-- =============================================================================
-- Lot 0 — Tiers : clients, contacts, fournisseurs, comptes de paiement,
-- due diligence et agrément, articles, registre des fournisseurs présentés.
-- Cahier des charges : M2, M4, M16, section 5 « Fournisseurs et clients »,
-- « Protection contre le contournement », section 8.
-- =============================================================================

create table public.clients (
  id                uuid primary key default gen_random_uuid(),
  reference         text unique check (reference ~ '^CLI-[0-9]{4,6}$'),
  societe_id        uuid not null references public.societes(id),  -- cloisonnement
  raison_sociale    text not null check (length(raison_sociale) between 2 and 200),
  pays              char(2) not null check (pays in ('CI','GA','CM') or pays ~ '^[A-Z]{2}$'),
  devise            char(3) not null check (devise in ('XOF','XAF','USD','CNY')),
  segment           text check (length(segment) <= 80),
  specialite        text check (specialite in ('equipement_site','approvisionnement_industriel','autre')),
  identifiants      jsonb not null default '{}'::jsonb,
  conditions_paiement text check (length(conditions_paiement) <= 200),
  origine           text not null default 'direct' check (origine in ('direct','agent_pays')),
  agent_id          uuid references public.profils(id),
  verification_statut text not null default 'non_verifie'
                    check (verification_statut in ('non_verifie','en_cours','verifie','refuse')),
  verification_date date,
  langue            text not null default 'fr' check (langue in ('fr','en','zh')),
  archive_le        timestamptz,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check (origine = 'direct' or agent_id is not null)
);

create table public.fournisseurs (
  id                uuid primary key default gen_random_uuid(),
  reference         text unique check (reference ~ '^FRN-[0-9]{4,6}$'),
  raison_sociale_zh text check (length(raison_sociale_zh) <= 200),
  raison_sociale_en text not null check (length(raison_sociale_en) between 2 and 200),
  uscc              text check (uscc ~ '^[0-9A-Z]{18}$'),  -- numéro de crédit social unifié
  ville             text check (length(ville) <= 80),
  categories        text[] not null default '{}',
  statut_agrement   text not null default 'candidat'
                    check (statut_agrement in ('candidat','en_evaluation','agree','sous_surveillance','suspendu','radie')),
  agree_le          date,
  agree_par         uuid references public.profils(id),
  note              numeric(4,1) check (note between 0 and 100),
  engagement_non_commission_le date,   -- engagement signé (section 5, M30)
  engagement_document text check (length(engagement_document) <= 400),
  apporte_par_client boolean not null default false,  -- inspection d'une commande externe
  archive_le        timestamptz,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid
);

create table public.contacts (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references public.clients(id),
  fournisseur_id uuid references public.fournisseurs(id),
  nom           text not null check (length(nom) between 1 and 120),
  fonction      text check (length(fonction) <= 120),
  email         text check (length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  telephone     text check (length(telephone) <= 40),
  wechat_id     text check (length(wechat_id) <= 64),
  langue        text not null default 'fr' check (langue in ('fr','en','zh')),
  archive_le    timestamptz,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check ((client_id is null) <> (fournisseur_id is null))
);

-- Comptes de paiement : utilisables seulement une fois vérifiés (contrôle à 4 yeux).
create table public.comptes_paiement (
  id              uuid primary key default gen_random_uuid(),
  fournisseur_id  uuid not null references public.fournisseurs(id),
  type            text not null check (type in ('banque','wechat_pay','alipay')),
  titulaire       text not null check (length(titulaire) between 2 and 200),
  devise          char(3) not null check (devise in ('USD','CNY')),
  banque          text check (length(banque) <= 200),
  numero          text not null check (length(numero) between 4 and 64),
  swift           text check (swift ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$'),
  titulaire_est_entreprise boolean not null default true,
  verifie         boolean not null default false,
  verification_demandee_par uuid references public.profils(id),
  verification_demandee_le  timestamptz,
  verifie_par     uuid references public.profils(id),
  verifie_le      timestamptz,
  archive_le      timestamptz,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  -- Un compte WeChat Pay ou Alipay doit appartenir à l'entreprise, jamais à un particulier.
  check (type = 'banque' or titulaire_est_entreprise)
);

-- Toute modification des coordonnées d'un compte vérifié le repasse à « non vérifié ».
create or replace function private.trg_compte_reset() returns trigger
language plpgsql as $$
begin
  if (new.titulaire, new.numero, coalesce(new.banque,''), coalesce(new.swift,''), new.type, new.devise,
      new.titulaire_est_entreprise)
     is distinct from
     (old.titulaire, old.numero, coalesce(old.banque,''), coalesce(old.swift,''), old.type, old.devise,
      old.titulaire_est_entreprise) then
    new.verifie := false;
    new.verifie_par := null;
    new.verifie_le := null;
    new.verification_demandee_par := null;
    new.verification_demandee_le := null;
  elsif new.verifie and not old.verifie
        and coalesce(current_setting('gbs.rpc', true), '') <> 'verifier_compte' then
    raise exception 'GBS_VERIFICATION_RPC: la vérification passe par verifier_compte()' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function private.trg_compte_insert() returns trigger
language plpgsql as $$
begin
  new.verifie := false; new.verifie_par := null; new.verifie_le := null;
  return new;
end $$;

-- Due diligence (M16) : grille d'évaluation, note, conclusions, validité.
create table public.due_diligences (
  id              uuid primary key default gen_random_uuid(),
  reference       text unique check (reference ~ '^DD-[0-9]{4}-[0-9]{3,5}$'),
  fournisseur_id  uuid not null references public.fournisseurs(id),
  niveau          text not null default 'standard' check (niveau in ('standard','renforcee')),
  client_id       uuid references public.clients(id),   -- vendue au client, sinon interne
  dossier_id      uuid,                                  -- FK ajoutée après création des dossiers
  grille          jsonb not null default '[]'::jsonb,     -- [{critere, poids, note(0-5), commentaire}]
  note            numeric(5,1) check (note between 0 and 100),
  conclusion      text check (length(conclusion) <= 4000),
  statut          text not null default 'en_cours' check (statut in ('en_cours','validee','refusee')),
  realisee_le     date,
  valide_jusqu_au date,
  validee_par     uuid references public.profils(id),
  prix_ht         numeric(14,0) check (prix_ht >= 0),
  devise          char(3) not null default 'XOF' check (devise in ('XOF','XAF','USD','CNY')),
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check (jsonb_typeof(grille) = 'array')
);

-- Note pondérée de la grille, sur 100.
create or replace function private.note_grille(g jsonb) returns numeric
language sql immutable as $$
  select case when coalesce(sum((e->>'poids')::numeric), 0) = 0 then null
         else round(100 * sum((e->>'poids')::numeric * (e->>'note')::numeric / 5)
                    / sum((e->>'poids')::numeric), 1) end
  from jsonb_array_elements(g) e
$$;

create or replace function private.trg_dd_note() returns trigger
language plpgsql as $$
declare e jsonb;
begin
  for e in select * from jsonb_array_elements(new.grille) loop
    if jsonb_typeof(e) <> 'object'
       or not (e ? 'critere' and e ? 'poids' and e ? 'note')
       or (e->>'note')::numeric not between 0 and 5
       or (e->>'poids')::numeric not between 0 and 100
       or length(e->>'critere') > 200
       or length(coalesce(e->>'commentaire','')) > 1000 then
      raise exception 'GBS_GRILLE_INVALIDE' using errcode = '22023';
    end if;
  end loop;
  new.note := private.note_grille(new.grille);
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(7319);
    new.reference := 'DD-' || extract(year from now())::int || '-' || lpad((
      select coalesce(max(substring(reference from '-([0-9]+)$')::int), 0) + 1 from public.due_diligences
       where reference like 'DD-' || extract(year from now())::int || '-%')::text, 3, '0');
  elsif new.reference is distinct from old.reference then
    raise exception 'GBS_DD_FIGEE' using errcode = 'P0001';
  end if;
  if new.statut = 'validee' and (tg_op = 'INSERT' or old.statut <> 'validee')
     and coalesce(current_setting('gbs.rpc', true), '') <> 'valider_due_diligence' then
    raise exception 'GBS_VALIDATION_RPC: passez par valider_due_diligence()' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Référentiel articles (lot 0) : code SH, poids, volume, marchandise dangereuse.
create table public.articles (
  id            uuid primary key default gen_random_uuid(),
  reference     text not null unique check (reference ~ '^[A-Z0-9-]{3,30}$'),
  designation   text not null check (length(designation) between 2 and 300),
  designation_zh text check (length(designation_zh) <= 300),
  categorie     text not null check (length(categorie) <= 120),
  unite         text not null default 'piece' check (unite in ('piece','lot','kg','m','m2','m3','l','jeu','carton')),
  code_sh       text not null check (code_sh ~ '^[0-9]{6}([0-9]{2,4})?$'),
  poids_kg      numeric(12,3) check (poids_kg >= 0),
  volume_m3     numeric(12,4) check (volume_m3 >= 0),
  dangereux     boolean not null default false,
  classe_danger text check (classe_danger ~ '^[1-9](\.[1-6])?$'),
  certificats   text[] not null default '{}',
  archive_le    timestamptz,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check (not dangereux or classe_danger is not null)
);

-- Registre des fournisseurs présentés : preuve de non-contournement, ni modifiable ni supprimable.
create table public.registre_presentations (
  id              bigint generated always as identity primary key,
  client_id       uuid not null references public.clients(id),
  fournisseur_id  uuid not null references public.fournisseurs(id),
  dossier_id      uuid not null,
  presente_le     timestamptz not null default now(),
  origine         text not null check (origine in ('rapport_offres','commande')),
  unique (client_id, fournisseur_id, dossier_id)
);

-- Branchements
do $$
declare t text;
begin
  foreach t in array array['clients','fournisseurs','contacts','comptes_paiement','due_diligences','articles'] loop
    execute format('create trigger %1$s_touch before update on public.%1$s for each row execute function private.trg_touch()', t);
    execute format('create trigger %1$s_cree before insert on public.%1$s for each row execute function private.trg_cree_par()', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$s for each row execute function private.trg_audit()', t);
    execute format('create trigger %1$s_nodel before delete on public.%1$s for each row execute function private.trg_no_delete()', t);
  end loop;
end $$;

create trigger comptes_reset before update on public.comptes_paiement for each row execute function private.trg_compte_reset();
create trigger comptes_insert before insert on public.comptes_paiement for each row execute function private.trg_compte_insert();
create trigger dd_note before insert or update on public.due_diligences for each row execute function private.trg_dd_note();
create trigger registre_audit after insert on public.registre_presentations for each row execute function private.trg_audit();
create trigger registre_immuable before update or delete on public.registre_presentations for each row execute function private.trg_immuable();

-- Agrément interdit sans engagement de non-commission ni due diligence valide (section 5).
create or replace function private.trg_fournisseur_agrement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.statut_agrement = 'agree' and (tg_op = 'INSERT' or old.statut_agrement <> 'agree') then
    if coalesce(current_setting('gbs.rpc', true), '') <> 'agreer_fournisseur' then
      raise exception 'GBS_VALIDATION_RPC: l''agrément passe par agreer_fournisseur()' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger fournisseurs_agrement before insert or update on public.fournisseurs
  for each row execute function private.trg_fournisseur_agrement();

-- Commande : fournisseur agréé ou due diligence validée, toujours en cours de validité,
-- engagement de non-commission signé, ni suspendu ni radié (section 5, test de recette).
create or replace function private.fournisseur_commandable(f uuid, d date default current_date)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.fournisseurs x
    where x.id = f and x.archive_le is null
      and x.statut_agrement not in ('suspendu','radie')
      and (x.apporte_par_client or (
            x.engagement_non_commission_le is not null
        and exists (select 1 from public.due_diligences dd
                    where dd.fournisseur_id = x.id and dd.statut = 'validee'
                      and dd.valide_jusqu_au >= d))))
$$;

-- Demande de cotation : uniquement aux fournisseurs agréés (et DD en cours de validité).
create or replace function private.fournisseur_consultable(f uuid, d date default current_date)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.fournisseurs x
    where x.id = f and x.archive_le is null and not x.apporte_par_client
      and x.statut_agrement in ('agree','sous_surveillance')
      and x.engagement_non_commission_le is not null
      and exists (select 1 from public.due_diligences dd
                  where dd.fournisseur_id = x.id and dd.statut = 'validee'
                    and dd.valide_jusqu_au >= d))
$$;
