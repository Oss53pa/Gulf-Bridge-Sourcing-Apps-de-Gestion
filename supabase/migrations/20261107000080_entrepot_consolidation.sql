-- Entrepôt de consolidation (cahier des charges M19, lot 2 ; maquette « Logistique · ENT »).
-- * Consolidation : un conteneur pour un dossier (20' DV, 40' DV, 40' HC), capacités utiles en paramètres
--   datés (à confirmer par le transitaire) ; statut ouverte → liste de colisage close → empotage planifié → empoté.
-- * Réception de marchandises d'un fournisseur dans une consolidation ouverte : colis attendus (par défaut
--   ceux de la liste de colisage validée du fournisseur pour la commande) et reçus, volume, poids,
--   emplacement, photos au dossier. Un écart de colis ou un dommage constaté crée une réserve ; la levée
--   d'une réserve est motivée et journalisée.
-- * Clôture de la liste de colisage : au moins une réception, aucune réserve ouverte, capacité du conteneur
--   respectée ; la liste (réceptions, totaux) est figée. Empotage : planifié après clôture, puis réalisé
--   avec au moins une photo d'empotage.
-- * Une consolidation empotée se rattache à une expédition du même dossier, pas encore partie : le numéro
--   de conteneur et le plomb y sont reportés (sans doublon), le lieu de remise renseigné s'il est vide.
-- * Écriture : administratrice et achats Chine (équipe de l'entrepôt) ; lecture : équipe interne du dossier.

insert into gbs.parametres_definitions (cle, type, minimum, maximum, validateur, module, libelle) values
  ('entrepot.capacite_m3.*', 'nombre', 1, 120, null, 'logistique', 'Volume utile d''un conteneur, par type (m³)'),
  ('entrepot.charge_kg.*', 'nombre', 100, 40000, null, 'logistique', 'Charge utile d''un conteneur, par type (kg)');
insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('entrepot.capacite_m3.20_dv', '28', date '2026-01-01', 'Volume utile usuel d''un 20'' DV (à confirmer par le transitaire)'),
  ('entrepot.capacite_m3.40_dv', '58', date '2026-01-01', 'Volume utile usuel d''un 40'' DV (à confirmer par le transitaire)'),
  ('entrepot.capacite_m3.40_hc', '67', date '2026-01-01', 'Volume utile usuel d''un 40'' HC (maquette ; à confirmer)'),
  ('entrepot.charge_kg.20_dv', '21700', date '2026-01-01', 'Charge utile usuelle d''un 20'' DV (à confirmer)'),
  ('entrepot.charge_kg.40_dv', '26500', date '2026-01-01', 'Charge utile usuelle d''un 40'' DV (à confirmer)'),
  ('entrepot.charge_kg.40_hc', '26500', date '2026-01-01', 'Charge utile usuelle d''un 40'' HC (maquette ; à confirmer)');

create table gbs.consolidations (
  id               uuid primary key default gen_random_uuid(),
  reference        text not null unique,
  dossier_id       uuid not null references gbs.dossiers(id),
  type_conteneur   text not null check (type_conteneur in ('20_dv','40_dv','40_hc')),
  entrepot         text not null check (length(entrepot) between 2 and 80),
  statut           text not null default 'ouverte' check (statut in ('ouverte','colisage_clos','empotage_planifie','empote')),
  liste_colisage   jsonb,
  colisage_clos_le timestamptz,
  empotage_prevu_le date,
  empote_le        timestamptz,
  photos_empotage  text[] not null default '{}' check (cardinality(photos_empotage) <= 30),
  numero_conteneur text check (numero_conteneur ~ '^[A-Z]{4}[0-9]{7}$'),
  numero_plomb     text check (length(numero_plomb) between 3 and 40),
  expedition_id    uuid references gbs.expeditions(id),
  cree_le          timestamptz not null default now(), cree_par uuid,
  modifie_le       timestamptz not null default now(), modifie_par uuid,
  check ((statut = 'ouverte') = (liste_colisage is null)),
  check (statut <> 'empote' or (cardinality(photos_empotage) >= 1 and numero_conteneur is not null and numero_plomb is not null))
);

create table gbs.receptions_entrepot (
  id               uuid primary key default gen_random_uuid(),
  reference        text not null unique,
  consolidation_id uuid not null references gbs.consolidations(id),
  dossier_id       uuid not null references gbs.dossiers(id),
  fournisseur_id   uuid not null references gbs.fournisseurs(id),
  commande_id      uuid references gbs.commandes(id),
  recue_le         date not null,
  colis_attendus   int not null check (colis_attendus between 1 and 100000),
  colis_recus      int not null check (colis_recus between 0 and 100000),
  volume_m3        numeric(10,3) not null check (volume_m3 >= 0 and volume_m3 <= 200),
  poids_kg         numeric(12,2) not null check (poids_kg >= 0 and poids_kg <= 60000),
  emplacement      text check (emplacement ~ '^[A-Za-z0-9 ./_-]{1,20}$'),
  photos           text[] not null default '{}' check (cardinality(photos) <= 30),
  statut           text not null check (statut in ('conforme','reserve','reserve_levee')),
  reserve          text check (length(reserve) <= 1000),
  levee_motif      text check (length(levee_motif) <= 1000),
  levee_le         timestamptz,
  levee_par        uuid references gbs.profils(id),
  cree_le          timestamptz not null default now(), cree_par uuid,
  modifie_le       timestamptz not null default now(), modifie_par uuid,
  check (statut = 'conforme' or reserve is not null),
  check ((statut = 'reserve_levee') = (levee_le is not null))
);
create index on gbs.receptions_entrepot (consolidation_id);

create or replace function gbs_private.trg_entrepot_rpc() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'entrepot' then
    raise exception 'GBS_VALIDATION_RPC: l''entrepôt passe par les fonctions dédiées' using errcode = 'P0001';
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['consolidations','receptions_entrepot'] loop
    execute format('alter table gbs.%I enable row level security', t);
    execute format('grant select on gbs.%I to authenticated', t);
    execute format('create trigger %I before insert or update on gbs.%I for each row execute function gbs_private.trg_entrepot_rpc()', t || '_rpc', t);
    execute format('create trigger %I before update on gbs.%I for each row execute function gbs_private.trg_touch()', t || '_touch', t);
    execute format('create trigger %I after insert or update on gbs.%I for each row execute function gbs_private.trg_audit()', t || '_audit', t);
    execute format('create trigger %I before delete on gbs.%I for each row execute function gbs_private.trg_no_delete()', t || '_nodel', t);
    execute format('create policy %I on gbs.%I for select using (gbs_private.interne() and gbs_private.dossier_visible(dossier_id))', t || '_lecture', t);
  end loop;
end $$;

create or replace function gbs_private.chemins_valides(p jsonb, p_max int) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= p_max
     and not exists (select 1 from jsonb_array_elements(p) x where jsonb_typeof(x) <> 'string'
                      or (x #>> '{}') !~ '^[A-Za-z0-9/_.-]+$' or length(x #>> '{}') > 400 or (x #>> '{}') ~ '\.\.')
$$;

create or replace function gbs.ouvrir_consolidation(p_dossier uuid, p_type text, p_entrepot text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d gbs.dossiers; r uuid; n int;
begin
  select * into d from gbs.dossiers where id = p_dossier;
  perform gbs_private.exiger(d.id is not null and gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(d.id));
  if d.statut <> 'ouvert' then raise exception 'GBS_DOSSIER_NON_OUVERT' using errcode = 'P0001'; end if;
  if p_type is null or p_type not in ('20_dv','40_dv','40_hc') or p_entrepot is null or length(trim(p_entrepot)) not between 2 and 80 then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  select count(*) + 1 into n from gbs.consolidations c where c.dossier_id = d.id;
  perform gbs_private.rpc('entrepot');
  insert into gbs.consolidations (reference, dossier_id, type_conteneur, entrepot, cree_par)
  values ('CNS-' || d.reference || '-' || lpad(n::text, 2, '0'), d.id, p_type, trim(p_entrepot), auth.uid()) returning id into r;
  perform gbs_private.rpc('');
  return r;
end $$;

create or replace function gbs.receptionner(p_consolidation uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c gbs.consolidations; k gbs.commandes; f uuid; att int; rec int; res text; r uuid; n int;
begin
  select * into c from gbs.consolidations where id = p_consolidation for update;
  perform gbs_private.exiger(c.id is not null and gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(c.dossier_id));
  if c.statut <> 'ouverte' then raise exception 'GBS_COLISAGE_CLOS' using errcode = 'P0001'; end if;
  if jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) x where x not in ('fournisseur_id','commande_id','recue_le','colis_attendus','colis_recus','volume_m3','poids_kg','emplacement','photos','reserve'))
     or coalesce(jsonb_typeof(p -> 'recue_le'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'colis_recus'), '') <> 'number'
     or coalesce(jsonb_typeof(p -> 'volume_m3'), '') <> 'number' or coalesce(jsonb_typeof(p -> 'poids_kg'), '') <> 'number'
     or (p ? 'fournisseur_id' and jsonb_typeof(p -> 'fournisseur_id') not in ('string','null'))
     or (p ? 'commande_id' and jsonb_typeof(p -> 'commande_id') not in ('string','null'))
     or (p ? 'colis_attendus' and jsonb_typeof(p -> 'colis_attendus') not in ('number','null'))
     or (p ? 'emplacement' and jsonb_typeof(p -> 'emplacement') not in ('string','null'))
     or (p ? 'reserve' and jsonb_typeof(p -> 'reserve') not in ('string','null'))
     or (p ? 'photos' and not gbs_private.chemins_valides(p -> 'photos', 30))
     or (p ->> 'recue_le')::date > current_date then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  -- Commande du dossier : elle fixe le fournisseur et, par défaut, les colis attendus (liste de colisage validée).
  if nullif(p ->> 'commande_id', '') is not null then
    select * into k from gbs.commandes where id = (p ->> 'commande_id')::uuid;
    if k.id is null or k.dossier_id <> c.dossier_id then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
    f := k.fournisseur_id;
  else
    f := nullif(p ->> 'fournisseur_id', '')::uuid;
    if f is null or not exists (select 1 from gbs.fournisseurs x where x.id = f) then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  end if;
  att := coalesce((p ->> 'colis_attendus')::int,
                  (select x.caisses from gbs.colisages x where x.commande_id = k.id and x.statut = 'validee'));
  if att is null then raise exception 'GBS_COLIS_ATTENDUS_REQUIS' using errcode = 'P0001'; end if;
  rec := (p ->> 'colis_recus')::int;
  res := nullif(trim(coalesce(p ->> 'reserve', '')), '');
  if rec <> att then
    res := concat_ws(' ; ', case when rec < att then (att - rec) || ' colis manquant(s)' else (rec - att) || ' colis en excédent' end, res);
  end if;
  select count(*) + 1 into n from gbs.receptions_entrepot x where x.consolidation_id = c.id;
  perform gbs_private.rpc('entrepot');
  insert into gbs.receptions_entrepot (reference, consolidation_id, dossier_id, fournisseur_id, commande_id, recue_le, colis_attendus, colis_recus,
    volume_m3, poids_kg, emplacement, photos, statut, reserve, cree_par)
  values (c.reference || '-R' || lpad(n::text, 2, '0'), c.id, c.dossier_id, f, k.id, (p ->> 'recue_le')::date, att, rec,
          (p ->> 'volume_m3')::numeric, (p ->> 'poids_kg')::numeric, nullif(trim(p ->> 'emplacement'), ''),
          coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'photos') x), '{}'),
          case when res is null then 'conforme' else 'reserve' end, res, auth.uid())
  returning id into r;
  perform gbs_private.rpc('');
  return r;
exception
  when check_violation or not_null_violation or invalid_datetime_format or datetime_field_overflow or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

create or replace function gbs.lever_reserve_entrepot(p_reception uuid, p_motif text) returns void
language plpgsql security definer set search_path = '' as $$
declare x gbs.receptions_entrepot; c gbs.consolidations;
begin
  select * into x from gbs.receptions_entrepot where id = p_reception for update;
  perform gbs_private.exiger(x.id is not null and gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(x.dossier_id));
  select * into c from gbs.consolidations where id = x.consolidation_id;
  if c.statut <> 'ouverte' then raise exception 'GBS_COLISAGE_CLOS' using errcode = 'P0001'; end if;
  if x.statut <> 'reserve' then raise exception 'GBS_DEMANDE_TRAITEE' using errcode = 'P0001'; end if;
  perform gbs_private.motif(p_motif);
  perform gbs_private.rpc('entrepot');
  update gbs.receptions_entrepot set statut = 'reserve_levee', levee_motif = trim(p_motif), levee_le = now(), levee_par = auth.uid() where id = x.id;
  perform gbs_private.rpc('');
  perform gbs_private.journaliser('reserve_entrepot_levee', 'receptions_entrepot', x.id::text, x.dossier_id, null, null, trim(p_motif));
end $$;

-- Totaux d'une consolidation et taux de remplissage du conteneur.
create or replace function gbs_private.remplissage(c gbs.consolidations) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'receptions', count(r.id), 'colis_recus', coalesce(sum(r.colis_recus), 0), 'colis_attendus', coalesce(sum(r.colis_attendus), 0),
    'volume_m3', coalesce(sum(r.volume_m3), 0), 'poids_kg', coalesce(sum(r.poids_kg), 0),
    'reserves_ouvertes', count(r.id) filter (where r.statut = 'reserve'),
    'capacite_m3', gbs_private.param_num('entrepot.capacite_m3.' || c.type_conteneur),
    'charge_kg', gbs_private.param_num('entrepot.charge_kg.' || c.type_conteneur))
  from gbs.receptions_entrepot r where r.consolidation_id = c.id
$$;

create or replace function gbs.etat_consolidation(p_consolidation uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c gbs.consolidations;
begin
  select * into c from gbs.consolidations where id = p_consolidation;
  perform gbs_private.exiger(c.id is not null and gbs_private.interne() and gbs_private.dossier_visible(c.dossier_id));
  return gbs_private.remplissage(c);
end $$;

create or replace function gbs.clore_colisage(p_consolidation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c gbs.consolidations; e jsonb;
begin
  select * into c from gbs.consolidations where id = p_consolidation for update;
  perform gbs_private.exiger(c.id is not null and gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(c.dossier_id));
  if c.statut <> 'ouverte' then raise exception 'GBS_COLISAGE_CLOS' using errcode = 'P0001'; end if;
  e := gbs_private.remplissage(c);
  if (e ->> 'receptions')::int = 0 then raise exception 'GBS_AUCUNE_RECEPTION' using errcode = 'P0001'; end if;
  if (e ->> 'reserves_ouvertes')::int > 0 then raise exception 'GBS_RESERVES_OUVERTES' using errcode = 'P0001'; end if;
  if (e ->> 'volume_m3')::numeric > (e ->> 'capacite_m3')::numeric or (e ->> 'poids_kg')::numeric > (e ->> 'charge_kg')::numeric then
    raise exception 'GBS_CAPACITE_DEPASSEE' using errcode = 'P0001';
  end if;
  perform gbs_private.rpc('entrepot');
  update gbs.consolidations set statut = 'colisage_clos', colisage_clos_le = now(),
    liste_colisage = e || jsonb_build_object('lignes', (select jsonb_agg(jsonb_build_object('reference', r.reference, 'fournisseur', fo.raison_sociale_en,
        'colis', r.colis_recus, 'volume_m3', r.volume_m3, 'poids_kg', r.poids_kg, 'emplacement', r.emplacement) order by r.reference)
      from gbs.receptions_entrepot r join gbs.fournisseurs fo on fo.id = r.fournisseur_id where r.consolidation_id = c.id))
   where id = c.id;
  perform gbs_private.rpc('');
end $$;

create or replace function gbs.planifier_empotage(p_consolidation uuid, p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare c gbs.consolidations;
begin
  select * into c from gbs.consolidations where id = p_consolidation for update;
  perform gbs_private.exiger(c.id is not null and gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(c.dossier_id));
  if c.statut not in ('colisage_clos','empotage_planifie') then raise exception 'GBS_COLISAGE_NON_CLOS' using errcode = 'P0001'; end if;
  if p_date is null or p_date < current_date or p_date > current_date + 180 then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  perform gbs_private.rpc('entrepot');
  update gbs.consolidations set statut = 'empotage_planifie', empotage_prevu_le = p_date where id = c.id;
  perform gbs_private.rpc('');
end $$;

create or replace function gbs.confirmer_empotage(p_consolidation uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare c gbs.consolidations;
begin
  select * into c from gbs.consolidations where id = p_consolidation for update;
  perform gbs_private.exiger(c.id is not null and gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(c.dossier_id));
  if c.statut <> 'empotage_planifie' then raise exception 'GBS_EMPOTAGE_NON_PLANIFIE' using errcode = 'P0001'; end if;
  if jsonb_typeof(p) <> 'object' or exists (select 1 from jsonb_object_keys(p) x where x not in ('numero_conteneur','numero_plomb','photos'))
     or coalesce(jsonb_typeof(p -> 'numero_conteneur'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'numero_plomb'), '') <> 'string'
     or not gbs_private.chemins_valides(coalesce(p -> 'photos', 'null'::jsonb), 30) or jsonb_array_length(p -> 'photos') = 0 then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform gbs_private.rpc('entrepot');
  update gbs.consolidations set statut = 'empote', empote_le = now(), numero_conteneur = upper(trim(p ->> 'numero_conteneur')),
         numero_plomb = trim(p ->> 'numero_plomb'), photos_empotage = (select array_agg(x) from jsonb_array_elements_text(p -> 'photos') x)
   where id = c.id;
  perform gbs_private.rpc('');
exception
  when check_violation then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

create or replace function gbs.rattacher_expedition(p_consolidation uuid, p_expedition uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c gbs.consolidations; e gbs.expeditions;
begin
  select * into c from gbs.consolidations where id = p_consolidation for update;
  perform gbs_private.exiger(c.id is not null and gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(c.dossier_id));
  select * into e from gbs.expeditions where id = p_expedition for update;
  if e.id is null or e.dossier_id <> c.dossier_id then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  if c.statut <> 'empote' then raise exception 'GBS_EMPOTAGE_NON_CONFIRME' using errcode = 'P0001'; end if;
  if c.expedition_id is not null then raise exception 'GBS_DEMANDE_TRAITEE' using errcode = 'P0001'; end if;
  if e.statut not in ('preparation','remise_transporteur') then raise exception 'GBS_EXPEDITION_PARTIE' using errcode = 'P0001'; end if;
  update gbs.expeditions set
    conteneurs = case when c.numero_conteneur = any(conteneurs) then conteneurs else conteneurs || c.numero_conteneur end,
    plombs = case when c.numero_plomb = any(plombs) then plombs else plombs || c.numero_plomb end,
    lieu_remise = coalesce(lieu_remise, left('Entrepôt de consolidation · ' || c.entrepot, 200))
   where id = e.id;
  perform gbs_private.rpc('entrepot');
  update gbs.consolidations set expedition_id = e.id where id = c.id;
  perform gbs_private.rpc('');
end $$;

revoke all on function gbs.rattacher_expedition(uuid, uuid) from public, anon;
grant execute on function gbs.rattacher_expedition(uuid, uuid) to authenticated;

revoke all on function gbs_private.trg_entrepot_rpc(), gbs_private.remplissage(gbs.consolidations) from public, anon, authenticated;
revoke all on function gbs.ouvrir_consolidation(uuid, text, text), gbs.receptionner(uuid, jsonb), gbs.lever_reserve_entrepot(uuid, text),
  gbs.etat_consolidation(uuid), gbs.clore_colisage(uuid), gbs.planifier_empotage(uuid, date), gbs.confirmer_empotage(uuid, jsonb) from public, anon;
grant execute on function gbs.ouvrir_consolidation(uuid, text, text), gbs.receptionner(uuid, jsonb), gbs.lever_reserve_entrepot(uuid, text),
  gbs.etat_consolidation(uuid), gbs.clore_colisage(uuid), gbs.planifier_empotage(uuid, date), gbs.confirmer_empotage(uuid, jsonb) to authenticated;
