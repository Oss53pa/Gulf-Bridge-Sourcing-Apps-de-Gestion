-- Lot 2, M4 : indicateurs de performance des fournisseurs, calculés (jamais saisis) sur une fenêtre glissante.
-- * Livraison à l'heure : commandes dont la livraison effective (au sens de l'Incoterm, saisie par les achats) est
--   intervenue au plus tard à la date promise, décalée par les avenants signés.
-- * Livraison complète : aucune réception en entrepôt de la commande avec moins de colis que prévu (même si la
--   réserve a été levée ensuite). Sans réception en entrepôt, la commande est comptée complète : le nombre de
--   commandes réellement contrôlées est rendu à part pour que la lecture reste honnête.
-- * Défauts en parties par million : défauts relevés / unités contrôlées × 1 000 000, sur les inspections réalisées
--   en production, avant expédition et en contre-inspection ; unités contrôlées = le plus grand échantillon du plan
--   ISO 2859-1 de l'inspection.
-- * Réponse aux cotations : invitations dont la date limite est passée ; réponse = offre reçue ou pli déposé ;
--   délai médian en heures entre l'invitation et la première réponse.
-- * Non-conformités ouvertes, dont critiques.
-- Seuils d'alerte en paramètres datés. L'alerte ne change jamais le statut d'agrément : la mise sous surveillance
-- reste une décision de l'administratrice.
-- Accès : administratrice, achats Chine, Hub Afrique ; chaque chiffre ne porte que sur les dossiers visibles de
-- l'utilisateur (cloisonnement par société inchangé).

insert into gbs.parametres_definitions (cle, type, minimum, maximum, validateur, module, libelle) values
  ('fournisseurs.performance_fenetre_mois', 'entier', 1, 60, null, 'achats', 'Fenêtre de calcul des indicateurs de performance des fournisseurs (mois)'),
  ('fournisseurs.alerte_livraison_taux', 'taux', 0, 1, null, 'achats', 'Alerte si le taux de livraison complète et à l''heure passe sous ce seuil'),
  ('fournisseurs.alerte_ppm', 'entier', 0, 1000000, null, 'achats', 'Alerte si le taux de défaut dépasse ce seuil (parties par million)');
insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('fournisseurs.performance_fenetre_mois', '12', date '2026-01-01', 'Douze mois glissants'),
  ('fournisseurs.alerte_livraison_taux', '0.9', date '2026-01-01', 'Moins de 90 % de livraisons complètes et à l''heure'),
  ('fournisseurs.alerte_ppm', '15000', date '2026-01-01', 'Plus de 1,5 % de défauts relevés en inspection');

create or replace function gbs.performance_fournisseurs(p_fournisseur uuid default null)
returns table (fournisseur_id uuid, fenetre_du date,
  livraisons int, a_l_heure int, completes int, completes_controlees int, otif int, taux_otif numeric, retard_moyen_jours numeric,
  unites_inspectees int, defauts int, ppm int, inspections int,
  invitations int, reponses int, taux_reponse numeric, delai_reponse_heures numeric,
  nc_ouvertes int, nc_critiques_ouvertes int, en_alerte boolean, motifs_alerte text[])
language plpgsql stable security definer set search_path = '' as $$
declare du date; s_otif numeric; s_ppm numeric;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine','hub_afrique'));
  du := (current_date - make_interval(months => gbs_private.param_num('fournisseurs.performance_fenetre_mois')::int))::date;
  s_otif := gbs_private.param_num('fournisseurs.alerte_livraison_taux');
  s_ppm := gbs_private.param_num('fournisseurs.alerte_ppm');
  return query
  with f as (
    select x.id from gbs.fournisseurs x where p_fournisseur is null or x.id = p_fournisseur
  ), liv as (
    select c.fournisseur_id, c.id, c.livraison_reelle_le <= c.date_livraison_promise as heure,
           greatest(c.livraison_reelle_le - c.date_livraison_promise, 0) as retard,
           exists (select 1 from gbs.receptions_entrepot r where r.commande_id = c.id) as controlee,
           not exists (select 1 from gbs.receptions_entrepot r where r.commande_id = c.id and r.colis_recus < r.colis_attendus) as complete
      from gbs.commandes c join f on f.id = c.fournisseur_id
     where c.statut <> 'annulee' and c.date_livraison_promise is not null and c.livraison_reelle_le is not null
       and c.livraison_reelle_le >= du and gbs_private.dossier_visible(c.dossier_id)
  ), liv_f as (
    select l.fournisseur_id, count(*)::int n, count(*) filter (where l.heure)::int heure,
           count(*) filter (where l.complete)::int complete, count(*) filter (where l.controlee)::int controlee,
           count(*) filter (where l.heure and l.complete)::int otif,
           round(avg(l.retard) filter (where not l.heure), 1) retard
      from liv l group by 1
  ), ins as (
    select c.fournisseur_id, count(*)::int n,
           sum(greatest(coalesce((i.plan->'critique'->>'n')::int, 0), coalesce((i.plan->'majeur'->>'n')::int, 0),
                        coalesce((i.plan->'mineur'->>'n')::int, 0)))::int unites,
           sum(i.defauts_critiques + i.defauts_majeurs + i.defauts_mineurs)::int defauts
      from gbs.inspections i join gbs.commandes c on c.id = i.commande_id join f on f.id = c.fournisseur_id
     where i.type in ('en_production','avant_expedition','contre_inspection') and i.statut in ('realisee','validee','refusee')
       and i.date_realisee >= du and gbs_private.dossier_visible(i.dossier_id)
     group by 1
  ), inv as (
    select v.fournisseur_id, v.invite_le,
           least((select min(o.recu_le) from gbs.offres o where o.consultation_id = v.consultation_id and o.fournisseur_id = v.fournisseur_id),
                 (select min(p.depose_le) from gbs.plis p where p.consultation_id = v.consultation_id and p.fournisseur_id = v.fournisseur_id)) as reponse
      from gbs.consultation_invites v join f on f.id = v.fournisseur_id
      join gbs.consultations_fournisseurs k on k.id = v.consultation_id
     where k.statut <> 'annulee' and k.date_limite < now() and k.date_limite >= du and gbs_private.dossier_visible(k.dossier_id)
  ), inv_f as (
    select v.fournisseur_id, count(*)::int n, count(v.reponse)::int rep,
           round((percentile_cont(0.5) within group (order by greatest(extract(epoch from v.reponse - v.invite_le), 0) / 3600)
                  filter (where v.reponse is not null))::numeric, 1) delai
      from inv v group by 1
  ), nc as (
    select c.fournisseur_id, count(*)::int n, count(*) filter (where x.gravite = 'critique')::int crit
      from gbs.non_conformites x
      join gbs.commandes c on c.id = coalesce(x.commande_id, (select i.commande_id from gbs.inspections i where i.id = x.inspection_id))
      join f on f.id = c.fournisseur_id
     where x.statut = 'ouverte' and gbs_private.dossier_visible(x.dossier_id)
     group by 1
  ), r as (
    select f.id,
           coalesce(l.n, 0) n, coalesce(l.heure, 0) heure, coalesce(l.complete, 0) complete, coalesce(l.controlee, 0) controlee,
           coalesce(l.otif, 0) otif, case when coalesce(l.n, 0) > 0 then round(l.otif::numeric / l.n, 4) end taux, l.retard,
           coalesce(s.unites, 0) unites, coalesce(s.defauts, 0) defauts,
           case when coalesce(s.unites, 0) > 0 then round(s.defauts::numeric * 1000000 / s.unites)::int end ppm, coalesce(s.n, 0) nins,
           coalesce(v.n, 0) ninv, coalesce(v.rep, 0) rep, case when coalesce(v.n, 0) > 0 then round(v.rep::numeric / v.n, 4) end trep, v.delai,
           coalesce(n.n, 0) nc, coalesce(n.crit, 0) crit
      from f left join liv_f l on l.fournisseur_id = f.id left join ins s on s.fournisseur_id = f.id
      left join inv_f v on v.fournisseur_id = f.id left join nc n on n.fournisseur_id = f.id
  )
  select r.id, du, r.n, r.heure, r.complete, r.controlee, r.otif, r.taux, r.retard,
         r.unites, r.defauts, r.ppm, r.nins, r.ninv, r.rep, r.trep, r.delai, r.nc, r.crit,
         cardinality(m.motifs) > 0, m.motifs
    from r cross join lateral (select array_remove(array[
           case when r.taux < s_otif then 'livraison' end,
           case when r.ppm > s_ppm then 'defauts' end,
           case when r.crit > 0 then 'nc_critique' end], null) motifs) m
   order by r.id;
end $$;

revoke all on function gbs.performance_fournisseurs(uuid) from public, anon;
grant execute on function gbs.performance_fournisseurs(uuid) to authenticated;
