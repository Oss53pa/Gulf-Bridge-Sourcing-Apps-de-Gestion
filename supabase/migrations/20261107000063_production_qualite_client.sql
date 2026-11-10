-- Portail client : onglet « Production et qualité » (maquette « Espace client · production et qualité »).
-- * Avancement des commandes (statut, produits et quantités) sans aucun prix ; le nom du fabricant
--   n'est montré qu'en achat accompagné (le client achète en direct), jamais en négoce.
-- * Inspections : planifiées et réalisées ; résultats (décision, défauts par gravité) seulement une fois
--   l'inspection validée.
-- * Non-conformités du dossier : gravité, description, correction, statut, délai.
-- Ajouté au contenu de l'espace client uniquement ; la page de suivi par lien est inchangée.

create or replace function gbs_private.production_qualite_client(p_dossier uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'commandes', (select coalesce(jsonb_agg(jsonb_build_object('reference', k.reference, 'statut', k.statut,
                    'fabricant', case when d.mode_financier = 'accompagne' then f.raison_sociale_en end,
                    'produits', (select coalesce(jsonb_agg(jsonb_build_object('designation', a.designation, 'quantite', l.quantite) order by l.cree_le), '[]'::jsonb)
                                 from gbs.lignes_commande l join gbs.articles a on a.id = l.article_id where l.commande_id = k.id))
                    order by k.reference), '[]'::jsonb)
                  from gbs.commandes k join gbs.fournisseurs f on f.id = k.fournisseur_id
                 where k.dossier_id = d.id and k.statut not in ('brouillon','annulee')),
    'inspections', (select coalesce(jsonb_agg(jsonb_build_object('reference', i.reference, 'type', i.type, 'produit', i.produit,
                      'date_prevue', i.date_prevue, 'date_realisee', i.date_realisee, 'statut', i.statut,
                      'decision', case when i.statut = 'validee' then i.decision end,
                      'defauts', case when i.statut = 'validee' then jsonb_build_object('critiques', i.defauts_critiques, 'majeurs', i.defauts_majeurs, 'mineurs', i.defauts_mineurs) end)
                      order by coalesce(i.date_realisee, i.date_prevue) desc nulls last), '[]'::jsonb)
                    from gbs.inspections i where i.dossier_id = d.id),
    'non_conformites', (select coalesce(jsonb_agg(jsonb_build_object('reference', n.reference, 'gravite', n.gravite, 'description', n.description,
                          'correction', n.correction, 'statut', n.statut, 'delai', n.delai) order by n.cree_le desc), '[]'::jsonb)
                        from gbs.non_conformites n where n.dossier_id = d.id))
  from gbs.dossiers d where d.id = p_dossier
$$;

create or replace function gbs.espace_client_dossier(p_dossier uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c uuid := gbs_private.mon_client();
begin
  perform gbs_private.exiger(c is not null and exists (select 1 from gbs.dossiers d where d.id = p_dossier and d.client_id = c and d.statut <> 'annule'));
  return gbs_private.contenu_dossier_client(p_dossier) || jsonb_build_object('production', gbs_private.production_qualite_client(p_dossier));
end $$;

revoke all on function gbs_private.production_qualite_client(uuid) from public, anon, authenticated;
