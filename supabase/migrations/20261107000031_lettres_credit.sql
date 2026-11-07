-- Lot 1, M12 (mode 1) : lettres de crédit et certificat d'inspection rédigé selon le crédit.
-- * Le crédit est enregistré (références, montant, tolérances, dates, ports, documents exigés)
--   sur un dossier déclaré « avec lettre de crédit » (client vérifié, verrou du lot 0).
-- * Analyse : le crédit doit désigner Gulf Bridge Sourcing comme émettrice du certificat et
--   imposer une formulation explicite (ICC) ; montant, devise, dates et documents exigés sont
--   rapprochés de la commande. Avec une anomalie, le crédit est « à amender » et aucun
--   certificat ne peut être émis ; toute modification du crédit relance l'analyse.
-- * Certificat : émis par un validateur, avec exactement la formulation exigée, à partir d'une
--   inspection libérée ; refusé si une donnée (quantités, montant, dates, ports) contredit le
--   crédit, la commande ou l'expédition. Le certificat émis ne se modifie plus.

create table gbs.lettres_credit (
  id                  uuid primary key default gen_random_uuid(),
  reference           text unique check (reference ~ '^LC-[0-9]{4}-[0-9]{3,5}$'),
  dossier_id          uuid not null references gbs.dossiers(id),
  commande_id         uuid not null references gbs.commandes(id),
  numero              text not null check (length(trim(numero)) between 3 and 80),
  banque_emettrice    text not null check (length(trim(banque_emettrice)) between 2 and 200),
  banque_notificatrice text check (length(banque_notificatrice) <= 200),
  beneficiaire        text not null check (length(trim(beneficiaire)) between 2 and 200),
  montant             numeric(16,2) not null check (montant > 0),
  devise              char(3) not null check (devise in ('USD','CNY','EUR','XOF','XAF')),
  tolerance_montant   numeric(4,3) not null default 0 check (tolerance_montant between 0 and 0.1),
  tolerance_quantite  numeric(4,3) not null default 0 check (tolerance_quantite between 0 and 0.1),
  emise_le            date not null,
  expire_le           date not null,
  derniere_date_expedition date not null,
  port_chargement     text check (length(port_chargement) <= 80),
  port_dechargement   text check (length(port_dechargement) <= 80),
  expeditions_partielles boolean not null default false,
  regles              text not null default 'UCP 600' check (length(regles) <= 40),
  emetteur_certificat text not null check (length(trim(emetteur_certificat)) between 2 and 200),
  formulation_certificat text not null default '' check (length(formulation_certificat) <= 2000),
  documents_exiges    jsonb not null default '[]'::jsonb,
  statut              text not null default 'saisie' check (statut in ('saisie','conforme','a_amender')),
  anomalies           jsonb not null default '[]'::jsonb,
  analyse_par         uuid references gbs.profils(id),
  analyse_le          timestamptz,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check (expire_le >= emise_le and derniere_date_expedition <= expire_le)
);

create table gbs.certificats_lc (
  id              uuid primary key default gen_random_uuid(),
  numero          text unique check (numero ~ '^CERT-[0-9]{4}-[0-9]{3,5}$'),
  lettre_credit_id uuid not null references gbs.lettres_credit(id),
  dossier_id      uuid not null references gbs.dossiers(id),
  inspection_id   uuid not null references gbs.inspections(id),
  expedition_id   uuid references gbs.expeditions(id),
  formulation     text not null,
  donnees         jsonb not null,
  emis_le         date not null,
  emis_par        uuid not null references gbs.profils(id),
  cree_le timestamptz not null default now()
);

-- Documents exigés : [{document, originaux, copies, mentions}], clés strictes, 30 au plus.
create or replace function gbs_private.documents_lc_valides(r jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(r) = 'array' and jsonb_array_length(r) <= 30
     and not exists (
       select 1 from jsonb_array_elements(r) e
        where jsonb_typeof(e) <> 'object'
           or exists (select 1 from jsonb_object_keys(e) k where k not in ('document','originaux','copies','mentions'))
           or length(coalesce(e ->> 'document', '')) not between 2 and 120
           or length(coalesce(e ->> 'mentions', '')) > 1000
           or (e ? 'originaux' and (jsonb_typeof(e -> 'originaux') <> 'number' or (e ->> 'originaux')::numeric not between 0 and 10))
           or (e ? 'copies' and (jsonb_typeof(e -> 'copies') <> 'number' or (e ->> 'copies')::numeric not between 0 and 10)))
$$;

-- Anomalies du crédit au regard de la commande et des règles de la section 5.
create or replace function gbs_private.anomalies_lc(l gbs.lettres_credit) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c gbs.commandes; a jsonb := '[]'::jsonb;
begin
  select * into c from gbs.commandes where id = l.commande_id;
  if position('gulf bridge sourcing' in lower(l.emetteur_certificat)) = 0 then
    a := a || jsonb_build_object('code', 'emetteur_non_gbs');
  end if;
  if length(trim(l.formulation_certificat)) < 20 then
    a := a || jsonb_build_object('code', 'formulation_absente');
  end if;
  if not exists (select 1 from jsonb_array_elements(l.documents_exiges) e where lower(e ->> 'document') like '%inspection%') then
    a := a || jsonb_build_object('code', 'certificat_non_exige');
  end if;
  if l.devise <> c.devise then
    a := a || jsonb_build_object('code', 'devise', 'credit', l.devise, 'commande', c.devise);
  elsif c.montant_marchandise > round(l.montant * (1 + l.tolerance_montant), 2) then
    a := a || jsonb_build_object('code', 'montant_insuffisant', 'credit', l.montant, 'commande', c.montant_marchandise);
  end if;
  if c.date_livraison_promise is not null and l.derniere_date_expedition < c.date_livraison_promise then
    a := a || jsonb_build_object('code', 'date_expedition', 'credit', l.derniere_date_expedition, 'commande', c.date_livraison_promise);
  end if;
  if l.expire_le < current_date then a := a || jsonb_build_object('code', 'expire'); end if;
  return a;
end $$;

create or replace function gbs_private.trg_lettre_credit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d gbs.dossiers; c gbs.commandes; n int; rpc text := coalesce(current_setting('gbs.rpc', true), '');
begin
  select * into d from gbs.dossiers where id = new.dossier_id;
  select * into c from gbs.commandes where id = new.commande_id;
  if c.id is null or c.dossier_id <> new.dossier_id then raise exception 'GBS_COMMANDE_INCONNUE' using errcode = '22023'; end if;
  if not d.lettre_credit or d.mode_financier <> 'accompagne' then
    raise exception 'GBS_DOSSIER_SANS_LC: déclarez le dossier « avec lettre de crédit » (mode 1, client vérifié)' using errcode = 'P0001';
  end if;
  if not gbs_private.documents_lc_valides(new.documents_exiges) then
    raise exception 'GBS_DOCUMENTS_LC_INVALIDES' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(7332);
    select coalesce(max(substring(reference from '-([0-9]+)$')::int), 0) + 1 into n
      from gbs.lettres_credit where reference like 'LC-' || extract(year from now())::int || '-%';
    new.reference := 'LC-' || extract(year from now())::int || '-' || lpad(n::text, 3, '0');
    new.statut := 'saisie'; new.anomalies := '[]'::jsonb; new.analyse_par := null; new.analyse_le := null;
  else
    if (new.reference, new.dossier_id) is distinct from (old.reference, old.dossier_id) then
      raise exception 'GBS_LC_FIGEE' using errcode = 'P0001';
    end if;
    if rpc <> 'lettre_credit' then
      if (new.statut, new.anomalies, new.analyse_par, new.analyse_le) is distinct from (old.statut, old.anomalies, old.analyse_par, old.analyse_le) then
        raise exception 'GBS_VALIDATION_RPC' using errcode = 'P0001';
      end if;
      if exists (select 1 from gbs.certificats_lc x where x.lettre_credit_id = old.id) then
        raise exception 'GBS_LC_FIGEE: un certificat a été émis sur ce crédit' using errcode = 'P0001';
      end if;
      -- Toute modification (amendement) relance l'analyse.
      new.statut := 'saisie'; new.anomalies := '[]'::jsonb; new.analyse_par := null; new.analyse_le := null;
    end if;
  end if;
  return new;
end $$;
create trigger lettres_credit_regles before insert or update on gbs.lettres_credit
  for each row execute function gbs_private.trg_lettre_credit();

create or replace function gbs_private.trg_certificat_lc() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'certificat_lc' then
    raise exception 'GBS_VALIDATION_RPC: le certificat s''émet par emettre_certificat_lc()' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(7333);
  select coalesce(max(substring(numero from '-([0-9]+)$')::int), 0) + 1 into n
    from gbs.certificats_lc where numero like 'CERT-' || extract(year from now())::int || '-%';
  new.numero := 'CERT-' || extract(year from now())::int || '-' || lpad(n::text, 3, '0');
  return new;
end $$;
create trigger certificats_lc_regles before insert on gbs.certificats_lc
  for each row execute function gbs_private.trg_certificat_lc();

do $$
begin
  execute 'create trigger lettres_credit_touch before update on gbs.lettres_credit for each row execute function gbs_private.trg_touch()';
  execute 'create trigger lettres_credit_cree before insert on gbs.lettres_credit for each row execute function gbs_private.trg_cree_par()';
  execute 'create trigger lettres_credit_audit after insert or update or delete on gbs.lettres_credit for each row execute function gbs_private.trg_audit()';
  execute 'create trigger lettres_credit_nodel before delete on gbs.lettres_credit for each row execute function gbs_private.trg_no_delete()';
  execute 'create trigger certificats_lc_audit after insert on gbs.certificats_lc for each row execute function gbs_private.trg_audit()';
  execute 'create trigger certificats_lc_immuable before update or delete on gbs.certificats_lc for each row execute function gbs_private.trg_immuable()';
end $$;

-- -----------------------------------------------------------------------------
-- Analyse et émission
-- -----------------------------------------------------------------------------
create or replace function gbs_private.gere_lc(p_dossier uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select gbs_private.has_role('admin','achats_chine','hub_afrique') and gbs_private.dossier_visible(p_dossier)
$$;

create or replace function gbs.analyser_lc(p_lc uuid)
returns gbs.lettres_credit language plpgsql security definer set search_path = '' as $$
declare l gbs.lettres_credit; a jsonb;
begin
  select * into l from gbs.lettres_credit where id = p_lc for update;
  perform gbs_private.exiger(l.id is not null and gbs_private.gere_lc(l.dossier_id));
  a := gbs_private.anomalies_lc(l);
  perform set_config('gbs.rpc', 'lettre_credit', true);
  update gbs.lettres_credit set anomalies = a, statut = case when jsonb_array_length(a) = 0 then 'conforme' else 'a_amender' end,
         analyse_par = auth.uid(), analyse_le = now()
   where id = p_lc returning * into l;
  perform set_config('gbs.rpc', '', true);
  return l;
end $$;

create or replace function gbs.emettre_certificat_lc(p_lc uuid, p_inspection uuid, p_expedition uuid default null)
returns gbs.certificats_lc language plpgsql security definer set search_path = '' as $$
declare l gbs.lettres_credit; i gbs.inspections; e gbs.expeditions; c gbs.commandes; f gbs.fournisseurs;
        qte numeric; ecarts jsonb := '[]'::jsonb; cert gbs.certificats_lc; articles jsonb;
begin
  perform gbs_private.exiger(gbs_private.est_validateur(), 'GBS_VALIDATION_ADMIN');
  select * into l from gbs.lettres_credit where id = p_lc for update;
  perform gbs_private.exiger(l.id is not null and gbs_private.gere_lc(l.dossier_id));
  -- L'analyse est refaite à l'émission : une échéance a pu passer depuis.
  if l.statut <> 'conforme' or jsonb_array_length(gbs_private.anomalies_lc(l)) > 0 then
    raise exception 'GBS_LC_NON_CONFORME: crédit à amender avant tout certificat' using errcode = 'P0001';
  end if;
  select * into c from gbs.commandes where id = l.commande_id;
  select * into f from gbs.fournisseurs where id = c.fournisseur_id;
  select * into i from gbs.inspections where id = p_inspection;
  if i.id is null or i.commande_id is distinct from l.commande_id or i.statut <> 'validee' or i.decision <> 'liberation'
     or i.type not in ('avant_expedition','contre_inspection') then
    raise exception 'GBS_INSPECTION_NON_LIBEREE: inspection avant expédition libérée de la commande exigée' using errcode = 'P0001';
  end if;
  select coalesce(sum(quantite), 0) into qte from gbs.lignes_commande where commande_id = c.id;
  if abs(i.taille_lot - qte) > qte * l.tolerance_quantite then
    ecarts := ecarts || jsonb_build_object('code', 'quantite', 'inspection', i.taille_lot, 'commande', qte);
  end if;
  if current_date > l.expire_le then ecarts := ecarts || jsonb_build_object('code', 'credit_expire'); end if;
  if p_expedition is not null then
    select * into e from gbs.expeditions where id = p_expedition;
    if e.id is null or not exists (select 1 from gbs.expedition_commandes x where x.expedition_id = e.id and x.commande_id = c.id) then
      raise exception 'GBS_EXPEDITION_INCONNUE: l''expédition ne transporte pas la commande' using errcode = '22023';
    end if;
    if e.etd is not null and e.etd > l.derniere_date_expedition then
      ecarts := ecarts || jsonb_build_object('code', 'expedition_tardive', 'etd', e.etd, 'credit', l.derniere_date_expedition);
    end if;
    if e.etd is not null and i.validee_le::date > e.etd then
      ecarts := ecarts || jsonb_build_object('code', 'inspection_apres_depart', 'inspection', i.validee_le::date, 'etd', e.etd);
    end if;
    if l.port_chargement is not null and e.port_depart is not null and lower(trim(e.port_depart)) <> lower(trim(l.port_chargement)) then
      ecarts := ecarts || jsonb_build_object('code', 'port_chargement', 'expedition', e.port_depart, 'credit', l.port_chargement);
    end if;
    if l.port_dechargement is not null and e.port_arrivee is not null and lower(trim(e.port_arrivee)) <> lower(trim(l.port_dechargement)) then
      ecarts := ecarts || jsonb_build_object('code', 'port_dechargement', 'expedition', e.port_arrivee, 'credit', l.port_dechargement);
    end if;
  end if;
  if jsonb_array_length(ecarts) > 0 then
    raise exception 'GBS_CERTIFICAT_INCOHERENT: %', left(ecarts::text, 500) using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('reference', a.reference, 'designation', a.designation, 'quantite', lc.quantite) order by lc.cree_le), '[]'::jsonb)
    into articles from gbs.lignes_commande lc join gbs.articles a on a.id = lc.article_id where lc.commande_id = c.id;
  perform set_config('gbs.rpc', 'certificat_lc', true);
  insert into gbs.certificats_lc (lettre_credit_id, dossier_id, inspection_id, expedition_id, formulation, donnees, emis_le, emis_par)
  values (l.id, l.dossier_id, i.id, p_expedition, l.formulation_certificat,
          jsonb_build_object('emetteur', l.emetteur_certificat, 'lc_numero', l.numero, 'lc_reference', l.reference, 'regles', l.regles,
            'banque_emettrice', l.banque_emettrice, 'beneficiaire', l.beneficiaire, 'commande', c.reference,
            'fournisseur', f.raison_sociale_en, 'articles', articles, 'inspection', i.reference, 'type_inspection', i.type,
            'date_inspection', i.date_realisee, 'liberee_le', i.validee_le::date, 'taille_lot', i.taille_lot, 'niveau', i.niveau,
            'nqa', jsonb_build_object('critique', i.nqa_critique, 'majeur', i.nqa_majeur, 'mineur', i.nqa_mineur),
            'expedition', e.reference, 'connaissement', e.numero_connaissement, 'navire', e.navire,
            'port_chargement', e.port_depart, 'port_dechargement', e.port_arrivee, 'etd', e.etd),
          current_date, auth.uid())
  returning * into cert;
  perform set_config('gbs.rpc', '', true);
  return cert;
end $$;

-- -----------------------------------------------------------------------------
-- Droits
-- -----------------------------------------------------------------------------
alter table gbs.lettres_credit enable row level security;
alter table gbs.certificats_lc enable row level security;
grant select, insert on gbs.lettres_credit to authenticated;
grant update (commande_id, numero, banque_emettrice, banque_notificatrice, beneficiaire, montant, devise, tolerance_montant,
  tolerance_quantite, emise_le, expire_le, derniere_date_expedition, port_chargement, port_dechargement, expeditions_partielles,
  regles, emetteur_certificat, formulation_certificat, documents_exiges) on gbs.lettres_credit to authenticated;
grant select on gbs.certificats_lc to authenticated;

create policy lc_lecture on gbs.lettres_credit for select using (
  (gbs_private.has_role('admin','achats_chine','hub_afrique','comptable')) and gbs_private.dossier_visible(dossier_id));
create policy lc_creation on gbs.lettres_credit for insert with check (gbs_private.gere_lc(dossier_id));
create policy lc_maj on gbs.lettres_credit for update using (gbs_private.gere_lc(dossier_id));
create policy certificats_lecture on gbs.certificats_lc for select using (
  (gbs_private.has_role('admin','achats_chine','hub_afrique','comptable')) and gbs_private.dossier_visible(dossier_id));

revoke execute on function gbs.analyser_lc(uuid), gbs.emettre_certificat_lc(uuid, uuid, uuid),
  gbs_private.documents_lc_valides(jsonb), gbs_private.anomalies_lc(gbs.lettres_credit), gbs_private.trg_lettre_credit(),
  gbs_private.trg_certificat_lc(), gbs_private.gere_lc(uuid) from public;
grant execute on function gbs.analyser_lc(uuid), gbs.emettre_certificat_lc(uuid, uuid, uuid) to authenticated;
grant execute on all functions in schema gbs_private to authenticated, service_role;
