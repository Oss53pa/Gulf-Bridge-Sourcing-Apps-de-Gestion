-- Portail client : nouvelle demande (maquette « Espace client · nouvelle demande »).
-- * Un compte client décrit un nouveau besoin (texte, quantité, date d'ouverture souhaitée). La demande
--   n'ouvre pas de dossier : l'équipe commerciale la convertit en consultation (le dossier qu'elle
--   ouvre, avec modèle et société) ou la refuse avec un motif. Une demande traitée est figée.
-- * Limitation de débit : demandes par client et par jour, paramétrée.
-- * Lecture : le client voit ses demandes ; l'équipe commerciale voit celles des clients qu'elle voit.

insert into gbs.parametres_definitions (cle, type, minimum, maximum, validateur, module, libelle) values
  ('portail.max_demandes_jour', 'entier', 1, 100, null, 'commercial', 'Nouvelles demandes au plus par client et par jour (portail)');
insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('portail.max_demandes_jour', '5', date '2026-01-01', 'Limite anti-abus du portail client');

create table gbs.demandes_clients (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references gbs.clients(id),
  auteur_id        uuid not null references gbs.profils(id),
  besoin           text not null check (length(trim(besoin)) between 10 and 4000),
  quantite         text check (length(quantite) <= 120),
  ouverture_souhaitee date,
  statut           text not null default 'nouvelle' check (statut in ('nouvelle','convertie','refusee')),
  dossier_id       uuid references gbs.dossiers(id),
  motif_refus      text check (length(motif_refus) <= 1000),
  traitee_par      uuid references gbs.profils(id),
  traitee_le       timestamptz,
  cree_le          timestamptz not null default clock_timestamp(),
  check (statut <> 'convertie' or dossier_id is not null),
  check (statut <> 'refusee' or motif_refus is not null)
);
create index on gbs.demandes_clients (client_id, cree_le);

create or replace function gbs_private.trg_demande_client_rpc() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'demande_client' then
    raise exception 'GBS_VALIDATION_RPC: les demandes se modifient par les fonctions dédiées' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and old.statut <> 'nouvelle' then raise exception 'GBS_DEMANDE_TRAITEE' using errcode = 'P0001'; end if;
  return new;
end $$;

alter table gbs.demandes_clients enable row level security;
grant select on gbs.demandes_clients to authenticated;
create trigger demandes_clients_rpc before insert or update on gbs.demandes_clients for each row execute function gbs_private.trg_demande_client_rpc();
create trigger demandes_clients_audit after insert or update on gbs.demandes_clients for each row execute function gbs_private.trg_audit();
create trigger demandes_clients_nodel before delete on gbs.demandes_clients for each row execute function gbs_private.trg_no_delete();
create policy demandes_clients_lecture on gbs.demandes_clients for select using (
  client_id = gbs_private.mon_client()
  or (gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.client_visible(client_id)));

create or replace function gbs.deposer_demande_client(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c uuid := gbs_private.mon_client(); r uuid; n int;
begin
  perform gbs_private.exiger(c is not null);
  if jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) k where k not in ('besoin','quantite','ouverture_souhaitee'))
     or coalesce(jsonb_typeof(p -> 'besoin'), '') <> 'string'
     or (p ? 'quantite' and jsonb_typeof(p -> 'quantite') not in ('string','null'))
     or (p ? 'ouverture_souhaitee' and jsonb_typeof(p -> 'ouverture_souhaitee') not in ('string','null')) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if nullif(p ->> 'ouverture_souhaitee', '') is not null and (p ->> 'ouverture_souhaitee')::date <= current_date then
    raise exception 'GBS_DATE_INVALIDE' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('gbs.demandes_clients.' || c::text));
  select count(*) into n from gbs.demandes_clients where client_id = c and cree_le > now() - interval '1 day';
  if n >= gbs_private.param_num('portail.max_demandes_jour', current_date) then
    raise exception 'GBS_TROP_DE_DEMANDES' using errcode = 'P0001';
  end if;
  perform gbs_private.rpc('demande_client');
  insert into gbs.demandes_clients (client_id, auteur_id, besoin, quantite, ouverture_souhaitee)
  values (c, auth.uid(), trim(p ->> 'besoin'), nullif(trim(p ->> 'quantite'), ''), nullif(p ->> 'ouverture_souhaitee', '')::date)
  returning id into r;
  perform gbs_private.rpc('');
  return r;
exception
  when check_violation or not_null_violation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

-- Traitement par l'équipe : rattachement au dossier de consultation ouvert pour ce client, ou refus motivé.
create or replace function gbs.traiter_demande_client(p_demande uuid, p_dossier uuid default null, p_motif text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare d gbs.demandes_clients;
begin
  select * into d from gbs.demandes_clients where id = p_demande for update;
  perform gbs_private.exiger(d.id is not null and gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.client_visible(d.client_id));
  if d.statut <> 'nouvelle' then raise exception 'GBS_DEMANDE_TRAITEE' using errcode = 'P0001'; end if;
  if p_dossier is not null then
    if not exists (select 1 from gbs.dossiers x where x.id = p_dossier and x.client_id = d.client_id and gbs_private.dossier_visible(x.id)) then
      raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
    end if;
    perform gbs_private.rpc('demande_client');
    update gbs.demandes_clients set statut = 'convertie', dossier_id = p_dossier, traitee_par = auth.uid(), traitee_le = now() where id = d.id;
  else
    perform gbs_private.motif(p_motif);
    perform gbs_private.rpc('demande_client');
    update gbs.demandes_clients set statut = 'refusee', motif_refus = trim(p_motif), traitee_par = auth.uid(), traitee_le = now() where id = d.id;
  end if;
  perform gbs_private.rpc('');
end $$;

revoke all on function gbs_private.trg_demande_client_rpc() from public, anon, authenticated;
revoke all on function gbs.deposer_demande_client(jsonb), gbs.traiter_demande_client(uuid, uuid, text) from public, anon;
grant execute on function gbs.deposer_demande_client(jsonb), gbs.traiter_demande_client(uuid, uuid, text) to authenticated;
