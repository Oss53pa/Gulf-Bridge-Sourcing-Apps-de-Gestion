-- Lot 1, M37 : interventions d'installation, de mise en service et d'après-vente, avec
-- hygiène, sécurité et environnement (HSE).
-- * Intervention : planning, techniciens, analyse de risques, équipements de protection,
--   habilitations et permis de travail exigés par le site.
-- * Démarrage refusé tant qu'un technicien n'a pas une habilitation exigée valide pendant
--   toute l'intervention, qu'un permis exigé manque ou ne couvre pas les dates, ou que
--   l'analyse de risques et les équipements de protection ne sont pas renseignés.
-- * Temps passé par technicien (heures × taux) et frais liés (coûts validés du dossier
--   rattachés à l'intervention) = coût réel ; facture au coût réel + 15 % (paramètre daté),
--   émise en brouillon par la société qui facture le client.
-- * Mise en service : procès-verbal signé exigé pour terminer ; pièce du dossier validée.
-- * Registre des incidents et presque-accidents, non modifiable.

create table gbs.habilitations (
  id            uuid primary key default gen_random_uuid(),
  technicien_id uuid not null references gbs.profils(id),
  type          text not null check (type in ('electrique','travail_hauteur','espace_confine','levage','soudure',
                                              'frigorifique','secourisme','accueil_site','autre')),
  libelle       text not null check (length(trim(libelle)) between 2 and 200),
  organisme     text check (length(organisme) <= 200),
  delivree_le   date not null,
  expire_le     date not null,
  cree_le timestamptz not null default now(), cree_par uuid,
  check (expire_le > delivree_le)
);
create index on gbs.habilitations (technicien_id, type, expire_le);

create table gbs.interventions (
  id            uuid primary key default gen_random_uuid(),
  reference     text unique check (reference ~ '^INT-[0-9]{4}-[0-9]{3,5}$'),
  dossier_id    uuid not null references gbs.dossiers(id),
  type          text not null check (type in ('installation','mise_en_service','apres_vente')),
  objet         text not null check (length(trim(objet)) between 3 and 300),
  lieu          text not null check (length(trim(lieu)) between 2 and 200),
  date_debut    date not null,
  date_fin      date not null,
  habilitations_requises text[] not null default '{}' check (cardinality(habilitations_requises) <= 10),
  permis_requis text[] not null default '{}' check (cardinality(permis_requis) <= 10),
  analyse_risques jsonb not null default '[]'::jsonb,
  epi           text[] not null default '{}' check (cardinality(epi) <= 20),
  statut        text not null default 'planifiee' check (statut in ('planifiee','en_cours','terminee','facturee','annulee')),
  demarree_le   timestamptz,
  terminee_le   timestamptz,
  pv_document   text check (length(pv_document) <= 400),
  compte_rendu  text check (length(compte_rendu) <= 4000),
  facture_id    uuid references gbs.factures(id),
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check (date_fin >= date_debut and date_fin <= date_debut + 365)
);

create table gbs.intervention_techniciens (
  intervention_id uuid not null references gbs.interventions(id),
  technicien_id   uuid not null references gbs.profils(id),
  cree_le timestamptz not null default now(), cree_par uuid,
  primary key (intervention_id, technicien_id)
);

create table gbs.permis_travail (
  id              uuid primary key default gen_random_uuid(),
  intervention_id uuid not null references gbs.interventions(id),
  dossier_id      uuid not null references gbs.dossiers(id),
  type            text not null check (length(type) between 2 and 40),
  numero          text not null check (length(trim(numero)) between 1 and 80),
  delivre_par     text not null check (length(trim(delivre_par)) between 2 and 200),
  valide_du       date not null,
  valide_au       date not null,
  document        text check (length(document) <= 400),
  cree_le timestamptz not null default now(), cree_par uuid,
  check (valide_au >= valide_du)
);

create table gbs.intervention_temps (
  id              uuid primary key default gen_random_uuid(),
  intervention_id uuid not null references gbs.interventions(id),
  dossier_id      uuid not null references gbs.dossiers(id),
  technicien_id   uuid not null references gbs.profils(id),
  date_travail    date not null,
  heures          numeric(5,2) not null check (heures > 0 and heures <= 16),
  taux_horaire_xof numeric(12,0) not null check (taux_horaire_xof > 0 and taux_horaire_xof <= 1000000),
  cout_xof        numeric(16,0) generated always as (round(heures * taux_horaire_xof)) stored,
  travaux         text not null check (length(trim(travaux)) between 3 and 1000),
  cree_le timestamptz not null default now(), cree_par uuid
);

create table gbs.incidents_hse (
  id              uuid primary key default gen_random_uuid(),
  reference       text unique check (reference ~ '^HSE-[0-9]{4}-[0-9]{3,5}$'),
  intervention_id uuid not null references gbs.interventions(id),
  dossier_id      uuid not null references gbs.dossiers(id),
  survenu_le      timestamptz not null,
  nature          text not null check (nature in ('presque_accident','incident','accident_sans_arret','accident_avec_arret')),
  description     text not null check (length(trim(description)) between 10 and 4000),
  mesures         text not null check (length(trim(mesures)) between 5 and 4000),
  personnes       text check (length(personnes) <= 1000),
  photos          text[] not null default '{}' check (cardinality(photos) <= 20),
  cree_le timestamptz not null default now(), cree_par uuid
);

alter table gbs.couts add column intervention_id uuid references gbs.interventions(id);

-- -----------------------------------------------------------------------------
-- Droits d'accès : GBS Côte d'Ivoire et administratrice ; techniciens sur leurs interventions.
-- -----------------------------------------------------------------------------
create or replace function gbs_private.gere_interventions(p_dossier uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select gbs_private.has_role('admin','hub_afrique') and gbs_private.dossier_visible(p_dossier)
$$;
create or replace function gbs_private.technicien_de(p_intervention uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select gbs_private.interne() and exists (select 1 from gbs.intervention_techniciens t
                                            where t.intervention_id = p_intervention and t.technicien_id = auth.uid())
$$;
create or replace function gbs_private.intervention_visible(p_intervention uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from gbs.interventions i where i.id = p_intervention
                   and (gbs_private.gere_interventions(i.dossier_id)
                        or (gbs_private.has_role('achats_chine') and gbs_private.dossier_visible(i.dossier_id))))
      or gbs_private.technicien_de(p_intervention)
$$;

-- -----------------------------------------------------------------------------
-- Règles d'écriture
-- -----------------------------------------------------------------------------
create or replace function gbs_private.risques_valides(r jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(r) = 'array' and jsonb_array_length(r) <= 50
     and not exists (
       select 1 from jsonb_array_elements(r) e
        where jsonb_typeof(e) <> 'object'
           or exists (select 1 from jsonb_object_keys(e) k where k not in ('danger','mesure'))
           or length(coalesce(e ->> 'danger', '')) not between 3 and 300
           or length(coalesce(e ->> 'mesure', '')) not between 3 and 500)
$$;

create or replace function gbs_private.trg_intervention() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int; rpc text := coalesce(current_setting('gbs.rpc', true), '');
begin
  if tg_op = 'INSERT' then
    if new.statut <> 'planifiee' or new.demarree_le is not null or new.terminee_le is not null
       or new.facture_id is not null or new.pv_document is not null then
      raise exception 'GBS_VALIDATION_RPC' using errcode = 'P0001';
    end if;
    perform pg_advisory_xact_lock(7330);
    select coalesce(max(substring(reference from '-([0-9]+)$')::int), 0) + 1 into n
      from gbs.interventions where reference like 'INT-' || extract(year from now())::int || '-%';
    new.reference := 'INT-' || extract(year from now())::int || '-' || lpad(n::text, 3, '0');
  else
    if (new.reference, new.dossier_id, new.type) is distinct from (old.reference, old.dossier_id, old.type) then
      raise exception 'GBS_INTERVENTION_FIGEE' using errcode = 'P0001';
    end if;
    if rpc <> 'intervention' then
      if (new.statut, new.demarree_le, new.terminee_le, new.facture_id, new.pv_document)
         is distinct from (old.statut, old.demarree_le, old.terminee_le, old.facture_id, old.pv_document) then
        raise exception 'GBS_VALIDATION_RPC: l''intervention avance par les fonctions dédiées' using errcode = 'P0001';
      end if;
      -- Une fois démarrée, les exigences HSE et le planning ne changent plus.
      if old.statut <> 'planifiee' and (new.habilitations_requises, new.permis_requis, new.analyse_risques, new.epi,
            new.date_debut, new.date_fin, new.lieu, new.objet)
         is distinct from (old.habilitations_requises, old.permis_requis, old.analyse_risques, old.epi,
            old.date_debut, old.date_fin, old.lieu, old.objet) then
        raise exception 'GBS_INTERVENTION_FIGEE: intervention démarrée' using errcode = 'P0001';
      end if;
    end if;
  end if;
  if not gbs_private.risques_valides(new.analyse_risques) then
    raise exception 'GBS_RISQUES_INVALIDES' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(new.habilitations_requises) h where h not in ('electrique','travail_hauteur','espace_confine',
               'levage','soudure','frigorifique','secourisme','accueil_site','autre'))
     or exists (select 1 from unnest(new.permis_requis) p where p !~ '^[a-z_]{2,40}$')
     or exists (select 1 from unnest(new.epi) e where length(e) not between 2 and 80) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger interventions_regles before insert or update on gbs.interventions
  for each row execute function gbs_private.trg_intervention();

create or replace function gbs_private.trg_intervention_enfant() returns trigger
language plpgsql security definer set search_path = '' as $$
declare i gbs.interventions;
begin
  select * into i from gbs.interventions where id = new.intervention_id;
  if i.id is null then raise exception 'GBS_INTERVENTION_INCONNUE' using errcode = '22023'; end if;
  if tg_table_name = 'intervention_techniciens' then
    if i.statut not in ('planifiee','en_cours') then raise exception 'GBS_INTERVENTION_STATUT' using errcode = 'P0001'; end if;
    if not exists (select 1 from gbs.profils p where p.id = new.technicien_id and p.actif
                     and p.role in ('inspecteur','hub_afrique','achats_chine','admin')) then
      raise exception 'GBS_ASSIGNE_INVALIDE' using errcode = '22023';
    end if;
    return new;
  end if;
  new.dossier_id := i.dossier_id;
  if tg_table_name = 'permis_travail' then
    if i.statut <> 'planifiee' then raise exception 'GBS_INTERVENTION_STATUT' using errcode = 'P0001'; end if;
    if new.document is not null and not gbs_private.photos_valides(i.dossier_id, array[new.document]) then
      raise exception 'GBS_DOCUMENTS_INVALIDES' using errcode = '22023';
    end if;
  elsif tg_table_name = 'intervention_temps' then
    if i.statut <> 'en_cours' then raise exception 'GBS_INTERVENTION_STATUT: le temps se saisit pendant l''intervention' using errcode = 'P0001'; end if;
    if not exists (select 1 from gbs.intervention_techniciens t where t.intervention_id = i.id and t.technicien_id = new.technicien_id) then
      raise exception 'GBS_ASSIGNE_INVALIDE: technicien non affecté à l''intervention' using errcode = '22023';
    end if;
    if new.date_travail < i.date_debut or new.date_travail > least(i.date_fin, current_date) then
      raise exception 'GBS_DATE_INVALIDE' using errcode = '22023';
    end if;
    -- Un technicien ne saisit que son propre temps ; la gestion saisit pour tous.
    if not gbs_private.gere_interventions(i.dossier_id) and new.technicien_id is distinct from auth.uid() then
      raise exception 'GBS_ACCES_REFUSE' using errcode = '42501';
    end if;
  elsif tg_table_name = 'incidents_hse' then
    if i.statut not in ('en_cours','terminee','facturee') then raise exception 'GBS_INTERVENTION_STATUT' using errcode = 'P0001'; end if;
    if new.survenu_le > now() or new.survenu_le < i.date_debut::timestamptz - interval '1 day' then
      raise exception 'GBS_DATE_INVALIDE' using errcode = '22023';
    end if;
    if not gbs_private.photos_valides(i.dossier_id, new.photos) then raise exception 'GBS_PHOTOS_INVALIDES' using errcode = '22023'; end if;
  end if;
  return new;
end $$;
create trigger intervention_techniciens_regles before insert on gbs.intervention_techniciens
  for each row execute function gbs_private.trg_intervention_enfant();
create trigger permis_travail_regles before insert or update on gbs.permis_travail
  for each row execute function gbs_private.trg_intervention_enfant();
create trigger intervention_temps_regles before insert on gbs.intervention_temps
  for each row execute function gbs_private.trg_intervention_enfant();
create trigger incidents_hse_regles before insert on gbs.incidents_hse
  for each row execute function gbs_private.trg_intervention_enfant();

create or replace function gbs_private.trg_incident_ref() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform pg_advisory_xact_lock(7331);
  select coalesce(max(substring(reference from '-([0-9]+)$')::int), 0) + 1 into n
    from gbs.incidents_hse where reference like 'HSE-' || extract(year from now())::int || '-%';
  new.reference := 'HSE-' || extract(year from now())::int || '-' || lpad(n::text, 3, '0');
  return new;
end $$;
create trigger incidents_hse_ref before insert on gbs.incidents_hse
  for each row execute function gbs_private.trg_incident_ref();

-- Frais rattachés à une intervention : même dossier.
create or replace function gbs_private.trg_cout_intervention() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.intervention_id is not null and not exists (select 1 from gbs.interventions i
       where i.id = new.intervention_id and i.dossier_id = new.dossier_id and i.statut in ('planifiee','en_cours','terminee')) then
    raise exception 'GBS_INTERVENTION_INCONNUE: frais rattachés à une intervention ouverte du même dossier' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger couts_intervention before insert or update of intervention_id, dossier_id on gbs.couts
  for each row execute function gbs_private.trg_cout_intervention();

do $$
declare t text;
begin
  foreach t in array array['habilitations','intervention_techniciens','permis_travail','intervention_temps','incidents_hse'] loop
    execute format('create trigger %1$s_cree before insert on gbs.%1$s for each row execute function gbs_private.trg_cree_par()', t);
    execute format('create trigger %1$s_audit after insert or update or delete on gbs.%1$s for each row execute function gbs_private.trg_audit()', t);
  end loop;
  -- Temps, permis et registre HSE : jamais modifiés ni supprimés (erreur : nouvelle ligne).
  foreach t in array array['intervention_temps','incidents_hse','permis_travail'] loop
    execute format('create trigger %1$s_immuable before update or delete on gbs.%1$s for each row execute function gbs_private.trg_immuable()', t);
  end loop;
  execute 'create trigger habilitations_nodel before delete on gbs.habilitations for each row execute function gbs_private.trg_no_delete()';
  execute 'create trigger interventions_touch before update on gbs.interventions for each row execute function gbs_private.trg_touch()';
  execute 'create trigger interventions_cree before insert on gbs.interventions for each row execute function gbs_private.trg_cree_par()';
  execute 'create trigger interventions_audit after insert or update or delete on gbs.interventions for each row execute function gbs_private.trg_audit()';
  execute 'create trigger interventions_nodel before delete on gbs.interventions for each row execute function gbs_private.trg_no_delete()';
end $$;

-- -----------------------------------------------------------------------------
-- Démarrage : contrôles HSE ; fin ; facturation au coût réel + 15 %.
-- -----------------------------------------------------------------------------
create or replace function gbs.controles_hse(p_intervention uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare i gbs.interventions; manques jsonb := '[]'::jsonb; t record; h text; p text;
begin
  select * into i from gbs.interventions where id = p_intervention;
  perform gbs_private.exiger(i.id is not null and gbs_private.intervention_visible(p_intervention));
  if not exists (select 1 from gbs.intervention_techniciens where intervention_id = i.id) then
    manques := manques || jsonb_build_object('controle', 'techniciens');
  end if;
  if jsonb_array_length(i.analyse_risques) = 0 then manques := manques || jsonb_build_object('controle', 'analyse_risques'); end if;
  if cardinality(i.epi) = 0 then manques := manques || jsonb_build_object('controle', 'epi'); end if;
  for t in select x.technicien_id, pr.nom from gbs.intervention_techniciens x join gbs.profils pr on pr.id = x.technicien_id
            where x.intervention_id = i.id loop
    foreach h in array i.habilitations_requises loop
      if not exists (select 1 from gbs.habilitations a where a.technicien_id = t.technicien_id and a.type = h
                       and a.delivree_le <= i.date_debut and a.expire_le >= i.date_fin) then
        manques := manques || jsonb_build_object('controle', 'habilitation', 'technicien', t.nom, 'type', h);
      end if;
    end loop;
  end loop;
  foreach p in array i.permis_requis loop
    if not exists (select 1 from gbs.permis_travail w where w.intervention_id = i.id and w.type = p
                     and w.valide_du <= greatest(i.date_debut, current_date) and w.valide_au >= i.date_fin) then
      manques := manques || jsonb_build_object('controle', 'permis', 'type', p);
    end if;
  end loop;
  return manques;
end $$;

create or replace function gbs.demarrer_intervention(p_intervention uuid)
returns gbs.interventions language plpgsql security definer set search_path = '' as $$
declare i gbs.interventions; m jsonb;
begin
  select * into i from gbs.interventions where id = p_intervention for update;
  perform gbs_private.exiger(i.id is not null and gbs_private.gere_interventions(i.dossier_id));
  if i.statut <> 'planifiee' then raise exception 'GBS_INTERVENTION_STATUT' using errcode = 'P0001'; end if;
  if current_date < i.date_debut - 1 or current_date > i.date_fin then raise exception 'GBS_DATE_INVALIDE' using errcode = '22023'; end if;
  m := gbs.controles_hse(p_intervention);
  if jsonb_array_length(m) > 0 then
    raise exception 'GBS_HSE_INCOMPLET: %', left(m::text, 500) using errcode = 'P0001';
  end if;
  perform set_config('gbs.rpc', 'intervention', true);
  update gbs.interventions set statut = 'en_cours', demarree_le = now() where id = p_intervention returning * into i;
  perform set_config('gbs.rpc', '', true);
  return i;
end $$;

create or replace function gbs.terminer_intervention(p_intervention uuid, p_compte_rendu text, p_pv text default null)
returns gbs.interventions language plpgsql security definer set search_path = '' as $$
declare i gbs.interventions; cr text := trim(coalesce(p_compte_rendu, '')); prev text;
begin
  select * into i from gbs.interventions where id = p_intervention for update;
  perform gbs_private.exiger(i.id is not null and gbs_private.gere_interventions(i.dossier_id));
  if i.statut <> 'en_cours' then raise exception 'GBS_INTERVENTION_STATUT' using errcode = 'P0001'; end if;
  if length(cr) not between 10 and 4000 then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  if not exists (select 1 from gbs.intervention_temps where intervention_id = i.id) then
    raise exception 'GBS_TEMPS_MANQUANT: saisissez le temps passé' using errcode = 'P0001';
  end if;
  if i.type = 'mise_en_service' and p_pv is null then
    raise exception 'GBS_PV_MISE_EN_SERVICE: procès-verbal de mise en service signé exigé' using errcode = 'P0001';
  end if;
  if p_pv is not null and not gbs_private.photos_valides(i.dossier_id, array[p_pv]) then
    raise exception 'GBS_DOCUMENTS_INVALIDES' using errcode = '22023';
  end if;
  perform set_config('gbs.rpc', 'intervention', true);
  update gbs.interventions set statut = 'terminee', terminee_le = now(), compte_rendu = cr, pv_document = p_pv
   where id = p_intervention returning * into i;
  if i.type = 'mise_en_service' then
    prev := 'intervention';
    perform set_config('gbs.rpc', 'systeme', true);
    update gbs.pieces set statut = 'validee', document_chemin = p_pv
     where dossier_id = i.dossier_id and code = 'pv_mise_en_service' and statut <> 'validee';
  end if;
  perform set_config('gbs.rpc', '', true);
  return i;
end $$;

-- Coût réel : temps des techniciens + frais validés rattachés à l'intervention.
create or replace function gbs_private.cout_intervention(p_intervention uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'heures', coalesce((select sum(heures) from gbs.intervention_temps where intervention_id = p_intervention), 0),
    'temps_xof', coalesce((select sum(cout_xof) from gbs.intervention_temps where intervention_id = p_intervention), 0),
    'frais_xof', coalesce((select sum(montant_xof) from gbs.couts where intervention_id = p_intervention and statut in ('validee','remboursee')), 0))
$$;

create or replace function gbs.cout_intervention(p_intervention uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c jsonb; i gbs.interventions; maj numeric;
begin
  select * into i from gbs.interventions where id = p_intervention;
  perform gbs_private.exiger(i.id is not null and gbs_private.gere_interventions(i.dossier_id));
  c := gbs_private.cout_intervention(p_intervention);
  maj := gbs_private.param_num('tarif.installation_majoration', i.date_debut);
  return c || jsonb_build_object('cout_reel_xof', (c ->> 'temps_xof')::numeric + (c ->> 'frais_xof')::numeric, 'majoration', maj,
    'a_facturer_xof', round(((c ->> 'temps_xof')::numeric + (c ->> 'frais_xof')::numeric) * (1 + maj)));
end $$;

create or replace function gbs.facturer_intervention(p_intervention uuid)
returns gbs.factures language plpgsql security definer set search_path = '' as $$
declare i gbs.interventions; d gbs.dossiers; cl gbs.clients; c jsonb; reel numeric; maj numeric; soc text; dev text; f gbs.factures;
begin
  select * into i from gbs.interventions where id = p_intervention for update;
  perform gbs_private.exiger(i.id is not null and gbs_private.gere_interventions(i.dossier_id));
  if i.statut <> 'terminee' then raise exception 'GBS_INTERVENTION_STATUT' using errcode = 'P0001'; end if;
  select * into d from gbs.dossiers where id = i.dossier_id;
  select * into cl from gbs.clients where id = d.client_id;
  c := gbs_private.cout_intervention(p_intervention);
  reel := (c ->> 'temps_xof')::numeric + (c ->> 'frais_xof')::numeric;
  if reel <= 0 then raise exception 'GBS_COUT_NUL' using errcode = 'P0001'; end if;
  maj := gbs_private.param_num('tarif.installation_majoration', i.date_debut);
  soc := gbs_private.societe_facturante(cl.pays, 'installation', current_date);
  dev := gbs_private.devise_facturation(soc, cl.pays);
  insert into gbs.factures (societe_id, client_id, dossier_id, type, objet, devise, langue)
  values ((select id from gbs.societes where code = soc), cl.id, d.id, 'installation',
          left('Intervention ' || i.reference || ' — ' || i.objet, 300), dev, cl.langue)
  returning * into f;
  insert into gbs.lignes_facture (facture_id, libelle, service, dossier_ref, quantite, prix_unitaire, ordre) values
    (f.id, left('Temps des techniciens (' || (c ->> 'heures') || ' h) — ' || i.reference, 300), 'S9', d.id, 1,
     gbs_private.depuis_xof((c ->> 'temps_xof')::numeric, dev, current_date), 1);
  if (c ->> 'frais_xof')::numeric > 0 then
    insert into gbs.lignes_facture (facture_id, libelle, service, dossier_ref, quantite, prix_unitaire, ordre)
    values (f.id, left('Frais engagés (déplacements, sous-traitants, pièces) — ' || i.reference, 300), 'S9', d.id, 1,
            gbs_private.depuis_xof((c ->> 'frais_xof')::numeric, dev, current_date), 2);
  end if;
  insert into gbs.lignes_facture (facture_id, libelle, service, dossier_ref, quantite, prix_unitaire, ordre)
  values (f.id, left('Rémunération GBS : ' || round(maj * 100, 1) || ' % du coût réel', 300), 'S9', d.id, 1,
          gbs_private.depuis_xof(round(reel * maj), dev, current_date), 3);
  perform set_config('gbs.rpc', 'intervention', true);
  update gbs.interventions set statut = 'facturee', facture_id = f.id where id = p_intervention;
  perform set_config('gbs.rpc', '', true);
  select * into f from gbs.factures where id = f.id;
  return f;
end $$;

create or replace function gbs.annuler_intervention(p_intervention uuid, p_motif text)
returns gbs.interventions language plpgsql security definer set search_path = '' as $$
declare i gbs.interventions;
begin
  select * into i from gbs.interventions where id = p_intervention for update;
  perform gbs_private.exiger(i.id is not null and gbs_private.gere_interventions(i.dossier_id));
  if i.statut <> 'planifiee' then raise exception 'GBS_INTERVENTION_STATUT' using errcode = 'P0001'; end if;
  perform gbs_private.motif(p_motif);
  perform set_config('gbs.rpc', 'intervention', true);
  update gbs.interventions set statut = 'annulee' where id = p_intervention returning * into i;
  perform set_config('gbs.rpc', '', true);
  return i;
end $$;

-- Habilitations expirant bientôt (30 jours par défaut) ou expirées pour une intervention planifiée.
create or replace function gbs.habilitations_a_renouveler(p_jours int default 30)
returns table (habilitation_id uuid, technicien_id uuid, technicien text, type text, libelle text, expire_le date)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','hub_afrique'));
  if p_jours is null or p_jours not between 0 and 365 then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  return query
  select a.id, a.technicien_id, p.nom, a.type, a.libelle, a.expire_le
    from gbs.habilitations a join gbs.profils p on p.id = a.technicien_id
   where p.actif and a.expire_le <= current_date + p_jours
     and not exists (select 1 from gbs.habilitations b where b.technicien_id = a.technicien_id and b.type = a.type
                       and b.expire_le > a.expire_le)
   order by a.expire_le;
end $$;

-- Marge directe : le temps des techniciens est un coût du dossier (les frais y sont déjà).
create or replace function gbs_private.couts_dossier(p_dossier uuid)
returns table (cout_id uuid, categorie text, cause_perte text, montant_xof numeric)
language sql stable security definer set search_path = '' as $$
  select c.id, c.categorie, c.cause_perte, c.montant_xof::numeric from gbs.couts c
   where c.dossier_id = p_dossier and c.statut in ('validee','remboursee')
     and not exists (select 1 from gbs.couts_repartition r where r.cout_id = c.id)
  union all
  select c.id, c.categorie, c.cause_perte, r.montant_xof::numeric from gbs.couts_repartition r
    join gbs.couts c on c.id = r.cout_id
   where r.dossier_id = p_dossier and c.statut in ('validee','remboursee')
  union all
  select p.id, 'commission_agent', null, p.montant_xof::numeric from gbs.partages p
   where p.dossier_id = p_dossier and p.du_a = 'agent'
  union all
  select t.id, 'installation', null, t.cout_xof::numeric from gbs.intervention_temps t
   where t.dossier_id = p_dossier
$$;

-- -----------------------------------------------------------------------------
-- Droits
-- -----------------------------------------------------------------------------
alter table gbs.habilitations enable row level security;
alter table gbs.interventions enable row level security;
alter table gbs.intervention_techniciens enable row level security;
alter table gbs.permis_travail enable row level security;
alter table gbs.intervention_temps enable row level security;
alter table gbs.incidents_hse enable row level security;
grant select, insert on gbs.habilitations, gbs.interventions, gbs.intervention_techniciens, gbs.permis_travail,
  gbs.intervention_temps, gbs.incidents_hse to authenticated;
grant update (objet, lieu, date_debut, date_fin, habilitations_requises, permis_requis, analyse_risques, epi)
  on gbs.interventions to authenticated;
grant update (libelle, organisme) on gbs.habilitations to authenticated;
grant update (intervention_id) on gbs.couts to authenticated;

create policy habilitations_lecture on gbs.habilitations for select using (
  gbs_private.has_role('admin','hub_afrique') or technicien_id = auth.uid());
create policy habilitations_ecriture on gbs.habilitations for insert with check (gbs_private.has_role('admin','hub_afrique'));
create policy habilitations_maj on gbs.habilitations for update using (gbs_private.has_role('admin','hub_afrique'));

create policy interventions_lecture on gbs.interventions for select using (
  gbs_private.gere_interventions(dossier_id)
  or (gbs_private.has_role('achats_chine') and gbs_private.dossier_visible(dossier_id))
  or gbs_private.technicien_de(id));
create policy interventions_creation on gbs.interventions for insert with check (gbs_private.gere_interventions(dossier_id));
create policy interventions_maj on gbs.interventions for update using (gbs_private.gere_interventions(dossier_id));

create policy intervention_techniciens_lecture on gbs.intervention_techniciens for select using (gbs_private.intervention_visible(intervention_id));
create policy intervention_techniciens_ecriture on gbs.intervention_techniciens for insert with check (
  exists (select 1 from gbs.interventions i where i.id = intervention_id and gbs_private.gere_interventions(i.dossier_id)));

create policy permis_lecture on gbs.permis_travail for select using (gbs_private.intervention_visible(intervention_id));
create policy permis_ecriture on gbs.permis_travail for insert with check (
  exists (select 1 from gbs.interventions i where i.id = intervention_id and gbs_private.gere_interventions(i.dossier_id)));

create policy temps_lecture on gbs.intervention_temps for select using (gbs_private.intervention_visible(intervention_id));
create policy temps_ecriture on gbs.intervention_temps for insert with check (
  exists (select 1 from gbs.interventions i where i.id = intervention_id and gbs_private.gere_interventions(i.dossier_id))
  or (gbs_private.technicien_de(intervention_id) and technicien_id = auth.uid()));

create policy incidents_lecture on gbs.incidents_hse for select using (gbs_private.intervention_visible(intervention_id));
create policy incidents_ecriture on gbs.incidents_hse for insert with check (
  exists (select 1 from gbs.interventions i where i.id = intervention_id and gbs_private.gere_interventions(i.dossier_id))
  or gbs_private.technicien_de(intervention_id));

revoke execute on function gbs.controles_hse(uuid), gbs.demarrer_intervention(uuid), gbs.terminer_intervention(uuid, text, text),
  gbs.cout_intervention(uuid), gbs.facturer_intervention(uuid), gbs.annuler_intervention(uuid, text), gbs.habilitations_a_renouveler(int),
  gbs_private.gere_interventions(uuid), gbs_private.technicien_de(uuid), gbs_private.intervention_visible(uuid),
  gbs_private.risques_valides(jsonb), gbs_private.trg_intervention(), gbs_private.trg_intervention_enfant(),
  gbs_private.trg_incident_ref(), gbs_private.trg_cout_intervention(), gbs_private.cout_intervention(uuid) from public;
grant execute on function gbs.controles_hse(uuid), gbs.demarrer_intervention(uuid), gbs.terminer_intervention(uuid, text, text),
  gbs.cout_intervention(uuid), gbs.facturer_intervention(uuid), gbs.annuler_intervention(uuid, text),
  gbs.habilitations_a_renouveler(int) to authenticated;
grant execute on all functions in schema gbs_private to authenticated, service_role;
