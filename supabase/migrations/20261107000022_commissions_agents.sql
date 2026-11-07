-- Lot 1, M21 : commissions des agents pays.
-- * Contrat d'agent commercial : pays, taux, dates de validité. Le taux du contrat en
--   vigueur à la date de l'encaissement s'applique ; sans contrat, le paramètre daté
--   « agent.taux » (lot 0) s'applique et la ligne est signalée « sans contrat ».
-- * Relevé mensuel par agent et par société débitrice, validé par l'administratrice,
--   payé par une autre personne (quatre yeux). Une commission encaissée après la
--   validation d'un mois entre dans le relevé suivant (régularisation), jamais perdue.
-- * Export comptable : constatation de la charge à la validation, règlement au paiement.
-- * La commission entre dans les coûts du dossier (marge directe, M28).

-- -----------------------------------------------------------------------------
-- Contrats
-- -----------------------------------------------------------------------------
create table gbs.contrats_agents (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references gbs.profils(id),
  pays        char(2) not null check (pays ~ '^[A-Z]{2}$'),
  taux        numeric(6,4) not null check (taux > 0 and taux <= 0.5),
  debut       date not null,
  fin         date,
  reference   text not null check (length(trim(reference)) between 3 and 80),
  commentaire text check (length(commentaire) <= 1000),
  cree_le     timestamptz not null default now(),
  cree_par    uuid,
  check (fin is null or fin >= debut)
);
create index on gbs.contrats_agents (agent_id, debut);

alter table gbs.partages add column contrat_agent_id uuid references gbs.contrats_agents(id);

create or replace function gbs_private.trg_contrat_agent() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p gbs.profils; derniere date;
begin
  if tg_op = 'UPDATE' then
    -- Seules la date de fin et le commentaire se modifient ; la fin ne précède pas une commission déjà calculée.
    if (new.agent_id, new.pays, new.taux, new.debut, new.reference, new.cree_par, new.cree_le)
       is distinct from (old.agent_id, old.pays, old.taux, old.debut, old.reference, old.cree_par, old.cree_le) then
      raise exception 'GBS_CONTRAT_FIGE: seule la date de fin se modifie ; un nouveau taux exige un nouveau contrat' using errcode = 'P0001';
    end if;
    select max(e.recu_le) into derniere from gbs.partages x join gbs.encaissements e on e.id = x.encaissement_id
     where x.contrat_agent_id = new.id;
    if new.fin is not null and derniere is not null and new.fin < derniere then
      raise exception 'GBS_CONTRAT_FIN_INVALIDE' using errcode = '22023';
    end if;
  else
    new.cree_par := auth.uid();
    new.cree_le := now();
    new.reference := trim(new.reference);
  end if;
  select * into p from gbs.profils where id = new.agent_id;
  if p.id is null or p.role is distinct from 'agent_pays' or p.pays is distinct from new.pays then
    raise exception 'GBS_AGENT_INVALIDE: le contrat lie un agent pays à son propre pays' using errcode = '22023';
  end if;
  if exists (select 1 from gbs.contrats_agents c where c.agent_id = new.agent_id and c.id <> new.id
               and daterange(c.debut, c.fin, '[]') && daterange(new.debut, new.fin, '[]')) then
    raise exception 'GBS_CONTRATS_CHEVAUCHES' using errcode = '23P01';
  end if;
  return new;
end $$;
create trigger contrats_agents_regles before insert or update on gbs.contrats_agents
  for each row execute function gbs_private.trg_contrat_agent();
create trigger contrats_agents_audit after insert or update or delete on gbs.contrats_agents
  for each row execute function gbs_private.trg_audit();
create trigger contrats_agents_immuable before delete on gbs.contrats_agents
  for each row execute function gbs_private.trg_immuable();

-- -----------------------------------------------------------------------------
-- Calcul à l'encaissement : contrat en vigueur à la date de l'encaissement.
-- Reprend la fonction du lot 0 à l'identique pour les flux entre sociétés.
-- -----------------------------------------------------------------------------
create or replace function gbs_private.calculer_partage(p_enc uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e gbs.encaissements; f gbs.factures; s gbs.societes; c gbs.clients; dsr gbs.dossiers;
        cn gbs.societes; dref date; base numeric; taux numeric; part numeric; mois date;
        groupe text; ctr gbs.contrats_agents;
begin
  select * into e from gbs.encaissements where id = p_enc;
  select * into f from gbs.factures where id = e.facture_id;
  if f.client_id is null or f.type = 'avoir' then return; end if;   -- intragroupe : aucun partage
  select * into s from gbs.societes where id = f.societe_id;
  select * into c from gbs.clients where id = f.client_id;
  select * into dsr from gbs.dossiers where id = f.dossier_id;
  select * into cn from gbs.societes where code = 'GBS_CN';
  dref := coalesce(dsr.ouvert_le, e.recu_le);
  mois := date_trunc('month', e.recu_le)::date;
  -- Base hors taxes au prorata de l'encaissement sur le net à payer.
  base := round(e.montant_xof * (case when f.type = 'negoce' then f.marge_ht else f.montant_ht end)
                / nullif(f.net_a_payer, 0));
  if base is null or base = 0 then return; end if;

  groupe := case
    when f.type in ('forfait_consultation','forfait_projet','accord_cadre') then 'forfaits'
    when f.type = 'commission' then 'commissions'
    when f.type = 'installation' then 'installation'
    when f.type = 'negoce' then 'marge_negoce'
    else 'frais_gestion' end;

  -- Flux GBS Côte d'Ivoire -> GBS Chine (à partir de la création de GBS Chine)
  if s.code = 'GBS_CI' and e.recu_le >= cn.date_creation and groupe in ('forfaits','commissions') then
    taux := gbs_private.param_num('partage.ci_vers_cn.' || groupe, dref);
    part := round(base * taux);
    insert into gbs.partages (encaissement_id, facture_id, dossier_id, du_par, du_a, base_xof, taux,
                                 montant_xof, regle, regle_date_effet, mois)
    values (e.id, f.id, f.dossier_id, 'GBS_CI', 'GBS_CN', base, taux, part, 'partage.ci_vers_cn.' || groupe,
            (select max(date_effet) from gbs.parametres where cle = 'partage.ci_vers_cn.' || groupe and date_effet <= dref),
            mois);
  end if;
  -- Flux GBS Chine -> GBS Côte d'Ivoire pour les clients ivoiriens
  if s.code = 'GBS_CN' and c.pays = 'CI' and groupe in ('frais_gestion','marge_negoce') then
    taux := gbs_private.param_num('partage.cn_vers_ci.' || groupe, dref);
    part := round(base * taux);
    insert into gbs.partages (encaissement_id, facture_id, dossier_id, du_par, du_a, base_xof, taux,
                                 montant_xof, regle, regle_date_effet, mois)
    values (e.id, f.id, f.dossier_id, 'GBS_CN', 'GBS_CI', base, taux, part, 'partage.cn_vers_ci.' || groupe,
            (select max(date_effet) from gbs.parametres where cle = 'partage.cn_vers_ci.' || groupe and date_effet <= dref),
            mois);
  end if;
  -- Commission de l'agent pays sur les honoraires ou la marge de ses clients : taux du contrat
  -- en vigueur le jour de l'encaissement, à défaut paramètre daté (ligne signalée sans contrat).
  if c.origine = 'agent_pays' and c.agent_id is not null then
    select * into ctr from gbs.contrats_agents k
     where k.agent_id = c.agent_id and e.recu_le between k.debut and coalesce(k.fin, 'infinity'::date)
     order by k.debut desc limit 1;
    if ctr.id is not null then
      part := round(base * ctr.taux);
      insert into gbs.partages (encaissement_id, facture_id, dossier_id, du_par, du_a, agent_id, base_xof, taux,
                                   montant_xof, regle, regle_date_effet, mois, contrat_agent_id)
      values (e.id, f.id, f.dossier_id, s.code, 'agent', c.agent_id, base, ctr.taux, part, 'contrat_agent', ctr.debut, mois, ctr.id);
    else
      taux := gbs_private.param_num('agent.taux', dref);
      part := round(base * taux);
      insert into gbs.partages (encaissement_id, facture_id, dossier_id, du_par, du_a, agent_id, base_xof, taux,
                                   montant_xof, regle, regle_date_effet, mois)
      values (e.id, f.id, f.dossier_id, s.code, 'agent', c.agent_id, base, taux, part, 'agent.taux',
              (select max(date_effet) from gbs.parametres where cle = 'agent.taux' and date_effet <= dref),
              mois);
    end if;
  end if;
end $$;

-- Un encaissement n'est jamais daté dans le futur : sa date fixe le mois de la commission.
create or replace function gbs_private.trg_encaissement() returns trigger
language plpgsql security definer set search_path = '' as $$
declare f gbs.factures;
begin
  select * into f from gbs.factures where id = new.facture_id for update;
  if f.statut not in ('emise','partiellement_payee') then
    raise exception 'GBS_FACTURE_NON_EMISE: encaissement impossible (statut %)', f.statut using errcode = 'P0001';
  end if;
  if new.devise <> f.devise then
    raise exception 'GBS_DEVISE_ENCAISSEMENT: l''encaissement doit être enregistré en % (devise de la facture)', f.devise
      using errcode = 'P0001';
  end if;
  if new.recu_le > current_date then
    raise exception 'GBS_DATE_ENCAISSEMENT_INVALIDE' using errcode = '22023';
  end if;
  if f.encaisse + new.montant > f.net_a_payer then
    raise exception 'GBS_TROP_PERCU: % encaissés pour % dus', f.encaisse + new.montant, f.net_a_payer
      using errcode = 'P0001';
  end if;
  new.taux_xof := gbs_private.taux_xof(new.devise, new.recu_le);
  new.montant_xof := round(new.montant * new.taux_xof);
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Relevés mensuels par agent
-- -----------------------------------------------------------------------------
create table gbs.releves_agents (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references gbs.profils(id),
  societe_id    uuid not null references gbs.societes(id),
  mois          date not null check (mois = date_trunc('month', mois)::date),
  nb_lignes     int not null check (nb_lignes > 0),
  lignes_sans_contrat int not null default 0,
  total_xof     numeric(16,0) not null,
  valide_par    uuid not null references gbs.profils(id),
  valide_le     timestamptz not null default now(),
  paye_le       date,
  paye_par      uuid references gbs.profils(id),
  reference_paiement text check (length(reference_paiement) <= 80),
  unique (agent_id, societe_id, mois)
);
create table gbs.releves_agents_lignes (
  releve_id   uuid not null references gbs.releves_agents(id),
  partage_id  uuid not null unique references gbs.partages(id),
  primary key (releve_id, partage_id)
);

create or replace function gbs_private.trg_releve_agent() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'releve_agent' then
    raise exception 'GBS_VALIDATION_RPC' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.agent_id, new.societe_id, new.mois, new.nb_lignes, new.lignes_sans_contrat, new.total_xof,
                           new.valide_par, new.valide_le)
      is distinct from (old.agent_id, old.societe_id, old.mois, old.nb_lignes, old.lignes_sans_contrat, old.total_xof,
                        old.valide_par, old.valide_le) then
    raise exception 'GBS_RELEVE_FIGE' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger releves_agents_regles before insert or update on gbs.releves_agents
  for each row execute function gbs_private.trg_releve_agent();
create trigger releves_agents_audit after insert or update or delete on gbs.releves_agents
  for each row execute function gbs_private.trg_audit();
create trigger releves_agents_immuable before delete on gbs.releves_agents
  for each row execute function gbs_private.trg_immuable();
create trigger releves_agents_lignes_immuable before update or delete on gbs.releves_agents_lignes
  for each row execute function gbs_private.trg_immuable();

-- Commissions en attente de relevé (mois écoulés et non encore relevés), par agent et société.
create or replace function gbs.commissions_a_relever()
returns table (agent_id uuid, agent text, societe_id uuid, societe text, mois_max date, nb_lignes bigint,
               lignes_sans_contrat bigint, total_xof numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.finance());
  return query
  select p.agent_id, pr.nom, s.id, s.code, max(p.mois), count(*), count(*) filter (where p.contrat_agent_id is null),
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

-- Validation du relevé d'un mois écoulé : reprend toutes les commissions non relevées
-- jusqu'à ce mois inclus (régularisations comprises), une ligne par société débitrice.
create or replace function gbs.valider_releve_agent(p_agent uuid, p_mois date)
returns setof gbs.releves_agents language plpgsql security definer set search_path = '' as $$
declare m date := date_trunc('month', p_mois)::date; r gbs.releves_agents; s record;
begin
  perform gbs_private.exiger(gbs_private.is_admin(), 'GBS_VALIDATION_ADMIN');
  if p_mois is null or m >= date_trunc('month', current_date)::date then
    raise exception 'GBS_MOIS_NON_ECOULE: un relevé se valide une fois le mois terminé' using errcode = '22023';
  end if;
  perform set_config('gbs.rpc', 'releve_agent', true);
  for s in select p.du_par, count(*) n, count(*) filter (where p.contrat_agent_id is null) sc, sum(p.montant_xof) t
             from gbs.partages p
            where p.du_a = 'agent' and p.agent_id = p_agent and p.mois <= m
              and not exists (select 1 from gbs.releves_agents_lignes l where l.partage_id = p.id)
            group by p.du_par loop
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
    raise exception 'GBS_RELEVE_VIDE: aucune commission à relever' using errcode = 'P0001';
  end if;
end $$;

-- Paiement : par une autre personne que celle qui a validé, après la validation.
create or replace function gbs.payer_releve_agent(p_releve uuid, p_paye_le date, p_reference text)
returns gbs.releves_agents language plpgsql security definer set search_path = '' as $$
declare r gbs.releves_agents; ref text := trim(coalesce(p_reference, ''));
begin
  select * into r from gbs.releves_agents where id = p_releve for update;
  perform gbs_private.exiger(r.id is not null and gbs_private.finance()
    and (gbs_private.is_admin() or r.societe_id = any((gbs_private.profil()).societes)));
  if r.paye_le is not null then raise exception 'GBS_DEJA_PAYE' using errcode = 'P0001'; end if;
  if r.valide_par = auth.uid() then raise exception 'GBS_QUATRE_YEUX' using errcode = 'P0001'; end if;
  if p_paye_le is null or p_paye_le > current_date or p_paye_le < r.valide_le::date then
    raise exception 'GBS_DATE_PAIEMENT_INVALIDE' using errcode = '22023';
  end if;
  if length(ref) not between 3 and 80 then
    raise exception 'GBS_REFERENCE_PAIEMENT_INVALIDE' using errcode = '22023';
  end if;
  perform set_config('gbs.rpc', 'releve_agent', true);
  update gbs.releves_agents set paye_le = p_paye_le, paye_par = auth.uid(), reference_paiement = ref
   where id = p_releve returning * into r;
  perform set_config('gbs.rpc', '', true);
  return r;
end $$;

-- -----------------------------------------------------------------------------
-- Export comptable : écritures de la période pour une société (charge constatée à la
-- validation du relevé, règlement au paiement), montants en FCFA et dans la devise de
-- tenue de la société au cours du jour de l'écriture. Plan de comptes en paramètre daté.
-- -----------------------------------------------------------------------------
insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('export.comptes.GBS_CI', '{"charge":"6322","tiers":"4011","banque":"5211","journal_achats":"ACH","journal_banque":"BQ"}',
   date '2026-01-01', 'SYSCOHADA : commissions sur ventes, fournisseurs, banque — à confirmer par le cabinet comptable'),
  ('export.comptes.GBS_CN', '{"charge":"6601","tiers":"2241","banque":"1002","journal_achats":"ZJ","journal_banque":"YH"}',
   date '2026-01-01', 'Normes chinoises : frais de vente, autres dettes, banque — à confirmer par le cabinet comptable');

create or replace function gbs.export_commissions_agents(p_societe uuid, p_du date, p_au date)
returns table (date_ecriture date, journal text, compte text, compte_tiers text, piece text, libelle text,
               debit_xof numeric, credit_xof numeric, devise_tenue text, debit_devise numeric, credit_devise numeric)
language plpgsql stable security definer set search_path = '' as $$
declare s gbs.societes; r record; pc jsonb; tx numeric; lib text; piece_ text;
begin
  perform gbs_private.exiger(gbs_private.finance()
    and (gbs_private.is_admin() or p_societe = any((gbs_private.profil()).societes)));
  if p_du is null or p_au is null or p_au < p_du or p_au - p_du > 366 then
    raise exception 'GBS_PERIODE_INVALIDE' using errcode = '22023';
  end if;
  select * into s from gbs.societes where id = p_societe;
  if s.id is null then raise exception 'GBS_ACCES_REFUSE' using errcode = '42501'; end if;
  for r in select ra.*, pr.nom agent_nom from gbs.releves_agents ra join gbs.profils pr on pr.id = ra.agent_id
            where ra.societe_id = p_societe
              and ((ra.valide_le::date between p_du and p_au) or (ra.paye_le between p_du and p_au))
            order by ra.valide_le loop
    piece_ := 'COM-' || to_char(r.mois, 'YYYYMM') || '-' || left(r.id::text, 8);
    lib := 'Commission agent ' || r.agent_nom || ' ' || to_char(r.mois, 'MM/YYYY');
    devise_tenue := s.devise;
    if r.valide_le::date between p_du and p_au then
      pc := gbs_private.param('export.comptes.' || s.code, r.valide_le::date);
      if pc is null then raise exception 'GBS_PARAM_MANQUANT: export.comptes.%', s.code using errcode = 'P0001'; end if;
      tx := gbs_private.taux_xof(s.devise, r.valide_le::date);
      date_ecriture := r.valide_le::date; journal := pc ->> 'journal_achats'; piece := piece_; libelle := lib;
      compte := pc ->> 'charge'; compte_tiers := null;
      debit_xof := r.total_xof; credit_xof := 0; debit_devise := round(r.total_xof / tx, 2); credit_devise := 0;
      return next;
      compte := pc ->> 'tiers'; compte_tiers := 'AGT-' || left(r.agent_id::text, 8);
      debit_xof := 0; credit_xof := r.total_xof; debit_devise := 0; credit_devise := round(r.total_xof / tx, 2);
      return next;
    end if;
    if r.paye_le is not null and r.paye_le between p_du and p_au then
      pc := gbs_private.param('export.comptes.' || s.code, r.paye_le);
      if pc is null then raise exception 'GBS_PARAM_MANQUANT: export.comptes.%', s.code using errcode = 'P0001'; end if;
      tx := gbs_private.taux_xof(s.devise, r.paye_le);
      date_ecriture := r.paye_le; journal := pc ->> 'journal_banque'; piece := piece_;
      libelle := lib || ' — ' || r.reference_paiement;
      compte := pc ->> 'tiers'; compte_tiers := 'AGT-' || left(r.agent_id::text, 8);
      debit_xof := r.total_xof; credit_xof := 0; debit_devise := round(r.total_xof / tx, 2); credit_devise := 0;
      return next;
      compte := pc ->> 'banque'; compte_tiers := null;
      debit_xof := 0; credit_xof := r.total_xof; debit_devise := 0; credit_devise := round(r.total_xof / tx, 2);
      return next;
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Marge directe : la commission de l'agent est un coût du dossier.
-- -----------------------------------------------------------------------------
create or replace function gbs_private.couts_dossier(p_dossier uuid)
returns table (cout_id uuid, categorie text, cause_perte text, montant_xof numeric)
language sql stable security definer set search_path = '' as $$
  select c.id, c.categorie, c.cause_perte, c.montant_xof::numeric from gbs.couts c
   where c.dossier_id = p_dossier and c.statut in ('validee','remboursee')
     and not exists (select 1 from gbs.couts_repartition r where r.cout_id = c.id)
  union all
  select c.id, c.categorie, c.cause_perte, r.montant_xof::numeric from gbs.couts_repartition r
    join gbs.couts c on c.id = r.cout_id
   where r.dossier_id = p_dossier and c.statut in ('validee','remboursee')
  union all
  select p.id, 'commission_agent', null, p.montant_xof::numeric from gbs.partages p
   where p.dossier_id = p_dossier and p.du_a = 'agent'
$$;

-- -----------------------------------------------------------------------------
-- Droits : l'administratrice écrit les contrats ; la finance lit ; l'agent ne voit que les siens.
-- -----------------------------------------------------------------------------
alter table gbs.contrats_agents enable row level security;
alter table gbs.releves_agents enable row level security;
alter table gbs.releves_agents_lignes enable row level security;
grant select, insert on gbs.contrats_agents to authenticated;
grant update (fin, commentaire) on gbs.contrats_agents to authenticated;
grant select on gbs.releves_agents, gbs.releves_agents_lignes to authenticated;

create policy contrats_agents_lecture on gbs.contrats_agents for select using (
  gbs_private.finance() or (gbs_private.has_role('agent_pays') and agent_id = auth.uid()));
create policy contrats_agents_creation on gbs.contrats_agents for insert with check (gbs_private.is_admin());
create policy contrats_agents_modif on gbs.contrats_agents for update using (gbs_private.is_admin()) with check (gbs_private.is_admin());

create policy releves_agents_lecture on gbs.releves_agents for select using (
  gbs_private.is_admin()
  or (gbs_private.has_role('comptable') and societe_id = any((gbs_private.profil()).societes))
  or (gbs_private.has_role('agent_pays') and agent_id = auth.uid()));
create policy releves_agents_lignes_lecture on gbs.releves_agents_lignes for select using (
  exists (select 1 from gbs.releves_agents r where r.id = releve_id));

revoke execute on function gbs.commissions_a_relever(), gbs.valider_releve_agent(uuid, date),
  gbs.payer_releve_agent(uuid, date, text), gbs.export_commissions_agents(uuid, date, date),
  gbs_private.trg_contrat_agent(), gbs_private.trg_releve_agent() from public;
grant execute on function gbs.commissions_a_relever(), gbs.valider_releve_agent(uuid, date),
  gbs.payer_releve_agent(uuid, date, text), gbs.export_commissions_agents(uuid, date, date) to authenticated;
grant execute on all functions in schema gbs_private to authenticated, service_role;
