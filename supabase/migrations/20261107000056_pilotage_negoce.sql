-- Dossiers : pilotage du négoce clé en main (maquette NEG).
-- * Conditions du négoce par dossier : prix de vente convenu avec le client (HT, devise), clause de
--   révision de prix et son seuil. Saisies par fonction ; chaque changement est journalisé.
-- * Pilotage calculé par la base, en FCFA au dernier taux connu, avec un choc de change simulé :
--   coût complet = commandes fournisseurs (FOB, hors annulées) + coûts validés du dossier ;
--   marge = prix de vente − coût complet ; acomptes reçus du client (encaissements) et versés aux
--   fournisseurs (paiements exécutés) ; couverture du risque : clause de révision, garantie de
--   restitution d'acompte en vigueur, acompte client ≥ acompte fournisseur, marge ≥ minimum paramétré.
-- * Accès : administratrice, comptabilité et achats Chine, sur les dossiers visibles.

create table gbs.negoce_conditions (
  dossier_id      uuid primary key references gbs.dossiers(id),
  prix_vente_ht   numeric(16,2) not null check (prix_vente_ht > 0 and prix_vente_ht <= 1e13),
  devise          char(3) not null default 'XOF' check (devise in ('XOF','XAF','USD','EUR')),
  clause_revision boolean not null default false,
  seuil_revision  numeric(5,4) check (seuil_revision between 0 and 0.5),
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check (not clause_revision or seuil_revision is not null)
);

create or replace function gbs_private.trg_negoce_rpc() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'negoce' then
    raise exception 'GBS_VALIDATION_RPC: les conditions du négoce se modifient par la fonction dédiée' using errcode = 'P0001';
  end if;
  return new;
end $$;

alter table gbs.negoce_conditions enable row level security;
grant select on gbs.negoce_conditions to authenticated;
create trigger negoce_rpc before insert or update on gbs.negoce_conditions for each row execute function gbs_private.trg_negoce_rpc();
create trigger negoce_touch before update on gbs.negoce_conditions for each row execute function gbs_private.trg_touch();
create trigger negoce_cree before insert on gbs.negoce_conditions for each row execute function gbs_private.trg_cree_par();
create trigger negoce_audit after insert or update on gbs.negoce_conditions for each row execute function gbs_private.trg_audit();
create trigger negoce_nodel before delete on gbs.negoce_conditions for each row execute function gbs_private.trg_no_delete();
create policy negoce_lecture on gbs.negoce_conditions for select using (
  gbs_private.has_role('admin','comptable','achats_chine') and gbs_private.dossier_visible(dossier_id));

create or replace function gbs.definir_conditions_negoce(p_dossier uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','comptable') and gbs_private.dossier_visible(p_dossier));
  if not exists (select 1 from gbs.dossiers d where d.id = p_dossier and d.mode_financier = 'negoce')
     or jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) k where k not in ('prix_vente_ht','devise','clause_revision','seuil_revision'))
     or coalesce(jsonb_typeof(p -> 'prix_vente_ht'), '') <> 'number'
     or (p ? 'devise' and jsonb_typeof(p -> 'devise') <> 'string')
     or (p ? 'clause_revision' and jsonb_typeof(p -> 'clause_revision') <> 'boolean')
     or (p ? 'seuil_revision' and jsonb_typeof(p -> 'seuil_revision') not in ('number','null')) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform gbs_private.rpc('negoce');
  insert into gbs.negoce_conditions (dossier_id, prix_vente_ht, devise, clause_revision, seuil_revision)
  values (p_dossier, (p ->> 'prix_vente_ht')::numeric, coalesce(p ->> 'devise', 'XOF'), coalesce((p ->> 'clause_revision')::boolean, false),
          (p ->> 'seuil_revision')::numeric)
  on conflict (dossier_id) do update set prix_vente_ht = excluded.prix_vente_ht, devise = excluded.devise,
    clause_revision = excluded.clause_revision, seuil_revision = excluded.seuil_revision;
  perform gbs_private.rpc('');
exception
  when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

-- Pilotage : une ligne par dossier de négoce visible ; détail des achats en JSON.
create or replace function gbs.pilotage_negoce(p_choc_cny numeric default 0)
returns table (dossier_id uuid, reference text, intitule text, client text, statut text, prix_vente_xof numeric, achats_xof numeric, couts_xof numeric,
               cout_complet_xof numeric, marge_xof numeric, taux_marge numeric, acompte_recu_xof numeric, acompte_verse_xof numeric,
               clause_revision boolean, seuil_revision numeric, garantie_restitution boolean, marge_min numeric, taux_manquant boolean, achats jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare d record; t_cny numeric; t_usd numeric; mm numeric;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','comptable','achats_chine'));
  if p_choc_cny is null or p_choc_cny not between -0.5 and 0.5 then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  select x.taux_xof into t_cny from gbs.taux_change x where x.devise = 'CNY' and x.date_taux <= current_date order by x.date_taux desc limit 1;
  select x.taux_xof into t_usd from gbs.taux_change x where x.devise = 'USD' and x.date_taux <= current_date order by x.date_taux desc limit 1;
  mm := gbs_private.param_num('tarif.negoce_marge_min', current_date);
  for d in select x.id, x.reference, x.intitule, x.statut, c.raison_sociale, n.prix_vente_ht, n.devise, n.clause_revision, n.seuil_revision
             from gbs.dossiers x join gbs.clients c on c.id = x.client_id left join gbs.negoce_conditions n on n.dossier_id = x.id
            where x.mode_financier = 'negoce' and x.statut in ('ouvert','suspendu') and gbs_private.dossier_visible(x.id)
            order by x.reference loop
    dossier_id := d.id; reference := d.reference; intitule := d.intitule; client := d.raison_sociale; statut := d.statut;
    clause_revision := coalesce(d.clause_revision, false); seuil_revision := d.seuil_revision; marge_min := mm;
    taux_manquant := (t_cny is null and exists (select 1 from gbs.commandes k where k.dossier_id = d.id and k.devise = 'CNY' and k.statut <> 'annulee'))
                  or (t_usd is null and exists (select 1 from gbs.commandes k where k.dossier_id = d.id and k.devise = 'USD' and k.statut <> 'annulee'));
    prix_vente_xof := case when d.prix_vente_ht is null then null when d.devise = 'XOF' then d.prix_vente_ht
                           else round(d.prix_vente_ht * (select x.taux_xof from gbs.taux_change x where x.devise = d.devise and x.date_taux <= current_date order by x.date_taux desc limit 1)) end;
    taux_manquant := taux_manquant or (d.prix_vente_ht is not null and prix_vente_xof is null);
    select coalesce(sum(round(coalesce(k.fob_montant, 0) * case k.devise when 'CNY' then coalesce(t_cny, 0) * (1 + p_choc_cny) else coalesce(t_usd, 0) end)), 0),
           coalesce(jsonb_agg(jsonb_build_object('reference', k.reference, 'fournisseur', f.raison_sociale_en, 'montant', k.fob_montant, 'devise', k.devise,
             'montant_xof', round(coalesce(k.fob_montant, 0) * case k.devise when 'CNY' then coalesce(t_cny, 0) * (1 + p_choc_cny) else coalesce(t_usd, 0) end)) order by k.reference), '[]'::jsonb)
      into achats_xof, achats
      from gbs.commandes k join gbs.fournisseurs f on f.id = k.fournisseur_id where k.dossier_id = d.id and k.statut <> 'annulee';
    select coalesce(sum(x.montant_xof), 0) into couts_xof from gbs_private.couts_dossier(d.id) x;
    cout_complet_xof := achats_xof + couts_xof;
    -- Taux manquant : pas de marge affichée plutôt qu'une marge fausse.
    marge_xof := case when prix_vente_xof is null or taux_manquant then null else prix_vente_xof - cout_complet_xof end;
    taux_marge := case when coalesce(prix_vente_xof, 0) > 0 and marge_xof is not null then round(marge_xof / prix_vente_xof, 4) end;
    select coalesce(sum(coalesce(e.montant_xof, 0)), 0) into acompte_recu_xof
      from gbs.encaissements e join gbs.factures f on f.id = e.facture_id where f.dossier_id = d.id and f.client_id is not null;
    select coalesce(sum(round(p.montant * case p.devise when 'CNY' then coalesce(t_cny, 0) else coalesce(t_usd, 0) end)), 0) into acompte_verse_xof
      from gbs.paiements_fournisseurs p where p.dossier_id = d.id and p.statut in ('execute','confirme_client');
    garantie_restitution := exists (select 1 from gbs.garanties_bancaires g where g.dossier_id = d.id and g.type = 'restitution_acompte'
                                     and g.statut in ('emise','mainlevee_demandee'));
    return next;
  end loop;
end $$;

revoke all on function gbs_private.trg_negoce_rpc() from public, anon, authenticated;
revoke all on function gbs.definir_conditions_negoce(uuid, jsonb), gbs.pilotage_negoce(numeric) from public, anon;
grant execute on function gbs.definir_conditions_negoce(uuid, jsonb), gbs.pilotage_negoce(numeric) to authenticated;
