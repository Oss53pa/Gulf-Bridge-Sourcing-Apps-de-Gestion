-- Portefeuille des dossiers (M23, maquette « Portefeuille ») : une ligne par dossier visible avec
-- sa complétude, sa valeur FOB, sa marge avant l'ouverture du site et un état de synthèse.
-- * Visibilité : celle des dossiers (gbs_private.dossier_visible), jamais plus large.
-- * Complétude : pièces obligatoires validées sur les pièces obligatoires des phases déjà ouvertes
--   (phase courante incluse).
-- * Valeur FOB (FCFA, taux du jour) : mêmes droits que les montants FOB ailleurs : administratrice
--   et achats Chine ; Hub Afrique pour les achats accompagnés en Côte d'Ivoire ; sinon null.
-- * Marge : jours ouvrés entre la fin projetée et la date d'ouverture du site (rétroplanning).
-- * Alerte de marge : marge inférieure au seuil paramétré (portefeuille.marge_alerte_jours).
-- * État, par ordre de gravité : point bloquant ouvert, non-conformité ouverte, ouverture intenable,
--   attente d'un tiers, sinon dans les délais.

insert into gbs.parametres_definitions (cle, type, minimum, maximum, validateur, module, libelle) values
  ('portefeuille.marge_alerte_jours','entier',0,365,null,'dossiers','Portefeuille : alerte si la marge avant ouverture est inférieure à (jours ouvrés)');
insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('portefeuille.marge_alerte_jours', '7', '2026-01-01', 'Valeur initiale');

create or replace function gbs.portefeuille(p_statut text default 'ouvert')
returns table (
  id uuid, reference text, intitule text, client_id uuid, client text, segment text, pays text, societe_id uuid,
  modele text, mode_financier text, phase_courante text, statut text, priorite text, ouvert_le date,
  date_ouverture_site date, chef_id uuid, completude numeric, fob_xof numeric, marge_jours int, marge_alerte boolean, etat text)
language plpgsql stable security definer set search_path = '' as $$
declare r text := gbs_private.role();
  seuil int := coalesce(gbs_private.param_num_ou_null('portefeuille.marge_alerte_jours'), 7)::int;
begin
  perform gbs_private.exiger(gbs_private.interne());
  if p_statut is not null and p_statut not in ('ouvert','suspendu','clos','annule') then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  return query
  with d as (
    select x.*, case when x.date_ouverture_site is not null then gbs_private.planning_ouverture_brut(x.id) end as plan
      from gbs.dossiers x
     where (p_statut is null or x.statut = p_statut) and gbs_private.dossier_visible(x.id)
     order by x.ouvert_le desc limit 500
  ), courante as (
    select dp.dossier_id, dp.ordre, dp.statut from gbs.dossier_phases dp join d on d.id = dp.dossier_id and dp.phase = d.phase_courante
  ), comp as (
    select p.dossier_id,
           count(*) filter (where p.statut = 'validee')::numeric / nullif(count(*), 0) as taux
      from gbs.pieces p
      join gbs.dossier_phases dp on dp.dossier_id = p.dossier_id and dp.phase = p.phase
      join courante c on c.dossier_id = p.dossier_id
     where p.obligatoire and dp.ordre <= c.ordre
     group by p.dossier_id
  ), fob as (
    select c.dossier_id, sum(round(gbs_private.to_xof(c.fob_montant, c.devise, current_date))) as xof
      from gbs.commandes c join d on d.id = c.dossier_id
     where c.statut <> 'annulee' and c.fob_montant is not null
     group by c.dossier_id
  )
  select d.id, d.reference, d.intitule, d.client_id, cl.raison_sociale, cl.segment, d.pays::text, d.societe_id,
         d.modele, d.mode_financier, d.phase_courante, d.statut, d.priorite, d.ouvert_le, d.date_ouverture_site, d.chef_id,
         round(coalesce(comp.taux, 0), 4),
         case when r in ('admin','achats_chine') or (r = 'hub_afrique' and d.mode_financier = 'accompagne' and d.pays = 'CI')
              then fob.xof end,
         (d.plan ->> 'marge_jours_ouvres')::int,
         coalesce((d.plan ->> 'marge_jours_ouvres')::int < seuil, false),
         case
           when d.statut <> 'ouvert' then d.statut
           when exists (select 1 from gbs.points_bloquants b where b.dossier_id = d.id and b.resolu_le is null) then 'bloquant'
           when exists (select 1 from gbs.non_conformites n where n.dossier_id = d.id and n.statut = 'ouverte') then 'nc_ouverte'
           when coalesce((d.plan ->> 'intenable')::boolean, false) then 'intenable'
           when courante.statut = 'attente_tiers' then 'attente_tiers'
           else 'dans_les_delais'
         end
    from d
    join gbs.clients cl on cl.id = d.client_id
    left join courante on courante.dossier_id = d.id
    left join comp on comp.dossier_id = d.id
    left join fob on fob.dossier_id = d.id
   order by d.ouvert_le desc, d.reference;
end $$;
revoke all on function gbs.portefeuille(text) from public, anon;
grant execute on function gbs.portefeuille(text) to authenticated;
