-- Lot 1, M28 : réception sur site par GBS Côte d'Ivoire — procès-verbal, réserves, levée.
-- * Le procès-verbal se prépare (constat, photos, réserves), puis s'enregistre signé par
--   le client : acceptée sans réserve (définitive), acceptée avec réserves, ou refusée.
--   Une réserve bloquante interdit l'acceptation.
-- * Chaque réserve est levée avec une preuve ; quand toutes le sont, la réception est
--   prononcée définitive sur un procès-verbal de levée signé.
-- * La pièce « procès-verbal de réception » de la phase livraison est reçue à la signature
--   et validée quand toutes les réceptions du dossier sont définitives.

create table gbs.receptions (
  id              uuid primary key default gen_random_uuid(),
  reference       text unique check (reference ~ '^REC-[0-9]{4}-[0-9]{3,5}$'),
  dossier_id      uuid not null references gbs.dossiers(id),
  expedition_id   uuid references gbs.expeditions(id),
  date_reception  date not null,
  lieu            text not null check (length(trim(lieu)) between 2 and 200),
  client_signataire text check (length(client_signataire) <= 120),
  representant_id uuid references gbs.profils(id),
  constat         text check (length(constat) <= 4000),
  photos          text[] not null default '{}' check (cardinality(photos) <= 30),
  statut          text not null default 'brouillon' check (statut in ('brouillon','signee','definitive','refusee')),
  pv_document     text check (length(pv_document) <= 400),
  signe_le        date,
  pv_levee_document text check (length(pv_levee_document) <= 400),
  definitive_le   date,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid
);
create unique index receptions_expedition_active on gbs.receptions (expedition_id)
  where expedition_id is not null and statut <> 'refusee';

create table gbs.reserves_reception (
  id            uuid primary key default gen_random_uuid(),
  reception_id  uuid not null references gbs.receptions(id),
  dossier_id    uuid not null references gbs.dossiers(id),
  numero        int not null,
  description   text not null check (length(trim(description)) between 3 and 2000),
  gravite       text not null check (gravite in ('mineure','majeure','bloquante')),
  responsable   text not null check (responsable in ('fournisseur','transitaire','gbs','client')),
  commande_id   uuid references gbs.commandes(id),
  delai         date,
  photos        text[] not null default '{}' check (cardinality(photos) <= 20),
  statut        text not null default 'ouverte' check (statut in ('ouverte','levee')),
  preuve        text check (length(preuve) <= 2000),
  photos_levee  text[] not null default '{}' check (cardinality(photos_levee) <= 20),
  levee_le      timestamptz,
  levee_par     uuid references gbs.profils(id),
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  unique (reception_id, numero)
);

-- -----------------------------------------------------------------------------
-- Règles d'écriture
-- -----------------------------------------------------------------------------
create or replace function gbs_private.trg_reception() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int; e gbs.expeditions; rpc text := coalesce(current_setting('gbs.rpc', true), '');
begin
  if tg_op = 'INSERT' then
    if new.expedition_id is not null then
      select * into e from gbs.expeditions where id = new.expedition_id;
      if e.id is null or e.dossier_id <> new.dossier_id or e.statut not in ('arrivee','mise_a_disposition','livree') then
        raise exception 'GBS_EXPEDITION_NON_ARRIVEE: la réception suit l''arrivée de l''expédition du dossier' using errcode = 'P0001';
      end if;
    end if;
    if new.statut <> 'brouillon' or new.pv_document is not null or new.signe_le is not null
       or new.pv_levee_document is not null or new.definitive_le is not null then
      raise exception 'GBS_VALIDATION_RPC' using errcode = 'P0001';
    end if;
    perform pg_advisory_xact_lock(7326);
    select coalesce(max(substring(reference from '-([0-9]+)$')::int), 0) + 1 into n
      from gbs.receptions where reference like 'REC-' || extract(year from now())::int || '-%';
    new.reference := 'REC-' || extract(year from now())::int || '-' || lpad(n::text, 3, '0');
    new.representant_id := auth.uid();
  else
    if (new.reference, new.dossier_id, new.expedition_id, new.representant_id)
       is distinct from (old.reference, old.dossier_id, old.expedition_id, old.representant_id) then
      raise exception 'GBS_RECEPTION_FIGEE' using errcode = 'P0001';
    end if;
    if rpc <> 'reception' then
      if old.statut <> 'brouillon' then
        raise exception 'GBS_DOCUMENT_VALIDE: procès-verbal signé' using errcode = 'P0001';
      end if;
      if (new.statut, new.pv_document, new.signe_le, new.pv_levee_document, new.definitive_le)
         is distinct from (old.statut, old.pv_document, old.signe_le, old.pv_levee_document, old.definitive_le) then
        raise exception 'GBS_VALIDATION_RPC' using errcode = 'P0001';
      end if;
    end if;
  end if;
  if new.date_reception > current_date then raise exception 'GBS_DATE_INVALIDE' using errcode = '22023'; end if;
  if not gbs_private.photos_valides(new.dossier_id, new.photos) then
    raise exception 'GBS_PHOTOS_INVALIDES' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger receptions_regles before insert or update on gbs.receptions
  for each row execute function gbs_private.trg_reception();

create or replace function gbs_private.trg_reserve() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r gbs.receptions; rpc text := coalesce(current_setting('gbs.rpc', true), '');
begin
  select * into r from gbs.receptions where id = new.reception_id;
  if tg_op = 'INSERT' then
    if r.statut <> 'brouillon' then
      raise exception 'GBS_DOCUMENT_VALIDE: les réserves s''inscrivent au procès-verbal avant sa signature' using errcode = 'P0001';
    end if;
    new.dossier_id := r.dossier_id;
    perform pg_advisory_xact_lock(7327);
    select coalesce(max(numero), 0) + 1 into new.numero from gbs.reserves_reception where reception_id = new.reception_id;
    if new.statut <> 'ouverte' or new.preuve is not null or new.levee_le is not null or new.levee_par is not null
       or cardinality(new.photos_levee) > 0 then
      raise exception 'GBS_VALIDATION_RPC' using errcode = 'P0001';
    end if;
  else
    if (new.reception_id, new.dossier_id, new.numero) is distinct from (old.reception_id, old.dossier_id, old.numero) then
      raise exception 'GBS_RESERVE_FIGEE' using errcode = 'P0001';
    end if;
    if rpc <> 'reception' then
      if r.statut <> 'brouillon' then
        raise exception 'GBS_DOCUMENT_VALIDE: réserve inscrite au procès-verbal signé' using errcode = 'P0001';
      end if;
      if (new.statut, new.preuve, new.photos_levee, new.levee_le, new.levee_par)
         is distinct from (old.statut, old.preuve, old.photos_levee, old.levee_le, old.levee_par) then
        raise exception 'GBS_VALIDATION_RPC' using errcode = 'P0001';
      end if;
    end if;
  end if;
  if new.commande_id is not null and not exists (select 1 from gbs.commandes c where c.id = new.commande_id and c.dossier_id = new.dossier_id) then
    raise exception 'GBS_COMMANDE_INCONNUE' using errcode = '22023';
  end if;
  if new.delai is not null and new.delai < r.date_reception then raise exception 'GBS_DELAI_INVALIDE' using errcode = '22023'; end if;
  if not gbs_private.photos_valides(new.dossier_id, new.photos) or not gbs_private.photos_valides(new.dossier_id, new.photos_levee) then
    raise exception 'GBS_PHOTOS_INVALIDES' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger reserves_regles before insert or update on gbs.reserves_reception
  for each row execute function gbs_private.trg_reserve();

do $$
declare t text;
begin
  foreach t in array array['receptions','reserves_reception'] loop
    execute format('create trigger %1$s_touch before update on gbs.%1$s for each row execute function gbs_private.trg_touch()', t);
    execute format('create trigger %1$s_cree before insert on gbs.%1$s for each row execute function gbs_private.trg_cree_par()', t);
    execute format('create trigger %1$s_audit after insert or update or delete on gbs.%1$s for each row execute function gbs_private.trg_audit()', t);
    execute format('create trigger %1$s_nodel before delete on gbs.%1$s for each row execute function gbs_private.trg_no_delete()', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Pièce « procès-verbal de réception » de la phase livraison.
-- -----------------------------------------------------------------------------
create or replace function gbs_private.maj_piece_reception(p_dossier uuid, p_document text) returns void
language plpgsql security definer set search_path = '' as $$
declare prev text := coalesce(current_setting('gbs.rpc', true), ''); toutes boolean;
begin
  toutes := exists (select 1 from gbs.receptions r where r.dossier_id = p_dossier and r.statut <> 'refusee')
        and not exists (select 1 from gbs.receptions r where r.dossier_id = p_dossier and r.statut in ('brouillon','signee'));
  perform set_config('gbs.rpc', 'systeme', true);
  update gbs.pieces set statut = case when toutes then 'validee' else 'recue' end,
         document_chemin = coalesce(p_document, document_chemin)
   where dossier_id = p_dossier and phase = 'livraison' and code = 'client_pv_reception'
     and commande_id is null and expedition_id is null and statut not in ('validee');
  perform set_config('gbs.rpc', prev, true);
end $$;

-- -----------------------------------------------------------------------------
-- Signature, levée, réception définitive
-- -----------------------------------------------------------------------------
create or replace function gbs_private.peut_receptionner(p_dossier uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select gbs_private.has_role('admin','hub_afrique') and gbs_private.dossier_visible(p_dossier)
$$;

create or replace function gbs.signer_reception(p_reception uuid, p_decision text, p_signataire text, p_document text, p_signe_le date)
returns gbs.receptions language plpgsql security definer set search_path = '' as $$
declare r gbs.receptions; sig text := trim(coalesce(p_signataire, '')); nb int; bloquantes int;
begin
  select * into r from gbs.receptions where id = p_reception for update;
  perform gbs_private.exiger(r.id is not null and gbs_private.peut_receptionner(r.dossier_id));
  if r.statut <> 'brouillon' then raise exception 'GBS_RECEPTION_STATUT' using errcode = 'P0001'; end if;
  if p_decision not in ('acceptee','refusee') or length(sig) not between 2 and 120
     or p_document is null or not gbs_private.photos_valides(r.dossier_id, array[p_document])
     or p_signe_le is null or p_signe_le > current_date or p_signe_le < r.date_reception then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  select count(*), count(*) filter (where gravite = 'bloquante') into nb, bloquantes
    from gbs.reserves_reception where reception_id = p_reception;
  if p_decision = 'acceptee' and bloquantes > 0 then
    raise exception 'GBS_RESERVE_BLOQUANTE: une réserve bloquante interdit l''acceptation' using errcode = 'P0001';
  end if;
  if p_decision = 'refusee' and nb = 0 then
    raise exception 'GBS_REFUS_SANS_RESERVE: un refus s''appuie sur au moins une réserve' using errcode = 'P0001';
  end if;
  perform set_config('gbs.rpc', 'reception', true);
  update gbs.receptions set client_signataire = sig, pv_document = p_document, signe_le = p_signe_le,
         statut = case when p_decision = 'refusee' then 'refusee' when nb = 0 then 'definitive' else 'signee' end,
         definitive_le = case when p_decision = 'acceptee' and nb = 0 then p_signe_le end
   where id = p_reception returning * into r;
  perform set_config('gbs.rpc', '', true);
  if r.statut <> 'refusee' then perform gbs_private.maj_piece_reception(r.dossier_id, p_document); end if;
  return r;
end $$;

create or replace function gbs.lever_reserve(p_reserve uuid, p_preuve text, p_photos text[] default '{}')
returns gbs.reserves_reception language plpgsql security definer set search_path = '' as $$
declare x gbs.reserves_reception; r gbs.receptions; pr text := trim(coalesce(p_preuve, ''));
begin
  select * into x from gbs.reserves_reception where id = p_reserve for update;
  perform gbs_private.exiger(x.id is not null and gbs_private.peut_receptionner(x.dossier_id));
  select * into r from gbs.receptions where id = x.reception_id;
  if r.statut <> 'signee' or x.statut <> 'ouverte' then raise exception 'GBS_RECEPTION_STATUT' using errcode = 'P0001'; end if;
  if length(pr) not between 10 and 2000 then raise exception 'GBS_PREUVE_INVALIDE' using errcode = '22023'; end if;
  perform set_config('gbs.rpc', 'reception', true);
  update gbs.reserves_reception set statut = 'levee', preuve = pr, photos_levee = coalesce(p_photos, '{}'),
         levee_le = now(), levee_par = auth.uid()
   where id = p_reserve returning * into x;
  perform set_config('gbs.rpc', '', true);
  return x;
end $$;

create or replace function gbs.prononcer_reception_definitive(p_reception uuid, p_document text, p_date date)
returns gbs.receptions language plpgsql security definer set search_path = '' as $$
declare r gbs.receptions;
begin
  select * into r from gbs.receptions where id = p_reception for update;
  perform gbs_private.exiger(r.id is not null and gbs_private.peut_receptionner(r.dossier_id));
  if r.statut <> 'signee' then raise exception 'GBS_RECEPTION_STATUT' using errcode = 'P0001'; end if;
  if exists (select 1 from gbs.reserves_reception x where x.reception_id = p_reception and x.statut <> 'levee') then
    raise exception 'GBS_RESERVES_OUVERTES: toutes les réserves doivent être levées' using errcode = 'P0001';
  end if;
  if p_document is null or not gbs_private.photos_valides(r.dossier_id, array[p_document])
     or p_date is null or p_date > current_date or p_date < r.signe_le then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform set_config('gbs.rpc', 'reception', true);
  update gbs.receptions set statut = 'definitive', pv_levee_document = p_document, definitive_le = p_date
   where id = p_reception returning * into r;
  perform set_config('gbs.rpc', '', true);
  perform gbs_private.maj_piece_reception(r.dossier_id, p_document);
  return r;
end $$;

-- Réserves ouvertes, en retard d'abord.
create or replace function gbs.reserves_ouvertes()
returns table (reserve_id uuid, reception_id uuid, reception text, dossier_id uuid, dossier text, numero int, description text,
               gravite text, responsable text, delai date, en_retard boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','hub_afrique','achats_chine'));
  return query
  select x.id, r.id, r.reference, d.id, d.reference, x.numero, x.description, x.gravite, x.responsable, x.delai,
         coalesce(x.delai < current_date, false)
    from gbs.reserves_reception x
    join gbs.receptions r on r.id = x.reception_id
    join gbs.dossiers d on d.id = x.dossier_id
   where x.statut = 'ouverte' and r.statut = 'signee' and gbs_private.dossier_visible(x.dossier_id)
   order by coalesce(x.delai < current_date, false) desc, x.delai nulls last, r.reference, x.numero;
end $$;

-- -----------------------------------------------------------------------------
-- Droits : GBS Côte d'Ivoire (Hub Afrique) et administratrice ; achats en lecture.
-- -----------------------------------------------------------------------------
alter table gbs.receptions enable row level security;
alter table gbs.reserves_reception enable row level security;
grant select, insert on gbs.receptions, gbs.reserves_reception to authenticated;
grant update (date_reception, lieu, client_signataire, constat, photos) on gbs.receptions to authenticated;
grant update (description, gravite, responsable, commande_id, delai, photos) on gbs.reserves_reception to authenticated;

create policy receptions_lecture on gbs.receptions for select using (
  gbs_private.has_role('admin','hub_afrique','achats_chine') and gbs_private.dossier_visible(dossier_id));
create policy receptions_creation on gbs.receptions for insert with check (gbs_private.peut_receptionner(dossier_id));
create policy receptions_maj on gbs.receptions for update using (gbs_private.peut_receptionner(dossier_id));
create policy reserves_lecture on gbs.reserves_reception for select using (
  gbs_private.has_role('admin','hub_afrique','achats_chine') and gbs_private.dossier_visible(dossier_id));
create policy reserves_creation on gbs.reserves_reception for insert with check (
  exists (select 1 from gbs.receptions r where r.id = reception_id and gbs_private.peut_receptionner(r.dossier_id)));
create policy reserves_maj on gbs.reserves_reception for update using (gbs_private.peut_receptionner(dossier_id));

revoke execute on function gbs.signer_reception(uuid, text, text, text, date), gbs.lever_reserve(uuid, text, text[]),
  gbs.prononcer_reception_definitive(uuid, text, date), gbs.reserves_ouvertes(),
  gbs_private.trg_reception(), gbs_private.trg_reserve(), gbs_private.maj_piece_reception(uuid, text),
  gbs_private.peut_receptionner(uuid) from public;
grant execute on function gbs.signer_reception(uuid, text, text, text, date), gbs.lever_reserve(uuid, text, text[]),
  gbs.prononcer_reception_definitive(uuid, text, date), gbs.reserves_ouvertes() to authenticated;
grant execute on all functions in schema gbs_private to authenticated, service_role;
