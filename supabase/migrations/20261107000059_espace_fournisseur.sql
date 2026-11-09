-- Portail fournisseur avec compte (M17 niveau 2, lot 2 ; maquette « Espace fournisseur »), première
-- tranche en lecture : accueil, cotations, commandes, paiements, comptes et agrément.
-- Règles déduites de la maquette et du cahier des charges général, à valider avec le cahier des charges
-- des portails (absent du dépôt). Test d'intrusion indépendant exigé avant toute ouverture.
-- * Un compte fournisseur est rattaché à un seul fournisseur avec un sous-rôle (commercial, qualité,
--   logistique, finance), posé par l'administratrice ou les achats Chine.
-- * Le fournisseur ne voit que ses propres consultations, commandes et paiements : jamais le client,
--   le dossier, les prix de vente ni les autres fournisseurs ; ses plis restent scellés jusqu'à
--   l'ouverture ; ses comptes bancaires n'apparaissent que masqués.

create or replace function gbs.admin_compte_fournisseur(p_user uuid, p_fournisseur uuid, p_sous_role text, p_actif boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine'), 'GBS_VALIDATION_ADMIN');
  if p_sous_role not in ('commercial','qualite','logistique','finance') or not exists (select 1 from gbs.fournisseurs where id = p_fournisseur) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  -- Les achats Chine ne transforment jamais un compte interne en compte fournisseur.
  if not gbs_private.is_admin() and exists (select 1 from gbs.profils p where p.id = p_user and p.role is not null and p.role <> 'fournisseur') then
    raise exception 'GBS_ACCES_REFUSE' using errcode = '42501';
  end if;
  update gbs.profils set role = 'fournisseur', fournisseur_id = p_fournisseur, client_id = null, sous_role = p_sous_role, societes = '{}',
         pays = null, delegue_validation = false, actif = coalesce(p_actif, true)
   where id = p_user;
  if not found then raise exception 'GBS_PROFIL_INCONNU' using errcode = 'P0002'; end if;
end $$;

create or replace function gbs_private.mon_fournisseur() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.fournisseur_id from gbs.profils p where p.id = auth.uid() and p.actif and p.role = 'fournisseur' and gbs_private.role() = 'fournisseur'
$$;

create or replace function gbs.espace_fournisseur()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f uuid := gbs_private.mon_fournisseur(); x gbs.fournisseurs; p gbs.profils;
begin
  perform gbs_private.exiger(f is not null);
  select * into x from gbs.fournisseurs where id = f;
  select * into p from gbs.profils where id = auth.uid();
  return jsonb_build_object(
    'utilisateur', jsonb_build_object('nom', p.nom, 'sous_role', p.sous_role, 'langue', p.langue),
    'fournisseur', jsonb_build_object('reference', x.reference, 'raison_sociale_en', x.raison_sociale_en, 'raison_sociale_zh', x.raison_sociale_zh,
                     'statut_agrement', x.statut_agrement, 'note', x.note, 'engagement_non_commission_le', x.engagement_non_commission_le,
                     'due_diligence_jusqu_au', (select max(d.valide_jusqu_au) from gbs.due_diligences d where d.fournisseur_id = f and d.statut = 'validee')),
    -- Consultations auxquelles il est invité : objet et conditions ; son pli seulement, scellé (jamais les autres).
    'consultations', (select coalesce(jsonb_agg(jsonb_build_object('reference', c.reference, 'objet', c.objet, 'quantite', c.quantite,
                        'incoterm', c.incoterm_demande, 'lieu', c.lieu, 'date_limite', c.date_limite, 'fuseau', c.fuseau, 'statut', c.statut,
                        'pli_depose_le', (select max(k.depose_le) from gbs.plis k where k.consultation_id = c.id and k.fournisseur_id = f and k.statut <> 'remplace'))
                        order by c.date_limite desc), '[]'::jsonb)
                      from gbs.consultations_fournisseurs c
                     where exists (select 1 from gbs.liens_fournisseurs l where l.consultation_id = c.id and l.fournisseur_id = f) and c.statut <> 'annulee'),
    -- Ses commandes : ses propres prix ; ni client, ni dossier, ni prix de vente.
    'commandes', (select coalesce(jsonb_agg(jsonb_build_object('reference', k.reference, 'statut', k.statut, 'incoterm', k.incoterm, 'lieu', k.lieu,
                    'devise', k.devise, 'fob_montant', k.fob_montant,
                    'lignes', (select coalesce(jsonb_agg(jsonb_build_object('designation', a.designation, 'quantite', l.quantite,
                                 'prix_unitaire', l.prix_unitaire, 'montant', l.montant) order by l.cree_le), '[]'::jsonb)
                               from gbs.lignes_commande l join gbs.articles a on a.id = l.article_id where l.commande_id = k.id),
                    'paiements', (select coalesce(jsonb_agg(jsonb_build_object('nature', y.nature, 'montant', y.montant, 'devise', y.devise,
                                    'etat', case when y.statut in ('execute','confirme_client') then 'recu' when y.statut = 'refuse' then 'annule' else 'a_venir' end,
                                    'date', case when y.statut in ('execute','confirme_client') then y.execute_le end) order by y.cree_le), '[]'::jsonb)
                                  from gbs.paiements_fournisseurs y where y.commande_id = k.id))
                    order by k.reference desc), '[]'::jsonb)
                  from gbs.commandes k where k.fournisseur_id = f and k.statut <> 'brouillon'),
    -- Comptes de paiement : masqués.
    'comptes', (select coalesce(jsonb_agg(jsonb_build_object('type', cp.type, 'banque', cp.banque, 'fin_numero', right(cp.numero, 4),
                  'verifie', cp.verifie, 'verifie_le', cp.verifie_le) order by cp.verifie desc), '[]'::jsonb)
                from gbs.comptes_paiement cp where cp.fournisseur_id = f)
  );
end $$;

revoke all on function gbs_private.mon_fournisseur() from public, anon;
revoke all on function gbs.admin_compte_fournisseur(uuid, uuid, text, boolean), gbs.espace_fournisseur() from public, anon;
grant execute on function gbs.admin_compte_fournisseur(uuid, uuid, text, boolean), gbs.espace_fournisseur() to authenticated;
grant execute on function gbs_private.mon_fournisseur() to authenticated;
