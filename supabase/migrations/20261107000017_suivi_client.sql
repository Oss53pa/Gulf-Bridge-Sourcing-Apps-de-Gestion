-- Lot 1, M14 niveau 1 : page de suivi du client par lien sécurisé, en lecture seule.
--
-- Sécurité :
-- - jeton aléatoire de 256 bits, remis une seule fois ; la base n'en garde que
--   l'empreinte SHA-256 ; durée de vie bornée (90 jours au plus), révocable ;
-- - lecture uniquement par gbs.suivi_client(), réservée au rôle de service :
--   l'accès passe par la fonction serveur gbs-suivi (limitation de débit par
--   adresse, erreurs génériques), jamais directement par l'API publique ;
-- - consultations plafonnées par lien et par heure (seuil en paramètre) ;
-- - réponse limitée à une liste blanche de champs : ni prix fournisseur, ni
--   marge, ni calcul de commission ; en négoce, ni facture du fabricant ni
--   identité du fournisseur.

-- -----------------------------------------------------------------------------
-- Calculs de délais sans contrôle d'accès (appelés par les fonctions contrôlées).
-- -----------------------------------------------------------------------------
create or replace function gbs_private.etat_delais_brut(p_dossier uuid)
returns table (phase text, ordre int, statut text, responsable_id uuid, pays_calendrier text,
               debut date, fin date, cible int, jours_internes int, jours_externes int,
               echeance date, voyant text)
language plpgsql stable security definer set search_path = '' as $$
declare d gbs.dossiers; ph record; seuil numeric; total int; ext int; jusqua date;
begin
  select * into d from gbs.dossiers where id = p_dossier;
  seuil := gbs_private.param_num('delai.seuil_alerte');
  for ph in select p.*, c.jours_ouvres from gbs.dossier_phases p
              left join gbs.delais_cibles c on c.modele = d.modele and c.phase = p.phase
             where p.dossier_id = p_dossier order by p.ordre loop
    phase := ph.phase; ordre := ph.ordre; statut := ph.statut; responsable_id := ph.responsable_id;
    pays_calendrier := gbs_private.pays_calendrier(ph.responsable_id, d.pays);
    debut := ph.reelle_debut; fin := ph.reelle_fin; cible := ph.jours_ouvres;
    jours_internes := null; jours_externes := null; echeance := null; voyant := null;
    if ph.reelle_debut is not null then
      jusqua := coalesce(ph.reelle_fin, current_date);
      total := gbs_private.jours_ouvres_entre(pays_calendrier, ph.reelle_debut, jusqua);
      select coalesce(sum(gbs_private.jours_ouvres_entre(pays_calendrier, a.debut, least(coalesce(a.fin, jusqua), jusqua))), 0)
        into ext from gbs.phase_attentes a where a.phase_id = ph.id;
      jours_externes := ext;
      jours_internes := greatest(total - ext, 0);
      if cible is not null then
        echeance := gbs_private.ajouter_jours_ouvres(pays_calendrier, ph.reelle_debut, cible + ext);
        voyant := case when jours_internes > cible then 'rouge'
                       when jours_internes >= ceil(cible * seuil) then 'orange'
                       else 'vert' end;
      end if;
    end if;
    return next;
  end loop;
end $$;

create or replace function gbs.etat_delais(p_dossier uuid)
returns table (phase text, ordre int, statut text, responsable_id uuid, pays_calendrier text,
               debut date, fin date, cible int, jours_internes int, jours_externes int,
               echeance date, voyant text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.interne() and gbs_private.dossier_visible(p_dossier));
  return query select * from gbs_private.etat_delais_brut(p_dossier);
end $$;

create or replace function gbs_private.planning_ouverture_brut(p_dossier uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d gbs.dossiers; e record; retro jsonb := '{}'::jsonb; phases jsonb := '[]'::jsonb;
        manquantes text[]; fin date; debut date; proj_debut date; proj_fin date := null;
        projection_possible boolean := true; marge int; projete date;
begin
  select * into d from gbs.dossiers where id = p_dossier;
  if d.date_ouverture_site is null then
    return jsonb_build_object('date_ouverture', null);
  end if;
  select coalesce(array_agg(x.phase order by x.ordre), '{}') into manquantes
    from gbs_private.etat_delais_brut(p_dossier) x where x.phase <> 'cloture' and x.cible is null;
  if cardinality(manquantes) = 0 then
    fin := d.date_ouverture_site;
    for e in select * from gbs_private.etat_delais_brut(p_dossier) x where x.phase <> 'cloture' order by x.ordre desc loop
      debut := gbs_private.decaler_jours_ouvres(e.pays_calendrier, fin, -e.cible);
      retro := retro || jsonb_build_object(e.phase, jsonb_build_object('debut', debut, 'fin', fin));
      fin := debut;
    end loop;
  end if;
  for e in select * from gbs_private.etat_delais_brut(p_dossier) x where x.phase <> 'cloture' order by x.ordre loop
    proj_debut := null;
    if e.statut in ('complete','validee') then
      proj_debut := e.debut; proj_fin := coalesce(e.fin, proj_fin);
    elsif not projection_possible or e.cible is null then
      projection_possible := false; proj_fin := null;
    elsif e.debut is not null then
      proj_debut := e.debut;
      proj_fin := gbs_private.ajouter_jours_ouvres(e.pays_calendrier, greatest(current_date, e.debut),
                                                   greatest(e.cible - coalesce(e.jours_internes, 0), 0));
    else
      proj_debut := coalesce(proj_fin, current_date);
      proj_fin := gbs_private.ajouter_jours_ouvres(e.pays_calendrier, proj_debut, e.cible);
    end if;
    phases := phases || jsonb_build_array(jsonb_build_object(
      'phase', e.phase, 'ordre', e.ordre, 'statut', e.statut, 'cible', e.cible, 'pays_calendrier', e.pays_calendrier,
      'debut_au_plus_tard', retro -> e.phase ->> 'debut', 'fin_au_plus_tard', retro -> e.phase ->> 'fin',
      'debut_projete', proj_debut, 'fin_projetee', case when projection_possible then proj_fin end,
      'en_retard', projection_possible and proj_fin is not null and retro ? e.phase
                   and proj_fin > (retro -> e.phase ->> 'fin')::date));
  end loop;
  projete := case when projection_possible then proj_fin end;
  if projete is not null then
    marge := case when projete <= d.date_ouverture_site
                  then gbs_private.jours_ouvres_entre(d.pays, projete, d.date_ouverture_site)
                  else -gbs_private.jours_ouvres_entre(d.pays, d.date_ouverture_site, projete) end;
  end if;
  return jsonb_build_object(
    'date_ouverture', d.date_ouverture_site,
    'cibles_manquantes', to_jsonb(manquantes),
    'debut_au_plus_tard', (select min((v ->> 'debut')::date) from jsonb_each(retro) as j(k, v)),
    'fin_projetee', projete,
    'marge_jours_ouvres', marge,
    'intenable', marge is not null and marge < 0,
    'phases', phases);
end $$;

create or replace function gbs.planning_ouverture(p_dossier uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.interne() and gbs_private.dossier_visible(p_dossier));
  return gbs_private.planning_ouverture_brut(p_dossier);
end $$;

-- -----------------------------------------------------------------------------
-- Liens de suivi.
-- -----------------------------------------------------------------------------
create table gbs.liens_suivi (
  id            uuid primary key default gen_random_uuid(),
  dossier_id    uuid not null references gbs.dossiers(id),
  empreinte     text not null unique check (empreinte ~ '^[0-9a-f]{64}$'),
  destinataire  text not null check (length(destinataire) between 2 and 200),
  expire_le     timestamptz not null,
  revoque_le    timestamptz,
  revoque_par   uuid references gbs.profils(id),
  cree_le timestamptz not null default now(), cree_par uuid
);
create index on gbs.liens_suivi (dossier_id);
create trigger liens_cree before insert on gbs.liens_suivi for each row execute function gbs_private.trg_cree_par();
create trigger liens_nodel before delete on gbs.liens_suivi for each row execute function gbs_private.trg_no_delete();
-- Création et révocation au journal d'audit ; les consultations sont comptées à part.
create trigger liens_audit after insert or update on gbs.liens_suivi
  for each row execute function gbs_private.trg_audit();

create table gbs.liens_suivi_consultations (
  lien_id       uuid primary key references gbs.liens_suivi(id),
  consultations int not null default 0,
  derniere      timestamptz,
  fenetre_debut timestamptz,
  fenetre_n     int not null default 0
);
alter table gbs.liens_suivi_consultations enable row level security;
grant select on gbs.liens_suivi_consultations to authenticated;
create policy consultations_lecture on gbs.liens_suivi_consultations for select using (
  exists (select 1 from gbs.liens_suivi l where l.id = lien_id
           and gbs_private.has_role('admin','hub_afrique','agent_pays','achats_chine') and gbs_private.dossier_visible(l.dossier_id)));

alter table gbs.liens_suivi enable row level security;
-- Liste blanche de colonnes : l'empreinte du jeton n'est jamais lisible par l'API.
grant select (id, dossier_id, destinataire, expire_le, revoque_le, revoque_par, cree_le, cree_par) on gbs.liens_suivi to authenticated;
create policy liens_lecture on gbs.liens_suivi for select using (
  gbs_private.has_role('admin','hub_afrique','agent_pays','achats_chine') and gbs_private.dossier_visible(dossier_id));

insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('suivi.duree_max_jours', '90', date '2026-01-01', 'Durée de vie maximale d''un lien de suivi client'),
  ('suivi.consultations_max_heure', '60', date '2026-01-01', 'Consultations maximales par lien de suivi et par heure');

create or replace function gbs_private.empreinte_jeton(p_jeton text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(p_jeton, 'UTF8'), 'sha256'), 'hex')
$$;

-- Création : le jeton n'est rendu qu'ici, une seule fois.
create or replace function gbs.creer_lien_suivi(p_dossier uuid, p_destinataire text, p_jours int default 30)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare jeton text; l gbs.liens_suivi; d gbs.dossiers;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','hub_afrique','agent_pays')
                             and gbs_private.dossier_visible(p_dossier));
  select * into d from gbs.dossiers where id = p_dossier;
  if d.statut <> 'ouvert' then raise exception 'GBS_DOSSIER_FERME' using errcode = 'P0001'; end if;
  if p_destinataire is null or length(trim(p_destinataire)) not between 2 and 200
     or p_jours is null or p_jours < 1 or p_jours > gbs_private.param_num('suivi.duree_max_jours') then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  -- 32 octets aléatoires, encodés en base64 « url » sans remplissage : 43 caractères.
  jeton := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into gbs.liens_suivi (dossier_id, empreinte, destinataire, expire_le)
  values (p_dossier, gbs_private.empreinte_jeton(jeton), trim(p_destinataire), now() + make_interval(days => p_jours))
  returning * into l;
  return jsonb_build_object('id', l.id, 'jeton', jeton, 'expire_le', l.expire_le);
end $$;

create or replace function gbs.revoquer_lien_suivi(p_lien uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare l gbs.liens_suivi;
begin
  select * into l from gbs.liens_suivi where id = p_lien for update;
  perform gbs_private.exiger(l.id is not null and gbs_private.has_role('admin','hub_afrique','agent_pays')
                             and gbs_private.dossier_visible(l.dossier_id));
  update gbs.liens_suivi set revoque_le = coalesce(revoque_le, now()), revoque_par = coalesce(revoque_par, auth.uid())
   where id = p_lien;
end $$;

-- Pièces dont le document peut être remis au client, selon le mode financier.
create or replace function gbs_private.piece_visible_client(p_code text, p_mode text) returns boolean
language sql immutable set search_path = '' as $$
  select p_code = any (array['rapport_inspection_valide','certificat_inspection','liste_colisage','connaissement',
                             'certificat_origine','avis_mise_a_disposition','attestation_assurance','client_pv_reception',
                             'pv_mise_en_service','dossier_qualite_remis'])
      or (p_mode = 'accompagne' and p_code = any (array['facture_commerciale','facture_pro_forma','contrat_fournisseur_signe']))
$$;

-- Lecture de la page de suivi : réservée au rôle de service (fonction serveur gbs-suivi).
create or replace function gbs.suivi_client(p_jeton text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l gbs.liens_suivi; d gbs.dossiers; c gbs.clients; po jsonb; max_heure int; k gbs.liens_suivi_consultations;
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

  -- Plafond de consultations par heure pour ce lien.
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

  select * into c from gbs.clients where id = d.client_id;
  po := gbs_private.planning_ouverture_brut(d.id);
  return jsonb_build_object(
    'dossier', jsonb_build_object('reference', d.reference, 'intitule', d.intitule, 'modele', d.modele,
                 'statut', d.statut, 'phase_courante', d.phase_courante, 'ouvert_le', d.ouvert_le),
    'client', jsonb_build_object('raison_sociale', c.raison_sociale, 'langue', c.langue),
    'expire_le', l.expire_le,
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
    'points_bloquants', (select coalesce(jsonb_agg(jsonb_build_object('description', b.description, 'categorie', b.categorie,
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

revoke execute on function gbs.creer_lien_suivi(uuid, text, int), gbs.revoquer_lien_suivi(uuid), gbs.suivi_client(text),
  gbs.etat_delais(uuid), gbs.planning_ouverture(uuid),
  gbs_private.etat_delais_brut(uuid), gbs_private.planning_ouverture_brut(uuid), gbs_private.empreinte_jeton(text),
  gbs_private.piece_visible_client(text, text) from public;
grant execute on function gbs.creer_lien_suivi(uuid, text, int), gbs.revoquer_lien_suivi(uuid),
  gbs.etat_delais(uuid), gbs.planning_ouverture(uuid) to authenticated;
grant execute on function gbs.suivi_client(text) to service_role;
grant execute on all functions in schema gbs_private to authenticated, service_role;
