-- =============================================================================
-- Lot 0 — Finance : factures par société (FNE pour GBS Côte d'Ivoire), quatre
-- devises ISO, retenues à la source, TVA paramétrée, encaissements, ordres de
-- paiement fournisseurs avec contrôle à quatre yeux, partage de la valeur et
-- relevé des flux entre sociétés.
-- Cahier des charges : M11, M12, M21, M36, sections 1 bis, 5, 5 bis, 5 ter, 8.
-- =============================================================================

create table public.factures (
  id              uuid primary key default gen_random_uuid(),
  numero          text unique check (length(numero) <= 40),
  societe_id      uuid not null references public.societes(id),          -- émettrice
  client_id       uuid references public.clients(id),
  societe_dest_id uuid references public.societes(id),                   -- facture intragroupe
  dossier_id      uuid references public.dossiers(id),
  type            text not null check (type in ('forfait_consultation','forfait_projet','commission','accord_cadre',
                    'installation','due_diligence','controle_qualite','inspection','logistique','visite_usines',
                    'negoce','intragroupe','avoir')),
  tranche         int check (tranche in (1,2)),                  -- commission : 50 % / 50 %
  objet           text not null check (length(objet) between 2 and 300),
  devise          char(3) not null check (devise in ('XOF','XAF','USD','CNY')),
  langue          text not null default 'fr' check (langue in ('fr','en','zh')),
  date_emission   date,
  echeance        date,
  montant_ht      numeric(16,2) not null default 0,
  tva_taux        numeric(6,4) not null default 0 check (tva_taux between 0 and 0.5),
  tva             numeric(16,2) not null default 0,
  retenue_taux    numeric(6,4) not null default 0 check (retenue_taux between 0 and 0.5),
  retenue         numeric(16,2) not null default 0,
  ttc             numeric(16,2) not null default 0,
  net_a_payer     numeric(16,2) not null default 0,
  prix_apres_retenue boolean not null default false,  -- la facture indique si le prix s'entend avant ou après retenue
  marge_ht        numeric(16,2) check (marge_ht >= 0),  -- négoce : marge, base du partage
  avoir_de        uuid references public.factures(id),
  statut          text not null default 'brouillon'
                  check (statut in ('brouillon','en_attente_fne','emise','partiellement_payee','payee','annulee')),
  fne_requise     boolean not null default false,
  fne_numero      text check (length(fne_numero) <= 60),
  fne_qr          text check (length(fne_qr) <= 2000),
  fne_certifiee_le timestamptz,
  encaisse        numeric(16,2) not null default 0,
  attestation_retenue text check (length(attestation_retenue) <= 400),
  recapitulatif   jsonb,          -- forfait au projet : total, déjà facturé, déjà encaissé, reste dû
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check ((client_id is null) <> (societe_dest_id is null)),
  check (type <> 'negoce' or marge_ht is not null),
  -- Une facture FNE ne part pas au client sans numéro ni QR code de la DGI.
  check (not fne_requise or statut in ('brouillon','en_attente_fne','annulee')
         or (fne_numero is not null and fne_qr is not null))
);
create index on public.factures (societe_id, statut);
create index on public.factures (dossier_id);

create table public.lignes_facture (
  id            uuid primary key default gen_random_uuid(),
  facture_id    uuid not null references public.factures(id),
  libelle       text not null check (length(libelle) between 1 and 300),
  service       text check (service in ('S1','S2','S2bis','S3','S4','S5','S6','S7','S8','S9','S10','IG')),
  dossier_ref   uuid references public.dossiers(id),
  quantite      numeric(14,3) not null default 1 check (quantite > 0),
  prix_unitaire numeric(16,2) not null,
  montant       numeric(16,2) generated always as (round(quantite * prix_unitaire, 2)) stored,
  ordre         int not null default 0,
  cree_le timestamptz not null default now(), cree_par uuid
);

create table public.encaissements (
  id          uuid primary key default gen_random_uuid(),
  facture_id  uuid not null references public.factures(id),
  montant     numeric(16,2) not null check (montant > 0),
  devise      char(3) not null check (devise in ('XOF','XAF','USD','CNY')),
  taux_xof    numeric(18,8),
  montant_xof numeric(16,0),
  recu_le     date not null,
  mode        text not null check (mode in ('virement','lettre_credit','cheque','especes','mobile')),
  reference   text check (length(reference) <= 80),
  justificatif text check (length(justificatif) <= 400),
  cree_le timestamptz not null default now(), cree_par uuid
);

create table public.paiements_fournisseurs (
  id            uuid primary key default gen_random_uuid(),
  reference     text unique check (reference ~ '^PAY-[0-9]{4}-[0-9]{3,5}$'),
  commande_id   uuid not null references public.commandes(id),
  dossier_id    uuid not null references public.dossiers(id),
  nature        text not null check (nature in ('acompte','solde','echantillon','frais')),
  flux          text not null check (flux in ('gbs','instruction_client')),
  canal         text not null check (canal in ('virement','wechat_pay','alipay','lettre_credit')),
  compte_id     uuid not null references public.comptes_paiement(id),
  montant       numeric(16,2) not null check (montant > 0),
  devise        char(3) not null check (devise in ('USD','CNY')),
  statut        text not null default 'prepare'
                check (statut in ('prepare','valide','execute','confirme_client','refuse')),
  prepare_par   uuid not null default auth.uid() references public.profils(id),
  prepare_le    timestamptz not null default now(),
  valide_par    uuid references public.profils(id),
  valide_le     timestamptz,
  execute_le    timestamptz,
  reference_transaction text check (length(reference_transaction) <= 80),
  justificatif  text check (length(justificatif) <= 400),
  motif_refus   text check (length(motif_refus) <= 1000),
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check (valide_par is null or valide_par <> prepare_par),
  check (canal not in ('wechat_pay','alipay') or (devise = 'CNY' and flux = 'gbs'))
);

create table public.partages (
  id            uuid primary key default gen_random_uuid(),
  encaissement_id uuid not null references public.encaissements(id),
  facture_id    uuid not null references public.factures(id),
  dossier_id    uuid references public.dossiers(id),
  du_par        text not null check (du_par in ('GBS_CN','GBS_CI')),
  du_a          text not null check (du_a in ('GBS_CN','GBS_CI','agent')),
  agent_id      uuid references public.profils(id),
  base_xof      numeric(16,0) not null,
  taux          numeric(6,4) not null,
  montant_xof   numeric(16,0) not null,
  regle         text not null check (length(regle) <= 80),
  regle_date_effet date not null,
  mois          date not null,                     -- premier jour du mois de l'encaissement
  cree_le       timestamptz not null default now()
);
create index on public.partages (mois);

create table public.releves_valides (
  mois          date primary key,
  valide_par    uuid not null references public.profils(id),
  valide_le     timestamptz not null default now(),
  total_ci_vers_cn numeric(16,0) not null,
  total_cn_vers_ci numeric(16,0) not null,
  total_agents  numeric(16,0) not null
);

-- -----------------------------------------------------------------------------
-- Société qui facture (section 5, « Facturation et paiements »)
-- -----------------------------------------------------------------------------
create or replace function private.societe_facturante(p_client_pays text, p_type text, p_date date)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p_date < (select date_creation from public.societes where code = 'GBS_CN') then 'GBS_CI'
    when p_client_pays = 'CI' and p_type in ('forfait_consultation','forfait_projet','commission',
                                             'accord_cadre','installation') then 'GBS_CI'
    else 'GBS_CN'
  end
$$;

-- TVA : paramètre daté par société émettrice et par type de service.
create or replace function private.tva_taux(p_societe text, p_type text, p_date date)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((private.param('tva.' || p_societe || '.' || p_type, p_date) #>> '{}')::numeric,
                  (private.param('tva.' || p_societe, p_date) #>> '{}')::numeric, 0)
$$;

create or replace function private.recalcul_facture(f uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.factures; ht numeric; prev text := coalesce(current_setting('gbs.rpc', true), '');
begin
  select * into x from public.factures where id = f;
  select coalesce(sum(montant), 0) into ht from public.lignes_facture where facture_id = f;
  perform set_config('gbs.rpc', 'recalcul_facture', true);
  update public.factures set
    montant_ht = ht,
    tva = round(ht * x.tva_taux, case when x.devise in ('XOF','XAF') then 0 else 2 end),
    retenue = round(ht * x.retenue_taux, case when x.devise in ('XOF','XAF') then 0 else 2 end),
    ttc = ht + round(ht * x.tva_taux, case when x.devise in ('XOF','XAF') then 0 else 2 end),
    net_a_payer = ht + round(ht * x.tva_taux, case when x.devise in ('XOF','XAF') then 0 else 2 end)
                     - round(ht * x.retenue_taux, case when x.devise in ('XOF','XAF') then 0 else 2 end)
  where id = f;
  perform set_config('gbs.rpc', prev, true);
end $$;

create or replace function private.trg_facture() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.societes; c public.clients; dst public.societes; attendue text; d date;
        rpc text := coalesce(current_setting('gbs.rpc', true), '');
begin
  select * into s from public.societes where id = new.societe_id;
  if tg_op = 'INSERT' then
    d := coalesce(new.date_emission, current_date);
    if s.date_creation > d then
      raise exception 'GBS_SOCIETE_NON_CREEE' using errcode = 'P0001';
    end if;
    new.statut := 'brouillon'; new.numero := null; new.encaisse := 0; new.date_emission := null;
    new.montant_ht := 0; new.tva := 0; new.retenue := 0; new.ttc := 0; new.net_a_payer := 0;
    if coalesce(current_setting('gbs.rpc', true), '') <> 'facturer_echeance' then new.recapitulatif := null; end if;
    new.fne_numero := null; new.fne_qr := null; new.fne_certifiee_le := null;
    if new.client_id is not null then
      select * into c from public.clients where id = new.client_id;
      if new.type = 'intragroupe' then raise exception 'GBS_TYPE_INVALIDE' using errcode = 'P0001'; end if;
      if new.dossier_id is not null and not exists
         (select 1 from public.dossiers x where x.id = new.dossier_id and x.client_id = new.client_id) then
        raise exception 'GBS_DOSSIER_AUTRE_CLIENT' using errcode = 'P0001';
      end if;
      -- La société qui facture suit la règle du modèle financier (sauf avoir : société de la facture d'origine).
      if new.type <> 'avoir' then
        attendue := private.societe_facturante(c.pays, new.type, d);
        if s.code <> attendue then
          raise exception 'GBS_SOCIETE_FACTURANTE: cette facture doit être émise par %', attendue
            using errcode = 'P0001';
        end if;
      end if;
      -- Devise : GBS Côte d'Ivoire en FCFA (XOF ; XAF pour un client CEMAC), GBS Chine en USD ou CNY.
      if s.code = 'GBS_CI' and not (new.devise = 'XOF' or (new.devise = 'XAF' and c.pays in ('GA','CM'))) then
        raise exception 'GBS_DEVISE_SOCIETE: GBS Côte d''Ivoire facture en XOF' using errcode = 'P0001';
      end if;
      if s.code = 'GBS_CN' and new.devise not in ('USD','CNY') then
        raise exception 'GBS_DEVISE_SOCIETE: GBS Chine facture en USD (export) ou CNY (fapiao)' using errcode = 'P0001';
      end if;
      -- Retenue à la source : seulement si l'émettrice n'est pas résidente du pays du client.
      new.retenue_taux := case when s.pays <> c.pays
                               then coalesce((private.param('retenue.' || c.pays, d) #>> '{}')::numeric, 0)
                               else 0 end;
    else
      select * into dst from public.societes where id = new.societe_dest_id;
      if new.type <> 'intragroupe' or dst.id = s.id then
        raise exception 'GBS_INTRAGROUPE_INVALIDE' using errcode = 'P0001';
      end if;
      new.retenue_taux := case when s.pays <> dst.pays
                               then coalesce((private.param('retenue_intragroupe.' || dst.pays, d) #>> '{}')::numeric, 0)
                               else 0 end;
    end if;
    new.tva_taux := private.tva_taux(s.code, new.type, d);
    new.fne_requise := s.fne;
  else
    if new.societe_id <> old.societe_id or new.client_id is distinct from old.client_id
       or new.societe_dest_id is distinct from old.societe_dest_id or new.devise <> old.devise
       or new.type <> old.type then
      raise exception 'GBS_FACTURE_FIGEE' using errcode = 'P0001';
    end if;
    if new.retenue_taux <> old.retenue_taux or new.tva_taux <> old.tva_taux then
      if not private.is_admin() then raise exception 'GBS_TAUX_ADMIN' using errcode = '42501'; end if;
    end if;
    if old.statut <> 'brouillon' and rpc not in ('emettre_facture','certifier_fne','encaissement','annuler_facture') then
      if (new.montant_ht, new.tva, new.retenue, new.ttc, new.objet, new.date_emission)
         is distinct from (old.montant_ht, old.tva, old.retenue, old.ttc, old.objet, old.date_emission)
         or new.statut <> old.statut or new.numero is distinct from old.numero then
        raise exception 'GBS_FACTURE_EMISE: une facture émise ne se modifie pas ; émettez un avoir' using errcode = 'P0001';
      end if;
    end if;
    if new.statut <> old.statut and rpc not in ('emettre_facture','certifier_fne','encaissement','annuler_facture') then
      raise exception 'GBS_VALIDATION_RPC: le statut d''une facture change par les fonctions dédiées' using errcode = 'P0001';
    end if;
    if (new.montant_ht, new.tva, new.retenue, new.ttc, new.net_a_payer)
       is distinct from (old.montant_ht, old.tva, old.retenue, old.ttc, old.net_a_payer)
       and rpc not in ('recalcul_facture') then
      raise exception 'GBS_MONTANTS_CALCULES: les montants découlent des lignes' using errcode = 'P0001';
    end if;
    if new.recapitulatif is distinct from old.recapitulatif and rpc <> 'recalcul_facture' then
      raise exception 'GBS_MONTANTS_CALCULES' using errcode = 'P0001';
    end if;
    if (new.fne_numero, new.fne_qr) is distinct from (old.fne_numero, old.fne_qr) and rpc <> 'certifier_fne' then
      raise exception 'GBS_VALIDATION_RPC: certification par certifier_fne()' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger factures_regles before insert or update on public.factures
  for each row execute function private.trg_facture();

create or replace function private.trg_ligne_facture() returns trigger
language plpgsql security definer set search_path = '' as $$
declare st text;
begin
  select statut into st from public.factures where id = coalesce(new.facture_id, old.facture_id);
  if st <> 'brouillon' then
    raise exception 'GBS_FACTURE_EMISE: lignes figées' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    perform private.recalcul_facture(old.facture_id);   -- en AFTER
    return old;
  end if;
  return new;
end $$;
create or replace function private.trg_ligne_facture_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.recalcul_facture(coalesce(new.facture_id, old.facture_id));
  return null;
end $$;
create trigger lignes_facture_regles before insert or update on public.lignes_facture
  for each row execute function private.trg_ligne_facture();
create trigger lignes_facture_calc after insert or update or delete on public.lignes_facture
  for each row execute function private.trg_ligne_facture_after();

-- Les lignes d'une facture en brouillon peuvent être retirées ; jamais après émission.
create or replace function private.trg_ligne_facture_del() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select statut from public.factures where id = old.facture_id) <> 'brouillon' then
    raise exception 'GBS_FACTURE_EMISE: lignes figées' using errcode = 'P0001';
  end if;
  return old;
end $$;
create trigger lignes_facture_del before delete on public.lignes_facture
  for each row execute function private.trg_ligne_facture_del();

-- -----------------------------------------------------------------------------
-- Encaissements : devise exacte, taux du jour, statut de facture, partage
-- -----------------------------------------------------------------------------
create or replace function private.trg_encaissement() returns trigger
language plpgsql security definer set search_path = '' as $$
declare f public.factures;
begin
  select * into f from public.factures where id = new.facture_id for update;
  if f.statut not in ('emise','partiellement_payee') then
    raise exception 'GBS_FACTURE_NON_EMISE: encaissement impossible (statut %)', f.statut using errcode = 'P0001';
  end if;
  if new.devise <> f.devise then
    raise exception 'GBS_DEVISE_ENCAISSEMENT: l''encaissement doit être enregistré en % (devise de la facture)', f.devise
      using errcode = 'P0001';
  end if;
  if f.encaisse + new.montant > f.net_a_payer then
    raise exception 'GBS_TROP_PERCU: % encaissés pour % dus', f.encaisse + new.montant, f.net_a_payer
      using errcode = 'P0001';
  end if;
  new.taux_xof := private.taux_xof(new.devise, new.recu_le);
  new.montant_xof := round(new.montant * new.taux_xof);
  return new;
end $$;

create or replace function private.trg_encaissement_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare f public.factures; total numeric; prev text := coalesce(current_setting('gbs.rpc', true), '');
begin
  select * into f from public.factures where id = new.facture_id;
  total := f.encaisse + new.montant;
  perform set_config('gbs.rpc', 'encaissement', true);
  update public.factures set encaisse = total,
         statut = case when total >= net_a_payer then 'payee' else 'partiellement_payee' end
   where id = f.id;
  perform set_config('gbs.rpc', prev, true);
  perform private.calculer_partage(new.id);
  return null;
end $$;
create trigger encaissements_regles before insert on public.encaissements
  for each row execute function private.trg_encaissement();
create trigger encaissements_after after insert on public.encaissements
  for each row execute function private.trg_encaissement_after();
create trigger encaissements_audit after insert on public.encaissements
  for each row execute function private.trg_audit();
create trigger encaissements_cree before insert on public.encaissements
  for each row execute function private.trg_cree_par();
-- Un encaissement ne se modifie ni ne se supprime : on contre-passe par un avoir.
create trigger encaissements_immuable before update or delete on public.encaissements
  for each row execute function private.trg_immuable();

-- -----------------------------------------------------------------------------
-- Partage de la valeur (M21) et flux entre sociétés (M36), règles datées : un
-- dossier garde la règle en vigueur à son ouverture.
-- -----------------------------------------------------------------------------
create or replace function private.calculer_partage(p_enc uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.encaissements; f public.factures; s public.societes; c public.clients; dsr public.dossiers;
        cn public.societes; dref date; base numeric; taux numeric; part numeric; mois date;
        groupe text;
begin
  select * into e from public.encaissements where id = p_enc;
  select * into f from public.factures where id = e.facture_id;
  if f.client_id is null or f.type = 'avoir' then return; end if;   -- intragroupe : aucun partage
  select * into s from public.societes where id = f.societe_id;
  select * into c from public.clients where id = f.client_id;
  select * into dsr from public.dossiers where id = f.dossier_id;
  select * into cn from public.societes where code = 'GBS_CN';
  dref := coalesce(dsr.ouvert_le, e.recu_le);
  mois := date_trunc('month', e.recu_le)::date;
  -- Base hors taxes au prorata de l'encaissement sur le net à payer.
  base := round(e.montant_xof * (case when f.type = 'negoce' then f.marge_ht else f.montant_ht end)
                / nullif(f.net_a_payer, 0));
  if base is null or base = 0 then return; end if;

  groupe := case
    when f.type in ('forfait_consultation','forfait_projet','accord_cadre') then 'forfaits'
    when f.type = 'commission' then 'commissions'
    when f.type = 'installation' then 'installation'
    when f.type = 'negoce' then 'marge_negoce'
    else 'frais_gestion' end;

  -- Flux GBS Côte d'Ivoire -> GBS Chine (à partir de la création de GBS Chine)
  if s.code = 'GBS_CI' and e.recu_le >= cn.date_creation and groupe in ('forfaits','commissions') then
    taux := private.param_num('partage.ci_vers_cn.' || groupe, dref);
    part := round(base * taux);
    insert into public.partages (encaissement_id, facture_id, dossier_id, du_par, du_a, base_xof, taux,
                                 montant_xof, regle, regle_date_effet, mois)
    values (e.id, f.id, f.dossier_id, 'GBS_CI', 'GBS_CN', base, taux, part, 'partage.ci_vers_cn.' || groupe,
            (select max(date_effet) from public.parametres where cle = 'partage.ci_vers_cn.' || groupe and date_effet <= dref),
            mois);
  end if;
  -- Flux GBS Chine -> GBS Côte d'Ivoire pour les clients ivoiriens
  if s.code = 'GBS_CN' and c.pays = 'CI' and groupe in ('frais_gestion','marge_negoce') then
    taux := private.param_num('partage.cn_vers_ci.' || groupe, dref);
    part := round(base * taux);
    insert into public.partages (encaissement_id, facture_id, dossier_id, du_par, du_a, base_xof, taux,
                                 montant_xof, regle, regle_date_effet, mois)
    values (e.id, f.id, f.dossier_id, 'GBS_CN', 'GBS_CI', base, taux, part, 'partage.cn_vers_ci.' || groupe,
            (select max(date_effet) from public.parametres where cle = 'partage.cn_vers_ci.' || groupe and date_effet <= dref),
            mois);
  end if;
  -- Commission de l'agent pays (Gabon, Cameroun) sur les honoraires ou la marge de ses clients
  if c.origine = 'agent_pays' and c.agent_id is not null then
    taux := private.param_num('agent.taux', dref);
    part := round(base * taux);
    insert into public.partages (encaissement_id, facture_id, dossier_id, du_par, du_a, agent_id, base_xof, taux,
                                 montant_xof, regle, regle_date_effet, mois)
    values (e.id, f.id, f.dossier_id, s.code, 'agent', c.agent_id, base, taux, part, 'agent.taux',
            (select max(date_effet) from public.parametres where cle = 'agent.taux' and date_effet <= dref),
            mois);
  end if;
end $$;
create trigger partages_audit after insert on public.partages for each row execute function private.trg_audit();
create trigger partages_immuable before update or delete on public.partages for each row execute function private.trg_immuable();

-- Relevé mensuel : par dossier, encaissement d'origine, règle et date d'effet.
create or replace view public.v_releve_flux with (security_invoker = true) as
select p.mois, p.du_par, p.du_a, p.agent_id, p.dossier_id, d.reference as dossier_reference,
       f.numero as facture_numero, e.recu_le, p.base_xof, p.taux, p.montant_xof, p.regle, p.regle_date_effet
from public.partages p
join public.encaissements e on e.id = p.encaissement_id
join public.factures f on f.id = p.facture_id
left join public.dossiers d on d.id = p.dossier_id;

-- -----------------------------------------------------------------------------
-- Ordres de paiement fournisseurs : compte vérifié, verrous, plafond, 4 yeux
-- -----------------------------------------------------------------------------
create or replace function private.trg_paiement() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cmd public.commandes; d public.dossiers; cp public.comptes_paiement; n int; an int;
        rpc text := coalesce(current_setting('gbs.rpc', true), '');
begin
  select * into cmd from public.commandes where id = new.commande_id;
  select * into d from public.dossiers where id = cmd.dossier_id;
  select * into cp from public.comptes_paiement where id = new.compte_id;
  if tg_op = 'INSERT' then
    new.dossier_id := cmd.dossier_id;
    new.statut := 'prepare'; new.valide_par := null; new.valide_le := null; new.execute_le := null;
    new.prepare_par := auth.uid(); new.prepare_le := now();
    an := extract(year from now())::int;
    perform pg_advisory_xact_lock(7317);
    select coalesce(max(substring(reference from '-([0-9]+)$')::int), 0) + 1 into n
      from public.paiements_fournisseurs where reference like 'PAY-' || an || '-%';
    new.reference := 'PAY-' || an || '-' || lpad(n::text, 3, '0');
  else
    if (new.commande_id, new.compte_id, new.montant, new.devise, new.nature, new.flux, new.canal, new.prepare_par)
       is distinct from (old.commande_id, old.compte_id, old.montant, old.devise, old.nature, old.flux, old.canal, old.prepare_par) then
      raise exception 'GBS_PAIEMENT_FIGE: un ordre de paiement ne se modifie pas ; refusez-le et préparez-en un autre'
        using errcode = 'P0001';
    end if;
    if new.statut <> old.statut and rpc not in ('valider_paiement','executer_paiement','refuser_paiement') then
      raise exception 'GBS_VALIDATION_RPC' using errcode = 'P0001';
    end if;
  end if;
  -- Mode 1 : GBS n'encaisse ni ne paie jamais les fonds destinés au fournisseur.
  if d.mode_financier = 'accompagne' and new.flux <> 'instruction_client' then
    raise exception 'GBS_MODE1_FONDS_CLIENT: en achat accompagné, le client paie lui-même l''usine' using errcode = 'P0001';
  end if;
  if d.mode_financier = 'negoce' and new.flux <> 'gbs' then
    raise exception 'GBS_MODE2_PAIEMENT_GBS' using errcode = 'P0001';
  end if;
  if d.mode_financier = 'service_seul' then
    raise exception 'GBS_SERVICE_SEUL_SANS_ACHAT' using errcode = 'P0001';
  end if;
  -- Compte vérifié du fournisseur de la commande, uniquement.
  if cp.fournisseur_id <> cmd.fournisseur_id then
    raise exception 'GBS_COMPTE_AUTRE_FOURNISSEUR' using errcode = 'P0001';
  end if;
  if not cp.verifie or cp.archive_le is not null then
    raise exception 'GBS_COMPTE_NON_VERIFIE: paiement refusé vers un compte non vérifié' using errcode = 'P0001';
  end if;
  if (new.canal = 'virement' and cp.type <> 'banque') or (new.canal = 'wechat_pay' and cp.type <> 'wechat_pay')
     or (new.canal = 'alipay' and cp.type <> 'alipay') then
    raise exception 'GBS_CANAL_COMPTE' using errcode = 'P0001';
  end if;
  if new.devise <> cp.devise then
    raise exception 'GBS_DEVISE_COMPTE' using errcode = 'P0001';
  end if;
  if new.canal in ('wechat_pay','alipay') and new.montant > private.param_num('paiement.plafond_wallet_cny') then
    raise exception 'GBS_PLAFOND_WALLET: au-delà du plafond, le virement bancaire est obligatoire' using errcode = 'P0001';
  end if;
  if cmd.statut = 'annulee' then raise exception 'GBS_COMMANDE_ANNULEE' using errcode = 'P0001'; end if;
  -- Verrou 1 : aucun acompte sans mandat et contrat signés.
  if new.nature = 'acompte' and not private.verrou1_contrat_ok(cmd.id) then
    raise exception 'GBS_VERROU1: aucun acompte fournisseur sans mandat client et contrat fournisseur signés'
      using errcode = 'P0001';
  end if;
  -- Verrou 2 : aucun solde sans inspection avant expédition validée (ou dérogation).
  if new.nature = 'solde' and not private.verrou2_inspection_ok(cmd.id) then
    raise exception 'GBS_VERROU2: solde bloqué tant que l''inspection avant expédition n''est pas validée'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Forward declarations des verrous (redéfinies dans la migration des règles).
create or replace function private.verrou1_contrat_ok(p_commande uuid) returns boolean
language sql stable as $$ select false $$;
create or replace function private.verrou2_inspection_ok(p_commande uuid) returns boolean
language sql stable as $$ select false $$;

create trigger paiements_regles before insert or update on public.paiements_fournisseurs
  for each row execute function private.trg_paiement();
create trigger paiements_touch before update on public.paiements_fournisseurs for each row execute function private.trg_touch();
create trigger paiements_audit after insert or update or delete on public.paiements_fournisseurs for each row execute function private.trg_audit();
create trigger paiements_nodel before delete on public.paiements_fournisseurs for each row execute function private.trg_no_delete();

do $$
declare t text;
begin
  foreach t in array array['factures'] loop
    execute format('create trigger %1$s_touch before update on public.%1$s for each row execute function private.trg_touch()', t);
    execute format('create trigger %1$s_cree before insert on public.%1$s for each row execute function private.trg_cree_par()', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$s for each row execute function private.trg_audit()', t);
    execute format('create trigger %1$s_nodel before delete on public.%1$s for each row execute function private.trg_no_delete()', t);
  end loop;
end $$;
create trigger lignes_facture_cree before insert on public.lignes_facture for each row execute function private.trg_cree_par();
create trigger lignes_facture_audit after insert or update or delete on public.lignes_facture for each row execute function private.trg_audit();
create trigger releves_audit after insert on public.releves_valides for each row execute function private.trg_audit();
create trigger releves_immuable before update or delete on public.releves_valides for each row execute function private.trg_immuable();
