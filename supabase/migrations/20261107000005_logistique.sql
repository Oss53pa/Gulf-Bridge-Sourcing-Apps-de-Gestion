-- =============================================================================
-- Lot 0 — Logistique : suivi manuel des expéditions (M9), bordereau de suivi des
-- cargaisons et marchandises dangereuses exigés dans la phase Expédition (M20).
-- Cahier des charges : section 4 quater, M9, M20.
-- =============================================================================

create table gbs.expeditions (
  id              uuid primary key default gen_random_uuid(),
  reference       text unique check (reference ~ '^EXP-[0-9]{4}-[0-9]{3,5}$'),
  dossier_id      uuid not null references gbs.dossiers(id),
  mode            text not null check (mode in ('conteneur_complet','groupage','aerien')),
  transitaire     text check (length(transitaire) <= 200),
  reservation     text check (length(reservation) <= 80),
  conteneurs      text[] not null default '{}',
  plombs          text[] not null default '{}',
  lieu_remise     text check (length(lieu_remise) <= 200),
  port_depart     text check (length(port_depart) <= 80),
  port_arrivee    text check (port_arrivee in ('Abidjan','San-Pédro','Owendo','Douala','Kribi') or port_arrivee is null),
  pays_destination char(2) not null check (pays_destination ~ '^[A-Z]{2}$'),
  navire          text check (length(navire) <= 120),
  type_connaissement text check (type_connaissement in ('original','telex_release','non_negociable','lta')),
  numero_connaissement text check (length(numero_connaissement) <= 60),
  etd             date,
  eta             date,
  eta_initiale    date,
  date_mainlevee  date,
  jours_franchise int check (jours_franchise between 0 and 60),
  bordereau_reference text check (length(bordereau_reference) <= 60),   -- BSC / BESC / BIETC
  fds_document    text check (length(fds_document) <= 400),            -- fiche de données de sécurité
  declaration_imdg_document text check (length(declaration_imdg_document) <= 400),
  un38_3_document text check (length(un38_3_document) <= 400),
  statut          text not null default 'preparation'
                  check (statut in ('preparation','remise_transporteur','expediee','en_transit','arrivee','mise_a_disposition','livree')),
  expediee_le     timestamptz,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check (cardinality(conteneurs) <= 50 and cardinality(plombs) <= 50)
);

create table gbs.expedition_commandes (
  expedition_id uuid not null references gbs.expeditions(id),
  commande_id   uuid not null references gbs.commandes(id),
  primary key (expedition_id, commande_id)
);

create table gbs.expedition_etapes (
  id            uuid primary key default gen_random_uuid(),
  expedition_id uuid not null references gbs.expeditions(id),
  dossier_id    uuid not null references gbs.dossiers(id),
  etape         text not null check (etape in ('remise_transporteur','depart_port','transbordement','arrivee_port',
                                               'dechargement','mise_a_disposition','livraison','autre')),
  lieu          text check (length(lieu) <= 120),
  survenue_le   timestamptz not null,
  commentaire   text check (length(commentaire) <= 1000),
  visible_client boolean not null default true,
  cree_le timestamptz not null default now(), cree_par uuid
);

create or replace function gbs_private.trg_expedition_ref() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int; an int := extract(year from now())::int;
begin
  perform pg_advisory_xact_lock(7316);
  select coalesce(max(substring(reference from '-([0-9]+)$')::int), 0) + 1 into n
    from gbs.expeditions where reference like 'EXP-' || an || '-%';
  new.reference := 'EXP-' || an || '-' || lpad(n::text, 3, '0');
  if new.eta_initiale is null then new.eta_initiale := new.eta; end if;
  return new;
end $$;
create trigger expeditions_ref before insert on gbs.expeditions
  for each row execute function gbs_private.trg_expedition_ref();

create or replace function gbs_private.trg_etape() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select e.dossier_id into new.dossier_id from gbs.expeditions e where e.id = new.expedition_id;
  return new;
end $$;
create trigger etapes_dossier before insert on gbs.expedition_etapes
  for each row execute function gbs_private.trg_etape();

create or replace function gbs_private.trg_exp_cmd() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from gbs.expeditions e join gbs.commandes c on c.dossier_id = e.dossier_id
                 where e.id = new.expedition_id and c.id = new.commande_id) then
    raise exception 'GBS_COMMANDE_AUTRE_DOSSIER' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger exp_cmd_regles before insert on gbs.expedition_commandes
  for each row execute function gbs_private.trg_exp_cmd();

do $$
declare t text;
begin
  foreach t in array array['expeditions'] loop
    execute format('create trigger %1$s_touch before update on gbs.%1$s for each row execute function gbs_private.trg_touch()', t);
    execute format('create trigger %1$s_cree before insert on gbs.%1$s for each row execute function gbs_private.trg_cree_par()', t);
    execute format('create trigger %1$s_audit after insert or update or delete on gbs.%1$s for each row execute function gbs_private.trg_audit()', t);
    execute format('create trigger %1$s_nodel before delete on gbs.%1$s for each row execute function gbs_private.trg_no_delete()', t);
  end loop;
end $$;
create trigger etapes_cree before insert on gbs.expedition_etapes for each row execute function gbs_private.trg_cree_par();
create trigger etapes_audit after insert or update or delete on gbs.expedition_etapes for each row execute function gbs_private.trg_audit();
create trigger etapes_nodel before delete on gbs.expedition_etapes for each row execute function gbs_private.trg_no_delete();
create trigger exp_cmd_audit after insert or update or delete on gbs.expedition_commandes for each row execute function gbs_private.trg_audit();
create trigger exp_cmd_nodel before delete on gbs.expedition_commandes for each row execute function gbs_private.trg_no_delete();

alter table gbs.derogations
  add constraint derogations_expedition_fk foreign key (expedition_id) references gbs.expeditions(id);
alter table gbs.pieces
  add constraint pieces_commande_fk foreign key (commande_id) references gbs.commandes(id),
  add constraint pieces_expedition_fk foreign key (expedition_id) references gbs.expeditions(id);
