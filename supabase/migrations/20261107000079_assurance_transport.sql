-- Assurance transport et sinistres (cahier des charges M9, lot 2 ; maquette « Logistique · ASS »).
-- * Police par expédition : assureur, numéro, garantie (clauses Institute Cargo A, B ou C), devise,
--   valeur CIF, période de couverture, attestation. La valeur assurée (CIF majorée) et la prime de
--   référence sont calculées en base selon des paramètres datés (10 % et 0,35 % par défaut, à confirmer
--   avec l'assureur) ; la prime réelle de l'assureur peut être saisie à la place de la prime de référence.
-- * Sinistre : déclaré par l'équipe qui gère l'expédition (nature, constat, montant réclamé, preuves au
--   dossier) ; une déclaration au-delà du délai paramétré après le constat est signalée « tardive ».
--   Suite (administratrice, achats Chine) : transmission à l'expert, puis indemnité (plafonnée à la valeur
--   assurée, convertie au cours du jour) ou refus motivé. Un sinistre clos ne se modifie plus.
-- * Lecture : équipe interne qui voit le dossier.

insert into gbs.parametres_definitions (cle, type, minimum, maximum, validateur, module, libelle) values
  ('assurance.majoration_valeur', 'taux', 0, 0.5, null, 'logistique', 'Assurance transport : majoration de la valeur CIF'),
  ('assurance.taux_prime', 'taux', 0, 0.05, null, 'logistique', 'Assurance transport : taux de prime de référence'),
  ('assurance.delai_declaration_jours', 'entier', 1, 60, null, 'logistique', 'Sinistre : délai de déclaration après le constat (jours)');
insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('assurance.majoration_valeur', '0.10', date '2026-01-01', 'Usage : CIF + 10 % (à confirmer avec l''assureur)'),
  ('assurance.taux_prime', '0.0035', date '2026-01-01', 'Taux de référence de la maquette (à confirmer avec l''assureur)'),
  ('assurance.delai_declaration_jours', '3', date '2026-01-01', 'Réserves au transporteur sous trois jours (à confirmer avec l''assureur)');

create table gbs.polices_assurance (
  id              uuid primary key default gen_random_uuid(),
  expedition_id   uuid not null unique references gbs.expeditions(id),
  dossier_id      uuid not null references gbs.dossiers(id),
  assureur        text not null check (length(assureur) between 2 and 120),
  numero          text not null check (numero ~ '^[A-Za-z0-9 ./_-]{3,60}$'),
  garantie        text not null check (garantie in ('icc_a','icc_b','icc_c')),
  devise          char(3) not null check (devise in ('USD','CNY','XOF','XAF','EUR')),
  valeur_cif      numeric(16,2) not null check (valeur_cif > 0),
  valeur_assuree  numeric(16,2) not null check (valeur_assuree >= valeur_cif),
  prime           numeric(16,2) not null check (prime >= 0),
  prime_reelle    boolean not null default false,
  du              date not null,
  au              date not null check (au >= du and au - du <= 400),
  attestation     text check (attestation ~ '^[A-Za-z0-9/_.-]+$' and length(attestation) <= 400 and attestation !~ '\.\.'),
  modifie_le      timestamptz not null default now(), modifie_par uuid,
  cree_le         timestamptz not null default now(), cree_par uuid
);

create table gbs.sinistres (
  id              uuid primary key default gen_random_uuid(),
  reference       text not null unique,
  expedition_id   uuid not null references gbs.expeditions(id),
  police_id       uuid not null references gbs.polices_assurance(id),
  dossier_id      uuid not null references gbs.dossiers(id),
  nature          text not null check (nature in ('avarie','manquant','perte_totale','vol','mouille','autre')),
  description     text not null check (length(description) between 10 and 2000),
  constate_le     date not null,
  declare_le      date not null default current_date,
  tardif          boolean not null default false,
  montant_reclame numeric(16,2) not null check (montant_reclame > 0),
  devise          char(3) not null,
  preuves         text[] not null default '{}' check (cardinality(preuves) <= 20),
  statut          text not null default 'declare' check (statut in ('declare','expertise','indemnise','refuse')),
  reference_assureur text check (length(reference_assureur) <= 80),
  indemnite       numeric(16,2) check (indemnite >= 0),
  indemnise_le    date,
  motif_refus     text check (length(motif_refus) <= 1000),
  declare_par     uuid not null references gbs.profils(id),
  traite_par      uuid references gbs.profils(id),
  modifie_le      timestamptz not null default now(), modifie_par uuid,
  check (statut <> 'indemnise' or (indemnite is not null and indemnise_le is not null)),
  check (statut <> 'refuse' or motif_refus is not null),
  check (statut = 'declare' or reference_assureur is not null)
);
create index on gbs.sinistres (expedition_id);

create or replace function gbs_private.trg_assurance_rpc() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'assurance' then
    raise exception 'GBS_VALIDATION_RPC: l''assurance transport passe par les fonctions dédiées' using errcode = 'P0001';
  end if;
  -- Un sinistre clos ne change plus (lecture du statut par jsonb : la même fonction sert aux polices).
  if tg_table_name = 'sinistres' and tg_op = 'UPDATE' and (to_jsonb(old) ->> 'statut') in ('indemnise','refuse') then
    raise exception 'GBS_DEMANDE_TRAITEE' using errcode = 'P0001';
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['polices_assurance','sinistres'] loop
    execute format('alter table gbs.%I enable row level security', t);
    execute format('grant select on gbs.%I to authenticated', t);
    execute format('create trigger %I before insert or update on gbs.%I for each row execute function gbs_private.trg_assurance_rpc()', t || '_rpc', t);
    execute format('create trigger %I before update on gbs.%I for each row execute function gbs_private.trg_touch()', t || '_touch', t);
    execute format('create trigger %I after insert or update on gbs.%I for each row execute function gbs_private.trg_audit()', t || '_audit', t);
    execute format('create trigger %I before delete on gbs.%I for each row execute function gbs_private.trg_no_delete()', t || '_nodel', t);
    execute format('create policy %I on gbs.%I for select using (gbs_private.interne() and gbs_private.dossier_visible(dossier_id))', t || '_lecture', t);
  end loop;
end $$;

-- Police : création ou mise à jour (tant qu'aucun sinistre n'est en cours sur l'expédition).
create or replace function gbs.enregistrer_police(p_expedition uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare e gbs.expeditions; r uuid; cif numeric; prime numeric; maj numeric; d1 date; d2 date;
begin
  perform gbs_private.exiger(gbs_private.gere_expedition(p_expedition));
  select * into e from gbs.expeditions where id = p_expedition;
  if jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) k where k not in ('assureur','numero','garantie','devise','valeur_cif','prime','du','au','attestation'))
     or coalesce(jsonb_typeof(p -> 'assureur'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'numero'), '') <> 'string'
     or coalesce(jsonb_typeof(p -> 'garantie'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'devise'), '') <> 'string'
     or coalesce(jsonb_typeof(p -> 'valeur_cif'), '') <> 'number'
     or coalesce(jsonb_typeof(p -> 'du'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'au'), '') <> 'string'
     or (p ? 'prime' and jsonb_typeof(p -> 'prime') not in ('number','null'))
     or (p ? 'attestation' and jsonb_typeof(p -> 'attestation') not in ('string','null')) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if exists (select 1 from gbs.sinistres s where s.expedition_id = e.id and s.statut in ('declare','expertise')) then
    raise exception 'GBS_SINISTRE_EN_COURS' using errcode = 'P0001';
  end if;
  cif := (p ->> 'valeur_cif')::numeric; d1 := (p ->> 'du')::date; d2 := (p ->> 'au')::date;
  maj := gbs_private.param_num('assurance.majoration_valeur', d1);
  prime := case when jsonb_typeof(p -> 'prime') = 'number' then (p ->> 'prime')::numeric
                else round(cif * (1 + maj) * gbs_private.param_num('assurance.taux_prime', d1), 2) end;
  perform gbs_private.rpc('assurance');
  insert into gbs.polices_assurance (expedition_id, dossier_id, assureur, numero, garantie, devise, valeur_cif, valeur_assuree, prime, prime_reelle, du, au, attestation, cree_par, modifie_par)
  values (e.id, e.dossier_id, trim(p ->> 'assureur'), trim(p ->> 'numero'), p ->> 'garantie', p ->> 'devise', cif, round(cif * (1 + maj), 2), prime,
          coalesce(jsonb_typeof(p -> 'prime') = 'number', false), d1, d2, nullif(p ->> 'attestation', ''), auth.uid(), auth.uid())
  on conflict (expedition_id) do update set assureur = excluded.assureur, numero = excluded.numero, garantie = excluded.garantie,
    devise = excluded.devise, valeur_cif = excluded.valeur_cif, valeur_assuree = excluded.valeur_assuree, prime = excluded.prime,
    prime_reelle = excluded.prime_reelle, du = excluded.du, au = excluded.au, attestation = excluded.attestation, modifie_par = excluded.modifie_par
  returning id into r;
  perform gbs_private.rpc('');
  return r;
exception
  when check_violation or not_null_violation or invalid_datetime_format or datetime_field_overflow or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

-- Déclaration d'un sinistre : police exigée, constat dans la période de couverture.
create or replace function gbs.declarer_sinistre(p_expedition uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare e gbs.expeditions; po gbs.polices_assurance; r uuid; c date; n int;
begin
  perform gbs_private.exiger(gbs_private.gere_expedition(p_expedition));
  select * into e from gbs.expeditions where id = p_expedition;
  select * into po from gbs.polices_assurance where expedition_id = p_expedition;
  if po.id is null then raise exception 'GBS_POLICE_REQUISE' using errcode = 'P0001'; end if;
  if jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) k where k not in ('nature','description','constate_le','montant_reclame','preuves'))
     or coalesce(jsonb_typeof(p -> 'nature'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'description'), '') <> 'string'
     or coalesce(jsonb_typeof(p -> 'constate_le'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'montant_reclame'), '') <> 'number'
     or (p ? 'preuves' and (jsonb_typeof(p -> 'preuves') <> 'array'
         or exists (select 1 from jsonb_array_elements(p -> 'preuves') x where jsonb_typeof(x) <> 'string'
                     or (x #>> '{}') !~ '^[A-Za-z0-9/_.-]+$' or length(x #>> '{}') > 400 or (x #>> '{}') ~ '\.\.'))) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  c := (p ->> 'constate_le')::date;
  if c > current_date or c < po.du or c > po.au + gbs_private.param_num('assurance.delai_declaration_jours')::int then
    raise exception 'GBS_HORS_COUVERTURE' using errcode = 'P0001';
  end if;
  if (p ->> 'montant_reclame')::numeric > po.valeur_assuree then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  select count(*) + 1 into n from gbs.sinistres s where s.expedition_id = e.id;
  perform gbs_private.rpc('assurance');
  insert into gbs.sinistres (reference, expedition_id, police_id, dossier_id, nature, description, constate_le, tardif, montant_reclame, devise, preuves, declare_par)
  values ('SIN-' || coalesce(e.reference, left(e.id::text, 8)) || '-' || lpad(n::text, 2, '0'), e.id, po.id, e.dossier_id, p ->> 'nature',
          trim(p ->> 'description'), c, current_date - c > gbs_private.param_num('assurance.delai_declaration_jours')::int,
          (p ->> 'montant_reclame')::numeric, po.devise,
          coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'preuves') x), '{}'), auth.uid())
  returning id into r;
  perform gbs_private.rpc('');
  return r;
exception
  when check_violation or not_null_violation or invalid_datetime_format or datetime_field_overflow or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

-- Suite du sinistre : expertise (référence de l'assureur), indemnité ou refus motivé.
create or replace function gbs.traiter_sinistre(p_sinistre uuid, p_action text, p jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare s gbs.sinistres; po gbs.polices_assurance;
begin
  select * into s from gbs.sinistres where id = p_sinistre for update;
  perform gbs_private.exiger(s.id is not null and gbs_private.has_role('admin','achats_chine'));
  select * into po from gbs.polices_assurance where id = s.police_id;
  if jsonb_typeof(p) <> 'object' or exists (select 1 from jsonb_object_keys(p) k where k not in ('reference_assureur','indemnite','indemnise_le','motif')) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if s.statut in ('indemnise','refuse') then raise exception 'GBS_DEMANDE_TRAITEE' using errcode = 'P0001'; end if;
  perform gbs_private.rpc('assurance');
  if p_action = 'expertise' and s.statut = 'declare' then
    if coalesce(jsonb_typeof(p -> 'reference_assureur'), '') <> 'string' or length(trim(p ->> 'reference_assureur')) not between 2 and 80 then
      raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
    end if;
    update gbs.sinistres set statut = 'expertise', reference_assureur = trim(p ->> 'reference_assureur'), traite_par = auth.uid() where id = s.id;
  elsif p_action = 'indemniser' and s.statut = 'expertise' then
    if coalesce(jsonb_typeof(p -> 'indemnite'), '') <> 'number' or coalesce(jsonb_typeof(p -> 'indemnise_le'), '') <> 'string'
       or (p ->> 'indemnite')::numeric < 0 or (p ->> 'indemnite')::numeric > po.valeur_assuree
       or (p ->> 'indemnise_le')::date > current_date or (p ->> 'indemnise_le')::date < s.declare_le then
      raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
    end if;
    update gbs.sinistres set statut = 'indemnise', indemnite = (p ->> 'indemnite')::numeric, indemnise_le = (p ->> 'indemnise_le')::date,
           traite_par = auth.uid() where id = s.id;
  elsif p_action = 'refuser' and s.statut = 'expertise' then
    perform gbs_private.motif(p ->> 'motif');
    update gbs.sinistres set statut = 'refuse', motif_refus = trim(p ->> 'motif'), traite_par = auth.uid() where id = s.id;
  else
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform gbs_private.rpc('');
exception
  when invalid_datetime_format or datetime_field_overflow or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

revoke all on function gbs_private.trg_assurance_rpc() from public, anon, authenticated;
revoke all on function gbs.enregistrer_police(uuid, jsonb), gbs.declarer_sinistre(uuid, jsonb), gbs.traiter_sinistre(uuid, text, jsonb) from public, anon;
grant execute on function gbs.enregistrer_police(uuid, jsonb), gbs.declarer_sinistre(uuid, jsonb), gbs.traiter_sinistre(uuid, text, jsonb) to authenticated;
