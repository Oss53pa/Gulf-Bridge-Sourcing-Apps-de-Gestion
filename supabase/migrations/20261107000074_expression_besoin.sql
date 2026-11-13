-- Guide d'expression du besoin (cahier des charges M31, section 4 quinquies ; maquette « BES »), usage interne.
-- * Questionnaires versionnés et paramétrables sans développement : un tronc commun et un questionnaire par
--   catégorie, en étapes et champs (type, options, champ critique, aide, exemple, contrôle de cohérence).
--   Une catégorie complète les étapes du tronc commun de même code et en ajoute. Seule l'administratrice
--   active une version (validation de la fondatrice) ; un besoin garde la version avec laquelle il est né.
-- * Réseau électrique par pays (tensions, fréquence, prises), paramétré par l'administratrice ; les valeurs
--   amorcées sont « à confirmer ».
-- * Besoin d'un dossier : réponses validées champ par champ en base (type, longueur, options, champs inconnus
--   refusés) ; complétude, champs critiques manquants et incohérences calculés en base ; soumission refusée
--   tant qu'un champ critique manque ; chaque soumission conserve une version ; questions et réponses par
--   champ ; validation sur cahier des charges signé, après quoi le besoin est figé.
-- * Rôles : rédaction par l'administratrice, le Hub Afrique et l'agent pays du dossier ; questions aussi par
--   les achats Chine ; validation par l'administratrice ou le Hub Afrique.

-- ----------------------------------------------------------------------------- questionnaires
create table gbs.questionnaires_besoin (
  id          uuid primary key default gen_random_uuid(),
  categorie   text not null check (categorie ~ '^[a-z0-9_]{2,40}$'),
  libelle     text not null check (length(libelle) between 2 and 120),
  version     int not null check (version >= 1),
  etapes      jsonb not null,
  statut      text not null default 'brouillon' check (statut in ('brouillon','actif','retire')),
  active_le   timestamptz,
  active_par  uuid references gbs.profils(id),
  cree_le     timestamptz not null default now(),
  cree_par    uuid references gbs.profils(id),
  unique (categorie, version)
);
create unique index questionnaires_un_actif on gbs.questionnaires_besoin (categorie) where statut = 'actif';

-- Structure stricte d'un questionnaire : étapes et champs, clés connues seulement, longueurs bornées.
create or replace function gbs_private.etapes_besoin_valides(v jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare e jsonb; c jsonb; o jsonb; cles text[] := '{}'; codes text[] := '{}';
begin
  if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) not between 1 and 12 then return false; end if;
  for e in select value from jsonb_array_elements(v) loop
    if jsonb_typeof(e) <> 'object' or exists (select 1 from jsonb_object_keys(e) k where k not in ('code','libelle','libelle_zh','aide','champs'))
       or coalesce(e ->> 'code', '') !~ '^[a-z0-9_]{2,40}$' or (e ->> 'code') = any(codes)
       or length(coalesce(e ->> 'libelle', '')) not between 2 and 120 or length(coalesce(e ->> 'libelle_zh', '')) > 120
       or length(coalesce(e ->> 'aide', '')) > 500
       or coalesce(jsonb_typeof(e -> 'champs'), '') <> 'array' or jsonb_array_length(e -> 'champs') not between 1 and 30 then
      return false;
    end if;
    if exists (select 1 from jsonb_each(e) x where x.key in ('code','libelle','libelle_zh','aide') and jsonb_typeof(x.value) <> 'string') then return false; end if;
    codes := codes || (e ->> 'code');
    for c in select value from jsonb_array_elements(e -> 'champs') loop
      if jsonb_typeof(c) <> 'object'
         or exists (select 1 from jsonb_object_keys(c) k where k not in ('cle','libelle','libelle_zh','type','options','critique','aide','exemple','unite','min','max','controle'))
         or exists (select 1 from jsonb_each(c) x where x.key in ('cle','libelle','libelle_zh','type','aide','exemple','unite','controle') and jsonb_typeof(x.value) <> 'string')
         or coalesce(c ->> 'cle', '') !~ '^[a-z0-9_]{2,40}$' or (c ->> 'cle') = any(cles)
         or length(coalesce(c ->> 'libelle', '')) not between 2 and 200 or length(coalesce(c ->> 'libelle_zh', '')) > 200
         or coalesce(c ->> 'type', '') not in ('texte','texte_long','nombre','choix','choix_multiple','oui_non','date')
         or length(coalesce(c ->> 'aide', '')) > 500 or length(coalesce(c ->> 'exemple', '')) > 500 or length(coalesce(c ->> 'unite', '')) > 20
         or (c ? 'critique' and jsonb_typeof(c -> 'critique') <> 'boolean')
         or (c ? 'min' and (jsonb_typeof(c -> 'min') <> 'number' or c ->> 'type' <> 'nombre'))
         or (c ? 'max' and (jsonb_typeof(c -> 'max') <> 'number' or c ->> 'type' <> 'nombre'))
         or (c ? 'min' and c ? 'max' and (c ->> 'min')::numeric > (c ->> 'max')::numeric)
         or (c ? 'controle' and c ->> 'controle' not in ('tension_pays','frequence_pays','prises_pays'))
         or ((c ->> 'type') in ('choix','choix_multiple')) <> (c ? 'options') then
        return false;
      end if;
      if c ? 'options' then
        o := c -> 'options';
        if jsonb_typeof(o) <> 'array' or jsonb_array_length(o) not between 2 and 40
           or exists (select 1 from jsonb_array_elements(o) x where jsonb_typeof(x) <> 'string' or length(x #>> '{}') not between 1 and 120)
           or (select count(distinct x) from jsonb_array_elements_text(o) x) <> jsonb_array_length(o) then
          return false;
        end if;
      end if;
      cles := cles || (c ->> 'cle');
    end loop;
  end loop;
  return true;
end $$;

alter table gbs.questionnaires_besoin add constraint questionnaires_etapes_valides check (gbs_private.etapes_besoin_valides(etapes));

-- ----------------------------------------------------------------------------- réseau électrique par pays
create table gbs.pays_electricite (
  pays       char(2) primary key check (pays ~ '^[A-Z]{2}$'),
  tensions   int[] not null check (cardinality(tensions) between 1 and 6 and 0 < all(tensions) and 1000 > all(tensions)),
  frequence  int not null check (frequence in (50, 60)),
  prises     text[] not null check (cardinality(prises) between 1 and 10),
  confirme   boolean not null default false,
  source     text check (length(source) <= 300),
  modifie_le timestamptz not null default now(), modifie_par uuid
);
-- Valeurs courantes, à confirmer par l'administratrice avant de s'y fier (non confirmées par défaut).
insert into gbs.pays_electricite (pays, tensions, frequence, prises) values
  ('CI', '{230,400}', 50, '{C,E}'),
  ('GA', '{220,380}', 50, '{C}'),
  ('CM', '{220,380}', 50, '{C,E}'),
  ('SN', '{230,400}', 50, '{C,D,E,K}');

-- ----------------------------------------------------------------------------- besoins
create table gbs.besoins (
  id              uuid primary key default gen_random_uuid(),
  dossier_id      uuid not null references gbs.dossiers(id),
  categorie       text not null,
  tronc_id        uuid not null references gbs.questionnaires_besoin(id),
  questionnaire_id uuid references gbs.questionnaires_besoin(id),
  pays            char(2),
  reponses        jsonb not null default '{}'::jsonb check (jsonb_typeof(reponses) = 'object'),
  statut          text not null default 'brouillon' check (statut in ('brouillon','soumis','valide')),
  version         int not null default 0,
  soumis_le       timestamptz,
  valide_le       timestamptz,
  valide_par      uuid references gbs.profils(id),
  document_signe  text check (length(document_signe) <= 400),
  signe_le        date,
  cree_le         timestamptz not null default now(),
  cree_par        uuid references gbs.profils(id),
  modifie_le      timestamptz not null default now(), modifie_par uuid,
  unique (dossier_id, categorie),
  check ((statut = 'valide') = (valide_le is not null and document_signe is not null and signe_le is not null))
);

create table gbs.besoins_versions (
  besoin_id  uuid not null references gbs.besoins(id),
  version    int not null,
  reponses   jsonb not null,
  etat       jsonb not null,
  cree_le    timestamptz not null default now(),
  cree_par   uuid references gbs.profils(id),
  primary key (besoin_id, version)
);

create table gbs.besoins_questions (
  id          uuid primary key default gen_random_uuid(),
  besoin_id   uuid not null references gbs.besoins(id),
  champ       text not null check (champ ~ '^[a-z0-9_]{2,40}$'),
  question    text not null check (length(question) between 3 and 1000),
  auteur_id   uuid not null references gbs.profils(id),
  cree_le     timestamptz not null default clock_timestamp(),
  reponse     text check (length(reponse) between 1 and 2000),
  repondu_par uuid references gbs.profils(id),
  repondu_le  timestamptz,
  check ((reponse is null) = (repondu_le is null) and (reponse is null) = (repondu_par is null))
);
create index on gbs.besoins_questions (besoin_id, cree_le);

-- Écritures uniquement par les fonctions dédiées.
create or replace function gbs_private.trg_besoin_rpc() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'besoin' then
    raise exception 'GBS_VALIDATION_RPC: le guide d''expression du besoin passe par les fonctions dédiées' using errcode = 'P0001';
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['questionnaires_besoin','pays_electricite','besoins','besoins_versions','besoins_questions'] loop
    execute format('alter table gbs.%I enable row level security', t);
    execute format('grant select on gbs.%I to authenticated', t);
    execute format('create trigger %I before insert or update on gbs.%I for each row execute function gbs_private.trg_besoin_rpc()', t || '_rpc', t);
    execute format('create trigger %I after insert or update on gbs.%I for each row execute function gbs_private.trg_audit()', t || '_audit', t);
    execute format('create trigger %I before delete on gbs.%I for each row execute function gbs_private.trg_no_delete()', t || '_nodel', t);
  end loop;
end $$;
create trigger besoins_touch before update on gbs.besoins for each row execute function gbs_private.trg_touch();
create trigger pays_electricite_touch before update on gbs.pays_electricite for each row execute function gbs_private.trg_touch();

create policy questionnaires_lecture on gbs.questionnaires_besoin for select using (gbs_private.interne());
create policy pays_electricite_lecture on gbs.pays_electricite for select using (gbs_private.interne());
create policy besoins_lecture on gbs.besoins for select using (gbs_private.interne() and gbs_private.dossier_visible(dossier_id));
create policy besoins_versions_lecture on gbs.besoins_versions for select using (gbs_private.interne()
  and exists (select 1 from gbs.besoins b where b.id = besoin_id and gbs_private.dossier_visible(b.dossier_id)));
create policy besoins_questions_lecture on gbs.besoins_questions for select using (gbs_private.interne()
  and exists (select 1 from gbs.besoins b where b.id = besoin_id and gbs_private.dossier_visible(b.dossier_id)));

-- ----------------------------------------------------------------------------- administration des questionnaires
create or replace function gbs.enregistrer_questionnaire_besoin(p_categorie text, p_libelle text, p_etapes jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r uuid; tronc jsonb;
begin
  perform gbs_private.exiger(gbs_private.is_admin(), 'GBS_VALIDATION_ADMIN');
  if p_categorie is null or p_categorie !~ '^[a-z0-9_]{2,40}$' or p_libelle is null or length(trim(p_libelle)) not between 2 and 120
     or not gbs_private.etapes_besoin_valides(p_etapes) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  -- Une catégorie ne redéfinit pas un champ du tronc commun en vigueur.
  if p_categorie <> 'tronc_commun' then
    select etapes into tronc from gbs.questionnaires_besoin where categorie = 'tronc_commun' and statut = 'actif';
    if exists (select 1 from jsonb_array_elements(p_etapes) e, jsonb_array_elements(e -> 'champs') c
                where c ->> 'cle' in (select t2 ->> 'cle' from jsonb_array_elements(coalesce(tronc, '[]'::jsonb)) t1, jsonb_array_elements(t1 -> 'champs') t2)) then
      raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
    end if;
  end if;
  perform gbs_private.rpc('besoin');
  insert into gbs.questionnaires_besoin (categorie, libelle, version, etapes, cree_par)
  values (p_categorie, trim(p_libelle),
          coalesce((select max(version) from gbs.questionnaires_besoin where categorie = p_categorie), 0) + 1, p_etapes, auth.uid())
  returning id into r;
  perform gbs_private.rpc('');
  return r;
end $$;

create or replace function gbs.activer_questionnaire_besoin(p_questionnaire uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare q gbs.questionnaires_besoin;
begin
  perform gbs_private.exiger(gbs_private.is_admin(), 'GBS_VALIDATION_ADMIN');
  select * into q from gbs.questionnaires_besoin where id = p_questionnaire for update;
  if q.id is null or q.statut <> 'brouillon' then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  perform gbs_private.rpc('besoin');
  update gbs.questionnaires_besoin set statut = 'retire' where categorie = q.categorie and statut = 'actif';
  update gbs.questionnaires_besoin set statut = 'actif', active_le = now(), active_par = auth.uid() where id = q.id;
  perform gbs_private.rpc('');
  perform gbs_private.journaliser('questionnaire_besoin_active', 'questionnaires_besoin', q.id::text, null, null,
    jsonb_build_object('categorie', q.categorie, 'version', q.version), null);
end $$;

create or replace function gbs.enregistrer_pays_electricite(p_pays text, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.is_admin(), 'GBS_VALIDATION_ADMIN');
  if p_pays is null or p_pays !~ '^[A-Z]{2}$' or jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) k where k not in ('tensions','frequence','prises','confirme','source'))
     or coalesce(jsonb_typeof(p -> 'tensions'), '') <> 'array' or coalesce(jsonb_typeof(p -> 'prises'), '') <> 'array'
     or coalesce(jsonb_typeof(p -> 'frequence'), '') <> 'number' or coalesce(jsonb_typeof(p -> 'confirme'), '') <> 'boolean'
     or (p ? 'source' and jsonb_typeof(p -> 'source') not in ('string','null'))
     or exists (select 1 from jsonb_array_elements(p -> 'tensions') x where jsonb_typeof(x) <> 'number')
     or exists (select 1 from jsonb_array_elements(p -> 'prises') x where jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ '^[A-N]$') then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform gbs_private.rpc('besoin');
  insert into gbs.pays_electricite (pays, tensions, frequence, prises, confirme, source, modifie_par)
  values (p_pays, (select array_agg((x #>> '{}')::int) from jsonb_array_elements(p -> 'tensions') x), (p ->> 'frequence')::int,
          (select array_agg(x #>> '{}') from jsonb_array_elements(p -> 'prises') x), (p ->> 'confirme')::boolean, nullif(trim(p ->> 'source'), ''), auth.uid())
  on conflict (pays) do update set tensions = excluded.tensions, frequence = excluded.frequence, prises = excluded.prises,
    confirme = excluded.confirme, source = excluded.source, modifie_par = excluded.modifie_par;
  perform gbs_private.rpc('');
exception
  when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

-- ----------------------------------------------------------------------------- moteur
-- Étapes fusionnées : tronc commun puis catégorie (champs ajoutés aux étapes de même code).
create or replace function gbs_private.etapes_besoin(p_tronc uuid, p_categorie uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with t as (select e, o from gbs.questionnaires_besoin q, jsonb_array_elements(q.etapes) with ordinality x(e, o) where q.id = p_tronc),
       c as (select e, o from gbs.questionnaires_besoin q, jsonb_array_elements(q.etapes) with ordinality x(e, o) where q.id = p_categorie)
  select coalesce(jsonb_agg(etape order by rang, o), '[]'::jsonb) from (
    select 0 rang, t.o, t.e || jsonb_build_object('champs', (t.e -> 'champs') || coalesce((select c.e -> 'champs' from c where c.e ->> 'code' = t.e ->> 'code'), '[]'::jsonb)) etape from t
    union all
    select 1, c.o, c.e from c where not exists (select 1 from t where t.e ->> 'code' = c.e ->> 'code')
  ) z
$$;

create or replace function gbs_private.valeur_besoin_valide(c jsonb, v jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  case c ->> 'type'
    when 'texte' then return jsonb_typeof(v) = 'string' and length(v #>> '{}') between 1 and 500;
    when 'texte_long' then return jsonb_typeof(v) = 'string' and length(v #>> '{}') between 1 and 4000;
    when 'nombre' then return jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between coalesce((c ->> 'min')::numeric, -1e12) and coalesce((c ->> 'max')::numeric, 1e12);
    when 'choix' then return jsonb_typeof(v) = 'string' and (c -> 'options') ? (v #>> '{}');
    when 'choix_multiple' then return jsonb_typeof(v) = 'array' and jsonb_array_length(v) between 1 and jsonb_array_length(c -> 'options')
      and not exists (select 1 from jsonb_array_elements(v) x where jsonb_typeof(x) <> 'string' or not (c -> 'options') ? (x #>> '{}'))
      and (select count(distinct x) from jsonb_array_elements_text(v) x) = jsonb_array_length(v);
    when 'oui_non' then return jsonb_typeof(v) = 'boolean';
    when 'date' then return jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$' and (v #>> '{}')::date between '2000-01-01' and '2100-12-31';
    else return false;
  end case;
exception when others then return false;
end $$;

-- État d'un besoin : complétude par étape, champs critiques manquants, incohérences avec le pays de livraison.
create or replace function gbs_private.etat_besoin(b gbs.besoins) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare etapes jsonb := gbs_private.etapes_besoin(b.tronc_id, b.questionnaire_id); e jsonb; c jsonb; v jsonb;
        pe gbs.pays_electricite; par jsonb := '[]'::jsonb; manquants jsonb := '[]'::jsonb; alertes jsonb := '[]'::jsonb;
        total int := 0; remplis int := 0; te int; re int; n int;
begin
  select * into pe from gbs.pays_electricite where pays = b.pays;
  for e in select value from jsonb_array_elements(etapes) loop
    te := 0; re := 0;
    for c in select value from jsonb_array_elements(e -> 'champs') loop
      te := te + 1; v := b.reponses -> (c ->> 'cle');
      if v is not null then re := re + 1;
      elsif coalesce((c ->> 'critique')::boolean, false) then manquants := manquants || to_jsonb(c ->> 'cle'); end if;
      if v is not null and c ? 'controle' then
        if pe.pays is null then
          alertes := alertes || jsonb_build_object('champ', c ->> 'cle', 'code', 'pays_inconnu', 'pays', b.pays);
        elsif c ->> 'controle' = 'tension_pays' then
          n := nullif(substring(case when jsonb_typeof(v) = 'number' then v #>> '{}' else v #>> '{}' end from '^\s*(\d{2,4})'), '')::int;
          if n is null or not n = any(pe.tensions) then
            alertes := alertes || jsonb_build_object('champ', c ->> 'cle', 'code', 'tension_pays', 'pays', pe.pays, 'attendu', to_jsonb(pe.tensions), 'confirme', pe.confirme);
          end if;
        elsif c ->> 'controle' = 'frequence_pays' then
          n := nullif(substring(v #>> '{}' from '^\s*(\d{2})'), '')::int;
          if n is distinct from pe.frequence then
            alertes := alertes || jsonb_build_object('champ', c ->> 'cle', 'code', 'frequence_pays', 'pays', pe.pays, 'attendu', pe.frequence, 'confirme', pe.confirme);
          end if;
        elsif c ->> 'controle' = 'prises_pays' then
          if exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(v) = 'array' then v else jsonb_build_array(v) end) x
                      where not upper(substring(x from '[A-Na-n]')) = any(pe.prises)) then
            alertes := alertes || jsonb_build_object('champ', c ->> 'cle', 'code', 'prises_pays', 'pays', pe.pays, 'attendu', to_jsonb(pe.prises), 'confirme', pe.confirme);
          end if;
        end if;
      end if;
    end loop;
    total := total + te; remplis := remplis + re;
    par := par || jsonb_build_object('code', e ->> 'code', 'total', te, 'remplis', re);
  end loop;
  return jsonb_build_object('completude', case when total = 0 then 0 else round(100.0 * remplis / total) end,
    'etapes', par, 'critiques_manquants', manquants, 'alertes', alertes);
end $$;

create or replace function gbs_private.besoin_redigeable(b gbs.besoins) returns boolean
language sql stable security definer set search_path = '' as $$
  select b.id is not null and gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.dossier_visible(b.dossier_id)
$$;

create or replace function gbs.creer_besoin(p_dossier uuid, p_categorie text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d gbs.dossiers; t uuid; q uuid; r uuid;
begin
  select * into d from gbs.dossiers where id = p_dossier;
  perform gbs_private.exiger(d.id is not null and gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.dossier_visible(d.id));
  if d.statut <> 'ouvert' then raise exception 'GBS_DOSSIER_NON_OUVERT' using errcode = 'P0001'; end if;
  select id into t from gbs.questionnaires_besoin where categorie = 'tronc_commun' and statut = 'actif';
  if t is null then raise exception 'GBS_QUESTIONNAIRE_INACTIF' using errcode = 'P0001'; end if;
  if p_categorie is null or p_categorie !~ '^[a-z0-9_]{2,40}$' then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  if p_categorie <> 'tronc_commun' then
    select id into q from gbs.questionnaires_besoin where categorie = p_categorie and statut = 'actif';
    if q is null then raise exception 'GBS_QUESTIONNAIRE_INACTIF' using errcode = 'P0001'; end if;
  end if;
  perform gbs_private.rpc('besoin');
  insert into gbs.besoins (dossier_id, categorie, tronc_id, questionnaire_id, pays, cree_par)
  values (d.id, p_categorie, t, q, d.pays, auth.uid()) returning id into r;
  perform gbs_private.rpc('');
  return r;
exception when unique_violation then
  raise exception 'GBS_BESOIN_EXISTANT' using errcode = 'P0001';
end $$;

-- Réponses : fusion champ par champ ; null efface ; toute modification ramène un besoin soumis en brouillon.
create or replace function gbs.enregistrer_besoin(p_besoin uuid, p_reponses jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b gbs.besoins; champs jsonb; k text; c jsonb; nouvelles jsonb;
begin
  select * into b from gbs.besoins where id = p_besoin for update;
  perform gbs_private.exiger(gbs_private.besoin_redigeable(b));
  perform gbs_private.limiter('besoin');
  if b.statut = 'valide' then raise exception 'GBS_BESOIN_VALIDE' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_reponses) <> 'object' or (select count(*) from jsonb_object_keys(p_reponses)) not between 1 and 200 then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  select jsonb_object_agg(x ->> 'cle', x) into champs
    from jsonb_array_elements(gbs_private.etapes_besoin(b.tronc_id, b.questionnaire_id)) e, jsonb_array_elements(e -> 'champs') x;
  nouvelles := b.reponses;
  for k in select jsonb_object_keys(p_reponses) loop
    c := champs -> k;
    if c is null then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
    if jsonb_typeof(p_reponses -> k) = 'null' then nouvelles := nouvelles - k;
    elsif gbs_private.valeur_besoin_valide(c, p_reponses -> k) then
      nouvelles := nouvelles || jsonb_build_object(k, case when jsonb_typeof(p_reponses -> k) = 'string' then to_jsonb(trim(p_reponses ->> k)) else p_reponses -> k end);
    else raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
    end if;
  end loop;
  perform gbs_private.rpc('besoin');
  update gbs.besoins set reponses = nouvelles, statut = 'brouillon' where id = b.id returning * into b;
  perform gbs_private.rpc('');
  return gbs_private.etat_besoin(b);
end $$;

create or replace function gbs.etat_besoin(p_besoin uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare b gbs.besoins;
begin
  select * into b from gbs.besoins where id = p_besoin;
  perform gbs_private.exiger(b.id is not null and gbs_private.interne() and gbs_private.dossier_visible(b.dossier_id));
  return gbs_private.etat_besoin(b) || jsonb_build_object('etapes_definition', gbs_private.etapes_besoin(b.tronc_id, b.questionnaire_id));
end $$;

-- Soumission pour relecture : refusée tant qu'un champ critique manque ; version conservée.
create or replace function gbs.soumettre_besoin(p_besoin uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare b gbs.besoins; e jsonb;
begin
  select * into b from gbs.besoins where id = p_besoin for update;
  perform gbs_private.exiger(gbs_private.besoin_redigeable(b));
  perform gbs_private.limiter('besoin');
  if b.statut <> 'brouillon' then raise exception 'GBS_DEMANDE_TRAITEE' using errcode = 'P0001'; end if;
  e := gbs_private.etat_besoin(b);
  if jsonb_array_length(e -> 'critiques_manquants') > 0 then raise exception 'GBS_BESOIN_INCOMPLET' using errcode = 'P0001'; end if;
  perform gbs_private.rpc('besoin');
  update gbs.besoins set statut = 'soumis', version = version + 1, soumis_le = now() where id = b.id returning * into b;
  insert into gbs.besoins_versions (besoin_id, version, reponses, etat, cree_par) values (b.id, b.version, b.reponses, e, auth.uid());
  perform gbs_private.rpc('');
  return b.version;
end $$;

create or replace function gbs.poser_question_besoin(p_besoin uuid, p_champ text, p_question text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare b gbs.besoins; r uuid;
begin
  select * into b from gbs.besoins where id = p_besoin;
  perform gbs_private.exiger(b.id is not null and gbs_private.has_role('admin','hub_afrique','agent_pays','achats_chine') and gbs_private.dossier_visible(b.dossier_id));
  if b.statut = 'valide' then raise exception 'GBS_BESOIN_VALIDE' using errcode = 'P0001'; end if;
  if p_question is null or length(trim(p_question)) not between 3 and 1000
     or not exists (select 1 from jsonb_array_elements(gbs_private.etapes_besoin(b.tronc_id, b.questionnaire_id)) e, jsonb_array_elements(e -> 'champs') x
                     where x ->> 'cle' = p_champ) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if (select count(*) from gbs.besoins_questions q where q.besoin_id = b.id and q.reponse is null) >= 50 then
    raise exception 'GBS_TROP_DE_DEMANDES' using errcode = 'P0001';
  end if;
  perform gbs_private.rpc('besoin');
  insert into gbs.besoins_questions (besoin_id, champ, question, auteur_id) values (b.id, p_champ, trim(p_question), auth.uid()) returning id into r;
  perform gbs_private.rpc('');
  return r;
end $$;

create or replace function gbs.repondre_question_besoin(p_question uuid, p_reponse text) returns void
language plpgsql security definer set search_path = '' as $$
declare q gbs.besoins_questions; b gbs.besoins;
begin
  select * into q from gbs.besoins_questions where id = p_question for update;
  select * into b from gbs.besoins where id = q.besoin_id;
  perform gbs_private.exiger(q.id is not null and gbs_private.besoin_redigeable(b));
  perform gbs_private.limiter('besoin');
  if q.reponse is not null then raise exception 'GBS_DEMANDE_TRAITEE' using errcode = 'P0001'; end if;
  if p_reponse is null or length(trim(p_reponse)) not between 1 and 2000 then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  perform gbs_private.rpc('besoin');
  update gbs.besoins_questions set reponse = trim(p_reponse), repondu_par = auth.uid(), repondu_le = now() where id = q.id;
  perform gbs_private.rpc('');
end $$;

-- Validation : sur la dernière version soumise, sans question ouverte, avec le cahier des charges signé.
create or replace function gbs.valider_besoin(p_besoin uuid, p_document text, p_signe_le date) returns void
language plpgsql security definer set search_path = '' as $$
declare b gbs.besoins;
begin
  select * into b from gbs.besoins where id = p_besoin for update;
  perform gbs_private.exiger(b.id is not null and gbs_private.has_role('admin','hub_afrique') and gbs_private.dossier_visible(b.dossier_id));
  if b.statut <> 'soumis' then raise exception 'GBS_BESOIN_NON_SOUMIS' using errcode = 'P0001'; end if;
  if exists (select 1 from gbs.besoins_questions q where q.besoin_id = b.id and q.reponse is null) then
    raise exception 'GBS_QUESTIONS_OUVERTES' using errcode = 'P0001';
  end if;
  if p_document is null or p_document !~ '^[A-Za-z0-9/_.-]+$' or length(p_document) not between 3 and 400 or p_document ~ '\.\.' or p_signe_le is null
     or not gbs_private.photos_valides(b.dossier_id, array[p_document])
     or p_signe_le > current_date or p_signe_le < b.soumis_le::date then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform gbs_private.rpc('besoin');
  update gbs.besoins set statut = 'valide', valide_le = now(), valide_par = auth.uid(), document_signe = p_document, signe_le = p_signe_le where id = b.id;
  perform gbs_private.rpc('');
  perform gbs_private.journaliser('besoin_valide', 'besoins', b.id::text, b.dossier_id, null,
    jsonb_build_object('version', b.version, 'document', p_document, 'signe_le', p_signe_le), null);
end $$;

-- ----------------------------------------------------------------------------- tronc commun (brouillon, à valider)
-- Tiré du cahier des charges (section 4 quinquies) ; la fondatrice le valide avant activation.
select gbs_private.rpc('besoin');
insert into gbs.questionnaires_besoin (categorie, libelle, version, etapes) values ('tronc_commun', 'Tronc commun', 1, $j$[
 {"code":"usage","libelle":"Usage et contexte","champs":[
   {"cle":"usage","libelle":"À quoi servira l'équipement et dans quel établissement ?","type":"texte_long","critique":true,
    "aide":"Décrivez l'usage réel, le rythme d'utilisation et les utilisateurs.","exemple":"Lingerie d'un hôtel de 120 chambres, 2 rotations de draps par jour."},
   {"cle":"site","libelle":"Site d'installation","type":"texte","aide":"Ville et nature du site.","exemple":"Assinie-Mafia, hôtel en bord de lagune."}]},
 {"code":"quantites","libelle":"Quantités et dimensions","champs":[
   {"cle":"quantites","libelle":"Quantités par article","type":"texte_long","critique":true,"exemple":"6 lave-linge 40 kg, 4 séchoirs 50 kg."},
   {"cle":"dimensions","libelle":"Dimensions et encombrement disponibles","type":"texte_long","exemple":"Local de 12 × 8 m, hauteur 3,2 m, porte de 1,2 m."},
   {"cle":"materiaux","libelle":"Matériaux et finitions attendus","type":"texte_long","exemple":"Cuve et tambour inox 304, carrosserie peinte époxy."}]},
 {"code":"contraintes","libelle":"Contraintes locales","aide":"Les oublis les plus coûteux : un équipement qui ne fonctionne pas sur le réseau du pays ou qui rouille en six mois.","champs":[
   {"cle":"tension","libelle":"Tension électrique disponible","type":"choix","options":["110 V","220 V","230 V","380 V triphasé","400 V triphasé"],"critique":true,"controle":"tension_pays",
    "exemple":"230 V monophasé pour la lingerie, 400 V triphasé disponible au local technique."},
   {"cle":"frequence","libelle":"Fréquence du réseau","type":"choix","options":["50 Hz","60 Hz"],"controle":"frequence_pays"},
   {"cle":"prises","libelle":"Types de prises","type":"choix_multiple","options":["C","D","E","F","G","K"],"controle":"prises_pays"},
   {"cle":"climat","libelle":"Climat et environnement","type":"choix_multiple","options":["Tropical humide","Air salin côtier","Chaleur > 35 °C","Coupures réseau"]},
   {"cle":"zone_cotiere","libelle":"Site en zone côtière","type":"oui_non","aide":"Active les exigences anti-corrosion (inox 316, traitement marin)."}]},
 {"code":"normes","libelle":"Normes et certifications","champs":[
   {"cle":"normes","libelle":"Normes et certifications exigées","type":"texte_long","critique":true,"exemple":"CE, IEC 60335 ; certificat d'origine exigé par l'acheteur."}]},
 {"code":"budget","libelle":"Budget et délai","champs":[
   {"cle":"budget","libelle":"Budget indicatif","type":"texte","critique":true,"exemple":"Entre 60 et 80 millions de FCFA hors taxes."},
   {"cle":"delai","libelle":"Date de mise en service souhaitée","type":"date","critique":true},
   {"cle":"lieu_livraison","libelle":"Lieu de livraison","type":"texte","critique":true,"exemple":"Port d'Abidjan, puis site d'Assinie."},
   {"cle":"installation","libelle":"Installation et mise en service par GBS","type":"oui_non"}]},
 {"code":"garantie","libelle":"Garantie et pièces","champs":[
   {"cle":"garantie","libelle":"Garantie attendue","type":"texte","exemple":"24 mois pièces et main-d'œuvre."},
   {"cle":"pieces_detachees","libelle":"Pièces détachées attendues","type":"texte_long","exemple":"Lot de pièces d'usure pour 2 ans livré avec l'équipement."}]},
 {"code":"pieces_jointes","libelle":"Pièces jointes","champs":[
   {"cle":"pieces_jointes","libelle":"Plans, photos, références ou exemples transmis","type":"texte_long","aide":"Indiquez les documents déposés au dossier et ce qu'ils montrent."}]}
]$j$::jsonb);
select gbs_private.rpc('');

revoke all on function gbs_private.etapes_besoin_valides(jsonb), gbs_private.trg_besoin_rpc(), gbs_private.etapes_besoin(uuid, uuid),
  gbs_private.valeur_besoin_valide(jsonb, jsonb), gbs_private.etat_besoin(gbs.besoins), gbs_private.besoin_redigeable(gbs.besoins) from public, anon, authenticated;
-- La contrainte de structure appelle le validateur avec les droits de l'appelant.
grant execute on function gbs_private.etapes_besoin_valides(jsonb) to authenticated;
revoke all on function gbs.enregistrer_questionnaire_besoin(text, text, jsonb), gbs.activer_questionnaire_besoin(uuid),
  gbs.enregistrer_pays_electricite(text, jsonb), gbs.creer_besoin(uuid, text), gbs.enregistrer_besoin(uuid, jsonb), gbs.etat_besoin(uuid),
  gbs.soumettre_besoin(uuid), gbs.poser_question_besoin(uuid, text, text), gbs.repondre_question_besoin(uuid, text),
  gbs.valider_besoin(uuid, text, date) from public, anon;
grant execute on function gbs.enregistrer_questionnaire_besoin(text, text, jsonb), gbs.activer_questionnaire_besoin(uuid),
  gbs.enregistrer_pays_electricite(text, jsonb), gbs.creer_besoin(uuid, text), gbs.enregistrer_besoin(uuid, jsonb), gbs.etat_besoin(uuid),
  gbs.soumettre_besoin(uuid), gbs.poser_question_besoin(uuid, text, text), gbs.repondre_question_besoin(uuid, text),
  gbs.valider_besoin(uuid, text, date) to authenticated;
