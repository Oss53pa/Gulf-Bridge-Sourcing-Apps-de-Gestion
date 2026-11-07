-- Lot 1, M21 et section 5 (annulation) : un avoir émis sur une facture déjà encaissée
-- contre-passe les parts calculées sur cette facture — commission de l'agent pays et
-- flux entre sociétés — au prorata de l'avoir, sans jamais dépasser ce qui a été calculé.
-- La contre-passation tombe dans le mois de l'avoir. Pour un agent, un solde négatif
-- n'est pas « payé » : il reste en attente et s'impute sur le relevé suivant.

alter table gbs.partages
  alter column encaissement_id drop not null,
  add column contrepasse_de uuid references gbs.partages(id),
  add constraint partages_origine check ((encaissement_id is null) = (contrepasse_de is not null));
create index on gbs.partages (contrepasse_de);

create or replace function gbs_private.contrepasser_partages(p_avoir uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a gbs.factures; o gbs.factures; ratio numeric; p record; deja numeric; montant numeric; mois date;
begin
  select * into a from gbs.factures where id = p_avoir;
  if a.type <> 'avoir' or a.avoir_de is null then return; end if;
  select * into o from gbs.factures where id = a.avoir_de;
  if o.montant_ht is null or o.montant_ht = 0 then return; end if;
  ratio := least(abs(a.montant_ht) / abs(o.montant_ht), 1);
  mois := date_trunc('month', coalesce(a.date_emission, current_date))::date;
  for p in select * from gbs.partages x where x.facture_id = o.id and x.contrepasse_de is null loop
    select coalesce(-sum(r.montant_xof), 0) into deja from gbs.partages r where r.contrepasse_de = p.id;
    montant := least(round(p.montant_xof * ratio), p.montant_xof - deja);
    if montant > 0 then
      insert into gbs.partages (encaissement_id, facture_id, dossier_id, du_par, du_a, agent_id, base_xof, taux,
                                montant_xof, regle, regle_date_effet, mois, contrat_agent_id, contrepasse_de)
      values (null, a.id, p.dossier_id, p.du_par, p.du_a, p.agent_id, -round(p.base_xof * ratio), p.taux,
              -montant, p.regle, p.regle_date_effet, mois, p.contrat_agent_id, p.id);
    end if;
  end loop;
end $$;

create or replace function gbs_private.trg_facture_avoir_emis() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.type = 'avoir' and new.statut = 'emise' and old.statut is distinct from 'emise' then
    perform gbs_private.contrepasser_partages(new.id);
  end if;
  return null;
end $$;
create trigger factures_avoir_emis after update of statut on gbs.factures
  for each row execute function gbs_private.trg_facture_avoir_emis();

-- Relevé : les lignes de contre-passation n'ont pas d'encaissement ; date = émission de l'avoir.
create or replace view gbs.v_releve_flux with (security_invoker = true) as
select p.mois, p.du_par, p.du_a, p.agent_id, p.dossier_id, d.reference as dossier_reference,
       f.numero as facture_numero, coalesce(e.recu_le, f.date_emission) as recu_le, p.base_xof, p.taux, p.montant_xof,
       p.regle, p.regle_date_effet
from gbs.partages p
left join gbs.encaissements e on e.id = p.encaissement_id
join gbs.factures f on f.id = p.facture_id
left join gbs.dossiers d on d.id = p.dossier_id;

-- Relevé d'agent : seul un solde positif se valide ; un solde négatif ou nul attend
-- les commissions suivantes (imputation sur le relevé suivant).
create or replace function gbs.valider_releve_agent(p_agent uuid, p_mois date)
returns setof gbs.releves_agents language plpgsql security definer set search_path = '' as $$
declare m date := date_trunc('month', p_mois)::date; r gbs.releves_agents; s record; debiteur boolean := false;
begin
  perform gbs_private.exiger(gbs_private.is_admin(), 'GBS_VALIDATION_ADMIN');
  if p_mois is null or m >= date_trunc('month', current_date)::date then
    raise exception 'GBS_MOIS_NON_ECOULE: un relevé se valide une fois le mois terminé' using errcode = '22023';
  end if;
  perform set_config('gbs.rpc', 'releve_agent', true);
  for s in select p.du_par, count(*) n, count(*) filter (where p.contrat_agent_id is null and p.contrepasse_de is null) sc,
                  sum(p.montant_xof) t
             from gbs.partages p
            where p.du_a = 'agent' and p.agent_id = p_agent and p.mois <= m
              and not exists (select 1 from gbs.releves_agents_lignes l where l.partage_id = p.id)
            group by p.du_par loop
    if s.t <= 0 then debiteur := true; continue; end if;
    insert into gbs.releves_agents (agent_id, societe_id, mois, nb_lignes, lignes_sans_contrat, total_xof, valide_par)
    values (p_agent, (select id from gbs.societes where code = s.du_par), m, s.n, s.sc, s.t, auth.uid())
    returning * into r;
    insert into gbs.releves_agents_lignes (releve_id, partage_id)
    select r.id, p.id from gbs.partages p
     where p.du_a = 'agent' and p.agent_id = p_agent and p.du_par = s.du_par and p.mois <= m
       and not exists (select 1 from gbs.releves_agents_lignes l where l.partage_id = p.id);
    return next r;
  end loop;
  perform set_config('gbs.rpc', '', true);
  if r.id is null then
    if debiteur then
      raise exception 'GBS_RELEVE_DEBITEUR: les reprises sur avoir dépassent les commissions ; le solde s''imputera sur le relevé suivant' using errcode = 'P0001';
    end if;
    raise exception 'GBS_RELEVE_VIDE: aucune commission à relever' using errcode = 'P0001';
  end if;
end $$;

-- Commissions à relever : les reprises sur avoir ne sont pas des lignes « sans contrat ».
create or replace function gbs.commissions_a_relever()
returns table (agent_id uuid, agent text, societe_id uuid, societe text, mois_max date, nb_lignes bigint,
               lignes_sans_contrat bigint, total_xof numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.finance());
  return query
  select p.agent_id, pr.nom, s.id, s.code, max(p.mois), count(*),
         count(*) filter (where p.contrat_agent_id is null and p.contrepasse_de is null),
         sum(p.montant_xof)::numeric
    from gbs.partages p
    join gbs.profils pr on pr.id = p.agent_id
    join gbs.societes s on s.code = p.du_par
   where p.du_a = 'agent' and p.mois < date_trunc('month', current_date)::date
     and not exists (select 1 from gbs.releves_agents_lignes l where l.partage_id = p.id)
     and (gbs_private.is_admin() or s.id = any((gbs_private.profil()).societes))
   group by p.agent_id, pr.nom, s.id, s.code
   order by pr.nom, s.code;
end $$;

revoke execute on function gbs_private.contrepasser_partages(uuid), gbs_private.trg_facture_avoir_emis() from public;
grant execute on all functions in schema gbs_private to authenticated, service_role;
grant select on gbs.v_releve_flux to authenticated;
