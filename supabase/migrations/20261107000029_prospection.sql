-- M1 : prospection (lot 0, non livré jusqu'ici) et demandes du site web (lot 1).
-- * Fiche prospect : spécialité, pays, segment, source, page d'origine, consentement.
-- * Actions de prospection (appel, e-mail, rendez-vous...) avec relance programmée ; la
--   première action marque le premier contact.
-- * Alerte : une tâche « premier contact » est créée à l'arrivée, échéance 1 jour ouvré,
--   pour le responsable ; elle se ferme au premier contact.
-- * Entonnoir : nouveau → contacté → qualifié → consultation → converti (client) ; perdu motivé.
-- * Demandes du site web : reçues par la fonction serveur gbs-demande (signée par le site),
--   enregistrées par une fonction réservée au rôle de service ; plafonds par adresse et par
--   jour ; doublon du même jour rattaché au prospect existant ; fichiers dans
--   prospects/<id>/ (type vérifié sur les octets, nom régénéré).
-- * Visibilité : administratrice ; Hub Afrique hors Gabon et Cameroun ; agent pays sur son pays.

create table gbs.prospects (
  id              uuid primary key default gen_random_uuid(),
  reference       text unique check (reference ~ '^PRO-[0-9]{4}-[0-9]{3,6}$'),
  raison_sociale  text not null check (length(trim(raison_sociale)) between 2 and 200),
  contact_nom     text check (length(contact_nom) <= 120),
  contact_fonction text check (length(contact_fonction) <= 120),
  email           text check (length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  telephone       text check (length(telephone) <= 40 and telephone ~ '^[0-9+() .-]{6,40}$'),
  pays            char(2) not null check (pays ~ '^[A-Z]{2}$'),
  segment         text check (length(segment) <= 80),
  specialite      text not null default 'autre' check (specialite in ('equipement_site','approvisionnement_industriel','autre')),
  source          text not null check (source in ('site_web','salon','recommandation','prospection_directe','agent','reseau','autre')),
  page_origine    text check (length(page_origine) <= 500 and page_origine ~ '^https://'),
  message         text check (length(message) <= 4000),
  langue          text not null default 'fr' check (langue in ('fr','en','zh')),
  fichiers        text[] not null default '{}' check (cardinality(fichiers) <= 5),
  consentement_le timestamptz,
  statut          text not null default 'nouveau'
                  check (statut in ('nouveau','contacte','qualifie','consultation','converti','perdu')),
  responsable_id  uuid references gbs.profils(id),
  agent_id        uuid references gbs.profils(id),
  premier_contact_le timestamptz,
  prochaine_relance date,
  motif_perte     text check (length(motif_perte) <= 1000),
  client_id       uuid references gbs.clients(id),
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check (email is not null or telephone is not null)
);
create index on gbs.prospects (statut, prochaine_relance);
create index on gbs.prospects (lower(email), cree_le);

create table gbs.prospects_actions (
  id            uuid primary key default gen_random_uuid(),
  prospect_id   uuid not null references gbs.prospects(id),
  type          text not null check (type in ('appel','email','whatsapp','rendez_vous','visite','demande_site','autre')),
  date_action   date not null,
  compte_rendu  text not null check (length(trim(compte_rendu)) between 3 and 4000),
  prochaine_relance date,
  cree_le timestamptz not null default now(), cree_par uuid
);
create index on gbs.prospects_actions (prospect_id, date_action);

-- Plafond de demandes du site par adresse (empreinte HMAC, jamais l'adresse en clair).
create table gbs.demandes_site_compteurs (
  empreinte  text not null check (empreinte ~ '^[0-9a-f]{64}$'),
  heure      timestamptz not null,
  nombre     int not null default 0,
  primary key (empreinte, heure)
);

alter table gbs.taches add column prospect_id uuid references gbs.prospects(id);

insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('site.demandes_par_heure', '5', date '2026-01-01', 'Demandes du site web acceptées par adresse et par heure'),
  ('site.demandes_par_jour', '300', date '2026-01-01', 'Demandes du site web acceptées par jour, toutes adresses'),
  ('prospect.premier_contact_jours', '1', date '2026-01-01', 'Délai du premier contact, en jours ouvrés (cahier des charges, M1)');

-- -----------------------------------------------------------------------------
-- Visibilité
-- -----------------------------------------------------------------------------
create or replace function gbs_private.prospect_visible_cols(p_pays text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case gbs_private.role()
    when 'admin' then true
    when 'hub_afrique' then p_pays not in ('GA','CM')
    when 'agent_pays' then p_pays = (gbs_private.profil()).pays
    else false end
$$;
create or replace function gbs_private.prospect_visible(p_prospect uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from gbs.prospects p where p.id = p_prospect and gbs_private.prospect_visible_cols(p.pays))
$$;

-- Fichiers : prospects/<id du prospect>/<uuid>.<ext>, lus par ceux qui voient le prospect.
create or replace function gbs_private.document_visible(p_bucket text, p_nom text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_bucket = 'gbs-documents' and (
    (p_nom ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
       and gbs_private.dossier_visible(substring(p_nom from 1 for 36)::uuid))
    or (p_nom ~ '^frais/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
       and gbs_private.interne()
       and (substring(p_nom from 7 for 36)::uuid = auth.uid() or gbs_private.has_role('admin','comptable')))
    or (p_nom ~ '^prospects/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
       and gbs_private.prospect_visible(substring(p_nom from 11 for 36)::uuid)))
$$;

-- -----------------------------------------------------------------------------
-- Règles d'écriture
-- -----------------------------------------------------------------------------
create or replace function gbs_private.responsable_prospect(p_pays text) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.id from gbs.profils p where p.actif and p.role = 'agent_pays' and p.pays = p_pays and p_pays in ('GA','CM')
      order by p.cree_le limit 1),
    (select p.id from gbs.profils p where p.actif and p.role = 'hub_afrique' and p_pays not in ('GA','CM') order by p.cree_le limit 1),
    (select p.id from gbs.profils p where p.actif and p.role = 'admin' order by p.cree_le limit 1))
$$;

create or replace function gbs_private.trg_prospect() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int; rpc text := coalesce(current_setting('gbs.rpc', true), ''); resp gbs.profils;
begin
  if tg_op = 'INSERT' then
    if new.statut <> 'nouveau' or new.premier_contact_le is not null or new.client_id is not null or new.motif_perte is not null then
      raise exception 'GBS_VALIDATION_RPC' using errcode = 'P0001';
    end if;
    if cardinality(new.fichiers) > 0 and rpc <> 'demande_site' then
      raise exception 'GBS_VALIDATION_RPC' using errcode = 'P0001';
    end if;
    perform pg_advisory_xact_lock(7329);
    select coalesce(max(substring(reference from '-([0-9]+)$')::int), 0) + 1 into n
      from gbs.prospects where reference like 'PRO-' || extract(year from now())::int || '-%';
    new.reference := 'PRO-' || extract(year from now())::int || '-' || lpad(n::text, 4, '0');
    new.responsable_id := coalesce(new.responsable_id, auth.uid(), gbs_private.responsable_prospect(new.pays));
    -- Un agent pays rattache à lui les prospects de son pays.
    if new.agent_id is null and new.pays in ('GA','CM') then
      new.agent_id := (select p.id from gbs.profils p where p.id = new.responsable_id and p.role = 'agent_pays' and p.pays = new.pays);
    end if;
  else
    if (new.reference, new.source, new.page_origine, new.consentement_le, new.fichiers, new.cree_le)
       is distinct from (old.reference, old.source, old.page_origine, old.consentement_le, old.fichiers, old.cree_le)
       and rpc <> 'demande_site' then
      raise exception 'GBS_PROSPECT_FIGE: l''origine d''une demande ne se modifie pas' using errcode = 'P0001';
    end if;
    if (new.statut, new.premier_contact_le, new.client_id, new.motif_perte)
       is distinct from (old.statut, old.premier_contact_le, old.client_id, old.motif_perte) and rpc <> 'prospect' then
      raise exception 'GBS_VALIDATION_RPC: le statut du prospect change par les fonctions dédiées' using errcode = 'P0001';
    end if;
    if old.statut in ('converti','perdu') and rpc <> 'prospect' then
      raise exception 'GBS_PROSPECT_CLOS' using errcode = 'P0001';
    end if;
  end if;
  select * into resp from gbs.profils where id = new.responsable_id;
  if resp.id is null or not resp.actif or resp.role not in ('admin','hub_afrique','agent_pays') then
    raise exception 'GBS_ASSIGNE_INVALIDE' using errcode = '22023';
  end if;
  if resp.role = 'agent_pays' and resp.pays is distinct from new.pays then
    raise exception 'GBS_ASSIGNE_INVALIDE: un agent pays ne suit que les prospects de son pays' using errcode = '22023';
  end if;
  if new.agent_id is not null and not exists (select 1 from gbs.profils p where p.id = new.agent_id and p.role = 'agent_pays' and p.pays = new.pays) then
    raise exception 'GBS_AGENT_INVALIDE' using errcode = '22023';
  end if;
  if new.prochaine_relance is not null and new.prochaine_relance < current_date and (tg_op = 'INSERT' or new.prochaine_relance is distinct from old.prochaine_relance) then
    raise exception 'GBS_DATE_INVALIDE' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(new.fichiers) f where f !~ ('^prospects/' || new.id::text || '/[0-9a-f-]{36}\.(pdf|png|jpg|webp)$')) then
    raise exception 'GBS_DOCUMENTS_INVALIDES' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger prospects_regles before insert or update on gbs.prospects
  for each row execute function gbs_private.trg_prospect();

-- À l'arrivée : tâche « premier contact » pour le responsable, échéance 1 jour ouvré.
create or replace function gbs_private.trg_prospect_tache() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into gbs.taches (libelle, details, assigne_a, echeance, prospect_id)
  values (left('Premier contact : ' || new.raison_sociale, 300),
          left('Prospect ' || new.reference || coalesce(' — ' || new.contact_nom, '') || ' (' || new.pays || ', ' || new.source || ')', 2000),
          new.responsable_id,
          gbs_private.ajouter_jours_ouvres(gbs_private.pays_calendrier(new.responsable_id, new.pays), (new.cree_le at time zone 'UTC')::date,
                                           gbs_private.param_num('prospect.premier_contact_jours')::int),
          new.id);
  return null;
end $$;
create trigger prospects_tache after insert on gbs.prospects
  for each row execute function gbs_private.trg_prospect_tache();

do $$
begin
  execute 'create trigger prospects_touch before update on gbs.prospects for each row execute function gbs_private.trg_touch()';
  execute 'create trigger prospects_cree before insert on gbs.prospects for each row execute function gbs_private.trg_cree_par()';
  execute 'create trigger prospects_audit after insert or update or delete on gbs.prospects for each row execute function gbs_private.trg_audit()';
  execute 'create trigger prospects_nodel before delete on gbs.prospects for each row execute function gbs_private.trg_no_delete()';
  execute 'create trigger prospects_actions_cree before insert on gbs.prospects_actions for each row execute function gbs_private.trg_cree_par()';
  execute 'create trigger prospects_actions_audit after insert on gbs.prospects_actions for each row execute function gbs_private.trg_audit()';
  execute 'create trigger prospects_actions_immuable before update or delete on gbs.prospects_actions for each row execute function gbs_private.trg_immuable()';
end $$;

-- -----------------------------------------------------------------------------
-- Actions, statut, conversion
-- -----------------------------------------------------------------------------
create or replace function gbs.enregistrer_action_prospect(p_prospect uuid, p_type text, p_date date, p_compte_rendu text,
  p_prochaine_relance date default null)
returns gbs.prospects_actions language plpgsql security definer set search_path = '' as $$
declare p gbs.prospects; a gbs.prospects_actions; cr text := trim(coalesce(p_compte_rendu, '')); prev text;
begin
  select * into p from gbs.prospects where id = p_prospect for update;
  perform gbs_private.exiger(p.id is not null and gbs_private.prospect_visible_cols(p.pays));
  if p.statut in ('converti','perdu') then raise exception 'GBS_PROSPECT_CLOS' using errcode = 'P0001'; end if;
  if p_type not in ('appel','email','whatsapp','rendez_vous','visite','autre') or length(cr) not between 3 and 4000
     or p_date is null or p_date > current_date or p_date < (p.cree_le at time zone 'UTC')::date - 1
     or (p_prochaine_relance is not null and (p_prochaine_relance < current_date or p_prochaine_relance > current_date + 365)) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  insert into gbs.prospects_actions (prospect_id, type, date_action, compte_rendu, prochaine_relance)
  values (p_prospect, p_type, p_date, cr, p_prochaine_relance) returning * into a;
  prev := coalesce(current_setting('gbs.rpc', true), '');
  perform set_config('gbs.rpc', 'prospect', true);
  update gbs.prospects set premier_contact_le = coalesce(premier_contact_le, now()),
         statut = case when statut = 'nouveau' then 'contacte' else statut end,
         prochaine_relance = p_prochaine_relance
   where id = p_prospect;
  perform set_config('gbs.rpc', prev, true);
  update gbs.taches set statut = 'faite' where prospect_id = p_prospect and statut in ('a_faire','en_cours');
  return a;
end $$;

create or replace function gbs.changer_statut_prospect(p_prospect uuid, p_statut text, p_motif text default null)
returns gbs.prospects language plpgsql security definer set search_path = '' as $$
declare p gbs.prospects; m text := nullif(trim(coalesce(p_motif, '')), '');
begin
  select * into p from gbs.prospects where id = p_prospect for update;
  perform gbs_private.exiger(p.id is not null and gbs_private.prospect_visible_cols(p.pays));
  if p.statut in ('converti','perdu') then raise exception 'GBS_PROSPECT_CLOS' using errcode = 'P0001'; end if;
  if p_statut not in ('qualifie','consultation','perdu') then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  if p.premier_contact_le is null and p_statut <> 'perdu' then
    raise exception 'GBS_PREMIER_CONTACT_REQUIS: enregistrez d''abord le premier contact' using errcode = 'P0001';
  end if;
  if p_statut = 'perdu' and (m is null or length(m) < 5 or length(m) > 1000) then
    raise exception 'GBS_MOTIF_OBLIGATOIRE' using errcode = 'P0001';
  end if;
  perform set_config('gbs.rpc', 'prospect', true);
  update gbs.prospects set statut = p_statut, motif_perte = case when p_statut = 'perdu' then m end,
         prochaine_relance = case when p_statut = 'perdu' then null else prochaine_relance end
   where id = p_prospect returning * into p;
  perform set_config('gbs.rpc', '', true);
  if p_statut = 'perdu' then
    update gbs.taches set statut = 'annulee' where prospect_id = p_prospect and statut in ('a_faire','en_cours');
  end if;
  return p;
end $$;

-- Conversion : le prospect devient client de la société qui contracte (GBS Chine au Gabon et
-- au Cameroun, GBS Côte d'Ivoire ailleurs), dans la devise de sa zone ; vérification à faire (M2).
create or replace function gbs.convertir_prospect(p_prospect uuid)
returns gbs.clients language plpgsql security definer set search_path = '' as $$
declare p gbs.prospects; c gbs.clients; soc uuid; dev text;
begin
  select * into p from gbs.prospects where id = p_prospect for update;
  perform gbs_private.exiger(p.id is not null and gbs_private.prospect_visible_cols(p.pays));
  if p.statut in ('converti','perdu') then raise exception 'GBS_PROSPECT_CLOS' using errcode = 'P0001'; end if;
  if p.premier_contact_le is null then
    raise exception 'GBS_PREMIER_CONTACT_REQUIS: enregistrez d''abord le premier contact' using errcode = 'P0001';
  end if;
  soc := (select s.id from gbs.societes s where s.code = case when p.pays in ('GA','CM') then 'GBS_CN' else 'GBS_CI' end);
  dev := case when p.pays in ('CI','SN','BJ','BF','ML','NE','TG','GW') then 'XOF'
              when p.pays in ('GA','CM','CG','CF','TD','GQ') then 'XAF' else 'USD' end;
  insert into gbs.clients (societe_id, raison_sociale, pays, devise, segment, specialite, origine, agent_id, langue)
  values (soc, trim(p.raison_sociale), p.pays, dev, p.segment, p.specialite,
          case when p.agent_id is not null then 'agent_pays' else 'direct' end, p.agent_id, p.langue)
  returning * into c;
  if p.contact_nom is not null then
    insert into gbs.contacts (client_id, nom, fonction, email, telephone)
    values (c.id, left(p.contact_nom, 120), p.contact_fonction, p.email, p.telephone);
  end if;
  perform set_config('gbs.rpc', 'prospect', true);
  update gbs.prospects set statut = 'converti', client_id = c.id, prochaine_relance = null where id = p_prospect;
  perform set_config('gbs.rpc', '', true);
  update gbs.taches set statut = 'faite' where prospect_id = p_prospect and statut in ('a_faire','en_cours');
  return c;
end $$;

-- Entonnoir et alertes
create or replace function gbs.entonnoir_prospects(p_depuis date default current_date - 365)
returns table (statut text, nombre bigint, site_web bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','hub_afrique','agent_pays'));
  return query
  select s.statut, count(p.id), count(p.id) filter (where p.source = 'site_web')
    from unnest(array['nouveau','contacte','qualifie','consultation','converti','perdu']) with ordinality s(statut, o)
    left join gbs.prospects p on p.statut = s.statut and p.cree_le >= p_depuis and gbs_private.prospect_visible_cols(p.pays)
   group by s.statut, s.o order by s.o;
end $$;

create or replace function gbs.prospects_sans_contact()
returns table (prospect_id uuid, reference text, raison_sociale text, pays text, source text, responsable_id uuid, echeance date)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','hub_afrique','agent_pays'));
  return query
  select p.id, p.reference, p.raison_sociale, p.pays::text, p.source, p.responsable_id, t.echeance
    from gbs.prospects p join gbs.taches t on t.prospect_id = p.id and t.statut in ('a_faire','en_cours')
   where p.premier_contact_le is null and p.statut = 'nouveau' and t.echeance < current_date
     and gbs_private.prospect_visible_cols(p.pays)
   order by t.echeance, p.reference;
end $$;

-- -----------------------------------------------------------------------------
-- Demandes du site web (rôle de service uniquement, via gbs-demande)
-- -----------------------------------------------------------------------------
create or replace function gbs.recevoir_demande_site(p jsonb, p_empreinte_ip text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h timestamptz := date_trunc('hour', now()); n int; existant gbs.prospects; nouveau gbs.prospects;
        cles text[] := array['raison_sociale','contact_nom','contact_fonction','email','telephone','pays','specialite',
                             'segment','message','page_origine','langue','consentement'];
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'GBS_ACCES_REFUSE' using errcode = '42501';
  end if;
  if p_empreinte_ip is null or p_empreinte_ip !~ '^[0-9a-f]{64}$' then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  if jsonb_typeof(p) <> 'object' or exists (select 1 from jsonb_object_keys(p) k where not k = any(cles))
     or jsonb_typeof(p -> 'consentement') is distinct from 'boolean' or not (p ->> 'consentement')::boolean
     or exists (select 1 from jsonb_each(p) e where e.key <> 'consentement' and jsonb_typeof(e.value) not in ('string','null')) then
    raise exception 'GBS_DEMANDE_INVALIDE' using errcode = '22023';
  end if;
  -- Plafonds : par adresse et par heure ; par jour, toutes adresses.
  insert into gbs.demandes_site_compteurs (empreinte, heure, nombre) values (p_empreinte_ip, h, 1)
  on conflict (empreinte, heure) do update set nombre = gbs.demandes_site_compteurs.nombre + 1 returning nombre into n;
  if n > gbs_private.param_num('site.demandes_par_heure') then raise exception 'GBS_TROP_DE_DEMANDES' using errcode = 'P0001'; end if;
  if (select coalesce(sum(nombre), 0) from gbs.demandes_site_compteurs where heure >= date_trunc('day', now()))
     > gbs_private.param_num('site.demandes_par_jour') then
    raise exception 'GBS_TROP_DE_DEMANDES' using errcode = 'P0001';
  end if;
  -- Doublon du jour (même e-mail) : rattaché au prospect existant.
  select * into existant from gbs.prospects
   where p ->> 'email' is not null and lower(email) = lower(trim(p ->> 'email')) and source = 'site_web'
     and cree_le >= now() - interval '24 hours' order by cree_le desc limit 1;
  if existant.id is not null then
    insert into gbs.prospects_actions (prospect_id, type, date_action, compte_rendu)
    values (existant.id, 'demande_site', current_date,
            left('Nouvelle demande du site : ' || coalesce(nullif(trim(p ->> 'message'), ''), '(sans message)'), 4000));
    return jsonb_build_object('prospect_id', existant.id, 'doublon', true);
  end if;
  perform set_config('gbs.rpc', 'demande_site', true);
  insert into gbs.prospects (raison_sociale, contact_nom, contact_fonction, email, telephone, pays, specialite, segment,
                             source, page_origine, message, langue, consentement_le, responsable_id)
  values (trim(p ->> 'raison_sociale'), nullif(trim(p ->> 'contact_nom'), ''), nullif(trim(p ->> 'contact_fonction'), ''),
          nullif(lower(trim(p ->> 'email')), ''), nullif(trim(p ->> 'telephone'), ''), upper(trim(p ->> 'pays')),
          coalesce(nullif(p ->> 'specialite', ''), 'autre'), nullif(trim(p ->> 'segment'), ''), 'site_web',
          nullif(trim(p ->> 'page_origine'), ''), nullif(trim(p ->> 'message'), ''), coalesce(nullif(p ->> 'langue', ''), 'fr'),
          now(), gbs_private.responsable_prospect(upper(trim(p ->> 'pays'))))
  returning * into nouveau;
  perform set_config('gbs.rpc', '', true);
  return jsonb_build_object('prospect_id', nouveau.id, 'doublon', false);
exception when data_exception or integrity_constraint_violation then
  raise exception 'GBS_DEMANDE_INVALIDE' using errcode = '22023';
end $$;

create or replace function gbs.joindre_fichiers_demande(p_prospect uuid, p_chemins text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'GBS_ACCES_REFUSE' using errcode = '42501';
  end if;
  perform set_config('gbs.rpc', 'demande_site', true);
  update gbs.prospects set fichiers = (fichiers || coalesce(p_chemins, '{}'))[1:5]
   where id = p_prospect and source = 'site_web';
  perform set_config('gbs.rpc', '', true);
end $$;

-- -----------------------------------------------------------------------------
-- Droits
-- -----------------------------------------------------------------------------
alter table gbs.prospects enable row level security;
alter table gbs.prospects_actions enable row level security;
alter table gbs.demandes_site_compteurs enable row level security;
grant select, insert on gbs.prospects to authenticated;
grant update (raison_sociale, contact_nom, contact_fonction, email, telephone, pays, segment, specialite, langue,
              responsable_id, agent_id, prochaine_relance) on gbs.prospects to authenticated;
grant select on gbs.prospects_actions to authenticated;

create policy prospects_lecture on gbs.prospects for select using (gbs_private.prospect_visible_cols(pays));
create policy prospects_creation on gbs.prospects for insert with check (gbs_private.prospect_visible_cols(pays) and source <> 'site_web');
create policy prospects_maj on gbs.prospects for update using (gbs_private.prospect_visible_cols(pays))
  with check (gbs_private.prospect_visible_cols(pays));
create policy prospects_actions_lecture on gbs.prospects_actions for select using (gbs_private.prospect_visible(prospect_id));

revoke execute on function gbs.enregistrer_action_prospect(uuid, text, date, text, date), gbs.changer_statut_prospect(uuid, text, text),
  gbs.convertir_prospect(uuid), gbs.entonnoir_prospects(date), gbs.prospects_sans_contact(),
  gbs.recevoir_demande_site(jsonb, text), gbs.joindre_fichiers_demande(uuid, text[]),
  gbs_private.prospect_visible_cols(text), gbs_private.prospect_visible(uuid), gbs_private.responsable_prospect(text),
  gbs_private.trg_prospect(), gbs_private.trg_prospect_tache() from public;
grant execute on function gbs.enregistrer_action_prospect(uuid, text, date, text, date), gbs.changer_statut_prospect(uuid, text, text),
  gbs.convertir_prospect(uuid), gbs.entonnoir_prospects(date), gbs.prospects_sans_contact() to authenticated;
grant execute on function gbs.recevoir_demande_site(jsonb, text), gbs.joindre_fichiers_demande(uuid, text[]) to service_role;
grant execute on all functions in schema gbs_private to authenticated, service_role;
