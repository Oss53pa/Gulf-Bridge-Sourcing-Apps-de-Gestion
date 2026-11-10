-- Échanges : documents du dossier et leurs versions (maquette « Documents »).
-- * Document : contrat, mandat, rapport, facture, avenant ou autre, rattaché à un dossier, avec sa
--   partie concernée (client, fournisseur…) et un statut : brouillon, en revue, en signature,
--   en vigueur, archivé.
-- * Version : fichier rangé dans le dossier, numérotée par la base (1, 2, 3…), avec un commentaire ;
--   une version déposée ne se modifie ni ne se supprime ; la plus récente est la version courante.
--   Déposer une nouvelle version d'un document en vigueur le repasse en revue.
-- * Passage en vigueur : une version au moins ; un document archivé est figé.
-- * Accès : équipe interne sur les dossiers visibles (sauf inspecteurs) ; écriture par
--   l'administratrice, les achats Chine et le Hub Afrique, par fonctions, journalisée ;
--   aucune suppression. Les documents généraux sans dossier (CGV) ne sont pas couverts ici.

create table gbs.documents_dossier (
  id               uuid primary key default gen_random_uuid(),
  dossier_id       uuid not null references gbs.dossiers(id),
  type             text not null check (type in ('contrat','mandat','rapport','facture','avenant','autre')),
  titre            text not null check (length(trim(titre)) between 3 and 200),
  partie           text check (length(partie) <= 200),
  statut           text not null default 'brouillon' check (statut in ('brouillon','en_revue','en_signature','en_vigueur','archive')),
  version_courante int not null default 0 check (version_courante between 0 and 999),
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check (statut <> 'en_vigueur' or version_courante > 0)
);
create index on gbs.documents_dossier (dossier_id);

create table gbs.documents_versions (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references gbs.documents_dossier(id),
  version      int not null check (version between 1 and 999),
  chemin       text not null check (length(chemin) <= 400),
  commentaire  text not null check (length(trim(commentaire)) between 3 and 300),
  cree_le timestamptz not null default now(), cree_par uuid,
  unique (document_id, version)
);

create or replace function gbs_private.trg_documents_rpc() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'documents' then
    raise exception 'GBS_VALIDATION_RPC: les documents se modifient par les fonctions dédiées' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    if tg_table_name = 'documents_versions' then
      raise exception 'GBS_VALIDATION_RPC: une version déposée ne se modifie pas' using errcode = 'P0001';
    end if;
    if to_jsonb(old) ->> 'statut' = 'archive' then raise exception 'GBS_DOCUMENT_ARCHIVE' using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['documents_dossier','documents_versions'] loop
    execute format('alter table gbs.%I enable row level security', t);
    execute format('grant select on gbs.%I to authenticated', t);
    execute format('create trigger %I before insert or update on gbs.%I for each row execute function gbs_private.trg_documents_rpc()', t || '_rpc', t);
    execute format('create trigger %I before insert on gbs.%I for each row execute function gbs_private.trg_cree_par()', t || '_cree', t);
    execute format('create trigger %I after insert or update on gbs.%I for each row execute function gbs_private.trg_audit()', t || '_audit', t);
    execute format('create trigger %I before delete on gbs.%I for each row execute function gbs_private.trg_no_delete()', t || '_nodel', t);
  end loop;
end $$;
create trigger documents_dossier_touch before update on gbs.documents_dossier for each row execute function gbs_private.trg_touch();

create policy documents_dossier_lecture on gbs.documents_dossier for select using (
  gbs_private.has_role('admin','achats_chine','hub_afrique','agent_pays','comptable') and gbs_private.dossier_visible(dossier_id));
create policy documents_versions_lecture on gbs.documents_versions for select using (
  exists (select 1 from gbs.documents_dossier d where d.id = document_id
          and gbs_private.has_role('admin','achats_chine','hub_afrique','agent_pays','comptable') and gbs_private.dossier_visible(d.dossier_id)));

create or replace function gbs_private.document_modifiable(p_document uuid) returns gbs.documents_dossier
language plpgsql security definer set search_path = '' as $$
declare d gbs.documents_dossier;
begin
  select * into d from gbs.documents_dossier where id = p_document for update;
  perform gbs_private.exiger(d.id is not null and gbs_private.has_role('admin','achats_chine','hub_afrique') and gbs_private.dossier_visible(d.dossier_id));
  if d.statut = 'archive' then raise exception 'GBS_DOCUMENT_ARCHIVE' using errcode = 'P0001'; end if;
  return d;
end $$;

create or replace function gbs.creer_document(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r uuid; d uuid;
begin
  if jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) k where k not in ('dossier_id','type','titre','partie'))
     or coalesce(jsonb_typeof(p -> 'dossier_id'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'type'), '') <> 'string'
     or coalesce(jsonb_typeof(p -> 'titre'), '') <> 'string'
     or (p ? 'partie' and jsonb_typeof(p -> 'partie') not in ('string','null')) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  d := (p ->> 'dossier_id')::uuid;
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine','hub_afrique') and gbs_private.dossier_visible(d));
  perform gbs_private.rpc('documents');
  insert into gbs.documents_dossier (dossier_id, type, titre, partie)
  values (d, p ->> 'type', trim(p ->> 'titre'), nullif(trim(p ->> 'partie'), ''))
  returning id into r;
  perform gbs_private.rpc('');
  return r;
exception
  when check_violation or not_null_violation or invalid_text_representation or foreign_key_violation then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

-- Nouvelle version : numéro attribué par la base sous verrou ; un document en vigueur repasse en revue.
create or replace function gbs.deposer_version_document(p_document uuid, p_chemin text, p_commentaire text) returns int
language plpgsql security definer set search_path = '' as $$
declare d gbs.documents_dossier := gbs_private.document_modifiable(p_document); v int;
begin
  if p_chemin is null or not gbs_private.photos_valides(d.dossier_id, array[p_chemin])
     or length(trim(coalesce(p_commentaire, ''))) not between 3 and 300 or d.version_courante >= 999 then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  v := d.version_courante + 1;
  perform gbs_private.rpc('documents');
  insert into gbs.documents_versions (document_id, version, chemin, commentaire) values (d.id, v, p_chemin, trim(p_commentaire));
  update gbs.documents_dossier set version_courante = v,
         statut = case when statut in ('en_vigueur','en_signature') then 'en_revue' else statut end
   where id = d.id;
  perform gbs_private.rpc('');
  return v;
end $$;

-- Statut : brouillon → en revue → en signature → en vigueur ; archivage à tout moment (définitif).
create or replace function gbs.changer_statut_document(p_document uuid, p_statut text) returns void
language plpgsql security definer set search_path = '' as $$
declare d gbs.documents_dossier := gbs_private.document_modifiable(p_document);
begin
  if p_statut is null or p_statut not in ('en_revue','en_signature','en_vigueur','archive')
     or (p_statut = 'en_revue' and d.statut not in ('brouillon','en_signature'))
     or (p_statut = 'en_signature' and d.statut <> 'en_revue')
     or (p_statut = 'en_vigueur' and d.statut not in ('en_revue','en_signature')) then
    raise exception 'GBS_TRANSITION_INVALIDE' using errcode = 'P0001';
  end if;
  if p_statut in ('en_revue','en_signature','en_vigueur') and d.version_courante = 0 then
    raise exception 'GBS_DOCUMENT_SANS_VERSION' using errcode = 'P0001';
  end if;
  perform gbs_private.rpc('documents');
  update gbs.documents_dossier set statut = p_statut where id = d.id;
  perform gbs_private.rpc('');
end $$;

revoke all on function gbs_private.trg_documents_rpc(), gbs_private.document_modifiable(uuid) from public, anon, authenticated;
revoke all on function gbs.creer_document(jsonb), gbs.deposer_version_document(uuid, text, text), gbs.changer_statut_document(uuid, text) from public, anon;
grant execute on function gbs.creer_document(jsonb), gbs.deposer_version_document(uuid, text, text), gbs.changer_statut_document(uuid, text) to authenticated;
