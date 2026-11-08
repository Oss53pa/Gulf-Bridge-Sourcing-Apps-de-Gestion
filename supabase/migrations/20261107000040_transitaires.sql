-- Lot 1, M9 : formulaire du transitaire par lien sécurisé.
-- * Lien par expédition, remis au transitaire choisi : jeton de 256 bits remis une fois
--   (empreinte seule en base), durée paramétrée, révocable, plafond de consultations ;
--   caduc une fois l'expédition livrée.
-- * Le transitaire voit uniquement son expédition (ports, navire, conteneurs, dates, étapes) :
--   jamais les prix, les marges, le client ni les autres dossiers.
-- * Il saisit les étapes, met à jour navire, dates, connaissement, conteneurs et plombs, et
--   dépose les documents de transport (type vérifié sur les octets par la fonction serveur).
-- * Ses étapes restent masquées au client jusqu'à leur publication par l'équipe ; ses
--   documents sont rangés dans le dossier, avec leur empreinte.

create table gbs.liens_transitaires (
  id              uuid primary key default gen_random_uuid(),
  expedition_id   uuid not null references gbs.expeditions(id),
  destinataire    text not null check (length(trim(destinataire)) between 2 and 200),
  empreinte       char(64) not null unique,
  expire_le       timestamptz not null,
  revoque_le      timestamptz,
  revoque_par     uuid references gbs.profils(id),
  fenetre_debut   timestamptz,
  fenetre_n       int not null default 0,
  consultations   int not null default 0,
  derniere_consultation timestamptz,
  cree_le timestamptz not null default now(), cree_par uuid
);
create index on gbs.liens_transitaires (expedition_id);

alter table gbs.expedition_etapes
  add column source text not null default 'equipe' check (source in ('equipe','transitaire')),
  add column lien_transitaire_id uuid references gbs.liens_transitaires(id);

create table gbs.documents_transitaires (
  id              uuid primary key default gen_random_uuid(),
  expedition_id   uuid not null references gbs.expeditions(id),
  dossier_id      uuid not null references gbs.dossiers(id),
  lien_id         uuid not null references gbs.liens_transitaires(id),
  type            text not null check (type in ('projet_connaissement','connaissement','lta','liste_colisage','certificat_origine',
                    'photos_chargement','bordereau_suivi','declaration_douane','mainlevee','autre')),
  libelle         text check (length(libelle) <= 200),
  chemin          text not null unique check (chemin ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|png|jpg|webp)$'),
  empreinte       char(64) not null check (empreinte ~ '^[0-9a-f]{64}$'),
  taille          int not null check (taille between 1 and 26214400),
  depose_le       timestamptz not null default now()
);
create index on gbs.documents_transitaires (expedition_id);

insert into gbs.parametres_definitions (cle, type, minimum, maximum, validateur, module, libelle) values
  ('transitaire.lien_jours','entier',1,365,null,'dossiers','Validité du lien du transitaire (jours)'),
  ('transitaire.depots_max','entier',1,500,null,'dossiers','Documents et étapes saisis par lien de transitaire');
insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('transitaire.lien_jours', '120', date '2026-01-01', 'Lien du transitaire : 120 jours, le temps du voyage et du dédouanement'),
  ('transitaire.depots_max', '200', date '2026-01-01', 'Saisies par lien de transitaire');

-- -----------------------------------------------------------------------------
-- Règles
-- -----------------------------------------------------------------------------
create or replace function gbs_private.trg_systeme_transitaire() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'transitaire' then
    raise exception 'GBS_VALIDATION_RPC: les liens et saisies du transitaire passent par les fonctions dédiées' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger liens_transitaires_regles before insert or update on gbs.liens_transitaires
  for each row execute function gbs_private.trg_systeme_transitaire();
create trigger documents_transitaires_regles before insert or update on gbs.documents_transitaires
  for each row execute function gbs_private.trg_systeme_transitaire();

-- Une étape « transitaire » ne vient que du lien, et part masquée au client.
create or replace function gbs_private.trg_etape_source() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.source = 'transitaire' or new.lien_transitaire_id is not null)
     and coalesce(current_setting('gbs.rpc', true), '') <> 'transitaire' then
    raise exception 'GBS_VALIDATION_RPC: une étape du transitaire vient de son lien' using errcode = '42501';
  end if;
  if new.source = 'transitaire' then new.visible_client := false; end if;
  return new;
end $$;
create trigger etapes_source before insert on gbs.expedition_etapes
  for each row execute function gbs_private.trg_etape_source();

do $$
begin
  execute 'create trigger liens_transitaires_cree before insert on gbs.liens_transitaires for each row execute function gbs_private.trg_cree_par()';
  execute 'create trigger liens_transitaires_audit after insert on gbs.liens_transitaires for each row execute function gbs_private.trg_audit()';
  execute 'create trigger liens_transitaires_audit_revocation after update on gbs.liens_transitaires for each row when (old.revoque_le is distinct from new.revoque_le) execute function gbs_private.trg_audit()';
  execute 'create trigger liens_transitaires_nodel before delete on gbs.liens_transitaires for each row execute function gbs_private.trg_no_delete()';
  execute 'create trigger documents_transitaires_audit after insert on gbs.documents_transitaires for each row execute function gbs_private.trg_audit()';
  execute 'create trigger documents_transitaires_immuable before update or delete on gbs.documents_transitaires for each row execute function gbs_private.trg_immuable()';
end $$;

-- Lien valide : non révoqué, non expiré, expédition non livrée ; plafond horaire compté.
create or replace function gbs_private.lien_transitaire(p_jeton text, p_compter boolean) returns gbs.liens_transitaires
language plpgsql security definer set search_path = '' as $$
declare l gbs.liens_transitaires; max_h int;
begin
  if p_jeton is null or p_jeton !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'GBS_LIEN_INVALIDE' using errcode = 'P0001'; end if;
  select * into l from gbs.liens_transitaires where empreinte = gbs_private.empreinte_jeton(p_jeton) for update;
  if l.id is null or l.revoque_le is not null or l.expire_le <= now()
     or not exists (select 1 from gbs.expeditions e where e.id = l.expedition_id and e.statut <> 'livree') then
    raise exception 'GBS_LIEN_INVALIDE' using errcode = 'P0001';
  end if;
  if p_compter then
    max_h := gbs_private.param_num('fournisseur.consultations_max_heure')::int;
    perform set_config('gbs.rpc', 'transitaire', true);
    if l.fenetre_debut is null or l.fenetre_debut < now() - interval '1 hour' then
      update gbs.liens_transitaires set fenetre_debut = now(), fenetre_n = 1, consultations = consultations + 1, derniere_consultation = now()
       where id = l.id returning * into l;
    elsif l.fenetre_n >= max_h then
      perform set_config('gbs.rpc', '', true);
      raise exception 'GBS_TROP_DE_CONSULTATIONS' using errcode = 'P0001';
    else
      update gbs.liens_transitaires set fenetre_n = fenetre_n + 1, consultations = consultations + 1, derniere_consultation = now()
       where id = l.id returning * into l;
    end if;
    perform set_config('gbs.rpc', '', true);
  end if;
  return l;
end $$;

-- Saisies plafonnées par lien (étapes et documents).
create or replace function gbs_private.quota_transitaire(p_lien uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select count(*) from gbs.expedition_etapes where lien_transitaire_id = p_lien)
     + (select count(*) from gbs.documents_transitaires where lien_id = p_lien) >= gbs_private.param_num('transitaire.depots_max') then
    raise exception 'GBS_TROP_DE_DEPOTS' using errcode = 'P0001';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Équipe
-- -----------------------------------------------------------------------------
create or replace function gbs_private.gere_expedition(p_expedition uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from gbs.expeditions e where e.id = p_expedition
                  and (gbs_private.has_role('admin','achats_chine')
                       or (gbs_private.has_role('hub_afrique') and gbs_private.dossier_visible(e.dossier_id))))
$$;

create or replace function gbs.creer_lien_transitaire(p_expedition uuid, p_destinataire text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e gbs.expeditions; jeton text; l gbs.liens_transitaires;
begin
  perform gbs_private.exiger(gbs_private.gere_expedition(p_expedition));
  select * into e from gbs.expeditions where id = p_expedition;
  if e.statut = 'livree' then raise exception 'GBS_EXPEDITION_LIVREE' using errcode = 'P0001'; end if;
  if p_destinataire is null or length(trim(p_destinataire)) not between 2 and 200 then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  jeton := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  perform set_config('gbs.rpc', 'transitaire', true);
  update gbs.liens_transitaires set revoque_le = now(), revoque_par = auth.uid() where expedition_id = p_expedition and revoque_le is null;
  insert into gbs.liens_transitaires (expedition_id, destinataire, empreinte, expire_le)
  values (p_expedition, trim(p_destinataire), gbs_private.empreinte_jeton(jeton),
          now() + make_interval(days => gbs_private.param_num('transitaire.lien_jours')::int))
  returning * into l;
  perform set_config('gbs.rpc', '', true);
  return jsonb_build_object('id', l.id, 'jeton', jeton, 'expire_le', l.expire_le);
end $$;

create or replace function gbs.revoquer_lien_transitaire(p_lien uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare l gbs.liens_transitaires;
begin
  select * into l from gbs.liens_transitaires where id = p_lien;
  perform gbs_private.exiger(l.id is not null and gbs_private.gere_expedition(l.expedition_id));
  perform set_config('gbs.rpc', 'transitaire', true);
  update gbs.liens_transitaires set revoque_le = coalesce(revoque_le, now()), revoque_par = coalesce(revoque_par, auth.uid()) where id = p_lien;
  perform set_config('gbs.rpc', '', true);
end $$;

-- Publication au client d'une étape saisie par le transitaire, après relecture par l'équipe.
create or replace function gbs.publier_etape_transitaire(p_etape uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s gbs.expedition_etapes;
begin
  select * into s from gbs.expedition_etapes where id = p_etape for update;
  perform gbs_private.exiger(s.id is not null and gbs_private.gere_expedition(s.expedition_id));
  if s.source <> 'transitaire' then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  update gbs.expedition_etapes set visible_client = true where id = p_etape;
end $$;

-- -----------------------------------------------------------------------------
-- Transitaire (fonction serveur gbs-transitaire, rôle de service)
-- -----------------------------------------------------------------------------
create or replace function gbs.formulaire_transitaire(p_jeton text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l gbs.liens_transitaires; e gbs.expeditions;
begin
  l := gbs_private.lien_transitaire(p_jeton, true);
  select * into e from gbs.expeditions where id = l.expedition_id;
  -- Liste blanche : ni client, ni prix, ni commande, ni autre dossier.
  return jsonb_build_object(
    'expedition', jsonb_build_object('reference', e.reference, 'mode', e.mode, 'statut', e.statut, 'lieu_remise', e.lieu_remise,
      'port_depart', e.port_depart, 'port_arrivee', e.port_arrivee, 'pays_destination', e.pays_destination, 'navire', e.navire,
      'type_connaissement', e.type_connaissement, 'numero_connaissement', e.numero_connaissement, 'conteneurs', e.conteneurs,
      'plombs', e.plombs, 'etd', e.etd, 'eta', e.eta, 'date_mainlevee', e.date_mainlevee),
    'destinataire', l.destinataire, 'expire_le', l.expire_le,
    'etapes', coalesce((select jsonb_agg(jsonb_build_object('etape', s.etape, 'lieu', s.lieu, 'survenue_le', s.survenue_le,
                                'commentaire', case when s.source = 'transitaire' then s.commentaire end, 'source', s.source)
                                order by s.survenue_le)
                          from gbs.expedition_etapes s where s.expedition_id = e.id
                           and (s.source = 'transitaire' or s.visible_client)), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('type', d.type, 'libelle', d.libelle, 'depose_le', d.depose_le,
                                   'empreinte', d.empreinte) order by d.depose_le)
                             from gbs.documents_transitaires d where d.expedition_id = e.id and d.lien_id = l.id), '[]'::jsonb));
end $$;

create or replace function gbs.ajouter_etape_transitaire(p_jeton text, p_etape text, p_lieu text, p_survenue_le timestamptz, p_commentaire text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l gbs.liens_transitaires;
begin
  l := gbs_private.lien_transitaire(p_jeton, false);
  perform gbs_private.quota_transitaire(l.id);
  if p_survenue_le is null or p_survenue_le > now() + interval '1 hour' or p_survenue_le < now() - interval '180 days'
     or length(p_lieu) > 120 or length(p_commentaire) > 1000 then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform set_config('gbs.rpc', 'transitaire', true);
  insert into gbs.expedition_etapes (expedition_id, etape, lieu, survenue_le, commentaire, source, lien_transitaire_id)
  values (l.expedition_id, p_etape, nullif(trim(p_lieu), ''), p_survenue_le, nullif(trim(p_commentaire), ''), 'transitaire', l.id);
  perform set_config('gbs.rpc', '', true);
  return jsonb_build_object('ok', true);
end $$;

-- Mise à jour par le transitaire : champs de transport seulement, formats contrôlés.
create or replace function gbs.maj_expedition_transitaire(p_jeton text, p_champs jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l gbs.liens_transitaires; k text; c text;
begin
  l := gbs_private.lien_transitaire(p_jeton, false);
  if jsonb_typeof(p_champs) <> 'object' or exists (select 1 from jsonb_object_keys(p_champs) x
       where x not in ('navire','etd','eta','numero_connaissement','date_mainlevee','conteneurs','plombs')) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_champs) loop
    if k in ('conteneurs','plombs') then
      if jsonb_typeof(p_champs -> k) <> 'array' or jsonb_array_length(p_champs -> k) > 50 then
        raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
      end if;
      for c in select jsonb_array_elements_text(p_champs -> k) loop
        if (k = 'conteneurs' and c !~ '^[A-Z]{4}[0-9]{7}$') or (k = 'plombs' and c !~ '^[A-Za-z0-9-]{3,30}$') then
          raise exception 'GBS_PARAMETRES_INVALIDES: %', k using errcode = '22023';
        end if;
      end loop;
    elsif k in ('etd','eta','date_mainlevee') then
      if jsonb_typeof(p_champs -> k) <> 'string' or (p_champs ->> k) !~ '^\d{4}-\d{2}-\d{2}$'
         or (p_champs ->> k)::date not between current_date - 365 and current_date + 365 then
        raise exception 'GBS_PARAMETRES_INVALIDES: %', k using errcode = '22023';
      end if;
    elsif jsonb_typeof(p_champs -> k) <> 'string' or length(trim(p_champs ->> k)) not between 2 and (case k when 'navire' then 120 else 60 end) then
      raise exception 'GBS_PARAMETRES_INVALIDES: %', k using errcode = '22023';
    end if;
  end loop;
  update gbs.expeditions set
    navire = case when p_champs ? 'navire' then trim(p_champs ->> 'navire') else navire end,
    etd = case when p_champs ? 'etd' then (p_champs ->> 'etd')::date else etd end,
    eta = case when p_champs ? 'eta' then (p_champs ->> 'eta')::date else eta end,
    numero_connaissement = case when p_champs ? 'numero_connaissement' then trim(p_champs ->> 'numero_connaissement') else numero_connaissement end,
    date_mainlevee = case when p_champs ? 'date_mainlevee' then (p_champs ->> 'date_mainlevee')::date else date_mainlevee end,
    conteneurs = case when p_champs ? 'conteneurs' then array(select jsonb_array_elements_text(p_champs -> 'conteneurs')) else conteneurs end,
    plombs = case when p_champs ? 'plombs' then array(select jsonb_array_elements_text(p_champs -> 'plombs')) else plombs end
   where id = l.expedition_id;
  perform gbs_private.journaliser('maj_transitaire', 'expeditions', l.expedition_id::text,
    (select dossier_id from gbs.expeditions where id = l.expedition_id), null, p_champs, null);
  return jsonb_build_object('ok', true);
end $$;

create or replace function gbs.enregistrer_document_transitaire(p_jeton text, p_type text, p_libelle text, p_chemin text, p_empreinte text, p_taille int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l gbs.liens_transitaires; e gbs.expeditions; x gbs.documents_transitaires;
begin
  l := gbs_private.lien_transitaire(p_jeton, false);
  perform gbs_private.quota_transitaire(l.id);
  select * into e from gbs.expeditions where id = l.expedition_id;
  if p_chemin is null or p_chemin !~ ('^' || e.dossier_id::text || '/[0-9a-f-]{36}\.(pdf|png|jpg|webp)$') then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform set_config('gbs.rpc', 'transitaire', true);
  insert into gbs.documents_transitaires (expedition_id, dossier_id, lien_id, type, libelle, chemin, empreinte, taille)
  values (e.id, e.dossier_id, l.id, p_type, nullif(left(trim(regexp_replace(coalesce(p_libelle, ''), '[[:cntrl:]]+', ' ', 'g')), 200), ''),
          p_chemin, p_empreinte, p_taille)
  returning * into x;
  perform set_config('gbs.rpc', '', true);
  return jsonb_build_object('type', x.type, 'depose_le', x.depose_le, 'empreinte', x.empreinte);
end $$;

-- Dossier d'une expédition, pour ranger les fichiers (rôle de service).
create or replace function gbs.dossier_lien_transitaire(p_jeton text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare l gbs.liens_transitaires;
begin
  l := gbs_private.lien_transitaire(p_jeton, true);
  return (select dossier_id from gbs.expeditions where id = l.expedition_id);
end $$;

-- -----------------------------------------------------------------------------
-- Droits
-- -----------------------------------------------------------------------------
alter table gbs.liens_transitaires enable row level security;
alter table gbs.documents_transitaires enable row level security;
grant select (id, expedition_id, destinataire, expire_le, revoque_le, consultations, derniere_consultation, cree_le, cree_par)
  on gbs.liens_transitaires to authenticated;
grant select on gbs.documents_transitaires to authenticated;
create policy liens_transitaires_lecture on gbs.liens_transitaires for select using (gbs_private.gere_expedition(expedition_id));
create policy documents_transitaires_lecture on gbs.documents_transitaires for select using (
  gbs_private.has_role('admin','achats_chine') or (gbs_private.has_role('hub_afrique','agent_pays') and gbs_private.dossier_visible(dossier_id)));

revoke execute on function gbs.creer_lien_transitaire(uuid, text), gbs.revoquer_lien_transitaire(uuid), gbs.publier_etape_transitaire(uuid),
  gbs.formulaire_transitaire(text), gbs.ajouter_etape_transitaire(text, text, text, timestamptz, text),
  gbs.maj_expedition_transitaire(text, jsonb), gbs.enregistrer_document_transitaire(text, text, text, text, text, int),
  gbs.dossier_lien_transitaire(text), gbs_private.lien_transitaire(text, boolean), gbs_private.quota_transitaire(uuid),
  gbs_private.gere_expedition(uuid), gbs_private.trg_systeme_transitaire(), gbs_private.trg_etape_source() from public;
grant execute on function gbs.creer_lien_transitaire(uuid, text), gbs.revoquer_lien_transitaire(uuid), gbs.publier_etape_transitaire(uuid) to authenticated;
grant execute on function gbs.formulaire_transitaire(text), gbs.ajouter_etape_transitaire(text, text, text, timestamptz, text),
  gbs.maj_expedition_transitaire(text, jsonb), gbs.enregistrer_document_transitaire(text, text, text, text, text, int),
  gbs.dossier_lien_transitaire(text) to service_role;
grant execute on all functions in schema gbs_private to authenticated, service_role;
revoke execute on function gbs_private.lien_transitaire(text, boolean) from authenticated;
