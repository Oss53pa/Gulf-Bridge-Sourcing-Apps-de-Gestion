-- =============================================================================
-- Gulf Bridge Sourcing — Lot 0 — Socle
-- Sociétés, profils et rôles, paramètres datés, taux de change, journal d'audit
-- chaîné (ajout seul, altération détectable), interdiction des suppressions.
-- Cahier des charges : sections 1 bis, 2, 5, 6, 10, 10 bis.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Fonctions internes : jamais exposées par l'API (seul le schéma public l'est).
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Sociétés (M35)
-- -----------------------------------------------------------------------------
create table public.societes (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique check (code ~ '^[A-Z_]{2,16}$'),
  raison_sociale  text not null check (length(raison_sociale) between 2 and 200),
  pays            char(2) not null check (pays ~ '^[A-Z]{2}$'),          -- ISO 3166
  devise          char(3) not null check (devise in ('XOF','XAF','USD','CNY')), -- ISO 4217
  forme           text check (length(forme) <= 80),
  date_creation   date not null,             -- avant cette date, la société ne facture pas
  identifiants_fiscaux jsonb not null default '{}'::jsonb,
  fne             boolean not null default false,  -- factures normalisées électroniques (DGI CI)
  cree_le         timestamptz not null default now(),
  cree_par        uuid,
  modifie_le      timestamptz not null default now(),
  modifie_par     uuid
);

-- Numérotation propre à chaque société, par série et par année.
create table public.series_factures (
  societe_id  uuid not null references public.societes(id),
  serie       text not null check (serie ~ '^[A-Z0-9-]{2,20}$'),
  annee       int  not null check (annee between 2024 and 2100),
  dernier     int  not null default 0 check (dernier >= 0),
  largeur     int  not null default 5 check (largeur between 3 and 8),
  primary key (societe_id, serie, annee)
);

-- -----------------------------------------------------------------------------
-- Profils et rôles (section 2)
-- -----------------------------------------------------------------------------
create table public.profils (
  id            uuid primary key,  -- = auth.users.id
  nom           text not null check (length(nom) between 1 and 120),
  email         text not null check (length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  telephone     text check (length(telephone) <= 40),
  langue        text not null default 'fr' check (langue in ('fr','en','zh')),   -- ISO 639-1
  fuseau        text not null default 'Africa/Abidjan' check (length(fuseau) <= 64),
  role          text check (role in ('admin','achats_chine','hub_afrique','agent_pays',
                                     'inspecteur','comptable','client','fournisseur','transitaire')),
  sous_role     text check (length(sous_role) <= 40),
  societes      uuid[] not null default '{}',  -- sociétés dont l'utilisateur voit les données
  pays          char(2) check (pays ~ '^[A-Z]{2}$'),  -- agent pays : son pays
  delegue_validation boolean not null default false,  -- seconde personne désignée (4 yeux)
  actif         boolean not null default true,
  cree_le       timestamptz not null default now(),
  modifie_le    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Helpers d'identité et de droits (exécutés côté base, section 2)
-- -----------------------------------------------------------------------------
create or replace function private.uid() returns uuid
language sql stable as $$ select auth.uid() $$;

create or replace function private.profil() returns public.profils
language sql stable security definer set search_path = '' as $$
  select p.* from public.profils p where p.id = auth.uid() and p.actif
$$;

-- Double facteur : un compte interne n'a aucun accès sans session AAL2 (section 10).
create or replace function private.aal_ok() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

create or replace function private.role() returns text
language sql stable security definer set search_path = '' as $$
  select case
           when p.role is null then null
           when p.role in ('client','fournisseur','transitaire') then p.role
           when coalesce(auth.jwt() ->> 'aal', '') = 'aal2' then p.role
           else null           -- interne sans double facteur : aucun droit
         end
  from public.profils p where p.id = auth.uid() and p.actif
$$;

create or replace function private.has_role(variadic roles text[]) returns boolean
language sql stable as $$ select coalesce(private.role() = any(roles), false) $$;

create or replace function private.is_admin() returns boolean
language sql stable as $$ select private.has_role('admin') $$;

-- L'utilisateur voit-il les données de cette société ?
create or replace function private.societe_ok(s uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when private.role() = 'admin' then true
    when private.role() is null then false
    else exists (select 1 from public.profils p where p.id = auth.uid() and s = any(p.societes))
  end
$$;

-- -----------------------------------------------------------------------------
-- Paramètres datés (jamais écrits en dur, section 5) et taux de change
-- -----------------------------------------------------------------------------
create table public.parametres (
  id          uuid primary key default gen_random_uuid(),
  cle         text not null check (cle ~ '^[a-zA-Z0-9_.]{2,80}$'),
  valeur      jsonb not null,
  date_effet  date not null,
  commentaire text check (length(commentaire) <= 500),
  cree_le     timestamptz not null default now(),
  cree_par    uuid,
  unique (cle, date_effet)
);

-- Valeur d'un paramètre en vigueur à une date donnée.
create or replace function private.param(p_cle text, p_date date default current_date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select valeur from public.parametres
  where cle = p_cle and date_effet <= coalesce(p_date, current_date)
  order by date_effet desc limit 1
$$;

create or replace function private.param_num(p_cle text, p_date date default current_date)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare v jsonb := private.param(p_cle, p_date);
begin
  if v is null then
    raise exception 'GBS_PARAM_MANQUANT: %', p_cle using errcode = 'P0001';
  end if;
  return (v #>> '{}')::numeric;
end $$;

create table public.taux_change (
  devise      char(3) not null check (devise in ('XAF','USD','CNY','EUR')),
  date_taux   date not null,
  taux_xof    numeric(18,8) not null check (taux_xof > 0),  -- 1 unité de devise = n XOF
  source      text check (length(source) <= 120),
  cree_le     timestamptz not null default now(),
  cree_par    uuid,
  primary key (devise, date_taux)
);

-- Conversion en XOF pour le pilotage. XOF et XAF ont la même parité fixe avec
-- l'euro mais restent des codes distincts sur chaque pièce (section 5).
create or replace function private.taux_xof(p_devise text, p_date date)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare t numeric;
begin
  if p_devise = 'XOF' then return 1; end if;
  select taux_xof into t from public.taux_change
   where devise = p_devise and date_taux <= coalesce(p_date, current_date)
   order by date_taux desc limit 1;
  if t is null then
    raise exception 'GBS_TAUX_MANQUANT: % au %', p_devise, p_date using errcode = 'P0001';
  end if;
  return t;
end $$;

create or replace function private.to_xof(p_montant numeric, p_devise text, p_date date)
returns numeric language sql stable as $$
  select p_montant * private.taux_xof(p_devise, p_date)
$$;

-- -----------------------------------------------------------------------------
-- Journal d'audit : ajout seul, chaque ligne porte l'empreinte de la précédente.
-- -----------------------------------------------------------------------------
create table public.journal_audit (
  id          bigint generated always as identity primary key,
  horodatage  timestamptz not null default clock_timestamp(),
  utilisateur uuid,
  action      text not null check (length(action) <= 80),
  table_nom   text not null check (length(table_nom) <= 80),
  ligne_id    text check (length(ligne_id) <= 80),
  dossier_id  uuid,
  avant       jsonb,
  apres       jsonb,
  motif       text check (length(motif) <= 1000),
  empreinte_precedente text not null,
  empreinte   text not null
);
create index on public.journal_audit (table_nom, ligne_id);
create index on public.journal_audit (dossier_id);

create or replace function private.audit_hash(
  prev text, ts timestamptz, u uuid, act text, tbl text, rid text, av jsonb, ap jsonb, mot text)
returns text language sql immutable as $$
  select encode(extensions.digest(
    coalesce(prev,'') || '|' || to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
    coalesce(u::text,'') || '|' || act || '|' || tbl || '|' || coalesce(rid,'') || '|' ||
    coalesce(av::text,'') || '|' || coalesce(ap::text,'') || '|' || coalesce(mot,''),
    'sha256'), 'hex')
$$;

create or replace function private.journaliser(
  p_action text, p_table text, p_ligne text, p_dossier uuid,
  p_avant jsonb, p_apres jsonb, p_motif text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare prev text; ts timestamptz := clock_timestamp(); u uuid := auth.uid();
        mot text := coalesce(p_motif, nullif(current_setting('gbs.motif', true), ''));
begin
  -- Sérialise les écritures pour garantir une chaîne linéaire.
  perform pg_advisory_xact_lock(7311);
  select empreinte into prev from public.journal_audit order by id desc limit 1;
  prev := coalesce(prev, repeat('0', 64));
  insert into public.journal_audit
    (horodatage, utilisateur, action, table_nom, ligne_id, dossier_id, avant, apres, motif,
     empreinte_precedente, empreinte)
  values (ts, u, p_action, p_table, p_ligne, p_dossier, p_avant, p_apres, mot, prev,
          private.audit_hash(prev, ts, u, p_action, p_table, p_ligne, p_avant, p_apres, mot));
end $$;

-- Trigger générique branché sur toutes les tables métier.
create or replace function private.trg_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare j_old jsonb; j_new jsonb; d uuid; rid text;
begin
  if tg_op <> 'INSERT' then j_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then j_new := to_jsonb(new); end if;
  rid := coalesce(j_new ->> 'id', j_old ->> 'id');
  d := nullif(coalesce(j_new ->> 'dossier_id', j_old ->> 'dossier_id'), '')::uuid;
  if tg_table_name = 'dossiers' then d := rid::uuid; end if;
  perform private.journaliser(lower(tg_op), tg_table_name, rid, d, j_old, j_new);
  return coalesce(new, old);
end $$;

-- Le journal est inaltérable par l'application.
create or replace function private.trg_immuable() returns trigger
language plpgsql as $$
begin
  raise exception 'GBS_IMMUABLE: % ne peut être ni modifié ni supprimé', tg_table_name
    using errcode = 'P0001';
end $$;

create trigger journal_audit_immuable before update or delete on public.journal_audit
  for each row execute function private.trg_immuable();
create trigger journal_audit_no_truncate before truncate on public.journal_audit
  for each statement execute function private.trg_immuable();

-- Aucune suppression physique des données métier (section 6) : archivage logique.
create or replace function private.trg_no_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'GBS_SUPPRESSION_INTERDITE: archivez la ligne de % au lieu de la supprimer', tg_table_name
    using errcode = 'P0001';
end $$;

-- Champs modifie_le / modifie_par
create or replace function private.trg_touch() returns trigger
language plpgsql as $$
begin
  new.modifie_le := now();
  begin new.modifie_par := auth.uid(); exception when undefined_column then null; end;
  return new;
end $$;

create or replace function private.trg_cree_par() returns trigger
language plpgsql as $$
begin
  if new.cree_par is null then new.cree_par := auth.uid(); end if;
  return new;
end $$;

-- Vérification de la chaîne : renvoie la première ligne altérée, ou null.
create or replace function public.audit_verifier()
returns table (premiere_ligne_alteree bigint, lignes_verifiees bigint)
language plpgsql stable security definer set search_path = '' as $$
declare r record; prev text := repeat('0', 64); n bigint := 0;
begin
  if not private.has_role('admin','comptable') then
    raise exception 'GBS_ACCES_REFUSE' using errcode = '42501';
  end if;
  for r in select * from public.journal_audit order by id loop
    n := n + 1;
    if r.empreinte_precedente <> prev or r.empreinte <> private.audit_hash(
         r.empreinte_precedente, r.horodatage, r.utilisateur, r.action, r.table_nom,
         r.ligne_id, r.avant, r.apres, r.motif) then
      premiere_ligne_alteree := r.id; lignes_verifiees := n; return next; return;
    end if;
    prev := r.empreinte;
  end loop;
  premiere_ligne_alteree := null; lignes_verifiees := n; return next;
end $$;

-- Exécute une action sensible avec un motif inscrit au journal.
create or replace function private.motif(p text) returns void
language plpgsql as $$
begin
  if p is null or length(trim(p)) < 5 then
    raise exception 'GBS_MOTIF_OBLIGATOIRE: un motif d''au moins 5 caractères est exigé' using errcode = 'P0001';
  end if;
  if length(p) > 1000 then
    raise exception 'GBS_MOTIF_TROP_LONG' using errcode = 'P0001';
  end if;
  perform set_config('gbs.motif', p, true);
end $$;

-- Branchements socle
create trigger societes_touch before update on public.societes for each row execute function private.trg_touch();
create trigger societes_audit after insert or update or delete on public.societes for each row execute function private.trg_audit();
create trigger societes_nodel before delete on public.societes for each row execute function private.trg_no_delete();
create trigger profils_touch before update on public.profils for each row execute function private.trg_touch();
create trigger profils_audit after insert or update on public.profils for each row execute function private.trg_audit();
create trigger profils_nodel before delete on public.profils for each row execute function private.trg_no_delete();
create trigger parametres_cree before insert on public.parametres for each row execute function private.trg_cree_par();
create trigger parametres_audit after insert or update or delete on public.parametres for each row execute function private.trg_audit();
-- Un paramètre daté ne se modifie pas : on en crée un nouveau avec une nouvelle date d'effet.
create trigger parametres_immuable before update or delete on public.parametres for each row execute function private.trg_immuable();
create trigger taux_cree before insert on public.taux_change for each row execute function private.trg_cree_par();
create trigger taux_audit after insert or update or delete on public.taux_change for each row execute function private.trg_audit();
create trigger taux_immuable before update or delete on public.taux_change for each row execute function private.trg_immuable();
create trigger series_audit after insert or update on public.series_factures for each row execute function private.trg_audit();
