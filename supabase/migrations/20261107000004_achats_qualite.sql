-- =============================================================================
-- Lot 0 — Achats et qualité : mise en concurrence (offres saisies après la date
-- limite, base FOB, comparatif simple), devis et mandat, commandes avec les deux
-- verrous, inspections avec échantillonnage ISO 2859-1, non-conformités.
-- Cahier des charges : M5, M6, M7, M8, M27, sections 4 ter, 5, 5 bis.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Ramenée à la base FOB (section 5, « Incoterms »)
-- -----------------------------------------------------------------------------
create or replace function gbs_private.base_fob(
  p_incoterm text, p_montant numeric, p_fret numeric, p_assurance numeric,
  p_frais_bord numeric, p_date date)
returns numeric language plpgsql stable security definer set search_path = '' as $$
begin
  if p_montant is null or p_montant < 0 then
    raise exception 'GBS_MONTANT_INVALIDE' using errcode = '22023';
  end if;
  case p_incoterm
    when 'FOB', 'FAS' then return p_montant;
    when 'EXW', 'FCA' then
      -- Majorée des frais jusqu'à bord : montant déclaré, à défaut barème paramétré.
      return p_montant + coalesce(p_frais_bord,
        round(p_montant * gbs_private.param_num('fob.majoration_exw_fca', p_date), 2));
    when 'CFR', 'CPT' then
      if p_fret is null then
        raise exception 'GBS_FRET_REQUIS: une offre % doit indiquer le fret', p_incoterm using errcode = 'P0001';
      end if;
      return p_montant - p_fret;
    when 'CIF', 'CIP' then
      if p_fret is null or p_assurance is null then
        raise exception 'GBS_FRET_ASSURANCE_REQUIS: une offre % doit indiquer fret et assurance', p_incoterm
          using errcode = 'P0001';
      end if;
      return p_montant - p_fret - p_assurance;
    else
      raise exception 'GBS_INCOTERM_NON_GERE: %', p_incoterm using errcode = 'P0001';
  end case;
end $$;

-- -----------------------------------------------------------------------------
-- ISO 2859-1 : échantillonnage simple, contrôle normal (tableaux 1 et 2-A)
-- -----------------------------------------------------------------------------
create or replace function gbs_private.iso2859_lettre(p_lot int, p_niveau text)
returns text language plpgsql immutable as $$
declare
  bornes int[] := array[8,15,25,50,90,150,280,500,1200,3200,10000,35000,150000,500000];
  n1 text[] := array['A','A','B','C','C','D','E','F','G','H','J','K','L','M','N'];
  n2 text[] := array['A','B','C','D','E','F','G','H','J','K','L','M','N','P','Q'];
  n3 text[] := array['B','C','D','E','F','G','H','J','K','L','M','N','P','Q','R'];
  i int := 1;
begin
  if p_lot is null or p_lot < 2 then
    raise exception 'GBS_LOT_INVALIDE: la taille du lot doit être d''au moins 2' using errcode = '22023';
  end if;
  while i <= array_length(bornes, 1) and p_lot > bornes[i] loop i := i + 1; end loop;
  return case p_niveau when 'I' then n1[i] when 'II' then n2[i] when 'III' then n3[i]
         else null end;
end $$;

-- Plan pour un niveau de qualité acceptable (NQA). NQA = 0 : tolérance zéro
-- (Ac 0, Re 1) sur l'échantillon de la lettre-code.
create or replace function gbs_private.iso2859_plan(p_lot int, p_niveau text, p_nqa numeric)
returns jsonb language plpgsql immutable as $$
declare
  lettres text[] := array['A','B','C','D','E','F','G','H','J','K','L','M','N','P','Q','R'];
  tailles int[]  := array[2,3,5,8,13,20,32,50,80,125,200,315,500,800,1250,2000];
  nqas numeric[] := array[0.010,0.015,0.025,0.040,0.065,0.10,0.15,0.25,0.40,0.65,1.0,1.5,2.5,4.0,6.5];
  -- Diagonales du tableau 2-A : d = indice lettre + indice NQA (base 0)
  ac int[] := array[0,1,2,3,5,7,10,14,21];   -- d = 14, 17, 18, ..., 24
  l text; s int; a int; d int; n int; k int;
begin
  l := gbs_private.iso2859_lettre(p_lot, p_niveau);
  if l is null then raise exception 'GBS_NIVEAU_INVALIDE: %', p_niveau using errcode = '22023'; end if;
  s := array_position(lettres, l) - 1;
  if p_nqa = 0 then
    n := least(tailles[s + 1], p_lot);
    return jsonb_build_object('lettre', l, 'n', n, 'ac', 0, 're', 1, 'controle_total', n >= p_lot);
  end if;
  a := array_position(nqas, p_nqa) - 1;
  if a is null or a < 4 then
    raise exception 'GBS_NQA_NON_GERE: % (valeurs : 0, 0.065 à 6.5)', p_nqa using errcode = '22023';
  end if;
  d := s + a;
  -- Flèches : on suit la flèche jusqu'au premier plan, avec son effectif d'échantillon.
  if d < 14 then s := 14 - a; d := 14;           -- flèche vers le bas
  elsif d = 15 then s := s - 1; d := 14;          -- flèche vers le haut
  elsif d = 16 then s := s + 1; d := 17;          -- flèche vers le bas
  elsif d > 24 then s := 24 - a; d := 24;         -- flèche vers le haut
  end if;
  k := case when d = 14 then 1 else d - 15 end;   -- 14 -> 0/1, 17 -> 1/2, ..., 24 -> 21/22
  n := tailles[s + 1];
  if n >= p_lot then
    -- Effectif supérieur ou égal au lot : contrôle à 100 %.
    return jsonb_build_object('lettre', lettres[s + 1], 'n', p_lot, 'ac', ac[k], 're', ac[k] + 1,
                              'controle_total', true);
  end if;
  return jsonb_build_object('lettre', lettres[s + 1], 'n', n, 'ac', ac[k], 're', ac[k] + 1,
                            'controle_total', false);
end $$;

-- Exposé aux écrans : calcul pur, sans données.
create or replace function gbs.plan_echantillonnage(p_lot int, p_niveau text default 'II',
  p_nqa_critique numeric default 0, p_nqa_majeur numeric default 2.5, p_nqa_mineur numeric default 4.0)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'critique', gbs_private.iso2859_plan(p_lot, p_niveau, p_nqa_critique),
    'majeur',   gbs_private.iso2859_plan(p_lot, p_niveau, p_nqa_majeur),
    'mineur',   gbs_private.iso2859_plan(p_lot, p_niveau, p_nqa_mineur))
$$;

-- -----------------------------------------------------------------------------
-- Consultation des fournisseurs et offres
-- -----------------------------------------------------------------------------
create table gbs.consultations_fournisseurs (
  id              uuid primary key default gen_random_uuid(),
  dossier_id      uuid not null references gbs.dossiers(id),
  reference       text unique check (reference ~ '^RFQ-[0-9]{4}-[0-9]{3,5}$'),
  objet           text not null check (length(objet) between 2 and 300),
  specifications  text check (length(specifications) <= 20000),
  quantite        numeric(14,3) check (quantite > 0),
  incoterm_demande text not null default 'FOB' check (incoterm_demande in ('EXW','FCA','FAS','FOB','CFR','CPT','CIF','CIP')),
  lieu            text check (length(lieu) <= 120),
  date_limite     timestamptz not null,
  fuseau          text not null default 'Asia/Shanghai' check (length(fuseau) <= 64),
  statut          text not null default 'ouverte' check (statut in ('ouverte','close','attribuee','annulee')),
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid
);

create table gbs.consultation_invites (
  consultation_id uuid not null references gbs.consultations_fournisseurs(id),
  fournisseur_id  uuid not null references gbs.fournisseurs(id),
  invite_le       timestamptz not null default now(),
  invite_par      uuid,
  primary key (consultation_id, fournisseur_id)
);

create table gbs.offres (
  id              uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references gbs.consultations_fournisseurs(id),
  fournisseur_id  uuid not null references gbs.fournisseurs(id),
  dossier_id      uuid not null references gbs.dossiers(id),
  recu_le         timestamptz not null,
  canal           text not null check (canal in ('wechat','email','formulaire','autre')),
  incoterm        text not null check (incoterm in ('EXW','FCA','FAS','FOB','CFR','CPT','CIF','CIP')),
  incoterms_version text not null default '2020' check (incoterms_version in ('2010','2020')),
  lieu            text not null check (length(lieu) between 2 and 120),
  devise          char(3) not null check (devise in ('USD','CNY','XOF','XAF')),
  montant         numeric(16,2) not null check (montant >= 0),
  fret            numeric(16,2) check (fret >= 0),
  assurance       numeric(16,2) check (assurance >= 0),
  frais_jusqu_a_bord numeric(16,2) check (frais_jusqu_a_bord >= 0),
  fob_montant     numeric(16,2),
  fob_xof         numeric(16,0),
  delai_jours     int check (delai_jours between 0 and 730),
  conditions_paiement text check (length(conditions_paiement) <= 200),
  garantie_mois   int check (garantie_mois between 0 and 240),
  note_technique  numeric(3,1) check (note_technique between 0 and 5),
  cout_global     jsonb,            -- données de coût global (lot 1)
  commentaire     text check (length(commentaire) <= 2000),
  retenue         boolean not null default false,
  sur_mesure      boolean not null default false,
  reassort        boolean not null default false,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  unique (consultation_id, fournisseur_id)
);

create or replace function gbs_private.trg_invite() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not gbs_private.fournisseur_consultable(new.fournisseur_id) then
    raise exception 'GBS_FOURNISSEUR_NON_AGREE: une demande de cotation ne part qu''à un fournisseur agréé'
      using errcode = 'P0001';
  end if;
  new.invite_par := auth.uid();
  return new;
end $$;
create trigger invites_regles before insert on gbs.consultation_invites
  for each row execute function gbs_private.trg_invite();
create trigger invites_audit after insert or update or delete on gbs.consultation_invites
  for each row execute function gbs_private.trg_audit();

create or replace function gbs_private.trg_offre() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c gbs.consultations_fournisseurs;
begin
  select * into c from gbs.consultations_fournisseurs where id = new.consultation_id;
  new.dossier_id := c.dossier_id;
  if tg_op = 'INSERT' then
    if not exists (select 1 from gbs.consultation_invites i
                   where i.consultation_id = new.consultation_id and i.fournisseur_id = new.fournisseur_id) then
      raise exception 'GBS_FOURNISSEUR_NON_INVITE' using errcode = 'P0001';
    end if;
    -- Lot 0 : les offres ne sont enregistrées qu'après la date limite (plis fermés).
    if now() < c.date_limite then
      raise exception 'GBS_PLI_FERME: les offres s''enregistrent après la date limite (%)', c.date_limite
        using errcode = 'P0001';
    end if;
  end if;
  if new.recu_le > now() then
    raise exception 'GBS_DATE_RECEPTION_FUTURE' using errcode = '22023';
  end if;
  new.fob_montant := gbs_private.base_fob(new.incoterm, new.montant, new.fret, new.assurance,
                                      new.frais_jusqu_a_bord, new.recu_le::date);
  new.fob_xof := round(gbs_private.to_xof(new.fob_montant, new.devise, new.recu_le::date));
  return new;
end $$;
create trigger offres_regles before insert or update on gbs.offres
  for each row execute function gbs_private.trg_offre();

-- Comparatif simple : offres ramenées à la base FOB en XOF, rang et alertes.
create or replace view gbs.v_comparatif_offres with (security_invoker = true) as
with med as (
  select consultation_id, percentile_cont(0.5) within group (order by fob_xof) as mediane
  from gbs.offres group by consultation_id
), o as (
  select o.*, med.mediane from gbs.offres o join med using (consultation_id)
)
select o.id, o.consultation_id, o.dossier_id, o.fournisseur_id, o.incoterm, o.devise, o.montant,
       o.fob_montant, o.fob_xof, o.delai_jours, o.garantie_mois, o.note_technique, o.retenue,
       rank() over (partition by o.consultation_id order by o.fob_xof) as rang_prix,
       o.fob_xof < o.mediane * coalesce((select (valeur #>> '{}')::numeric from gbs.parametres
                                          where cle = 'offre.seuil_anormalement_basse'
                                          order by date_effet desc limit 1), 0.7)
         as anormalement_basse,
       o.cout_global is null as cout_global_manquant
from o;

-- -----------------------------------------------------------------------------
-- Devis client et mandat (M6)
-- -----------------------------------------------------------------------------
create table gbs.devis (
  id              uuid primary key default gen_random_uuid(),
  dossier_id      uuid not null references gbs.dossiers(id),
  version         int not null default 1 check (version between 1 and 99),
  reference       text unique check (reference ~ '^DEV-[0-9]{4}-[0-9]{3,5}-V[0-9]{1,2}$'),
  incoterm        text not null default 'FOB' check (incoterm in ('FOB','FCA','CFR','CIF','EXW','DDP')),
  lieu            text check (length(lieu) <= 120),
  langue          text not null default 'fr' check (langue in ('fr','en')),
  statut          text not null default 'brouillon' check (statut in ('brouillon','envoye','accepte','refuse','remplace')),
  -- Deux inspections prévues par défaut ; seule la première peut faire l'objet d'une renonciation écrite.
  jours_inspection_production int not null default 1 check (jours_inspection_production between 0 and 60),
  jours_inspection_expedition int not null default 1 check (jours_inspection_expedition between 1 and 60),
  renonciation_inspection_production text check (length(renonciation_inspection_production) <= 400),
  calcul          jsonb,           -- instantané du calcul de commission
  commission_ht   numeric(16,0),
  accepte_le      date,
  mandat_document text check (length(mandat_document) <= 400),
  mandat_valide_par uuid references gbs.profils(id),
  mandat_valide_le timestamptz,
  derogation_incoterm text check (length(derogation_incoterm) <= 1000),
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  unique (dossier_id, version),
  check (jours_inspection_production > 0 or renonciation_inspection_production is not null)
);

-- EXW et DDP bloqués sauf dérogation motivée de l'administratrice.
create or replace function gbs_private.trg_devis() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d gbs.dossiers;
begin
  select * into d from gbs.dossiers where id = new.dossier_id;
  if tg_op = 'INSERT' then
    new.reference := 'DEV-' || substring(d.reference from 5) || '-V' || new.version;
  end if;
  if new.incoterm in ('EXW','DDP') and new.derogation_incoterm is null then
    raise exception 'GBS_INCOTERM_BLOQUE: % exige une dérogation motivée de l''administratrice', new.incoterm
      using errcode = 'P0001';
  end if;
  if new.derogation_incoterm is not null and (tg_op = 'INSERT' or old.derogation_incoterm is null)
     and not gbs_private.is_admin() then
    raise exception 'GBS_DEROGATION_ADMIN' using errcode = '42501';
  end if;
  if new.statut in ('accepte','remplace') and (tg_op = 'INSERT' or new.statut <> old.statut)
     and coalesce(current_setting('gbs.rpc', true), '') <> 'valider_mandat' then
    raise exception 'GBS_VALIDATION_RPC: un devis est accepté par valider_mandat()' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and (new.dossier_id, new.version, new.reference) is distinct from (old.dossier_id, old.version, old.reference) then
    raise exception 'GBS_DEVIS_FIGE' using errcode = 'P0001';
  end if;
  if (new.calcul, new.commission_ht, new.accepte_le) is distinct from
     (case when tg_op = 'UPDATE' then old.calcul end, case when tg_op = 'UPDATE' then old.commission_ht end,
      case when tg_op = 'UPDATE' then old.accepte_le end)
     and coalesce(current_setting('gbs.rpc', true), '') not in ('valider_mandat','calculer_devis') then
    raise exception 'GBS_MONTANTS_CALCULES: le calcul du devis vient de calculer_devis()' using errcode = 'P0001';
  end if;
  if (new.mandat_valide_le is distinct from (case when tg_op = 'UPDATE' then old.mandat_valide_le end))
     and coalesce(current_setting('gbs.rpc', true), '') <> 'valider_mandat' then
    raise exception 'GBS_VALIDATION_RPC: le mandat est validé par valider_mandat()' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and old.mandat_valide_le is not null and
     (new.calcul, new.commission_ht, new.incoterm, new.jours_inspection_production, new.jours_inspection_expedition)
     is distinct from
     (old.calcul, old.commission_ht, old.incoterm, old.jours_inspection_production, old.jours_inspection_expedition) then
    raise exception 'GBS_DOCUMENT_SIGNE: un devis signé ne se modifie pas ; créez une nouvelle version'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger devis_regles before insert or update on gbs.devis
  for each row execute function gbs_private.trg_devis();

-- -----------------------------------------------------------------------------
-- Commandes fournisseurs (M7) : entité centrale où s'appliquent les verrous
-- -----------------------------------------------------------------------------
create table gbs.commandes (
  id              uuid primary key default gen_random_uuid(),
  reference       text unique check (reference ~ '^CMD-[0-9]{4}-[0-9]{3,5}-[0-9]{2}$'),
  dossier_id      uuid not null references gbs.dossiers(id),
  fournisseur_id  uuid not null references gbs.fournisseurs(id),
  offre_id        uuid references gbs.offres(id),
  incoterm        text not null check (incoterm in ('EXW','FCA','FAS','FOB','CFR','CPT','CIF','CIP','DDP')),
  incoterms_version text not null default '2020' check (incoterms_version in ('2010','2020')),
  lieu            text not null check (length(lieu) between 2 and 120),
  devise          char(3) not null check (devise in ('USD','CNY')),
  montant_marchandise numeric(16,2) not null default 0 check (montant_marchandise >= 0),
  fret            numeric(16,2) check (fret >= 0),
  assurance       numeric(16,2) check (assurance >= 0),
  frais_jusqu_a_bord numeric(16,2) check (frais_jusqu_a_bord >= 0),
  fob_montant     numeric(16,2),
  sur_mesure      boolean not null default false,
  transfert_risque text check (length(transfert_risque) <= 200),
  date_livraison_promise date,
  penalite_taux_jour numeric(6,4) check (penalite_taux_jour between 0 and 0.05),
  penalite_plafond numeric(6,4) check (penalite_plafond between 0 and 0.5),
  statut          text not null default 'brouillon'
                  check (statut in ('brouillon','contrat_signe','en_production','production_terminee','expediee','livree','annulee')),
  contrat_document text check (length(contrat_document) <= 400),
  contrat_mode    text check (contrat_mode in ('electronique','cachet')),
  contrat_signe_le date,
  contrat_valide_par uuid references gbs.profils(id),
  contrat_valide_le timestamptz,
  approbation_document text check (length(approbation_document) <= 400),
  approbation_valide_par uuid references gbs.profils(id),
  approbation_valide_le timestamptz,
  derogation_incoterm text check (length(derogation_incoterm) <= 1000),
  annule_le       timestamptz,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid
);
create index on gbs.commandes (dossier_id);

create table gbs.lignes_commande (
  id            uuid primary key default gen_random_uuid(),
  commande_id   uuid not null references gbs.commandes(id),
  dossier_id    uuid not null references gbs.dossiers(id),
  article_id    uuid not null references gbs.articles(id),
  quantite      numeric(14,3) not null check (quantite > 0),
  prix_unitaire numeric(16,4) not null check (prix_unitaire >= 0),
  montant       numeric(16,2) generated always as (round(quantite * prix_unitaire, 2)) stored,
  sur_mesure    boolean not null default false,
  reassort      boolean not null default false,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid
);

-- Dérogations aux verrous : réservées à l'administratrice, motif obligatoire.
create table gbs.derogations (
  id          uuid primary key default gen_random_uuid(),
  dossier_id  uuid not null references gbs.dossiers(id),
  commande_id uuid references gbs.commandes(id),
  expedition_id uuid,
  objet       text not null check (objet in ('verrou_inspection','commission_impayee','piece_obligatoire',
                                             'incoterm','bordereau_suivi','marchandise_dangereuse','marge_sous_seuil')),
  motif       text not null check (length(motif) between 5 and 1000),
  accordee_par uuid not null references gbs.profils(id),
  accordee_le timestamptz not null default now()
);
create trigger derogations_audit after insert on gbs.derogations for each row execute function gbs_private.trg_audit();
create trigger derogations_immuable before update or delete on gbs.derogations for each row execute function gbs_private.trg_immuable();

-- -----------------------------------------------------------------------------
-- Inspections (M8) et non-conformités (M27)
-- -----------------------------------------------------------------------------
create table gbs.inspections (
  id              uuid primary key default gen_random_uuid(),
  reference       text unique check (reference ~ '^INS-[0-9]{4}-[0-9]{3,5}$'),
  dossier_id      uuid not null references gbs.dossiers(id),
  commande_id     uuid references gbs.commandes(id),
  type            text not null check (type in ('en_production','avant_expedition','contre_inspection','inspection_seule')),
  inspecteur_id   uuid references gbs.profils(id),
  date_prevue     date,
  date_realisee   date,
  lieu            text check (length(lieu) <= 200),
  produit         text check (length(produit) <= 300),
  taille_lot      int not null check (taille_lot between 2 and 10000000),
  niveau          text not null default 'II' check (niveau in ('I','II','III')),
  nqa_critique    numeric(6,3) not null default 0,
  nqa_majeur      numeric(6,3) not null default 2.5,
  nqa_mineur      numeric(6,3) not null default 4.0,
  plan            jsonb,
  defauts_critiques int not null default 0 check (defauts_critiques >= 0),
  defauts_majeurs   int not null default 0 check (defauts_majeurs >= 0),
  defauts_mineurs   int not null default 0 check (defauts_mineurs >= 0),
  decision_proposee text check (decision_proposee in ('acceptee','refusee')),
  decision        text check (decision in ('liberation','refus')),
  statut          text not null default 'planifiee' check (statut in ('planifiee','realisee','validee','refusee')),
  validee_par     uuid references gbs.profils(id),
  validee_le      timestamptz,
  conclusion      text check (length(conclusion) <= 4000),
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check (commande_id is not null or type = 'inspection_seule')
);

create table gbs.constats (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references gbs.inspections(id),
  dossier_id    uuid not null references gbs.dossiers(id),
  ordre         int not null default 0,
  point         text not null check (length(point) between 2 and 300),
  exigence      text check (length(exigence) <= 500),
  mesure        text check (length(mesure) <= 200),
  resultat      text not null default 'na' check (resultat in ('conforme','nc','na')),
  gravite       text check (gravite in ('critique','majeur','mineur')),
  nombre        int not null default 0 check (nombre >= 0),
  photos        text[] not null default '{}',
  commentaire   text check (length(commentaire) <= 2000),
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check (resultat <> 'nc' or gravite is not null),
  check (cardinality(photos) <= 500)
);

create table gbs.non_conformites (
  id            uuid primary key default gen_random_uuid(),
  reference     text unique check (reference ~ '^NC-[0-9]{4}-[0-9]{3,5}$'),
  dossier_id    uuid not null references gbs.dossiers(id),
  inspection_id uuid references gbs.inspections(id),
  commande_id   uuid references gbs.commandes(id),
  gravite       text not null check (gravite in ('critique','majeur','mineur')),
  description   text not null check (length(description) between 3 and 4000),
  correction    text check (length(correction) <= 4000),
  delai         date,
  statut        text not null default 'ouverte' check (statut in ('ouverte','corrigee','close')),
  close_le      timestamptz,
  close_par     uuid references gbs.profils(id),
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid
);

-- Plan et décision proposée recalculés à chaque saisie.
create or replace function gbs_private.trg_inspection() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p jsonb; n int;
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(7313);
    select coalesce(max(substring(reference from '-([0-9]+)$')::int), 0) + 1 into n
      from gbs.inspections where reference like 'INS-' || extract(year from now())::int || '-%';
    new.reference := 'INS-' || extract(year from now())::int || '-' || lpad(n::text, 3, '0');
    if new.commande_id is not null then
      select c.dossier_id into new.dossier_id from gbs.commandes c where c.id = new.commande_id;
    end if;
  end if;
  p := gbs.plan_echantillonnage(new.taille_lot, new.niveau, new.nqa_critique, new.nqa_majeur, new.nqa_mineur);
  new.plan := p;
  new.decision_proposee := case
    when new.defauts_critiques <= (p #>> '{critique,ac}')::int
     and new.defauts_majeurs   <= (p #>> '{majeur,ac}')::int
     and new.defauts_mineurs   <= (p #>> '{mineur,ac}')::int then 'acceptee' else 'refusee' end;
  if new.statut in ('validee','refusee') and (tg_op = 'INSERT' or old.statut not in ('validee','refusee'))
     and coalesce(current_setting('gbs.rpc', true), '') <> 'valider_inspection' then
    raise exception 'GBS_VALIDATION_RPC: l''inspection est validée par valider_inspection()' using errcode = 'P0001';
  end if;
  if (new.decision, new.validee_par, new.validee_le) is distinct from
     (case when tg_op = 'UPDATE' then old.decision end, case when tg_op = 'UPDATE' then old.validee_par end,
      case when tg_op = 'UPDATE' then old.validee_le end)
     and coalesce(current_setting('gbs.rpc', true), '') <> 'valider_inspection' then
    raise exception 'GBS_VALIDATION_RPC: la décision est prise par valider_inspection()' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and old.statut in ('validee','refusee')
     and coalesce(current_setting('gbs.rpc', true), '') <> 'valider_inspection' then
    raise exception 'GBS_DOCUMENT_VALIDE: une inspection validée ne se modifie plus' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger inspections_regles before insert or update on gbs.inspections
  for each row execute function gbs_private.trg_inspection();

create or replace function gbs_private.trg_constat() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select i.dossier_id into new.dossier_id from gbs.inspections i where i.id = new.inspection_id;
  if exists (select 1 from gbs.inspections i where i.id = new.inspection_id and i.statut in ('validee','refusee')) then
    raise exception 'GBS_DOCUMENT_VALIDE: inspection close' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger constats_regles before insert or update on gbs.constats
  for each row execute function gbs_private.trg_constat();

create or replace function gbs_private.trg_nc() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(7314);
    select coalesce(max(substring(reference from '-([0-9]+)$')::int), 0) + 1 into n
      from gbs.non_conformites where reference like 'NC-' || extract(year from now())::int || '-%';
    new.reference := 'NC-' || extract(year from now())::int || '-' || lpad(n::text, 3, '0');
    if new.inspection_id is not null then
      select i.dossier_id, i.commande_id into new.dossier_id, new.commande_id
        from gbs.inspections i where i.id = new.inspection_id;
    end if;
  end if;
  if new.statut = 'close' and (tg_op = 'INSERT' or old.statut <> 'close') then
    new.close_le := now(); new.close_par := auth.uid();
  end if;
  return new;
end $$;
create trigger nc_regles before insert or update on gbs.non_conformites
  for each row execute function gbs_private.trg_nc();

do $$
declare t text;
begin
  foreach t in array array['consultations_fournisseurs','offres','devis','commandes','lignes_commande',
                           'inspections','constats','non_conformites'] loop
    execute format('create trigger %1$s_touch before update on gbs.%1$s for each row execute function gbs_private.trg_touch()', t);
    execute format('create trigger %1$s_cree before insert on gbs.%1$s for each row execute function gbs_private.trg_cree_par()', t);
    execute format('create trigger %1$s_audit after insert or update or delete on gbs.%1$s for each row execute function gbs_private.trg_audit()', t);
    execute format('create trigger %1$s_nodel before delete on gbs.%1$s for each row execute function gbs_private.trg_no_delete()', t);
  end loop;
end $$;

create or replace function gbs_private.trg_consultation_ref() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int; an int := extract(year from now())::int;
begin
  perform pg_advisory_xact_lock(7315);
  select coalesce(max(substring(reference from '-([0-9]+)$')::int), 0) + 1 into n
    from gbs.consultations_fournisseurs where reference like 'RFQ-' || an || '-%';
  new.reference := 'RFQ-' || an || '-' || lpad(n::text, 3, '0');
  return new;
end $$;
create trigger consultations_ref before insert on gbs.consultations_fournisseurs
  for each row execute function gbs_private.trg_consultation_ref();
