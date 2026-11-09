-- Portail client avec compte (M14 niveau 2, lot 2 ; maquette « Espace client »), première tranche :
-- lecture de ses dossiers (accueil, dossier, expédition, documents, factures).
-- Règles déduites de la maquette et du cahier des charges général, à valider avec le cahier des charges
-- des portails (absent du dépôt). Un test d'intrusion indépendant reste exigé avant toute ouverture.
-- * Un compte client est rattaché à un seul client (profils.client_id) avec un sous-rôle : demandeur,
--   technique, valideur, finance. Le rattachement est posé par l'administratrice ; un utilisateur ne
--   modifie jamais lui-même son rattachement ni son sous-rôle (protection étendue).
-- * Contenu identique à la page de suivi par lien (même fonction) : aucun prix fournisseur, aucune
--   autre société cliente, documents limités aux pièces validées visibles par le client.
-- * Fichiers : un client ne lit que les documents visibles de ses propres dossiers (URL signées).

alter table gbs.profils
  add column client_id uuid references gbs.clients(id),
  add column fournisseur_id uuid references gbs.fournisseurs(id),
  add constraint profils_client_lie check ((client_id is null or role = 'client') and (role is distinct from 'client' or client_id is not null)),
  add constraint profils_fournisseur_lie check (fournisseur_id is null or role = 'fournisseur'),
  add constraint profils_sous_role_client check (role <> 'client' or sous_role in ('demandeur','technique','valideur','finance'));

-- Un profil ne modifie jamais lui-même son rôle, son rattachement externe ni son sous-rôle.
create or replace function gbs_private.trg_profil_protege() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.role, new.societes, new.pays, new.delegue_validation, new.actif, new.id, new.email, new.client_id, new.fournisseur_id, new.sous_role)
     is distinct from (old.role, old.societes, old.pays, old.delegue_validation, old.actif, old.id, old.email, old.client_id, old.fournisseur_id, old.sous_role)
     and not gbs_private.is_admin() and current_user in ('authenticated','anon') then
    raise exception 'GBS_ACCES_REFUSE' using errcode = '42501';
  end if;
  return new;
end $$;

-- Rôles internes : le rôle client passe par admin_compte_client ; quitter le rôle efface le rattachement.
create or replace function gbs.admin_definir_profil(p_user uuid, p_role text, p_societes uuid[],
  p_pays text default null, p_delegue boolean default false, p_actif boolean default true)
returns gbs.profils language plpgsql security definer set search_path = '' as $$
declare x gbs.profils;
begin
  perform gbs_private.exiger(gbs_private.is_admin(), 'GBS_VALIDATION_ADMIN');
  if p_role is not null and p_role not in ('admin','achats_chine','hub_afrique','agent_pays','inspecteur','comptable',
                                           'fournisseur','transitaire') then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if p_role = 'agent_pays' and p_pays is null then
    raise exception 'GBS_PAYS_AGENT_REQUIS' using errcode = '22023';
  end if;
  update gbs.profils set role = p_role, societes = coalesce(p_societes, '{}'), pays = p_pays,
         delegue_validation = coalesce(p_delegue, false), actif = coalesce(p_actif, true),
         client_id = null, fournisseur_id = case when p_role = 'fournisseur' then fournisseur_id end,
         sous_role = case when role = 'client' then null else sous_role end
   where id = p_user returning * into x;
  if x.id is null then raise exception 'GBS_PROFIL_INCONNU' using errcode = 'P0002'; end if;
  return x;
end $$;

-- Rattachement d'un compte à un client (administratrice).
create or replace function gbs.admin_compte_client(p_user uuid, p_client uuid, p_sous_role text, p_actif boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.is_admin(), 'GBS_VALIDATION_ADMIN');
  if p_sous_role not in ('demandeur','technique','valideur','finance') or not exists (select 1 from gbs.clients where id = p_client) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  update gbs.profils set role = 'client', client_id = p_client, fournisseur_id = null, sous_role = p_sous_role, societes = '{}',
         pays = null, delegue_validation = false, actif = coalesce(p_actif, true)
   where id = p_user;
  if not found then raise exception 'GBS_PROFIL_INCONNU' using errcode = 'P0002'; end if;
end $$;

-- Client de l'utilisateur connecté (null sinon).
create or replace function gbs_private.mon_client() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.client_id from gbs.profils p where p.id = auth.uid() and p.actif and p.role = 'client' and gbs_private.role() = 'client'
$$;

-- Contenu d'un dossier tel que le client le voit : même règle pour le lien de suivi et l'espace client.
create or replace function gbs_private.contenu_dossier_client(p_dossier uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d gbs.dossiers; c gbs.clients; po jsonb;
begin
  select * into d from gbs.dossiers where id = p_dossier;
  select * into c from gbs.clients where id = d.client_id;
  po := gbs_private.planning_ouverture_brut(d.id);
  return jsonb_build_object(
    'dossier', jsonb_build_object('reference', d.reference, 'intitule', d.intitule, 'modele', d.modele,
                 'statut', d.statut, 'phase_courante', d.phase_courante, 'ouvert_le', d.ouvert_le),
    'client', jsonb_build_object('raison_sociale', c.raison_sociale, 'langue', c.langue),
    'ouverture', case when d.date_ouverture_site is null then null else jsonb_build_object(
                   'date', d.date_ouverture_site, 'fin_projetee', po ->> 'fin_projetee',
                   'marge_jours_ouvres', po -> 'marge_jours_ouvres') end,
    'phases', (select coalesce(jsonb_agg(jsonb_build_object('phase', f.phase, 'ordre', f.ordre, 'statut',
                 case when f.statut in ('complete','validee') then 'terminee' when f.statut = 'non_commencee' then 'a_venir'
                      else 'en_cours' end,
                 'debut', f.reelle_debut, 'fin', f.reelle_fin, 'fin_prevue', f.prevue_fin) order by f.ordre), '[]'::jsonb)
               from gbs.dossier_phases f where f.dossier_id = d.id),
    'pieces_attendues', (select coalesce(jsonb_agg(jsonb_build_object('libelle', p.libelle, 'phase', p.phase,
                 'statut', case when p.statut in ('recue','a_verifier') then 'recue' else p.statut end,
                 'demandee_le', p.demandee_le) order by p.phase, p.libelle), '[]'::jsonb)
               from gbs.pieces p where p.dossier_id = d.id and p.fournie_par = 'client' and p.obligatoire),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('libelle', p.libelle, 'phase', p.phase,
                 'chemin', p.document_chemin, 'date', p.statut_le) order by p.statut_le), '[]'::jsonb)
               from gbs.pieces p where p.dossier_id = d.id and p.statut = 'validee' and p.document_chemin is not null
                and p.document_chemin like d.id::text || '/%'
                and gbs_private.piece_visible_client(p.code, d.mode_financier)),
    'retards', gbs_private.retards_par_partie(d.id),
    'points_bloquants', (select coalesce(jsonb_agg(jsonb_build_object('description', b.description, 'categorie', b.categorie,
                 'partie', gbs_private.partie_point_bloquant(b.categorie), 'impact_jours', coalesce(b.impact_jours, 0),
                 'resolu', b.resolu_le is not null, 'echeance', b.echeance) order by b.cree_le), '[]'::jsonb)
               from gbs.points_bloquants b where b.dossier_id = d.id and b.visible_client),
    'expeditions', (select coalesce(jsonb_agg(jsonb_build_object('reference', e.reference, 'mode', e.mode, 'statut', e.statut,
                 'port_arrivee', e.port_arrivee, 'etd', e.etd, 'eta', e.eta,
                 'etapes', (select coalesce(jsonb_agg(jsonb_build_object('etape', s.etape, 'lieu', s.lieu, 'survenue_le', s.survenue_le,
                              'commentaire', s.commentaire) order by s.survenue_le), '[]'::jsonb)
                            from gbs.expedition_etapes s where s.expedition_id = e.id and s.visible_client))
                 order by e.cree_le), '[]'::jsonb)
               from gbs.expeditions e where e.dossier_id = d.id),
    'factures', (select coalesce(jsonb_agg(jsonb_build_object('numero', f.numero, 'objet', f.objet, 'type', f.type,
                 'date_emission', f.date_emission, 'echeance', f.echeance, 'devise', f.devise, 'ttc', f.ttc,
                 'net_a_payer', f.net_a_payer, 'encaisse', f.encaisse, 'statut', f.statut) order by f.date_emission), '[]'::jsonb)
               from gbs.factures f where f.dossier_id = d.id and f.client_id = d.client_id
                and f.statut in ('emise','partiellement_payee','payee'))
  );
end $$;

-- Page de suivi par lien : contrôles du jeton inchangés, contenu commun.
create or replace function gbs.suivi_client(p_jeton text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l gbs.liens_suivi; d gbs.dossiers; max_heure int; k gbs.liens_suivi_consultations;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'GBS_ACCES_REFUSE' using errcode = '42501';
  end if;
  if p_jeton is null or p_jeton !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'GBS_LIEN_INVALIDE' using errcode = 'P0002';
  end if;
  select * into l from gbs.liens_suivi where empreinte = gbs_private.empreinte_jeton(p_jeton) for update;
  if l.id is null or l.revoque_le is not null or l.expire_le <= now() then
    raise exception 'GBS_LIEN_INVALIDE' using errcode = 'P0002';
  end if;
  select * into d from gbs.dossiers where id = l.dossier_id;
  if d.statut = 'annule' then raise exception 'GBS_LIEN_INVALIDE' using errcode = 'P0002'; end if;
  max_heure := gbs_private.param_num('suivi.consultations_max_heure')::int;
  insert into gbs.liens_suivi_consultations (lien_id) values (l.id) on conflict (lien_id) do nothing;
  select * into k from gbs.liens_suivi_consultations where lien_id = l.id for update;
  if k.fenetre_debut is null or k.fenetre_debut < now() - interval '1 hour' then
    update gbs.liens_suivi_consultations set fenetre_debut = now(), fenetre_n = 1, consultations = consultations + 1,
           derniere = now() where lien_id = l.id;
  elsif k.fenetre_n >= max_heure then
    raise exception 'GBS_TROP_DE_CONSULTATIONS' using errcode = 'P0001';
  else
    update gbs.liens_suivi_consultations set fenetre_n = fenetre_n + 1, consultations = consultations + 1,
           derniere = now() where lien_id = l.id;
  end if;
  return gbs_private.contenu_dossier_client(d.id) || jsonb_build_object('expire_le', l.expire_le);
end $$;

-- Espace client : la liste de ses dossiers (ouverts, suspendus, clos depuis moins d'un an).
create or replace function gbs.espace_client()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c uuid := gbs_private.mon_client(); p gbs.profils;
begin
  perform gbs_private.exiger(c is not null);
  select * into p from gbs.profils where id = auth.uid();
  return jsonb_build_object(
    'utilisateur', jsonb_build_object('nom', p.nom, 'sous_role', p.sous_role, 'langue', p.langue),
    'client', (select jsonb_build_object('raison_sociale', x.raison_sociale) from gbs.clients x where x.id = c),
    'dossiers', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'reference', d.reference, 'intitule', d.intitule,
                   'statut', d.statut, 'phase_courante', d.phase_courante, 'date_ouverture_site', d.date_ouverture_site,
                   'chef', (select jsonb_build_object('nom', q.nom, 'telephone', q.telephone) from gbs.profils q where q.id = d.chef_id))
                   order by d.statut <> 'ouvert', d.ouvert_le desc), '[]'::jsonb)
                 from gbs.dossiers d where d.client_id = c and (d.statut in ('ouvert','suspendu') or d.clos_le > now() - interval '1 year')));
end $$;

create or replace function gbs.espace_client_dossier(p_dossier uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c uuid := gbs_private.mon_client();
begin
  perform gbs_private.exiger(c is not null and exists (select 1 from gbs.dossiers d where d.id = p_dossier and d.client_id = c and d.statut <> 'annule'));
  return gbs_private.contenu_dossier_client(p_dossier);
end $$;

-- Fichiers : le client lit seulement les documents visibles de ses dossiers (même règle que le contenu).
create or replace function gbs_private.document_visible(p_bucket text, p_nom text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_bucket = 'gbs-documents' and (
    (p_nom ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
       and gbs_private.dossier_visible(substring(p_nom from 1 for 36)::uuid))
    or (p_nom ~ '^frais/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
       and gbs_private.interne()
       and (substring(p_nom from 7 for 36)::uuid = auth.uid() or gbs_private.has_role('admin','comptable')))
    or (p_nom ~ '^prospects/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
       and gbs_private.prospect_visible(substring(p_nom from 11 for 36)::uuid))
    or (p_nom ~ '^dd/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
       and gbs_private.has_role('admin','achats_chine'))
    or (gbs_private.mon_client() is not null and exists (
         select 1 from gbs.pieces p join gbs.dossiers d on d.id = p.dossier_id
          where p.document_chemin = p_nom and p.statut = 'validee' and d.client_id = gbs_private.mon_client() and d.statut <> 'annule'
            and gbs_private.piece_visible_client(p.code, d.mode_financier))))
$$;

revoke all on function gbs_private.contenu_dossier_client(uuid), gbs_private.mon_client() from public, anon;
revoke all on function gbs.admin_compte_client(uuid, uuid, text, boolean), gbs.espace_client(), gbs.espace_client_dossier(uuid) from public, anon;
grant execute on function gbs.admin_compte_client(uuid, uuid, text, boolean), gbs.espace_client(), gbs.espace_client_dossier(uuid) to authenticated;
-- Utilisées dans la règle de lecture du stockage : exécutables par authenticated.
grant execute on function gbs_private.mon_client(), gbs_private.document_visible(text, text) to authenticated;
revoke execute on function gbs.suivi_client(text) from public, anon, authenticated;
grant execute on function gbs.suivi_client(text) to service_role;
