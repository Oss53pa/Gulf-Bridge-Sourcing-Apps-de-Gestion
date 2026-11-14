-- Avancement de la fabrication déclaré par le fournisseur (maquette « Espace fournisseur · mes commandes »
-- et « Espace client · production et qualité »).
-- * Le fournisseur (compte en double facteur, commande à lui, contrat signé ou en production) déclare un
--   pourcentage d'avancement, un commentaire et des photos. L'avancement ne recule pas.
-- * Photos : déposées par la fonction serveur gbs-depot (octets, taille, nom régénéré) et enregistrées
--   par le rôle de service seulement ; le fournisseur ne manipule jamais de chemin de fichier. Les photos
--   en attente sont rattachées à sa prochaine déclaration. Datées par le serveur (la géolocalisation
--   EXIF n'est pas fiable ni vérifiable ; elle n'est pas reprise).
-- * Client : rien n'est montré tant que l'équipe (admin, achats Chine) n'a pas publié la déclaration.
--   En négoce, une photo peut révéler le fabricant : la publication reste une décision humaine.
-- * Lecture interne : équipe qui voit le dossier (hors comptabilité). Limitation : 12 photos en attente
--   par commande, une déclaration par heure et par commande.

create table gbs.avancements_production (
  id          uuid primary key default gen_random_uuid(),
  commande_id uuid not null references gbs.commandes(id),
  dossier_id  uuid not null references gbs.dossiers(id),
  pct         int not null check (pct between 0 and 100),
  commentaire text check (length(commentaire) <= 500),
  auteur_id   uuid not null references gbs.profils(id),
  cree_le     timestamptz not null default clock_timestamp(),
  publie_le   timestamptz,
  publie_par  uuid references gbs.profils(id),
  check ((publie_le is null) = (publie_par is null))
);
create index on gbs.avancements_production (commande_id, cree_le);

create table gbs.photos_production (
  id             uuid primary key default gen_random_uuid(),
  commande_id    uuid not null references gbs.commandes(id),
  dossier_id     uuid not null references gbs.dossiers(id),
  chemin         text not null unique check (length(chemin) <= 400),
  empreinte      char(64) not null check (empreinte ~ '^[0-9a-f]{64}$'),
  auteur_id      uuid not null references gbs.profils(id),
  avancement_id  uuid references gbs.avancements_production(id),
  cree_le        timestamptz not null default clock_timestamp()
);
create index on gbs.photos_production (commande_id, avancement_id);

create or replace function gbs_private.trg_avancement_rpc() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'avancement' then
    raise exception 'GBS_VALIDATION_RPC: l''avancement de production se déclare par les fonctions dédiées' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'avancements_production'
     and (to_jsonb(new) - 'publie_le' - 'publie_par') is distinct from (to_jsonb(old) - 'publie_le' - 'publie_par') then
    raise exception 'GBS_VALIDATION_RPC: une déclaration ne se modifie pas' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'photos_production'
     and (to_jsonb(new) - 'avancement_id') is distinct from (to_jsonb(old) - 'avancement_id') then
    raise exception 'GBS_VALIDATION_RPC: une photo déposée ne se modifie pas' using errcode = 'P0001';
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['avancements_production','photos_production'] loop
    execute format('alter table gbs.%I enable row level security', t);
    execute format('grant select on gbs.%I to authenticated', t);
    execute format('create trigger %I before insert or update on gbs.%I for each row execute function gbs_private.trg_avancement_rpc()', t || '_rpc', t);
    execute format('create trigger %I after insert or update on gbs.%I for each row execute function gbs_private.trg_audit()', t || '_audit', t);
    execute format('create trigger %I before delete on gbs.%I for each row execute function gbs_private.trg_no_delete()', t || '_nodel', t);
    execute format('create policy %I on gbs.%I for select using (gbs_private.has_role(''admin'',''achats_chine'',''hub_afrique'',''agent_pays'',''inspecteur'') and gbs_private.dossier_visible(dossier_id))', t || '_lecture', t);
  end loop;
end $$;

-- Commande du compte fournisseur connecté, ouverte à la déclaration ; renvoie son dossier (sinon refus).
create or replace function gbs.verifier_depot_photo_production(p_commande uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare f uuid := gbs_private.mon_fournisseur(); k gbs.commandes;
begin
  select * into k from gbs.commandes where id = p_commande;
  perform gbs_private.exiger(f is not null and k.id is not null and k.fournisseur_id = f
    and k.statut in ('contrat_signe','en_production','production_terminee'));
  if (select count(*) from gbs.photos_production p where p.commande_id = k.id and p.avancement_id is null) >= 12 then
    raise exception 'GBS_TROP_DE_DEPOTS' using errcode = 'P0001';
  end if;
  return k.dossier_id;
end $$;

-- Enregistrement d'une photo (rôle de service, après stockage par gbs-depot).
create or replace function gbs.enregistrer_photo_production(p_user uuid, p_commande uuid, p_chemin text, p_empreinte text)
returns void language plpgsql security definer set search_path = '' as $$
declare pr gbs.profils; k gbs.commandes;
begin
  select * into pr from gbs.profils where id = p_user;
  select * into k from gbs.commandes where id = p_commande for update;
  if pr.id is null or not pr.actif or pr.role is distinct from 'fournisseur' or k.id is null or k.fournisseur_id is distinct from pr.fournisseur_id
     or k.statut not in ('contrat_signe','en_production','production_terminee') then
    raise exception 'GBS_ACCES_REFUSE' using errcode = '42501';
  end if;
  if p_chemin is null or not gbs_private.photos_valides(k.dossier_id, array[p_chemin]) or p_chemin !~ '\.(jpg|png|webp)$'
     or p_empreinte is null or p_empreinte !~ '^[0-9a-f]{64}$' then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if (select count(*) from gbs.photos_production p where p.commande_id = k.id and p.avancement_id is null) >= 12 then
    raise exception 'GBS_TROP_DE_DEPOTS' using errcode = 'P0001';
  end if;
  perform gbs_private.rpc('avancement');
  insert into gbs.photos_production (commande_id, dossier_id, chemin, empreinte, auteur_id) values (k.id, k.dossier_id, p_chemin, p_empreinte, pr.id);
  perform gbs_private.rpc('');
end $$;

-- Déclaration par le fournisseur : rattache ses photos en attente de cette commande.
create or replace function gbs.declarer_avancement(p_commande uuid, p_pct int, p_commentaire text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare f uuid := gbs_private.mon_fournisseur(); k gbs.commandes; dernier int; r uuid;
begin
  select * into k from gbs.commandes where id = p_commande for update;
  perform gbs_private.exiger(f is not null and k.id is not null and k.fournisseur_id = f
    and k.statut in ('contrat_signe','en_production','production_terminee'));
  if p_pct is null or p_pct not between 0 and 100 or length(coalesce(p_commentaire, '')) > 500 then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  select a.pct into dernier from gbs.avancements_production a where a.commande_id = k.id order by a.cree_le desc limit 1;
  if p_pct < coalesce(dernier, 0) then raise exception 'GBS_AVANCEMENT_RECUL' using errcode = 'P0001'; end if;
  if exists (select 1 from gbs.avancements_production a where a.commande_id = k.id and a.cree_le > now() - interval '1 hour') then
    raise exception 'GBS_TROP_DE_DEPOTS' using errcode = 'P0001';
  end if;
  perform gbs_private.rpc('avancement');
  insert into gbs.avancements_production (commande_id, dossier_id, pct, commentaire, auteur_id)
  values (k.id, k.dossier_id, p_pct, nullif(trim(p_commentaire), ''), auth.uid()) returning id into r;
  update gbs.photos_production set avancement_id = r where commande_id = k.id and avancement_id is null and auteur_id = auth.uid();
  perform gbs_private.rpc('');
  return r;
end $$;

-- Publication au client (ou retrait) par l'équipe.
create or replace function gbs.publier_avancement_client(p_avancement uuid, p_publier boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare a gbs.avancements_production;
begin
  select * into a from gbs.avancements_production where id = p_avancement for update;
  perform gbs_private.exiger(a.id is not null and gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(a.dossier_id));
  if p_publier is null then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  perform gbs_private.rpc('avancement');
  update gbs.avancements_production set publie_le = case when p_publier then now() end, publie_par = case when p_publier then auth.uid() end where id = a.id;
  perform gbs_private.rpc('');
end $$;

-- Espace client : dernier avancement publié et photos publiées, par commande.
create or replace function gbs_private.production_qualite_client(p_dossier uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'commandes', (select coalesce(jsonb_agg(jsonb_build_object('reference', k.reference, 'statut', k.statut,
                    'fabricant', case when d.mode_financier = 'accompagne' then f.raison_sociale_en end,
                    'produits', (select coalesce(jsonb_agg(jsonb_build_object('designation', a.designation, 'quantite', l.quantite) order by l.cree_le), '[]'::jsonb)
                                 from gbs.lignes_commande l join gbs.articles a on a.id = l.article_id where l.commande_id = k.id),
                    'avancement', (select jsonb_build_object('pct', av.pct, 'le', av.cree_le) from gbs.avancements_production av
                                    where av.commande_id = k.id and av.publie_le is not null order by av.cree_le desc limit 1),
                    'photos', (select coalesce(jsonb_agg(jsonb_build_object('chemin', ph.chemin, 'le', ph.cree_le) order by ph.cree_le desc), '[]'::jsonb)
                                 from gbs.photos_production ph join gbs.avancements_production av on av.id = ph.avancement_id
                                where ph.commande_id = k.id and av.publie_le is not null))
                    order by k.reference), '[]'::jsonb)
                  from gbs.commandes k join gbs.fournisseurs f on f.id = k.fournisseur_id
                 where k.dossier_id = d.id and k.statut not in ('brouillon','annulee')),
    'inspections', (select coalesce(jsonb_agg(jsonb_build_object('reference', i.reference, 'type', i.type, 'produit', i.produit,
                      'date_prevue', i.date_prevue, 'date_realisee', i.date_realisee, 'statut', i.statut,
                      'decision', case when i.statut = 'validee' then i.decision end,
                      'defauts', case when i.statut = 'validee' then jsonb_build_object('critiques', i.defauts_critiques, 'majeurs', i.defauts_majeurs, 'mineurs', i.defauts_mineurs) end)
                      order by coalesce(i.date_realisee, i.date_prevue) desc nulls last), '[]'::jsonb)
                    from gbs.inspections i where i.dossier_id = d.id),
    'non_conformites', (select coalesce(jsonb_agg(jsonb_build_object('reference', n.reference, 'gravite', n.gravite, 'libelle', n.libelle_client,
                          'statut', n.statut, 'delai', n.delai) order by n.cree_le desc), '[]'::jsonb)
                        from gbs.non_conformites n where n.dossier_id = d.id and n.libelle_client is not null))
  from gbs.dossiers d where d.id = p_dossier
$$;

-- Espace fournisseur : avancement et photos de ses commandes.
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
    'consultations', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'reference', c.reference, 'objet', c.objet, 'quantite', c.quantite,
                        'incoterm', c.incoterm_demande, 'lieu', c.lieu, 'date_limite', c.date_limite, 'fuseau', c.fuseau, 'statut', c.statut,
                        'pli_depose_le', (select max(k.depose_le) from gbs.plis k where k.consultation_id = c.id and k.fournisseur_id = f and k.statut <> 'remplace'))
                        order by c.date_limite desc), '[]'::jsonb)
                      from gbs.consultations_fournisseurs c
                     where exists (select 1 from gbs.consultation_invites i where i.consultation_id = c.id and i.fournisseur_id = f) and c.statut <> 'annulee'),
    'commandes', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'reference', k.reference, 'statut', k.statut, 'incoterm', k.incoterm, 'lieu', k.lieu,
                    'devise', k.devise, 'fob_montant', k.fob_montant,
                    'avancement', (select max(av.pct) from gbs.avancements_production av where av.commande_id = k.id),
                    'photos', (select count(*) from gbs.photos_production ph where ph.commande_id = k.id and ph.avancement_id is not null),
                    'photos_en_attente', (select count(*) from gbs.photos_production ph where ph.commande_id = k.id and ph.avancement_id is null),
                    'lignes', (select coalesce(jsonb_agg(jsonb_build_object('designation', a.designation, 'quantite', l.quantite,
                                 'prix_unitaire', l.prix_unitaire, 'montant', l.montant) order by l.cree_le), '[]'::jsonb)
                               from gbs.lignes_commande l join gbs.articles a on a.id = l.article_id where l.commande_id = k.id),
                    'paiements', (select coalesce(jsonb_agg(jsonb_build_object('nature', y.nature, 'montant', y.montant, 'devise', y.devise,
                                    'etat', case when y.statut in ('execute','confirme_client') then 'recu' when y.statut = 'refuse' then 'annule' else 'a_venir' end,
                                    'date', case when y.statut in ('execute','confirme_client') then y.execute_le end) order by y.cree_le), '[]'::jsonb)
                                  from gbs.paiements_fournisseurs y where y.commande_id = k.id))
                    order by k.reference desc), '[]'::jsonb)
                  from gbs.commandes k where k.fournisseur_id = f and k.statut <> 'brouillon'),
    'comptes', (select coalesce(jsonb_agg(jsonb_build_object('type', cp.type, 'banque', cp.banque, 'fin_numero', right(cp.numero, 4),
                  'verifie', cp.verifie, 'verifie_le', cp.verifie_le) order by cp.verifie desc), '[]'::jsonb)
                from gbs.comptes_paiement cp where cp.fournisseur_id = f)
  );
end $$;

-- Fichiers : le fournisseur lit ses photos de production ; le client, les photos publiées de ses dossiers.
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
            and gbs_private.piece_visible_client(p.code, d.mode_financier)))
    or (gbs_private.mon_client() is not null and exists (
         select 1 from gbs.photos_production ph join gbs.avancements_production av on av.id = ph.avancement_id join gbs.dossiers d on d.id = ph.dossier_id
          where ph.chemin = p_nom and av.publie_le is not null and d.client_id = gbs_private.mon_client() and d.statut <> 'annule'))
    or (gbs_private.mon_fournisseur() is not null and exists (
         select 1 from gbs.photos_production ph join gbs.commandes k on k.id = ph.commande_id
          where ph.chemin = p_nom and k.fournisseur_id = gbs_private.mon_fournisseur())))
$$;

revoke all on function gbs_private.trg_avancement_rpc() from public, anon, authenticated;
revoke all on function gbs.verifier_depot_photo_production(uuid), gbs.declarer_avancement(uuid, int, text), gbs.publier_avancement_client(uuid, boolean) from public, anon;
grant execute on function gbs.verifier_depot_photo_production(uuid), gbs.declarer_avancement(uuid, int, text), gbs.publier_avancement_client(uuid, boolean) to authenticated;
revoke all on function gbs.enregistrer_photo_production(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function gbs.enregistrer_photo_production(uuid, uuid, text, text) to service_role;
grant execute on function gbs_private.document_visible(text, text) to authenticated;
