-- Simulation minimale de l'environnement Supabase pour les tests sur un
-- PostgreSQL nu : rôles, schéma auth et fonctions auth.uid() / auth.jwt().
-- NE PAS appliquer sur un projet Supabase (ces objets y existent déjà).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(auth.jwt() ->> 'role', current_user) $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- Objets d'une autre application du même projet, avec des noms identiques à ceux de
-- GBS : les migrations GBS ne doivent ni les modifier ni changer leurs droits.
create table if not exists public.dossiers (id int primary key, libelle text);
create table if not exists public.societes (id int primary key, nom text);
grant select, insert on public.dossiers, public.societes to authenticated, anon;
insert into public.dossiers values (1, 'autre application') on conflict do nothing;

-- Simulation de pg_net : les requêtes sont enregistrées, les tests écrivent les réponses.
create schema if not exists net;
create sequence if not exists net.seq;
create table if not exists net.requetes (id bigint primary key, url text, cree_le timestamptz default now());
create table if not exists net._http_response (
  id bigint primary key, status_code int, content text, timed_out boolean, error_msg text,
  created timestamptz default now());
create or replace function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}',
  timeout_milliseconds int default 5000) returns bigint language sql as $$
  insert into net.requetes (id, url) values (nextval('net.seq'), url) returning id $$;
