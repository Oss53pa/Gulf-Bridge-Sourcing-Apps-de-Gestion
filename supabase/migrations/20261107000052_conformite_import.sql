-- Logistique : conformité à l'import (maquette IMP).
-- * Référentiel daté des documents exigés à l'import, par pays de destination (ou tous pays) et par
--   catégorie de marchandise (ou toutes) : document, organisme émetteur, délai d'obtention en jours.
--   Une règle ne se modifie pas : on la désactive et on en crée une nouvelle (historique conservé).
-- * Chaque expédition porte sa catégorie (référentiel des catégories) ; sa liste de contrôle est
--   calculée par la base à partir des règles actives à la date du jour.
-- * Document reçu : fichier rangé dans le dossier de l'expédition, une fois par exigence.
-- * Accès : règles lues par tout l'interne, écrites par l'administratrice ; liste de contrôle et
--   documents pour qui gère l'expédition. Écritures par fonctions, journalisées ; aucune suppression.

create table gbs.categories_import (
  code     text primary key check (code ~ '^[a-z_]{2,40}$'),
  libelle  text not null check (length(trim(libelle)) between 2 and 120),
  cree_le timestamptz not null default now(), cree_par uuid
);

create table gbs.exigences_import (
  id          uuid primary key default gen_random_uuid(),
  pays        text not null check (pays ~ '^([A-Z]{2}|\*)$'),            -- * : tous pays
  categorie   text references gbs.categories_import(code),             -- null : toutes catégories
  document    text not null check (length(trim(document)) between 3 and 200),
  emetteur    text check (length(emetteur) <= 200),
  delai_jours int not null default 0 check (delai_jours between 0 and 120),
  date_effet  date not null default current_date,
  actif       boolean not null default true,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid
);
create index on gbs.exigences_import (pays, categorie) where actif;

alter table gbs.expeditions add column categorie_import text references gbs.categories_import(code);

create table gbs.conformite_documents (
  id            uuid primary key default gen_random_uuid(),
  expedition_id uuid not null references gbs.expeditions(id),
  exigence_id   uuid not null references gbs.exigences_import(id),
  chemin        text not null check (length(chemin) <= 400),
  recu_le       timestamptz not null default now(),
  cree_le timestamptz not null default now(), cree_par uuid,
  unique (expedition_id, exigence_id)
);

create or replace function gbs_private.trg_conformite_rpc() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'conformite_import' then
    raise exception 'GBS_VALIDATION_RPC: la conformité à l''import se modifie par les fonctions dédiées' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'exigences_import' then
    -- Seule la désactivation est permise : une règle publiée ne change pas de contenu.
    if (to_jsonb(new) - 'actif' - 'modifie_le' - 'modifie_par') is distinct from (to_jsonb(old) - 'actif' - 'modifie_le' - 'modifie_par') then
      raise exception 'GBS_REGLE_FIGEE' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'conformite_documents' then
    raise exception 'GBS_VALIDATION_RPC: un document reçu ne se modifie pas' using errcode = 'P0001';
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['categories_import','exigences_import','conformite_documents'] loop
    execute format('alter table gbs.%I enable row level security', t);
    execute format('grant select on gbs.%I to authenticated', t);
    execute format('create trigger %I before insert or update on gbs.%I for each row execute function gbs_private.trg_conformite_rpc()', t || '_rpc', t);
    execute format('create trigger %I before insert on gbs.%I for each row execute function gbs_private.trg_cree_par()', t || '_cree', t);
    execute format('create trigger %I after insert or update on gbs.%I for each row execute function gbs_private.trg_audit()', t || '_audit', t);
    execute format('create trigger %I before delete on gbs.%I for each row execute function gbs_private.trg_no_delete()', t || '_nodel', t);
  end loop;
end $$;
create trigger exigences_import_touch before update on gbs.exigences_import for each row execute function gbs_private.trg_touch();

create policy categories_import_lecture on gbs.categories_import for select using (gbs_private.interne());
create policy exigences_import_lecture on gbs.exigences_import for select using (gbs_private.interne());
create policy conformite_documents_lecture on gbs.conformite_documents for select using (gbs_private.gere_expedition(expedition_id));

-- -----------------------------------------------------------------------------
-- Référentiel (administratrice)
-- -----------------------------------------------------------------------------
create or replace function gbs.creer_categorie_import(p_code text, p_libelle text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.is_admin());
  perform gbs_private.rpc('conformite_import');
  insert into gbs.categories_import (code, libelle) values (p_code, trim(p_libelle));
  perform gbs_private.rpc('');
exception
  when check_violation or not_null_violation then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  when unique_violation then raise exception 'GBS_REFERENCE_EXISTANTE' using errcode = 'P0001';
end $$;

create or replace function gbs.creer_exigence_import(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r uuid;
begin
  perform gbs_private.exiger(gbs_private.is_admin());
  if jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) k where k not in ('pays','categorie','document','emetteur','delai_jours','date_effet'))
     or coalesce(jsonb_typeof(p -> 'pays'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'document'), '') <> 'string'
     or (p ? 'categorie' and jsonb_typeof(p -> 'categorie') not in ('string','null'))
     or (p ? 'emetteur' and jsonb_typeof(p -> 'emetteur') not in ('string','null'))
     or (p ? 'delai_jours' and jsonb_typeof(p -> 'delai_jours') <> 'number')
     or (p ? 'date_effet' and jsonb_typeof(p -> 'date_effet') <> 'string') then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform gbs_private.rpc('conformite_import');
  insert into gbs.exigences_import (pays, categorie, document, emetteur, delai_jours, date_effet)
  values (p ->> 'pays', nullif(p ->> 'categorie', ''), trim(p ->> 'document'), nullif(trim(p ->> 'emetteur'), ''),
          coalesce((p ->> 'delai_jours')::int, 0), coalesce((p ->> 'date_effet')::date, current_date))
  returning id into r;
  perform gbs_private.rpc('');
  return r;
exception
  when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow
       or numeric_value_out_of_range or foreign_key_violation then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

create or replace function gbs.desactiver_exigence_import(p_exigence uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.is_admin());
  if not exists (select 1 from gbs.exigences_import where id = p_exigence and actif) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform gbs_private.rpc('conformite_import');
  update gbs.exigences_import set actif = false where id = p_exigence;
  perform gbs_private.rpc('');
end $$;

-- -----------------------------------------------------------------------------
-- Par expédition
-- -----------------------------------------------------------------------------
create or replace function gbs.definir_categorie_import(p_expedition uuid, p_categorie text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.gere_expedition(p_expedition));
  if p_categorie is not null and not exists (select 1 from gbs.categories_import where code = p_categorie) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  update gbs.expeditions set categorie_import = p_categorie where id = p_expedition;
end $$;

-- Liste de contrôle : règles actives et en vigueur pour le pays et la catégorie de l'expédition.
create or replace function gbs.conformite_expedition(p_expedition uuid)
returns table (exigence_id uuid, pays text, categorie text, document text, emetteur text, delai_jours int, recu boolean, chemin text, recu_le timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare e gbs.expeditions;
begin
  perform gbs_private.exiger(gbs_private.gere_expedition(p_expedition));
  select * into e from gbs.expeditions where id = p_expedition;
  return query
  select x.id, x.pays, x.categorie, x.document, x.emetteur, x.delai_jours, d.id is not null, d.chemin, d.recu_le
    from gbs.exigences_import x
    left join gbs.conformite_documents d on d.exigence_id = x.id and d.expedition_id = e.id
   where x.actif and x.date_effet <= current_date
     and (x.pays = '*' or x.pays = e.pays_destination)
     and (x.categorie is null or x.categorie = e.categorie_import)
   order by x.pays = '*', x.categorie is null, x.document;
end $$;

create or replace function gbs.deposer_document_conformite(p_expedition uuid, p_exigence uuid, p_chemin text) returns void
language plpgsql security definer set search_path = '' as $$
declare e gbs.expeditions;
begin
  perform gbs_private.exiger(gbs_private.gere_expedition(p_expedition));
  select * into e from gbs.expeditions where id = p_expedition;
  if p_chemin is null or not gbs_private.photos_valides(e.dossier_id, array[p_chemin])
     or not exists (select 1 from gbs.conformite_expedition(p_expedition) c where c.exigence_id = p_exigence) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if exists (select 1 from gbs.conformite_documents where expedition_id = p_expedition and exigence_id = p_exigence) then
    raise exception 'GBS_DOCUMENT_DEJA_RECU' using errcode = 'P0001';
  end if;
  perform gbs_private.rpc('conformite_import');
  insert into gbs.conformite_documents (expedition_id, exigence_id, chemin) values (p_expedition, p_exigence, p_chemin);
  perform gbs_private.rpc('');
end $$;

revoke all on function gbs_private.trg_conformite_rpc() from public, anon, authenticated;
revoke all on function gbs.creer_categorie_import(text, text), gbs.creer_exigence_import(jsonb), gbs.desactiver_exigence_import(uuid),
  gbs.definir_categorie_import(uuid, text), gbs.conformite_expedition(uuid), gbs.deposer_document_conformite(uuid, uuid, text) from public, anon;
grant execute on function gbs.creer_categorie_import(text, text), gbs.creer_exigence_import(jsonb), gbs.desactiver_exigence_import(uuid),
  gbs.definir_categorie_import(uuid, text), gbs.conformite_expedition(uuid), gbs.deposer_document_conformite(uuid, uuid, text) to authenticated;
