-- Lot 1, M26 : approbation technique et essais en usine.
-- * Circuit versionné par commande : plans, fiches techniques et échantillon de référence
--   soumis au client ; sa décision est enregistrée avec le document signé. Une nouvelle
--   version remplace la précédente et, avant la production, annule l'approbation acquise.
-- * L'approbation acceptée alimente le verrou 1 du lot 0 (pas de production d'une commande
--   sur mesure sans approbation signée) ; la saisie directe du lot 0 est fermée.
-- * L'échantillon de référence approuvé devient la base des inspections de la commande.
-- * Essais en usine : procès-verbal (critères, attendu, mesuré), validé ; lorsqu'il est
--   exigé par l'approbation, le lot n'est pas libéré avant un essai conforme.

create table gbs.approbations_techniques (
  id              uuid primary key default gen_random_uuid(),
  commande_id     uuid not null references gbs.commandes(id),
  dossier_id      uuid not null references gbs.dossiers(id),
  version         int not null,
  objet           text not null check (length(trim(objet)) between 3 and 300),
  documents       text[] not null default '{}' check (cardinality(documents) <= 30),
  echantillon     boolean not null default false,
  echantillon_description text check (length(echantillon_description) <= 1000),
  echantillon_envoye_le date,
  echantillon_cout_xof numeric(16,0) check (echantillon_cout_xof >= 0),
  essais_requis   boolean not null default false,
  statut          text not null default 'brouillon' check (statut in ('brouillon','soumise','approuvee','refusee','remplacee')),
  soumise_le      timestamptz,
  soumise_par     uuid references gbs.profils(id),
  decision_le     date,
  signataire      text check (length(signataire) <= 120),
  document_signe  text check (length(document_signe) <= 400),
  commentaire_client text check (length(commentaire_client) <= 2000),
  decision_saisie_par uuid references gbs.profils(id),
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  unique (commande_id, version),
  check (not echantillon or echantillon_description is not null)
);

create table gbs.essais_usine (
  id            uuid primary key default gen_random_uuid(),
  commande_id   uuid not null references gbs.commandes(id),
  dossier_id    uuid not null references gbs.dossiers(id),
  date_essai    date not null,
  lieu          text check (length(lieu) <= 200),
  protocole     text not null check (length(trim(protocole)) between 3 and 2000),
  resultats     jsonb not null default '[]'::jsonb,
  conforme      boolean,
  temoins       text check (length(temoins) <= 500),
  pv_document   text check (length(pv_document) <= 400),
  statut        text not null default 'brouillon' check (statut in ('brouillon','valide')),
  valide_par    uuid references gbs.profils(id),
  valide_le     timestamptz,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid
);

alter table gbs.inspections add column approbation_id uuid references gbs.approbations_techniques(id);

-- -----------------------------------------------------------------------------
-- Règles d'écriture
-- -----------------------------------------------------------------------------
create or replace function gbs_private.trg_approbation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c gbs.commandes; rpc text := coalesce(current_setting('gbs.rpc', true), '');
begin
  if tg_op = 'INSERT' then
    select * into c from gbs.commandes where id = new.commande_id;
    if c.id is null then raise exception 'GBS_COMMANDE_INCONNUE' using errcode = '22023'; end if;
    if c.statut not in ('brouillon','contrat_signe') then
      raise exception 'GBS_EN_PRODUCTION: les plans d''une commande lancée changent par avenant' using errcode = 'P0001';
    end if;
    if exists (select 1 from gbs.approbations_techniques a where a.commande_id = new.commande_id and a.statut in ('brouillon','soumise')) then
      raise exception 'GBS_APPROBATION_EN_COURS: une version est déjà en préparation ou soumise' using errcode = 'P0001';
    end if;
    new.dossier_id := c.dossier_id;
    perform pg_advisory_xact_lock(7325);
    select coalesce(max(version), 0) + 1 into new.version from gbs.approbations_techniques where commande_id = new.commande_id;
    if new.statut <> 'brouillon' or new.soumise_le is not null or new.decision_le is not null or new.document_signe is not null
       or new.signataire is not null or new.decision_saisie_par is not null or new.soumise_par is not null then
      raise exception 'GBS_VALIDATION_RPC' using errcode = 'P0001';
    end if;
  else
    if (new.commande_id, new.dossier_id, new.version) is distinct from (old.commande_id, old.dossier_id, old.version) then
      raise exception 'GBS_APPROBATION_FIGEE' using errcode = 'P0001';
    end if;
    if rpc <> 'approbation' then
      if new.statut <> old.statut or (new.soumise_le, new.soumise_par, new.decision_le, new.signataire, new.document_signe,
            new.commentaire_client, new.decision_saisie_par)
         is distinct from (old.soumise_le, old.soumise_par, old.decision_le, old.signataire, old.document_signe,
            old.commentaire_client, old.decision_saisie_par) then
        raise exception 'GBS_VALIDATION_RPC: le circuit d''approbation passe par les fonctions dédiées' using errcode = 'P0001';
      end if;
      -- Une fois soumise, la version ne change plus (seuls l'envoi et le coût de l'échantillon se complètent).
      if old.statut <> 'brouillon' and (new.objet, new.documents, new.echantillon, new.echantillon_description, new.essais_requis)
         is distinct from (old.objet, old.documents, old.echantillon, old.echantillon_description, old.essais_requis) then
        raise exception 'GBS_APPROBATION_FIGEE: soumettez une nouvelle version' using errcode = 'P0001';
      end if;
    end if;
  end if;
  if not gbs_private.photos_valides(new.dossier_id, new.documents) then
    raise exception 'GBS_DOCUMENTS_INVALIDES' using errcode = '22023';
  end if;
  if new.echantillon_envoye_le is not null and new.echantillon_envoye_le > current_date then
    raise exception 'GBS_DATE_INVALIDE' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger approbations_regles before insert or update on gbs.approbations_techniques
  for each row execute function gbs_private.trg_approbation();

-- Résultats d'essai : [{critere, attendu, mesure, conforme}], clés strictes, 100 au plus.
create or replace function gbs_private.resultats_essai_valides(r jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(r) = 'array' and jsonb_array_length(r) <= 100
     and not exists (
       select 1 from jsonb_array_elements(r) e
        where jsonb_typeof(e) <> 'object'
           or exists (select 1 from jsonb_object_keys(e) k where k not in ('critere','attendu','mesure','conforme'))
           or length(coalesce(e ->> 'critere', '')) not between 2 and 200
           or length(coalesce(e ->> 'attendu', '')) > 200 or length(coalesce(e ->> 'mesure', '')) > 200
           or jsonb_typeof(e -> 'conforme') is distinct from 'boolean')
$$;

create or replace function gbs_private.trg_essai() returns trigger
language plpgsql security definer set search_path = '' as $$
declare rpc text := coalesce(current_setting('gbs.rpc', true), '');
begin
  if tg_op = 'INSERT' then
    select c.dossier_id into new.dossier_id from gbs.commandes c where c.id = new.commande_id;
    if new.statut <> 'brouillon' or new.valide_par is not null or new.valide_le is not null then
      raise exception 'GBS_VALIDATION_RPC' using errcode = 'P0001';
    end if;
  else
    if (new.commande_id, new.dossier_id) is distinct from (old.commande_id, old.dossier_id) then
      raise exception 'GBS_ESSAI_FIGE' using errcode = 'P0001';
    end if;
    if old.statut = 'valide' then raise exception 'GBS_DOCUMENT_VALIDE: procès-verbal validé' using errcode = 'P0001'; end if;
    if (new.statut, new.valide_par, new.valide_le) is distinct from (old.statut, old.valide_par, old.valide_le) and rpc <> 'essai' then
      raise exception 'GBS_VALIDATION_RPC' using errcode = 'P0001';
    end if;
  end if;
  if not gbs_private.resultats_essai_valides(new.resultats) then
    raise exception 'GBS_RESULTATS_INVALIDES' using errcode = '22023';
  end if;
  if new.date_essai > current_date then raise exception 'GBS_DATE_INVALIDE' using errcode = '22023'; end if;
  if new.pv_document is not null and not gbs_private.photos_valides(new.dossier_id, array[new.pv_document]) then
    raise exception 'GBS_DOCUMENTS_INVALIDES' using errcode = '22023';
  end if;
  -- Conforme si tous les critères le sont (et qu'il y en a au moins un).
  new.conforme := case when jsonb_array_length(new.resultats) = 0 then null
                       else not exists (select 1 from jsonb_array_elements(new.resultats) e where not (e ->> 'conforme')::boolean) end;
  return new;
end $$;
create trigger essais_regles before insert or update on gbs.essais_usine
  for each row execute function gbs_private.trg_essai();

-- L'inspection prend pour base l'échantillon de référence approuvé de la commande.
create or replace function gbs_private.trg_inspection_reference() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.commande_id is not null then
    new.approbation_id := (select a.id from gbs.approbations_techniques a
                            where a.commande_id = new.commande_id and a.statut = 'approuvee' order by a.version desc limit 1);
  else
    new.approbation_id := null;
  end if;
  return new;
end $$;
create trigger inspections_reference before insert on gbs.inspections
  for each row execute function gbs_private.trg_inspection_reference();

do $$
declare t text;
begin
  foreach t in array array['approbations_techniques','essais_usine'] loop
    execute format('create trigger %1$s_touch before update on gbs.%1$s for each row execute function gbs_private.trg_touch()', t);
    execute format('create trigger %1$s_cree before insert on gbs.%1$s for each row execute function gbs_private.trg_cree_par()', t);
    execute format('create trigger %1$s_audit after insert or update or delete on gbs.%1$s for each row execute function gbs_private.trg_audit()', t);
    execute format('create trigger %1$s_nodel before delete on gbs.%1$s for each row execute function gbs_private.trg_no_delete()', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Circuit
-- -----------------------------------------------------------------------------
create or replace function gbs.soumettre_approbation(p_approbation uuid)
returns gbs.approbations_techniques language plpgsql security definer set search_path = '' as $$
declare a gbs.approbations_techniques;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine'));
  select * into a from gbs.approbations_techniques where id = p_approbation for update;
  perform gbs_private.exiger(a.id is not null and gbs_private.dossier_visible(a.dossier_id));
  if a.statut <> 'brouillon' then raise exception 'GBS_APPROBATION_STATUT' using errcode = 'P0001'; end if;
  if cardinality(a.documents) = 0 and not a.echantillon then
    raise exception 'GBS_APPROBATION_VIDE: joignez des plans ou fiches techniques, ou un échantillon' using errcode = 'P0001';
  end if;
  perform set_config('gbs.rpc', 'approbation', true);
  update gbs.approbations_techniques set statut = 'soumise', soumise_le = now(), soumise_par = auth.uid()
   where id = p_approbation returning * into a;
  perform set_config('gbs.rpc', '', true);
  return a;
end $$;

-- Décision du client, enregistrée avec le document signé (en attendant le portail et la
-- signature électronique intégrée). L'acceptation met à jour l'approbation de la commande ;
-- les versions antérieures sont remplacées.
create or replace function gbs.enregistrer_decision_approbation(p_approbation uuid, p_decision text, p_signataire text,
  p_document text, p_decision_le date, p_commentaire text default null)
returns gbs.approbations_techniques language plpgsql security definer set search_path = '' as $$
declare a gbs.approbations_techniques; sig text := trim(coalesce(p_signataire, '')); prev text;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine'));
  select * into a from gbs.approbations_techniques where id = p_approbation for update;
  perform gbs_private.exiger(a.id is not null and gbs_private.dossier_visible(a.dossier_id));
  if a.statut <> 'soumise' then raise exception 'GBS_APPROBATION_STATUT' using errcode = 'P0001'; end if;
  if p_decision not in ('approuvee','refusee') or length(sig) not between 2 and 120
     or p_document is null or not gbs_private.photos_valides(a.dossier_id, array[p_document])
     or p_decision_le is null or p_decision_le > current_date or p_decision_le < a.soumise_le::date
     or length(coalesce(p_commentaire, '')) > 2000 then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if p_decision = 'refusee' and length(trim(coalesce(p_commentaire, ''))) < 5 then
    raise exception 'GBS_MOTIF_OBLIGATOIRE: indiquez les réserves du client' using errcode = 'P0001';
  end if;
  prev := coalesce(current_setting('gbs.rpc', true), '');
  perform set_config('gbs.rpc', 'approbation', true);
  update gbs.approbations_techniques set statut = p_decision, signataire = sig, document_signe = p_document,
         decision_le = p_decision_le, commentaire_client = nullif(trim(coalesce(p_commentaire, '')), ''),
         decision_saisie_par = auth.uid()
   where id = p_approbation returning * into a;
  if p_decision = 'approuvee' then
    update gbs.approbations_techniques set statut = 'remplacee'
     where commande_id = a.commande_id and id <> a.id and statut = 'approuvee';
    perform gbs_private.rpc('valider_approbation');
    update gbs.commandes set approbation_document = p_document, approbation_valide_par = auth.uid(), approbation_valide_le = now()
     where id = a.commande_id;
  end if;
  perform set_config('gbs.rpc', prev, true);
  return a;
end $$;

-- Nouvelle version soumise avant la production : l'approbation acquise ne vaut plus.
create or replace function gbs_private.trg_approbation_soumise() returns trigger
language plpgsql security definer set search_path = '' as $$
declare prev text := coalesce(current_setting('gbs.rpc', true), '');
begin
  if new.statut = 'soumise' and old.statut = 'brouillon' and new.version > 1 then
    perform gbs_private.rpc('valider_approbation');
    update gbs.commandes set approbation_valide_le = null, approbation_valide_par = null, approbation_document = null
     where id = new.commande_id and approbation_valide_le is not null;
    perform set_config('gbs.rpc', prev, true);
  end if;
  return null;
end $$;
create trigger approbations_soumise after update of statut on gbs.approbations_techniques
  for each row execute function gbs_private.trg_approbation_soumise();

-- La saisie directe du lot 0 (accord écrit déposé) passe désormais par le circuit.
create or replace function gbs.valider_approbation(p_commande uuid, p_document text)
returns gbs.commandes language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'GBS_APPROBATION_CIRCUIT: l''approbation technique passe par le circuit de soumission (M26)' using errcode = 'P0001';
end $$;

create or replace function gbs.valider_essai(p_essai uuid)
returns gbs.essais_usine language plpgsql security definer set search_path = '' as $$
declare e gbs.essais_usine;
begin
  perform gbs_private.exiger(gbs_private.est_validateur(), 'GBS_VALIDATION_ADMIN');
  select * into e from gbs.essais_usine where id = p_essai for update;
  perform gbs_private.exiger(e.id is not null and gbs_private.dossier_visible(e.dossier_id));
  if e.statut <> 'brouillon' then raise exception 'GBS_DOCUMENT_VALIDE' using errcode = 'P0001'; end if;
  if e.pv_document is null or e.conforme is null then
    raise exception 'GBS_PV_INCOMPLET: procès-verbal signé et résultats exigés' using errcode = 'P0001';
  end if;
  perform set_config('gbs.rpc', 'essai', true);
  update gbs.essais_usine set statut = 'valide', valide_par = auth.uid(), valide_le = now()
   where id = p_essai returning * into e;
  perform set_config('gbs.rpc', '', true);
  return e;
end $$;

-- Essais exigés par l'approbation : pas de libération du lot sans essai conforme validé.
create or replace function gbs_private.essais_ok(p_commande uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from gbs.approbations_techniques a
                      where a.commande_id = p_commande and a.statut = 'approuvee' and a.essais_requis)
      or exists (select 1 from gbs.essais_usine e where e.commande_id = p_commande and e.statut = 'valide' and e.conforme)
$$;

create or replace function gbs.valider_inspection(p_inspection uuid, p_decision text, p_motif text default null)
returns gbs.inspections language plpgsql security definer set search_path = '' as $$
declare i gbs.inspections;
begin
  perform gbs_private.exiger(gbs_private.est_validateur(), 'GBS_VALIDATION_ADMIN');
  if p_decision not in ('liberation','refus') then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  select * into i from gbs.inspections where id = p_inspection for update;
  if i.statut <> 'realisee' or i.date_realisee is null then
    raise exception 'GBS_INSPECTION_NON_REALISEE' using errcode = 'P0001';
  end if;
  if exists (select 1 from gbs.non_conformites n where n.inspection_id = p_inspection and n.statut <> 'close') then
    raise exception 'GBS_NC_OUVERTE: une non-conformité ouverte empêche de valider l''inspection' using errcode = 'P0001';
  end if;
  if p_decision = 'liberation' and i.commande_id is not null and i.type in ('avant_expedition','contre_inspection')
     and not gbs_private.essais_ok(i.commande_id) then
    raise exception 'GBS_ESSAIS_MANQUANTS: essai en usine conforme et validé exigé avant la libération du lot' using errcode = 'P0001';
  end if;
  if p_decision = 'liberation' and i.decision_proposee = 'refusee' then
    perform gbs_private.exiger(gbs_private.is_admin(), 'GBS_DEROGATION_ADMIN');
    perform gbs_private.motif(p_motif);
  elsif p_motif is not null then
    perform gbs_private.motif(p_motif);
  end if;
  perform gbs_private.rpc('valider_inspection');
  update gbs.inspections set decision = p_decision,
         statut = case when p_decision = 'liberation' then 'validee' else 'refusee' end,
         validee_par = auth.uid(), validee_le = now()
   where id = p_inspection returning * into i;
  perform gbs_private.rpc('');
  return i;
end $$;

-- -----------------------------------------------------------------------------
-- Droits : achats et administratrice ; l'inspecteur lit la référence de ses commandes.
-- -----------------------------------------------------------------------------
alter table gbs.approbations_techniques enable row level security;
alter table gbs.essais_usine enable row level security;
grant select, insert on gbs.approbations_techniques, gbs.essais_usine to authenticated;
grant update (objet, documents, echantillon, echantillon_description, echantillon_envoye_le, echantillon_cout_xof, essais_requis)
  on gbs.approbations_techniques to authenticated;
grant update (date_essai, lieu, protocole, resultats, temoins, pv_document) on gbs.essais_usine to authenticated;

create or replace function gbs_private.commande_inspectee_par_moi(p_commande uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select gbs_private.has_role('inspecteur')
     and exists (select 1 from gbs.inspections i where i.commande_id = p_commande and i.inspecteur_id = auth.uid())
$$;

create policy approbations_lecture on gbs.approbations_techniques for select using (
  (gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(dossier_id))
  or gbs_private.commande_inspectee_par_moi(commande_id));
create policy approbations_creation on gbs.approbations_techniques for insert with check (
  gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(dossier_id));
create policy approbations_maj on gbs.approbations_techniques for update using (
  gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(dossier_id));

create policy essais_lecture on gbs.essais_usine for select using (
  (gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(dossier_id))
  or gbs_private.commande_inspectee_par_moi(commande_id));
create policy essais_creation on gbs.essais_usine for insert with check (
  gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(dossier_id));
create policy essais_maj on gbs.essais_usine for update using (
  gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(dossier_id));

revoke execute on function gbs.soumettre_approbation(uuid),
  gbs.enregistrer_decision_approbation(uuid, text, text, text, date, text), gbs.valider_essai(uuid),
  gbs_private.trg_approbation(), gbs_private.trg_essai(), gbs_private.trg_inspection_reference(),
  gbs_private.trg_approbation_soumise(), gbs_private.resultats_essai_valides(jsonb), gbs_private.essais_ok(uuid),
  gbs_private.commande_inspectee_par_moi(uuid) from public;
grant execute on function gbs.soumettre_approbation(uuid),
  gbs.enregistrer_decision_approbation(uuid, text, text, text, date, text), gbs.valider_essai(uuid) to authenticated;
grant execute on all functions in schema gbs_private to authenticated, service_role;
