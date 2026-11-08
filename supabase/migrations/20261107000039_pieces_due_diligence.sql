-- Lot 1, M17 niveau 1 et M16 : dépôt des pièces de due diligence par le fournisseur, par lien
-- sécurisé, sans compte.
-- * Lien par due diligence en cours : jeton de 256 bits remis une fois (empreinte seule en
--   base), durée paramétrée, révocable, plafond de consultations ; caduc dès que la due
--   diligence est statuée.
-- * Fichier reçu par la fonction serveur gbs-fournisseur : type vérifié sur les octets (PDF,
--   PNG, JPEG, WebP), taille bornée, nom régénéré, empreinte SHA-256 ; rangé sous
--   dd/<due diligence>/, lisible seulement par les achats et l'administratrice (URL signée).
-- * Chaque pièce est acceptée ou refusée (motif obligatoire, vu par le fournisseur) ; une pièce
--   ne change jamais de fichier : le fournisseur en dépose une nouvelle.

create table gbs.liens_due_diligence (
  id                uuid primary key default gen_random_uuid(),
  due_diligence_id  uuid not null references gbs.due_diligences(id),
  empreinte         char(64) not null unique,
  expire_le         timestamptz not null,
  revoque_le        timestamptz,
  revoque_par       uuid references gbs.profils(id),
  fenetre_debut     timestamptz,
  fenetre_n         int not null default 0,
  consultations     int not null default 0,
  derniere_consultation timestamptz,
  cree_le timestamptz not null default now(), cree_par uuid
);
create index on gbs.liens_due_diligence (due_diligence_id);

create table gbs.pieces_due_diligence (
  id                uuid primary key default gen_random_uuid(),
  due_diligence_id  uuid not null references gbs.due_diligences(id),
  type              text not null check (type in ('licence_commerciale','licence_export','certificat_qualite','certification_produit',
                      'rapport_audit','references_clients','attestation_bancaire','beneficiaires_effectifs','declaration_ethique','autre')),
  libelle           text check (length(libelle) <= 200),
  chemin            text not null unique check (chemin ~ '^dd/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|png|jpg|webp)$'),
  empreinte         char(64) not null check (empreinte ~ '^[0-9a-f]{64}$'),
  taille            int not null check (taille between 1 and 26214400),
  canal             text not null check (canal in ('lien','interne')),
  lien_id           uuid references gbs.liens_due_diligence(id),
  depose_le         timestamptz not null default now(),
  depose_par        uuid references gbs.profils(id),
  statut            text not null default 'recue' check (statut in ('recue','acceptee','refusee')),
  motif_refus       text check (length(motif_refus) <= 1000),
  statue_le         timestamptz,
  statue_par        uuid references gbs.profils(id),
  check ((statut = 'refusee') = (motif_refus is not null)),
  check ((canal = 'lien') = (lien_id is not null))
);
create index on gbs.pieces_due_diligence (due_diligence_id);

insert into gbs.parametres_definitions (cle, type, minimum, maximum, validateur, module, libelle) values
  ('due_diligence.lien_jours','entier',1,90,null,'achats','Validité du lien de dépôt des pièces de due diligence (jours)'),
  ('due_diligence.pieces_max','entier',1,200,null,'achats','Pièces déposées par lien de due diligence');
insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('due_diligence.lien_jours', '30', date '2026-01-01', 'Lien de dépôt des pièces : 30 jours'),
  ('due_diligence.pieces_max', '40', date '2026-01-01', 'Pièces par lien de due diligence');

-- -----------------------------------------------------------------------------
-- Règles
-- -----------------------------------------------------------------------------
create or replace function gbs_private.trg_systeme_dd() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'pieces_dd' then
    raise exception 'GBS_VALIDATION_RPC: les liens et pièces de due diligence passent par les fonctions dédiées' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger liens_dd_regles before insert or update on gbs.liens_due_diligence
  for each row execute function gbs_private.trg_systeme_dd();
create trigger pieces_dd_regles before insert or update on gbs.pieces_due_diligence
  for each row execute function gbs_private.trg_systeme_dd();

create or replace function gbs_private.trg_piece_dd_figee() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.due_diligence_id, new.type, new.chemin, new.empreinte, new.taille, new.canal, new.lien_id, new.depose_le, new.depose_par)
     is distinct from (old.due_diligence_id, old.type, old.chemin, old.empreinte, old.taille, old.canal, old.lien_id, old.depose_le, old.depose_par) then
    raise exception 'GBS_PIECE_DD_FIGEE: une pièce déposée ne change pas de fichier' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger pieces_dd_figee before update on gbs.pieces_due_diligence
  for each row execute function gbs_private.trg_piece_dd_figee();

do $$
begin
  execute 'create trigger liens_dd_cree before insert on gbs.liens_due_diligence for each row execute function gbs_private.trg_cree_par()';
  execute 'create trigger liens_dd_audit after insert on gbs.liens_due_diligence for each row execute function gbs_private.trg_audit()';
  execute 'create trigger liens_dd_audit_revocation after update on gbs.liens_due_diligence for each row when (old.revoque_le is distinct from new.revoque_le) execute function gbs_private.trg_audit()';
  execute 'create trigger liens_dd_nodel before delete on gbs.liens_due_diligence for each row execute function gbs_private.trg_no_delete()';
  execute 'create trigger pieces_dd_audit after insert or update on gbs.pieces_due_diligence for each row execute function gbs_private.trg_audit()';
  execute 'create trigger pieces_dd_nodel before delete on gbs.pieces_due_diligence for each row execute function gbs_private.trg_no_delete()';
end $$;

-- Lien valide : non révoqué, non expiré, due diligence encore en cours ; plafond horaire compté.
create or replace function gbs_private.lien_due_diligence(p_jeton text, p_compter boolean) returns gbs.liens_due_diligence
language plpgsql security definer set search_path = '' as $$
declare l gbs.liens_due_diligence; max_h int;
begin
  if p_jeton is null or p_jeton !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'GBS_LIEN_INVALIDE' using errcode = 'P0001'; end if;
  select * into l from gbs.liens_due_diligence where empreinte = gbs_private.empreinte_jeton(p_jeton) for update;
  if l.id is null or l.revoque_le is not null or l.expire_le <= now()
     or not exists (select 1 from gbs.due_diligences d where d.id = l.due_diligence_id and d.statut = 'en_cours') then
    raise exception 'GBS_LIEN_INVALIDE' using errcode = 'P0001';
  end if;
  if p_compter then
    max_h := gbs_private.param_num('fournisseur.consultations_max_heure')::int;
    perform set_config('gbs.rpc', 'pieces_dd', true);
    if l.fenetre_debut is null or l.fenetre_debut < now() - interval '1 hour' then
      update gbs.liens_due_diligence set fenetre_debut = now(), fenetre_n = 1, consultations = consultations + 1, derniere_consultation = now()
       where id = l.id returning * into l;
    elsif l.fenetre_n >= max_h then
      perform set_config('gbs.rpc', '', true);
      raise exception 'GBS_TROP_DE_CONSULTATIONS' using errcode = 'P0001';
    else
      update gbs.liens_due_diligence set fenetre_n = fenetre_n + 1, consultations = consultations + 1, derniere_consultation = now()
       where id = l.id returning * into l;
    end if;
    perform set_config('gbs.rpc', '', true);
  end if;
  return l;
end $$;

-- Lecture des documents : pièces de due diligence réservées aux achats et à l'administratrice.
create or replace function gbs_private.document_visible(p_bucket text, p_nom text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_bucket = 'gbs-documents' and (
    (p_nom ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
       and gbs_private.dossier_visible(substring(p_nom from 1 for 36)::uuid))
    or (p_nom ~ '^frais/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
       and gbs_private.interne()
       and (substring(p_nom from 7 for 36)::uuid = auth.uid() or gbs_private.has_role('admin','comptable')))
    or (p_nom ~ '^prospects/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
       and gbs_private.prospect_visible(substring(p_nom from 11 for 36)::uuid))
    or (p_nom ~ '^dd/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
       and gbs_private.has_role('admin','achats_chine')))
$$;

-- -----------------------------------------------------------------------------
-- Équipe achats
-- -----------------------------------------------------------------------------
create or replace function gbs.creer_lien_due_diligence(p_dd uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d gbs.due_diligences; jeton text; l gbs.liens_due_diligence;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine'));
  select * into d from gbs.due_diligences where id = p_dd;
  if d.id is null then raise exception 'GBS_ACCES_REFUSE' using errcode = '42501'; end if;
  if d.statut <> 'en_cours' then raise exception 'GBS_DD_DEJA_STATUEE' using errcode = 'P0001'; end if;
  jeton := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  perform set_config('gbs.rpc', 'pieces_dd', true);
  update gbs.liens_due_diligence set revoque_le = now(), revoque_par = auth.uid() where due_diligence_id = p_dd and revoque_le is null;
  insert into gbs.liens_due_diligence (due_diligence_id, empreinte, expire_le)
  values (p_dd, gbs_private.empreinte_jeton(jeton), now() + make_interval(days => gbs_private.param_num('due_diligence.lien_jours')::int))
  returning * into l;
  perform set_config('gbs.rpc', '', true);
  return jsonb_build_object('id', l.id, 'jeton', jeton, 'expire_le', l.expire_le);
end $$;

create or replace function gbs.revoquer_lien_due_diligence(p_lien uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine') and exists (select 1 from gbs.liens_due_diligence where id = p_lien));
  perform set_config('gbs.rpc', 'pieces_dd', true);
  update gbs.liens_due_diligence set revoque_le = coalesce(revoque_le, now()), revoque_par = coalesce(revoque_par, auth.uid()) where id = p_lien;
  perform set_config('gbs.rpc', '', true);
end $$;

create or replace function gbs.statuer_piece_due_diligence(p_piece uuid, p_statut text, p_motif text default null)
returns gbs.pieces_due_diligence language plpgsql security definer set search_path = '' as $$
declare x gbs.pieces_due_diligence;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine'));
  select * into x from gbs.pieces_due_diligence where id = p_piece for update;
  if x.id is null then raise exception 'GBS_ACCES_REFUSE' using errcode = '42501'; end if;
  if not exists (select 1 from gbs.due_diligences d where d.id = x.due_diligence_id and d.statut = 'en_cours') then
    raise exception 'GBS_DD_DEJA_STATUEE' using errcode = 'P0001';
  end if;
  if p_statut not in ('acceptee','refusee') then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  if p_statut = 'refusee' and length(trim(coalesce(p_motif, ''))) not between 5 and 1000 then
    raise exception 'GBS_MOTIF_OBLIGATOIRE' using errcode = '22023';
  end if;
  perform set_config('gbs.rpc', 'pieces_dd', true);
  update gbs.pieces_due_diligence set statut = p_statut, motif_refus = case when p_statut = 'refusee' then trim(p_motif) end,
         statue_le = now(), statue_par = auth.uid()
   where id = p_piece returning * into x;
  perform set_config('gbs.rpc', '', true);
  return x;
end $$;

-- -----------------------------------------------------------------------------
-- Fournisseur (fonction serveur gbs-fournisseur, rôle de service)
-- -----------------------------------------------------------------------------
create or replace function gbs.formulaire_due_diligence(p_jeton text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l gbs.liens_due_diligence; d gbs.due_diligences; f gbs.fournisseurs;
begin
  l := gbs_private.lien_due_diligence(p_jeton, true);
  select * into d from gbs.due_diligences where id = l.due_diligence_id;
  select * into f from gbs.fournisseurs where id = d.fournisseur_id;
  -- Liste blanche : ni grille, ni note, ni conclusion, ni client.
  return jsonb_build_object('due_diligence', d.id, 'reference', d.reference, 'niveau', d.niveau, 'fournisseur', f.raison_sociale_en,
    'expire_le', l.expire_le,
    'pieces', coalesce((select jsonb_agg(jsonb_build_object('type', p.type, 'libelle', p.libelle, 'depose_le', p.depose_le,
                                 'statut', p.statut, 'motif_refus', p.motif_refus, 'empreinte', p.empreinte) order by p.depose_le)
                          from gbs.pieces_due_diligence p where p.due_diligence_id = d.id), '[]'::jsonb));
end $$;

create or replace function gbs.enregistrer_piece_due_diligence(p_jeton text, p_type text, p_libelle text, p_chemin text, p_empreinte text, p_taille int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l gbs.liens_due_diligence; x gbs.pieces_due_diligence;
begin
  l := gbs_private.lien_due_diligence(p_jeton, false);
  if p_chemin is null or p_chemin !~ ('^dd/' || l.due_diligence_id::text || '/[0-9a-f-]{36}\.(pdf|png|jpg|webp)$') then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if (select count(*) from gbs.pieces_due_diligence p where p.lien_id = l.id) >= gbs_private.param_num('due_diligence.pieces_max') then
    raise exception 'GBS_TROP_DE_DEPOTS' using errcode = 'P0001';
  end if;
  perform set_config('gbs.rpc', 'pieces_dd', true);
  insert into gbs.pieces_due_diligence (due_diligence_id, type, libelle, chemin, empreinte, taille, canal, lien_id)
  values (l.due_diligence_id, p_type, nullif(left(trim(regexp_replace(coalesce(p_libelle, ''), '[[:cntrl:]]+', ' ', 'g')), 200), ''),
          p_chemin, p_empreinte, p_taille, 'lien', l.id)
  returning * into x;
  perform set_config('gbs.rpc', '', true);
  return jsonb_build_object('type', x.type, 'depose_le', x.depose_le, 'empreinte', x.empreinte);
end $$;

-- -----------------------------------------------------------------------------
-- Droits
-- -----------------------------------------------------------------------------
alter table gbs.liens_due_diligence enable row level security;
alter table gbs.pieces_due_diligence enable row level security;
grant select (id, due_diligence_id, expire_le, revoque_le, consultations, derniere_consultation, cree_le, cree_par)
  on gbs.liens_due_diligence to authenticated;
grant select on gbs.pieces_due_diligence to authenticated;
create policy liens_dd_lecture on gbs.liens_due_diligence for select using (gbs_private.has_role('admin','achats_chine'));
create policy pieces_dd_lecture on gbs.pieces_due_diligence for select using (gbs_private.has_role('admin','achats_chine'));

revoke execute on function gbs.creer_lien_due_diligence(uuid), gbs.revoquer_lien_due_diligence(uuid),
  gbs.statuer_piece_due_diligence(uuid, text, text), gbs.formulaire_due_diligence(text),
  gbs.enregistrer_piece_due_diligence(text, text, text, text, text, int),
  gbs_private.lien_due_diligence(text, boolean), gbs_private.trg_systeme_dd(), gbs_private.trg_piece_dd_figee() from public;
grant execute on function gbs.creer_lien_due_diligence(uuid), gbs.revoquer_lien_due_diligence(uuid),
  gbs.statuer_piece_due_diligence(uuid, text, text) to authenticated;
grant execute on function gbs.formulaire_due_diligence(text), gbs.enregistrer_piece_due_diligence(text, text, text, text, text, int) to service_role;
grant execute on all functions in schema gbs_private to authenticated, service_role;
revoke execute on function gbs_private.lien_due_diligence(text, boolean) from authenticated;
