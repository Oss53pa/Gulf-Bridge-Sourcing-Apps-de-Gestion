-- =============================================================================
-- Lot 0 — Dossiers en mode projet (M23, simplifié) : modèles, phases, statuts,
-- pièces exigées et complétude, points bloquants, journal.
-- Cahier des charges : sections 4 bis, 5 (forfait au projet, accord-cadre), 5 bis.
-- =============================================================================

create table public.modeles_dossier (
  code            text primary key check (code ~ '^[a-z_]{3,40}$'),
  libelle         text not null check (length(libelle) <= 120),
  mode_financier  text not null check (mode_financier in ('accompagne','negoce','service_seul')),
  phases          text[] not null,
  actif           boolean not null default true
);

create table public.pieces_modele (
  modele_code text not null references public.modeles_dossier(code),
  phase       text not null,
  code        text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  libelle     text not null check (length(libelle) <= 200),
  obligatoire boolean not null default true,
  ordre       int not null default 0,
  primary key (modele_code, phase, code)
);

create table public.dossiers (
  id                  uuid primary key default gen_random_uuid(),
  reference           text unique check (reference ~ '^GBS-[0-9]{4}-[0-9]{3,5}$'),
  intitule            text not null check (length(intitule) between 2 and 200),
  societe_id          uuid not null references public.societes(id),   -- société qui contracte
  client_id           uuid not null references public.clients(id),
  modele              text not null references public.modeles_dossier(code),
  mode_financier      text not null check (mode_financier in ('accompagne','negoce','service_seul')),
  specialite          text check (specialite in ('equipement_site','approvisionnement_industriel','autre')),
  segment             text check (length(segment) <= 80),
  pays                char(2) not null check (pays ~ '^[A-Z]{2}$'),
  origine             text not null default 'direct' check (origine in ('direct','agent_pays')),
  agent_id            uuid references public.profils(id),
  chef_id             uuid references public.profils(id),
  priorite            text not null default 'normale' check (priorite in ('basse','normale','haute','critique')),
  ouvert_le           date not null default current_date,  -- date des règles datées appliquées
  date_ouverture_site date,           -- base du planning à rebours (M33)
  dates_promises      jsonb not null default '{}'::jsonb,
  -- Rémunération
  forfait_consultation_ht numeric(14,0) check (forfait_consultation_ht between 0 and 100000000),
  forfait_projet_ht   numeric(14,0) check (forfait_projet_ht >= 0),
  taux_commission_projet numeric(6,4) check (taux_commission_projet between 0 and 0.3),
  cadre_id            uuid references public.dossiers(id),  -- dossier de commande rattaché à un accord-cadre
  engagement_annuel_xof numeric(16,0) check (engagement_annuel_xof >= 0),  -- sur le dossier-cadre
  forfait_mensuel_ht  numeric(14,0) check (forfait_mensuel_ht >= 0),      -- sur le dossier-cadre
  cadre_debut         date,
  cadre_fin           date,
  lettre_credit       boolean not null default false,
  reference_domiciliation text check (length(reference_domiciliation) <= 80),
  -- Statut
  statut              text not null default 'ouvert' check (statut in ('ouvert','suspendu','clos','annule')),
  phase_courante      text,
  annule_le           timestamptz,
  clos_le             timestamptz,
  archive_le          timestamptz,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check (cadre_fin is null or cadre_debut is null or cadre_fin > cadre_debut)
);
create index on public.dossiers (societe_id);
create index on public.dossiers (client_id);

alter table public.due_diligences
  add constraint due_diligences_dossier_fk foreign key (dossier_id) references public.dossiers(id);
alter table public.registre_presentations
  add constraint registre_dossier_fk foreign key (dossier_id) references public.dossiers(id);

create table public.dossier_phases (
  id          uuid primary key default gen_random_uuid(),
  dossier_id  uuid not null references public.dossiers(id),
  phase       text not null check (phase in ('consultation','verification','mise_en_concurrence','devis_mandat',
                'contrat','approbation_technique','production','inspection','expedition','livraison','cloture')),
  ordre       int not null,
  statut      text not null default 'non_commencee'
              check (statut in ('non_commencee','en_cours','attente_tiers','bloquee','complete','validee')),
  prevue_debut date, prevue_fin date, reelle_debut date, reelle_fin date,
  responsable_id uuid references public.profils(id),
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  unique (dossier_id, phase)
);

create table public.pieces (
  id          uuid primary key default gen_random_uuid(),
  dossier_id  uuid not null references public.dossiers(id),
  phase       text not null,
  code        text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  libelle     text not null check (length(libelle) <= 200),
  obligatoire boolean not null default true,
  statut      text not null default 'manquante'
              check (statut in ('manquante','recue','a_verifier','validee','refusee','expiree')),
  fournie_par text check (fournie_par in ('client','fournisseur','equipe','transitaire')),
  document_chemin text check (length(document_chemin) <= 400),
  document_empreinte text check (document_empreinte ~ '^[0-9a-f]{64}$'),
  expire_le   date,
  commentaire text check (length(commentaire) <= 1000),
  statut_par  uuid references public.profils(id),
  statut_le   timestamptz,
  commande_id uuid,      -- pièce propre à une commande (contrat, acompte...)
  expedition_id uuid,    -- pièce propre à une expédition
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid
);
create unique index pieces_unicite on public.pieces
  (dossier_id, phase, code, coalesce(commande_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(expedition_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.points_bloquants (
  id          uuid primary key default gen_random_uuid(),
  dossier_id  uuid not null references public.dossiers(id),
  description text not null check (length(description) between 3 and 2000),
  categorie   text not null check (categorie in ('client','fournisseur','qualite','paiement','logistique','documents','interne')),
  impact_jours int check (impact_jours between 0 and 365),
  responsable_id uuid references public.profils(id),
  echeance    date not null,
  actions     text check (length(actions) <= 4000),
  resolution  text check (length(resolution) <= 4000),
  resolu_le   timestamptz,
  escalade_le timestamptz,
  visible_client boolean not null default false,
  piece_id    uuid references public.pieces(id),
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid
);

do $$
declare t text;
begin
  foreach t in array array['dossiers','dossier_phases','pieces','points_bloquants'] loop
    execute format('create trigger %1$s_touch before update on public.%1$s for each row execute function private.trg_touch()', t);
    execute format('create trigger %1$s_cree before insert on public.%1$s for each row execute function private.trg_cree_par()', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$s for each row execute function private.trg_audit()', t);
    execute format('create trigger %1$s_nodel before delete on public.%1$s for each row execute function private.trg_no_delete()', t);
  end loop;
end $$;
create trigger modeles_audit after insert or update on public.modeles_dossier for each row execute function private.trg_audit();
create trigger pieces_modele_audit after insert or update or delete on public.pieces_modele for each row execute function private.trg_audit();

-- -----------------------------------------------------------------------------
-- Règles d'ouverture d'un dossier
-- -----------------------------------------------------------------------------
create or replace function private.trg_dossier_regles() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m public.modeles_dossier; c public.clients; s public.societes; n int; an int;
begin
  select * into m from public.modeles_dossier where code = new.modele;
  select * into c from public.clients where id = new.client_id;
  select * into s from public.societes where id = new.societe_id;

  if tg_op = 'INSERT' then
    if not m.actif then raise exception 'GBS_MODELE_INACTIF' using errcode = 'P0001'; end if;
    new.mode_financier := m.mode_financier;          -- le mode découle du modèle
    new.pays := c.pays;
    new.origine := c.origine;
    new.agent_id := c.agent_id;
    if s.date_creation > new.ouvert_le then
      raise exception 'GBS_SOCIETE_NON_CREEE: % n''existe pas encore au %', s.raison_sociale, new.ouvert_le
        using errcode = 'P0001';
    end if;
    -- Référence lisible
    an := extract(year from new.ouvert_le)::int;
    perform pg_advisory_xact_lock(7312, an);
    select coalesce(max(substring(reference from '^GBS-[0-9]{4}-([0-9]+)$')::int), 0) + 1 into n
      from public.dossiers where reference like 'GBS-' || an || '-%';
    new.reference := 'GBS-' || an || '-' || lpad(n::text, 3, '0');
    new.phase_courante := m.phases[1];
  else
    if new.mode_financier is distinct from old.mode_financier or new.modele is distinct from old.modele then
      raise exception 'GBS_MODE_FIGE: le mode financier est choisi à l''ouverture et non modifiable'
        using errcode = 'P0001';
    end if;
    if new.societe_id is distinct from old.societe_id or new.client_id is distinct from old.client_id then
      raise exception 'GBS_DOSSIER_FIGE: société et client ne se modifient pas' using errcode = 'P0001';
    end if;
    if new.ouvert_le is distinct from old.ouvert_le or new.reference is distinct from old.reference then
      raise exception 'GBS_DOSSIER_FIGE: la date d''ouverture fixe les règles datées appliquées' using errcode = 'P0001';
    end if;
    if (new.statut, new.clos_le, new.annule_le) is distinct from (old.statut, old.clos_le, old.annule_le)
       and coalesce(current_setting('gbs.rpc', true), '') <> 'avancer_phase' and not private.is_admin()
       and private.role() is not null then
      raise exception 'GBS_VALIDATION_ADMIN: le statut du dossier est réservé à l''administratrice' using errcode = '42501';
    end if;
    if new.phase_courante is distinct from old.phase_courante
       and coalesce(current_setting('gbs.rpc', true), '') <> 'avancer_phase' then
      raise exception 'GBS_VALIDATION_RPC: la phase avance par avancer_phase()' using errcode = 'P0001';
    end if;
  end if;

  -- Négoce : porté par GBS Chine (section 1 bis)
  if new.mode_financier = 'negoce' and s.code <> 'GBS_CN' then
    raise exception 'GBS_NEGOCE_GBS_CHINE: le négoce est porté par GBS Chine' using errcode = 'P0001';
  end if;
  -- Vérification du client obligatoire en négoce ou avec lettre de crédit (section 5)
  if (new.mode_financier = 'negoce' or new.lettre_credit)
     and not (c.verification_statut = 'verifie'
              and c.verification_date >= new.ouvert_le - interval '1 year') then
    raise exception 'GBS_CLIENT_NON_VERIFIE: vérification du client exigée (négoce ou lettre de crédit)'
      using errcode = 'P0001';
  end if;
  -- Équipement d'un site : date d'ouverture, forfait et taux réduit obligatoires
  if new.modele = 'equipement_site' and (new.date_ouverture_site is null
       or new.forfait_projet_ht is null or new.taux_commission_projet is null) then
    raise exception 'GBS_DATE_OUVERTURE_OBLIGATOIRE: un dossier d''équipement d''un site exige la date d''ouverture, le forfait et le taux réduit'
      using errcode = 'P0001';
  end if;
  if new.modele = 'accord_cadre' and (new.cadre_debut is null or new.cadre_fin is null or new.forfait_mensuel_ht is null) then
    raise exception 'GBS_CADRE_INCOMPLET: dates et forfait mensuel exigés' using errcode = 'P0001';
  end if;
  if new.cadre_id is not null then
    if not exists (select 1 from public.dossiers k where k.id = new.cadre_id and k.modele = 'accord_cadre'
                   and k.client_id = new.client_id) then
      raise exception 'GBS_CADRE_INVALIDE' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger dossiers_regles before insert or update on public.dossiers
  for each row execute function private.trg_dossier_regles();

-- Instanciation du modèle : phases et pièces exigées.
create or replace function private.trg_dossier_instancier() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m public.modeles_dossier; i int;
        bord text;
begin
  select * into m from public.modeles_dossier where code = new.modele;
  for i in 1 .. array_length(m.phases, 1) loop
    insert into public.dossier_phases (dossier_id, phase, ordre, statut)
    values (new.id, m.phases[i], i, case when i = 1 then 'en_cours' else 'non_commencee' end);
  end loop;
  insert into public.pieces (dossier_id, phase, code, libelle, obligatoire, fournie_par)
  select new.id, pm.phase, pm.code, pm.libelle, pm.obligatoire,
         case when pm.code like 'client_%' then 'client' else 'equipe' end
  from public.pieces_modele pm where pm.modele_code = new.modele;
  -- Bordereau électronique de suivi des cargaisons du pays de destination
  if 'expedition' = any(m.phases) then
    bord := case new.pays when 'CI' then 'Bordereau de suivi des cargaisons (BSC)'
                          when 'CM' then 'Bordereau électronique de suivi des cargaisons (BESC)'
                          when 'GA' then 'Bordereau électronique de suivi des cargaisons (BIETC)'
            end;
    if bord is not null then
      insert into public.pieces (dossier_id, phase, code, libelle, obligatoire, fournie_par)
      values (new.id, 'expedition', 'bordereau_suivi', bord, true, 'transitaire')
      on conflict do nothing;
    end if;
  end if;
  if new.reference_domiciliation is null and 'devis_mandat' = any(m.phases) then
    null; -- la pièce « référence de domiciliation » vient du modèle
  end if;
  return new;
end $$;
create trigger dossiers_instancier after insert on public.dossiers
  for each row execute function private.trg_dossier_instancier();

-- Changement de statut d'une pièce : auteur et date conservés, via RPC uniquement.
create or replace function private.trg_piece_statut() returns trigger
language plpgsql as $$
begin
  if new.statut is distinct from old.statut then
    if coalesce(current_setting('gbs.rpc', true), '') not in ('statuer_piece','deposer_piece','systeme') then
      raise exception 'GBS_VALIDATION_RPC: le statut d''une pièce change par statuer_piece()' using errcode = 'P0001';
    end if;
    new.statut_par := auth.uid();
    new.statut_le := now();
  end if;
  return new;
end $$;
create trigger pieces_statut before update on public.pieces
  for each row execute function private.trg_piece_statut();

-- Complétude par phase et par dossier
create or replace view public.v_completude with (security_invoker = true) as
select p.dossier_id, p.phase,
       count(*) filter (where p.obligatoire) as obligatoires,
       count(*) filter (where p.obligatoire and p.statut = 'validee') as obligatoires_validees,
       count(*) filter (where not p.obligatoire) as facultatives,
       count(*) filter (where not p.obligatoire and p.statut = 'validee') as facultatives_validees,
       round(100.0 * count(*) filter (where p.statut = 'validee') / nullif(count(*), 0), 0) as taux
from public.pieces p
group by p.dossier_id, p.phase;
