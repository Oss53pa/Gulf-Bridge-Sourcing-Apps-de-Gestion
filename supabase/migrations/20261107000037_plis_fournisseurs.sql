-- Lot 1, M17 niveau 1 et M5 : formulaire fournisseur par lien sécurisé et plis fermés.
-- * Lien par fournisseur invité : jeton de 256 bits remis une fois, seule l'empreinte est
--   gardée ; valable jusqu'à la date limite ; révocable ; plafond de consultations par heure.
-- * Réponse du fournisseur chiffrée par la fonction serveur gbs-fournisseur (AES-256-GCM,
--   clé GBS_PLIS_CLE hors de la base) : la base ne garde que le pli chiffré et l'empreinte
--   SHA-256 du contenu (salé). Personne, administratrice comprise, ne lit un pli avant la
--   date limite : la base ne livre les plis chiffrés qu'après, et l'ouverture vérifie que
--   chaque contenu déchiffré correspond à l'empreinte déposée.
-- * Une fois un pli déposé, la date limite ne peut plus être avancée.
-- * Questions des fournisseurs : la réponse est publiée à tous les invités, sans révéler
--   qui a posé la question.
-- * Offre issue d'un pli : prix, conditions et coût global figés.

create table gbs.liens_fournisseurs (
  id              uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references gbs.consultations_fournisseurs(id),
  fournisseur_id  uuid not null references gbs.fournisseurs(id),
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
create index on gbs.liens_fournisseurs (consultation_id, fournisseur_id);

create table gbs.plis (
  id              uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references gbs.consultations_fournisseurs(id),
  fournisseur_id  uuid not null references gbs.fournisseurs(id),
  lien_id         uuid not null references gbs.liens_fournisseurs(id),
  depose_le       timestamptz not null default now(),
  chiffre         text not null check (chiffre ~ '^[A-Za-z0-9+/]+=*$' and length(chiffre) between 24 and 200000),
  iv              text not null check (iv ~ '^[A-Za-z0-9+/]{16}$'),
  empreinte       char(64) not null check (empreinte ~ '^[0-9a-f]{64}$'),
  complet         boolean not null,
  statut          text not null default 'depose' check (statut in ('depose','remplace','ouvert')),
  remplace_le     timestamptz,
  ouvert_le       timestamptz,
  ouvert_par      uuid references gbs.profils(id),
  offre_id        uuid unique references gbs.offres(id)
);
create unique index plis_actif on gbs.plis (consultation_id, fournisseur_id) where statut <> 'remplace';

create table gbs.questions_consultation (
  id              uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references gbs.consultations_fournisseurs(id),
  fournisseur_id  uuid not null references gbs.fournisseurs(id),
  question        text not null check (length(question) between 5 and 2000),
  posee_le        timestamptz not null default now(),
  reponse         text check (length(reponse) between 2 and 4000),
  repondu_le      timestamptz,
  repondu_par     uuid references gbs.profils(id),
  check ((reponse is null) = (repondu_le is null))
);
create index on gbs.questions_consultation (consultation_id);

insert into gbs.parametres_definitions (cle, type, minimum, maximum, validateur, module, libelle) values
  ('fournisseur.consultations_max_heure','entier',1,1000,null,'achats','Consultations du formulaire fournisseur par lien et par heure'),
  ('fournisseur.questions_max','entier',0,100,null,'achats','Questions par fournisseur et par consultation'),
  ('fournisseur.depots_max','entier',1,50,null,'achats','Dépôts de pli (versions) par fournisseur et par consultation');
insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('fournisseur.consultations_max_heure', '60', date '2026-01-01', 'Lecture du formulaire fournisseur : 60 par heure et par lien'),
  ('fournisseur.questions_max', '10', date '2026-01-01', 'Questions d''un fournisseur sur une consultation'),
  ('fournisseur.depots_max', '10', date '2026-01-01', 'Versions successives d''un pli avant la date limite');

-- -----------------------------------------------------------------------------
-- Règles
-- -----------------------------------------------------------------------------
create or replace function gbs_private.trg_systeme_plis() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'plis' then
    raise exception 'GBS_VALIDATION_RPC: les liens, plis et questions passent par les fonctions dédiées' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function gbs_private.trg_pli_fige() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.consultation_id, new.fournisseur_id, new.lien_id, new.depose_le, new.chiffre, new.iv, new.empreinte, new.complet)
     is distinct from (old.consultation_id, old.fournisseur_id, old.lien_id, old.depose_le, old.chiffre, old.iv, old.empreinte, old.complet) then
    raise exception 'GBS_PLI_FIGE: un pli déposé ne se modifie pas' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger plis_fige before update on gbs.plis
  for each row execute function gbs_private.trg_pli_fige();
create trigger liens_fournisseurs_regles before insert or update on gbs.liens_fournisseurs
  for each row execute function gbs_private.trg_systeme_plis();
create trigger plis_regles before insert or update on gbs.plis
  for each row execute function gbs_private.trg_systeme_plis();
create trigger questions_regles before insert or update on gbs.questions_consultation
  for each row execute function gbs_private.trg_systeme_plis();

-- Date limite : jamais avancée une fois un pli déposé (sinon ouverture anticipée).
create or replace function gbs_private.trg_consultation_limite() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.date_limite < old.date_limite and exists (select 1 from gbs.plis p where p.consultation_id = old.id) then
    raise exception 'GBS_DATE_LIMITE_AVANCEE: des plis sont déposés, la date limite ne peut que reculer' using errcode = 'P0001';
  end if;
  if new.date_limite is distinct from old.date_limite then
    perform gbs_private.journaliser('date_limite_modifiee', 'consultations_fournisseurs', old.id::text, old.dossier_id,
      jsonb_build_object('date_limite', old.date_limite), jsonb_build_object('date_limite', new.date_limite), null);
  end if;
  return new;
end $$;
create trigger consultations_limite before update on gbs.consultations_fournisseurs
  for each row execute function gbs_private.trg_consultation_limite();

-- Offre issue d'un pli : le contenu du pli fait foi.
create or replace function gbs_private.trg_offre_pli() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.canal = 'formulaire'
     and (new.consultation_id, new.fournisseur_id, new.recu_le, new.canal, new.incoterm, new.lieu, new.devise, new.montant, new.fret,
          new.assurance, new.frais_jusqu_a_bord, new.delai_jours, new.conditions_paiement, new.garantie_mois, new.cout_global)
         is distinct from
         (old.consultation_id, old.fournisseur_id, old.recu_le, old.canal, old.incoterm, old.lieu, old.devise, old.montant, old.fret,
          old.assurance, old.frais_jusqu_a_bord, old.delai_jours, old.conditions_paiement, old.garantie_mois, old.cout_global) then
    raise exception 'GBS_OFFRE_PLI_FIGEE: l''offre reçue sous pli fermé ne se modifie pas' using errcode = 'P0001';
  end if;
  if new.canal = 'formulaire' and old.canal <> 'formulaire' then
    raise exception 'GBS_OFFRE_PLI_FIGEE' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger offres_pli before update on gbs.offres
  for each row execute function gbs_private.trg_offre_pli();

-- Une offre saisie à la main porte le canal de sa réception ; « formulaire » est réservé aux plis.
create or replace function gbs_private.trg_offre_canal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.canal = 'formulaire' and coalesce(current_setting('gbs.rpc', true), '') <> 'plis' then
    raise exception 'GBS_VALIDATION_RPC: une offre du formulaire vient de l''ouverture des plis' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger offres_canal before insert on gbs.offres
  for each row execute function gbs_private.trg_offre_canal();

do $$
begin
  execute 'create trigger liens_fournisseurs_audit after insert on gbs.liens_fournisseurs for each row execute function gbs_private.trg_audit()';
  execute 'create trigger liens_fournisseurs_audit_revocation after update on gbs.liens_fournisseurs for each row when (old.revoque_le is distinct from new.revoque_le) execute function gbs_private.trg_audit()';
  execute 'create trigger liens_fournisseurs_nodel before delete on gbs.liens_fournisseurs for each row execute function gbs_private.trg_no_delete()';
  execute 'create trigger liens_fournisseurs_cree before insert on gbs.liens_fournisseurs for each row execute function gbs_private.trg_cree_par()';
  execute 'create trigger plis_audit after insert or update on gbs.plis for each row execute function gbs_private.trg_audit()';
  execute 'create trigger plis_nodel before delete on gbs.plis for each row execute function gbs_private.trg_no_delete()';
  execute 'create trigger questions_audit after insert or update on gbs.questions_consultation for each row execute function gbs_private.trg_audit()';
  execute 'create trigger questions_nodel before delete on gbs.questions_consultation for each row execute function gbs_private.trg_no_delete()';
end $$;

-- Lien valide pour un jeton : non révoqué, non expiré, plafond horaire respecté (compté).
create or replace function gbs_private.lien_fournisseur(p_jeton text, p_compter boolean) returns gbs.liens_fournisseurs
language plpgsql security definer set search_path = '' as $$
declare l gbs.liens_fournisseurs; max_h int;
begin
  if p_jeton is null or p_jeton !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'GBS_LIEN_INVALIDE' using errcode = 'P0001'; end if;
  select * into l from gbs.liens_fournisseurs where empreinte = gbs_private.empreinte_jeton(p_jeton) for update;
  if l.id is null or l.revoque_le is not null or l.expire_le <= now() then
    raise exception 'GBS_LIEN_INVALIDE' using errcode = 'P0001';
  end if;
  if p_compter then
    max_h := gbs_private.param_num('fournisseur.consultations_max_heure')::int;
    perform set_config('gbs.rpc', 'plis', true);
    if l.fenetre_debut is null or l.fenetre_debut < now() - interval '1 hour' then
      update gbs.liens_fournisseurs set fenetre_debut = now(), fenetre_n = 1, consultations = consultations + 1, derniere_consultation = now()
       where id = l.id returning * into l;
    elsif l.fenetre_n >= max_h then
      perform set_config('gbs.rpc', '', true);
      raise exception 'GBS_TROP_DE_CONSULTATIONS' using errcode = 'P0001';
    else
      update gbs.liens_fournisseurs set fenetre_n = fenetre_n + 1, consultations = consultations + 1, derniere_consultation = now()
       where id = l.id returning * into l;
    end if;
    perform set_config('gbs.rpc', '', true);
  end if;
  return l;
end $$;

-- -----------------------------------------------------------------------------
-- Équipe achats
-- -----------------------------------------------------------------------------
create or replace function gbs.creer_lien_fournisseur(p_consultation uuid, p_fournisseur uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c gbs.consultations_fournisseurs; jeton text; l gbs.liens_fournisseurs;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine'));
  select * into c from gbs.consultations_fournisseurs where id = p_consultation;
  if c.id is null or not gbs_private.dossier_visible(c.dossier_id) then raise exception 'GBS_ACCES_REFUSE' using errcode = '42501'; end if;
  if c.statut <> 'ouverte' or c.date_limite <= now() then raise exception 'GBS_CONSULTATION_CLOSE' using errcode = 'P0001'; end if;
  if not exists (select 1 from gbs.consultation_invites i where i.consultation_id = p_consultation and i.fournisseur_id = p_fournisseur) then
    raise exception 'GBS_FOURNISSEUR_NON_INVITE' using errcode = 'P0001';
  end if;
  jeton := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  perform set_config('gbs.rpc', 'plis', true);
  -- Un seul lien actif par fournisseur : l'ancien est révoqué.
  update gbs.liens_fournisseurs set revoque_le = now(), revoque_par = auth.uid()
   where consultation_id = p_consultation and fournisseur_id = p_fournisseur and revoque_le is null;
  insert into gbs.liens_fournisseurs (consultation_id, fournisseur_id, empreinte, expire_le)
  values (p_consultation, p_fournisseur, gbs_private.empreinte_jeton(jeton), c.date_limite)
  returning * into l;
  perform set_config('gbs.rpc', '', true);
  return jsonb_build_object('id', l.id, 'jeton', jeton, 'expire_le', l.expire_le);
end $$;

create or replace function gbs.revoquer_lien_fournisseur(p_lien uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare l gbs.liens_fournisseurs; c gbs.consultations_fournisseurs;
begin
  select * into l from gbs.liens_fournisseurs where id = p_lien;
  select * into c from gbs.consultations_fournisseurs where id = l.consultation_id;
  perform gbs_private.exiger(l.id is not null and gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(c.dossier_id));
  perform set_config('gbs.rpc', 'plis', true);
  update gbs.liens_fournisseurs set revoque_le = coalesce(revoque_le, now()), revoque_par = coalesce(revoque_par, auth.uid()) where id = p_lien;
  perform set_config('gbs.rpc', '', true);
end $$;

-- Réponse à une question : publiée à tous les fournisseurs invités, sans l'auteur.
create or replace function gbs.repondre_question_consultation(p_question uuid, p_reponse text)
returns gbs.questions_consultation language plpgsql security definer set search_path = '' as $$
declare q gbs.questions_consultation; c gbs.consultations_fournisseurs;
begin
  select * into q from gbs.questions_consultation where id = p_question for update;
  select * into c from gbs.consultations_fournisseurs where id = q.consultation_id;
  perform gbs_private.exiger(q.id is not null and gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(c.dossier_id));
  if q.reponse is not null then raise exception 'GBS_QUESTION_DEJA_REPONDUE' using errcode = 'P0001'; end if;
  if p_reponse is null or length(trim(p_reponse)) not between 2 and 4000 then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  perform set_config('gbs.rpc', 'plis', true);
  update gbs.questions_consultation set reponse = trim(p_reponse), repondu_le = now(), repondu_par = auth.uid()
   where id = p_question returning * into q;
  perform set_config('gbs.rpc', '', true);
  return q;
end $$;

-- Plis chiffrés d'une consultation, livrés seulement après la date limite.
create or replace function gbs.plis_a_ouvrir(p_consultation uuid)
returns table (pli_id uuid, fournisseur_id uuid, chiffre text, iv text)
language plpgsql security definer set search_path = '' as $$
declare c gbs.consultations_fournisseurs;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine'));
  select * into c from gbs.consultations_fournisseurs where id = p_consultation;
  if c.id is null or not gbs_private.dossier_visible(c.dossier_id) then raise exception 'GBS_ACCES_REFUSE' using errcode = '42501'; end if;
  -- Avant la date limite : rien n'est livré, et la tentative reste au journal (une erreur
  -- annulerait aussi la trace).
  if now() < c.date_limite then
    perform gbs_private.journaliser('tentative_ouverture_anticipee', 'consultations_fournisseurs', c.id::text, c.dossier_id, null, null, null);
    return;
  end if;
  perform gbs_private.journaliser('lecture_plis_chiffres', 'consultations_fournisseurs', c.id::text, c.dossier_id, null, null, null);
  return query select p.id, p.fournisseur_id, p.chiffre, p.iv from gbs.plis p
                where p.consultation_id = p_consultation and p.statut = 'depose' order by p.depose_le;
end $$;

-- Ouverture : chaque contenu déchiffré doit correspondre à l'empreinte déposée ; il devient
-- l'offre du fournisseur, reçue à l'heure du dépôt, au canal « formulaire ».
create or replace function gbs.ouvrir_plis(p_consultation uuid, p_plis jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare c gbs.consultations_fournisseurs; x jsonb; p gbs.plis; o jsonb; n int := 0; v_offre uuid;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine'));
  select * into c from gbs.consultations_fournisseurs where id = p_consultation for update;
  if c.id is null or not gbs_private.dossier_visible(c.dossier_id) then raise exception 'GBS_ACCES_REFUSE' using errcode = '42501'; end if;
  if now() < c.date_limite then raise exception 'GBS_PLI_FERME' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_plis) <> 'array' or jsonb_array_length(p_plis) > 200 then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  for x in select value from jsonb_array_elements(p_plis) loop
    if jsonb_typeof(x) <> 'object' or (select count(*) from jsonb_object_keys(x)) <> 2 or not (x ? 'pli_id' and x ? 'contenu')
       or jsonb_typeof(x -> 'contenu') <> 'string' or length(x ->> 'contenu') > 150000 then
      raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
    end if;
    select * into p from gbs.plis where id = (x ->> 'pli_id')::uuid and consultation_id = p_consultation for update;
    if p.id is null or p.statut <> 'depose' then raise exception 'GBS_PLI_INCONNU' using errcode = 'P0001'; end if;
    if encode(extensions.digest(convert_to(x ->> 'contenu', 'UTF8'), 'sha256'), 'hex') <> p.empreinte then
      raise exception 'GBS_PLI_ALTERE: le contenu ne correspond pas au pli déposé' using errcode = 'P0001';
    end if;
    o := (x ->> 'contenu')::jsonb;
    if jsonb_typeof(o) <> 'object' or exists (select 1 from jsonb_object_keys(o) k where k not in ('sel','incoterm','lieu','devise','montant','fret',
         'assurance','frais_jusqu_a_bord','delai_jours','conditions_paiement','garantie_mois','cout_global','commentaire')) then
      raise exception 'GBS_PLI_ALTERE' using errcode = 'P0001';
    end if;
    if exists (select 1 from gbs.offres f where f.consultation_id = p_consultation and f.fournisseur_id = p.fournisseur_id) then
      raise exception 'GBS_OFFRE_EXISTANTE: une offre est déjà enregistrée pour ce fournisseur' using errcode = 'P0001';
    end if;
    perform set_config('gbs.rpc', 'plis', true);
    insert into gbs.offres (consultation_id, fournisseur_id, recu_le, canal, incoterm, lieu, devise, montant, fret, assurance,
                            frais_jusqu_a_bord, delai_jours, conditions_paiement, garantie_mois, cout_global, commentaire)
    values (p_consultation, p.fournisseur_id, p.depose_le, 'formulaire', o ->> 'incoterm', o ->> 'lieu', o ->> 'devise',
            (o ->> 'montant')::numeric, (o ->> 'fret')::numeric, (o ->> 'assurance')::numeric, (o ->> 'frais_jusqu_a_bord')::numeric,
            (o ->> 'delai_jours')::int, o ->> 'conditions_paiement', (o ->> 'garantie_mois')::int,
            case when jsonb_typeof(o -> 'cout_global') = 'object' then o -> 'cout_global' end, o ->> 'commentaire')
    returning id into v_offre;
    update gbs.plis set statut = 'ouvert', ouvert_le = now(), ouvert_par = auth.uid(), offre_id = v_offre where id = p.id;
    perform set_config('gbs.rpc', '', true);
    n := n + 1;
  end loop;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- Fournisseur (fonction serveur gbs-fournisseur, rôle de service)
-- -----------------------------------------------------------------------------
create or replace function gbs.formulaire_fournisseur(p_jeton text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l gbs.liens_fournisseurs; c gbs.consultations_fournisseurs; f gbs.fournisseurs; p gbs.plis;
begin
  l := gbs_private.lien_fournisseur(p_jeton, true);
  select * into c from gbs.consultations_fournisseurs where id = l.consultation_id;
  select * into f from gbs.fournisseurs where id = l.fournisseur_id;
  select * into p from gbs.plis where consultation_id = l.consultation_id and fournisseur_id = l.fournisseur_id and statut <> 'remplace';
  -- Liste blanche : ni client, ni dossier, ni autre fournisseur, ni prix.
  return jsonb_build_object(
    'consultation', jsonb_build_object('reference', c.reference, 'objet', c.objet, 'specifications', c.specifications, 'quantite', c.quantite,
      'incoterm_demande', c.incoterm_demande, 'lieu', c.lieu, 'date_limite', c.date_limite, 'fuseau', c.fuseau,
      'ouverte', c.statut = 'ouverte' and c.date_limite > now()),
    'fournisseur', f.raison_sociale_en,
    'pli', case when p.id is null then null else jsonb_build_object('depose_le', p.depose_le, 'empreinte', p.empreinte, 'complet', p.complet) end,
    'questions', coalesce((select jsonb_agg(jsonb_build_object('question', q.question, 'reponse', q.reponse, 'repondu_le', q.repondu_le,
                                  'mienne', q.fournisseur_id = l.fournisseur_id) order by q.posee_le)
                             from gbs.questions_consultation q
                            where q.consultation_id = l.consultation_id and (q.reponse is not null or q.fournisseur_id = l.fournisseur_id)), '[]'::jsonb));
end $$;

create or replace function gbs.deposer_pli(p_jeton text, p_chiffre text, p_iv text, p_empreinte text, p_complet boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l gbs.liens_fournisseurs; c gbs.consultations_fournisseurs; p gbs.plis;
begin
  l := gbs_private.lien_fournisseur(p_jeton, false);
  select * into c from gbs.consultations_fournisseurs where id = l.consultation_id for update;
  if c.statut <> 'ouverte' or c.date_limite <= now() then raise exception 'GBS_CONSULTATION_CLOSE' using errcode = 'P0001'; end if;
  if p_complet is null or p_empreinte !~ '^[0-9a-f]{64}$' then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  if (select count(*) from gbs.plis x where x.consultation_id = l.consultation_id and x.fournisseur_id = l.fournisseur_id)
     >= gbs_private.param_num('fournisseur.depots_max') then
    raise exception 'GBS_TROP_DE_DEPOTS' using errcode = 'P0001';
  end if;
  perform set_config('gbs.rpc', 'plis', true);
  update gbs.plis set statut = 'remplace', remplace_le = now()
   where consultation_id = l.consultation_id and fournisseur_id = l.fournisseur_id and statut = 'depose';
  insert into gbs.plis (consultation_id, fournisseur_id, lien_id, chiffre, iv, empreinte, complet)
  values (l.consultation_id, l.fournisseur_id, l.id, p_chiffre, p_iv, p_empreinte, p_complet)
  returning * into p;
  perform set_config('gbs.rpc', '', true);
  -- Accusé de réception : heure de dépôt et empreinte, que le fournisseur conserve.
  return jsonb_build_object('depose_le', p.depose_le, 'empreinte', p.empreinte, 'complet', p.complet, 'date_limite', c.date_limite);
end $$;

create or replace function gbs.poser_question_fournisseur(p_jeton text, p_question text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l gbs.liens_fournisseurs; c gbs.consultations_fournisseurs;
begin
  l := gbs_private.lien_fournisseur(p_jeton, false);
  select * into c from gbs.consultations_fournisseurs where id = l.consultation_id;
  if c.statut <> 'ouverte' or c.date_limite <= now() then raise exception 'GBS_CONSULTATION_CLOSE' using errcode = 'P0001'; end if;
  if p_question is null or length(trim(p_question)) not between 5 and 2000 then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  if (select count(*) from gbs.questions_consultation q where q.consultation_id = l.consultation_id and q.fournisseur_id = l.fournisseur_id)
     >= gbs_private.param_num('fournisseur.questions_max') then
    raise exception 'GBS_TROP_DE_QUESTIONS' using errcode = 'P0001';
  end if;
  perform set_config('gbs.rpc', 'plis', true);
  insert into gbs.questions_consultation (consultation_id, fournisseur_id, question) values (l.consultation_id, l.fournisseur_id, trim(p_question));
  perform set_config('gbs.rpc', '', true);
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- Droits
-- -----------------------------------------------------------------------------
alter table gbs.liens_fournisseurs enable row level security;
alter table gbs.plis enable row level security;
alter table gbs.questions_consultation enable row level security;
-- Ni empreinte du jeton, ni pli chiffré dans les colonnes lisibles.
grant select (id, consultation_id, fournisseur_id, expire_le, revoque_le, consultations, derniere_consultation, cree_le, cree_par)
  on gbs.liens_fournisseurs to authenticated;
grant select (id, consultation_id, fournisseur_id, depose_le, complet, statut, remplace_le, ouvert_le, ouvert_par, offre_id)
  on gbs.plis to authenticated;
grant select on gbs.questions_consultation to authenticated;
create policy liens_fournisseurs_lecture on gbs.liens_fournisseurs for select using (gbs_private.has_role('admin','achats_chine')
  and exists (select 1 from gbs.consultations_fournisseurs c where c.id = consultation_id and gbs_private.dossier_visible(c.dossier_id)));
create policy plis_lecture on gbs.plis for select using (gbs_private.has_role('admin','achats_chine')
  and exists (select 1 from gbs.consultations_fournisseurs c where c.id = consultation_id and gbs_private.dossier_visible(c.dossier_id)));
create policy questions_lecture on gbs.questions_consultation for select using (gbs_private.has_role('admin','achats_chine')
  and exists (select 1 from gbs.consultations_fournisseurs c where c.id = consultation_id and gbs_private.dossier_visible(c.dossier_id)));

revoke execute on function gbs.creer_lien_fournisseur(uuid, uuid), gbs.revoquer_lien_fournisseur(uuid),
  gbs.repondre_question_consultation(uuid, text), gbs.plis_a_ouvrir(uuid), gbs.ouvrir_plis(uuid, jsonb),
  gbs.formulaire_fournisseur(text), gbs.deposer_pli(text, text, text, text, boolean), gbs.poser_question_fournisseur(text, text),
  gbs_private.lien_fournisseur(text, boolean), gbs_private.trg_systeme_plis(), gbs_private.trg_pli_fige(), gbs_private.trg_consultation_limite(),
  gbs_private.trg_offre_pli(), gbs_private.trg_offre_canal() from public;
grant execute on function gbs.creer_lien_fournisseur(uuid, uuid), gbs.revoquer_lien_fournisseur(uuid),
  gbs.repondre_question_consultation(uuid, text), gbs.plis_a_ouvrir(uuid), gbs.ouvrir_plis(uuid, jsonb) to authenticated;
grant execute on function gbs.formulaire_fournisseur(text), gbs.deposer_pli(text, text, text, text, boolean),
  gbs.poser_question_fournisseur(text, text) to service_role;
grant execute on all functions in schema gbs_private to authenticated, service_role;
revoke execute on function gbs_private.lien_fournisseur(text, boolean) from authenticated;
