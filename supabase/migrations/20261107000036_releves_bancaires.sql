-- Lot 1, M11 : import des relevés bancaires et rapprochement des encaissements et paiements.
-- * Comptes bancaires des sociétés, tenus par l'administratrice.
-- * Relevé importé (ISO 20022 camt.053, MT940 ou tableur, lu dans le navigateur) : chaque
--   ligne est validée par la base ; le relevé doit être équilibré (solde d'ouverture + lignes
--   = solde de clôture) ; un même relevé ou une même opération n'est jamais importé deux fois.
-- * Rapprochement automatique seulement sur montant, devise, société ET référence de la
--   transaction ; sinon propositions, pointage manuel par la finance. Un écart limité
--   (paramètre) est admis et enregistré en frais bancaires du dossier.
-- * Contrôle clé : les encaissements déclarés qu'aucune ligne bancaire ne confirme.
-- Le fichier d'origine n'est pas conservé (le dépôt n'accepte que des PDF et des images) :
-- son empreinte SHA-256 est gardée pour refuser un second import.

create table gbs.comptes_bancaires (
  id          uuid primary key default gen_random_uuid(),
  societe_id  uuid not null references gbs.societes(id),
  libelle     text not null check (length(trim(libelle)) between 2 and 120),
  banque      text not null check (length(trim(banque)) between 2 and 200),
  numero      text not null unique check (numero ~ '^[A-Z0-9]{8,34}$'),
  devise      char(3) not null check (devise in ('XOF','XAF','USD','CNY','EUR')),
  actif       boolean not null default true,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid
);

create table gbs.releves_bancaires (
  id              uuid primary key default gen_random_uuid(),
  compte_id       uuid not null references gbs.comptes_bancaires(id),
  format          text not null check (format in ('camt053','mt940','tableur')),
  empreinte       char(64) not null check (empreinte ~ '^[0-9a-f]{64}$'),
  date_debut      date not null,
  date_fin        date not null check (date_fin >= date_debut),
  solde_ouverture numeric(18,2) not null,
  solde_cloture   numeric(18,2) not null,
  nb_lignes       int not null,
  nb_doublons     int not null,
  importe_le      timestamptz not null default now(),
  importe_par     uuid not null references gbs.profils(id),
  unique (compte_id, empreinte)
);

create table gbs.lignes_releve (
  id              uuid primary key default gen_random_uuid(),
  releve_id       uuid not null references gbs.releves_bancaires(id),
  compte_id       uuid not null references gbs.comptes_bancaires(id),
  cle             text not null check (length(cle) between 1 and 120),
  date_operation  date not null,
  date_valeur     date,
  montant         numeric(18,2) not null check (montant <> 0 and abs(montant) < 1e13),
  devise          char(3) not null,
  libelle         text not null check (length(libelle) between 1 and 500),
  reference       text check (length(reference) <= 80),
  contrepartie    text check (length(contrepartie) <= 200),
  statut          text not null default 'a_rapprocher' check (statut in ('a_rapprocher','rapprochee','classee')),
  encaissement_id uuid unique references gbs.encaissements(id),
  paiement_id     uuid unique references gbs.paiements_fournisseurs(id),
  cout_id         uuid references gbs.couts(id),
  classement      text check (classement in ('frais_bancaires','virement_interne','autre')),
  motif           text check (length(motif) <= 1000),
  automatique     boolean not null default false,
  rapproche_par   uuid references gbs.profils(id),
  rapproche_le    timestamptz,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  unique (compte_id, cle),
  check (num_nonnulls(encaissement_id, paiement_id) <= 1),
  check ((statut = 'rapprochee') = (encaissement_id is not null or paiement_id is not null)),
  check ((statut = 'classee') = (classement is not null)),
  check (encaissement_id is null or montant > 0),
  check (paiement_id is null or montant < 0)
);
create index on gbs.lignes_releve (compte_id, statut);
create index on gbs.lignes_releve (releve_id);

insert into gbs.parametres_definitions (cle, type, minimum, maximum, validateur, module, libelle) values
  ('banque.ecart_max','taux',0,0.05,null,'finance','Écart admis au rapprochement, enregistré en frais bancaires (part du montant)'),
  ('banque.fenetre_jours','entier',0,60,null,'finance','Fenêtre de dates des propositions de rapprochement (jours)'),
  ('banque.alerte_non_rapproche_jours','entier',1,90,null,'finance','Encaissement non confirmé par la banque : alerte après (jours)');
insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('banque.ecart_max', '0.01', date '2026-01-01', 'Frais de virement retenus par les banques : 1 % au plus — à confirmer'),
  ('banque.fenetre_jours', '10', date '2026-01-01', 'Propositions de rapprochement à ± 10 jours'),
  ('banque.alerte_non_rapproche_jours', '7', date '2026-01-01', 'Encaissement déclaré sans ligne bancaire après 7 jours');

-- -----------------------------------------------------------------------------
-- Règles
-- -----------------------------------------------------------------------------
create or replace function gbs_private.compte_bancaire_visible(p_compte uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select gbs_private.finance() and exists (select 1 from gbs.comptes_bancaires c where c.id = p_compte and gbs_private.societe_ok(c.societe_id))
$$;

create or replace function gbs_private.trg_compte_bancaire() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.societe_id, new.numero, new.devise) is distinct from (old.societe_id, old.numero, old.devise)
     and exists (select 1 from gbs.releves_bancaires r where r.compte_id = old.id) then
    raise exception 'GBS_COMPTE_BANCAIRE_FIGE: un compte qui a des relevés ne change ni de société, ni de numéro, ni de devise' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger comptes_bancaires_regles before update on gbs.comptes_bancaires
  for each row execute function gbs_private.trg_compte_bancaire();

-- Les lignes ne changent que par les fonctions de rapprochement ; leur contenu bancaire jamais.
create or replace function gbs_private.trg_ligne_releve() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'releve' then
    raise exception 'GBS_VALIDATION_RPC: les relevés passent par l''import et le rapprochement' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.releve_id, new.compte_id, new.cle, new.date_operation, new.date_valeur, new.montant, new.devise,
       new.libelle, new.reference, new.contrepartie)
     is distinct from (old.releve_id, old.compte_id, old.cle, old.date_operation, old.date_valeur, old.montant, old.devise,
       old.libelle, old.reference, old.contrepartie) then
    raise exception 'GBS_RELEVE_FIGE: une opération bancaire importée ne se modifie pas' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger lignes_releve_regles before insert or update on gbs.lignes_releve
  for each row execute function gbs_private.trg_ligne_releve();

create or replace function gbs_private.trg_releve_bancaire() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'releve' then
    raise exception 'GBS_VALIDATION_RPC: les relevés passent par importer_releve()' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger releves_bancaires_regles before insert on gbs.releves_bancaires
  for each row execute function gbs_private.trg_releve_bancaire();

do $$
begin
  execute 'create trigger comptes_bancaires_touch before update on gbs.comptes_bancaires for each row execute function gbs_private.trg_touch()';
  execute 'create trigger comptes_bancaires_cree before insert on gbs.comptes_bancaires for each row execute function gbs_private.trg_cree_par()';
  execute 'create trigger comptes_bancaires_audit after insert or update or delete on gbs.comptes_bancaires for each row execute function gbs_private.trg_audit()';
  execute 'create trigger comptes_bancaires_nodel before delete on gbs.comptes_bancaires for each row execute function gbs_private.trg_no_delete()';
  execute 'create trigger releves_bancaires_audit after insert or update or delete on gbs.releves_bancaires for each row execute function gbs_private.trg_audit()';
  execute 'create trigger releves_bancaires_immuable before update or delete on gbs.releves_bancaires for each row execute function gbs_private.trg_immuable()';
  execute 'create trigger lignes_releve_touch before update on gbs.lignes_releve for each row execute function gbs_private.trg_touch()';
  execute 'create trigger lignes_releve_cree before insert on gbs.lignes_releve for each row execute function gbs_private.trg_cree_par()';
  execute 'create trigger lignes_releve_audit after insert or update or delete on gbs.lignes_releve for each row execute function gbs_private.trg_audit()';
  execute 'create trigger lignes_releve_nodel before delete on gbs.lignes_releve for each row execute function gbs_private.trg_no_delete()';
end $$;

-- Rapprochement automatique : un seul candidat de même société, devise et montant exact,
-- dont la référence de transaction figure dans la référence ou le libellé bancaire.
create or replace function gbs_private.rapprocher_auto(p_compte uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare c gbs.comptes_bancaires; l record; cand uuid[]; n int := 0;
begin
  select * into c from gbs.comptes_bancaires where id = p_compte;
  perform set_config('gbs.rpc', 'releve', true);
  for l in select * from gbs.lignes_releve where compte_id = p_compte and statut = 'a_rapprocher' order by date_operation, id loop
    if l.montant > 0 then
      cand := array(select e.id from gbs.encaissements e join gbs.factures f on f.id = e.facture_id
                     where f.societe_id = c.societe_id and e.devise = l.devise and e.montant = l.montant
                       and e.mode in ('virement','lettre_credit','cheque','mobile')
                       and length(e.reference) >= 4
                       and (strpos(upper(coalesce(l.reference, '')), upper(e.reference)) > 0 or strpos(upper(l.libelle), upper(e.reference)) > 0)
                       and not exists (select 1 from gbs.lignes_releve x where x.encaissement_id = e.id));
      if cardinality(cand) = 1 then
        update gbs.lignes_releve set statut = 'rapprochee', encaissement_id = cand[1], automatique = true,
               rapproche_par = auth.uid(), rapproche_le = now() where id = l.id;
        n := n + 1;
      end if;
    else
      cand := array(select p.id from gbs.paiements_fournisseurs p join gbs.dossiers d on d.id = p.dossier_id
                     where d.societe_id = c.societe_id and p.flux = 'gbs' and p.statut in ('execute','confirme_client')
                       and p.devise = l.devise and p.montant = -l.montant
                       and length(p.reference_transaction) >= 4
                       and (strpos(upper(coalesce(l.reference, '')), upper(p.reference_transaction)) > 0
                            or strpos(upper(l.libelle), upper(p.reference_transaction)) > 0)
                       and not exists (select 1 from gbs.lignes_releve x where x.paiement_id = p.id));
      if cardinality(cand) = 1 then
        update gbs.lignes_releve set statut = 'rapprochee', paiement_id = cand[1], automatique = true,
               rapproche_par = auth.uid(), rapproche_le = now() where id = l.id;
        n := n + 1;
      end if;
    end if;
  end loop;
  perform set_config('gbs.rpc', '', true);
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- Import
-- -----------------------------------------------------------------------------
create or replace function gbs.importer_releve(p_compte uuid, p_format text, p_empreinte text, p_date_debut date, p_date_fin date,
                                               p_solde_ouverture numeric, p_solde_cloture numeric, p_lignes jsonb)
returns table (releve_id uuid, importees int, doublons int, rapprochees int)
language plpgsql security definer set search_path = '' as $$
declare c gbs.comptes_bancaires; r uuid; x jsonb; k text; somme numeric := 0; n int := 0; dbl int := 0; auto int;
        d_op date; mt numeric; lib text; ref text; rang int := 0; cles text[] := '{}'; dup boolean[] := '{}';
begin
  select * into c from gbs.comptes_bancaires where id = p_compte;
  perform gbs_private.exiger(c.id is not null and gbs_private.compte_bancaire_visible(c.id));
  if not c.actif then raise exception 'GBS_COMPTE_BANCAIRE_INACTIF' using errcode = 'P0001'; end if;
  if p_format not in ('camt053','mt940','tableur') or p_empreinte !~ '^[0-9a-f]{64}$' or p_date_debut is null or p_date_fin is null
     or p_date_fin < p_date_debut or p_date_fin > current_date or p_date_debut < date '2026-01-01'
     or p_solde_ouverture is null or p_solde_cloture is null or abs(p_solde_ouverture) >= 1e13 or abs(p_solde_cloture) >= 1e13
     or jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) > 5000 then
    raise exception 'GBS_RELEVE_INVALIDE' using errcode = '22023';
  end if;
  if exists (select 1 from gbs.releves_bancaires b where b.compte_id = p_compte and b.empreinte = p_empreinte) then
    raise exception 'GBS_RELEVE_DEJA_IMPORTE' using errcode = 'P0001';
  end if;

  -- Validation stricte de chaque ligne avant toute écriture.
  for x in select value from jsonb_array_elements(p_lignes) loop
    if jsonb_typeof(x) <> 'object' or exists (select 1 from jsonb_object_keys(x) o
         where o not in ('date_operation','date_valeur','montant','devise','libelle','reference','contrepartie'))
       or jsonb_typeof(x -> 'montant') <> 'number' or jsonb_typeof(x -> 'libelle') <> 'string'
       or jsonb_typeof(x -> 'date_operation') <> 'string' or (x ->> 'date_operation') !~ '^\d{4}-\d{2}-\d{2}$'
       or (x ? 'date_valeur' and jsonb_typeof(x -> 'date_valeur') <> 'null' and coalesce(x ->> 'date_valeur', '') !~ '^\d{4}-\d{2}-\d{2}$')
       or (x ? 'devise' and coalesce(x ->> 'devise', '') <> c.devise)
       or (x ? 'reference' and jsonb_typeof(x -> 'reference') not in ('string','null'))
       or (x ? 'contrepartie' and jsonb_typeof(x -> 'contrepartie') not in ('string','null')) then
      raise exception 'GBS_RELEVE_INVALIDE: ligne %', rang + 1 using errcode = '22023';
    end if;
    mt := (x ->> 'montant')::numeric;
    d_op := (x ->> 'date_operation')::date;
    lib := trim(x ->> 'libelle');
    if mt = 0 or mt <> round(mt, 2) or abs(mt) >= 1e13 or d_op not between p_date_debut and p_date_fin
       or length(lib) not between 1 and 500 or length(x ->> 'reference') > 80 or length(x ->> 'contrepartie') > 200 then
      raise exception 'GBS_RELEVE_INVALIDE: ligne %', rang + 1 using errcode = '22023';
    end if;
    somme := somme + mt;
    rang := rang + 1;
    -- Clé de l'opération : la référence de la banque, sinon une empreinte du contenu
    -- numérotée pour distinguer deux opérations identiques le même jour.
    ref := nullif(trim(coalesce(x ->> 'reference', '')), '');
    k := coalesce('R:' || ref, 'H:' || md5(d_op::text || '|' || mt::text || '|' || lib));
    if ref is null then
      k := k || ':' || (select count(*) + 1 from unnest(cles) z where z like k || ':%');
    end if;
    if k = any(cles) or exists (select 1 from gbs.lignes_releve y where y.compte_id = p_compte and y.cle = k) then
      dbl := dbl + 1;
      dup := dup || true;
    else
      n := n + 1;
      dup := dup || false;
    end if;
    cles := cles || k;
  end loop;
  if p_solde_ouverture + somme <> p_solde_cloture then
    raise exception 'GBS_RELEVE_DESEQUILIBRE: solde d''ouverture + opérations ≠ solde de clôture' using errcode = 'P0001';
  end if;

  perform set_config('gbs.rpc', 'releve', true);
  insert into gbs.releves_bancaires (compte_id, format, empreinte, date_debut, date_fin, solde_ouverture, solde_cloture, nb_lignes, nb_doublons, importe_par)
  values (p_compte, p_format, p_empreinte, p_date_debut, p_date_fin, p_solde_ouverture, p_solde_cloture, n, dbl, auth.uid())
  returning id into r;
  rang := 0;
  for x in select value from jsonb_array_elements(p_lignes) loop
    rang := rang + 1;
    continue when dup[rang];
    insert into gbs.lignes_releve (releve_id, compte_id, cle, date_operation, date_valeur, montant, devise, libelle, reference, contrepartie)
    values (r, p_compte, cles[rang], (x ->> 'date_operation')::date, nullif(x ->> 'date_valeur', '')::date, (x ->> 'montant')::numeric, c.devise,
            trim(x ->> 'libelle'), nullif(trim(coalesce(x ->> 'reference', '')), ''), nullif(trim(coalesce(x ->> 'contrepartie', '')), ''));
  end loop;
  perform set_config('gbs.rpc', '', true);
  auto := gbs_private.rapprocher_auto(p_compte);
  return query select r, n, dbl, auto;
end $$;

-- -----------------------------------------------------------------------------
-- Rapprochement manuel
-- -----------------------------------------------------------------------------
-- Propositions : même société, même devise, montant à l'écart admis près, dates proches.
create or replace function gbs.propositions_rapprochement(p_ligne uuid)
returns table (type text, id uuid, reference text, date_op date, montant numeric, devise text, ecart numeric, libelle text)
language plpgsql stable security definer set search_path = '' as $$
declare l gbs.lignes_releve; c gbs.comptes_bancaires; tol numeric; j int;
begin
  select * into l from gbs.lignes_releve where lignes_releve.id = p_ligne;
  perform gbs_private.exiger(l.id is not null and gbs_private.compte_bancaire_visible(l.compte_id));
  select * into c from gbs.comptes_bancaires where comptes_bancaires.id = l.compte_id;
  tol := gbs_private.param_num('banque.ecart_max', l.date_operation);
  j := gbs_private.param_num('banque.fenetre_jours', l.date_operation)::int;
  if l.montant > 0 then
    return query
    select 'encaissement'::text, x.id, coalesce(x.reference, f.numero), x.recu_le, x.montant, x.devise::text, x.montant - l.montant, f.numero::text
      from gbs.encaissements x join gbs.factures f on f.id = x.facture_id
     where f.societe_id = c.societe_id and x.devise = l.devise and l.montant between x.montant * (1 - tol) and x.montant
       and x.recu_le between l.date_operation - j and l.date_operation + j
       and not exists (select 1 from gbs.lignes_releve y where y.encaissement_id = x.id)
     order by abs(x.montant - l.montant), abs(x.recu_le - l.date_operation) limit 20;
  else
    return query
    select 'paiement'::text, p.id, coalesce(p.reference_transaction, p.reference), p.execute_le::date, p.montant, p.devise::text, -l.montant - p.montant, p.reference::text
      from gbs.paiements_fournisseurs p join gbs.dossiers d on d.id = p.dossier_id
     where d.societe_id = c.societe_id and p.flux = 'gbs' and p.statut in ('execute','confirme_client') and p.devise = l.devise
       and -l.montant between p.montant and p.montant * (1 + tol)
       and p.execute_le::date between l.date_operation - j and l.date_operation + j
       and not exists (select 1 from gbs.lignes_releve y where y.paiement_id = p.id)
     order by abs(-l.montant - p.montant), abs(p.execute_le::date - l.date_operation) limit 20;
  end if;
end $$;

-- Pointage : la ligne bancaire confirme un encaissement (crédit) ou un paiement (débit).
-- L'écart, toujours en défaveur de GBS et limité, devient un frais bancaire du dossier.
create or replace function gbs.pointer_ligne_releve(p_ligne uuid, p_encaissement uuid default null, p_paiement uuid default null)
returns gbs.lignes_releve language plpgsql security definer set search_path = '' as $$
declare l gbs.lignes_releve; c gbs.comptes_bancaires; att numeric; dev text; soc uuid; dos uuid; ecart numeric; cout uuid; tol numeric;
begin
  select * into l from gbs.lignes_releve where id = p_ligne for update;
  perform gbs_private.exiger(l.id is not null and gbs_private.compte_bancaire_visible(l.compte_id));
  if l.statut <> 'a_rapprocher' then raise exception 'GBS_LIGNE_DEJA_TRAITEE' using errcode = 'P0001'; end if;
  if num_nonnulls(p_encaissement, p_paiement) <> 1 then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  select * into c from gbs.comptes_bancaires where id = l.compte_id;
  if p_encaissement is not null then
    if l.montant < 0 then raise exception 'GBS_RAPPROCHEMENT_SENS: un débit ne confirme pas un encaissement' using errcode = 'P0001'; end if;
    select e.montant, e.devise, f.societe_id, f.dossier_id into att, dev, soc, dos
      from gbs.encaissements e join gbs.factures f on f.id = e.facture_id where e.id = p_encaissement;
    if exists (select 1 from gbs.lignes_releve y where y.encaissement_id = p_encaissement) then
      raise exception 'GBS_DEJA_RAPPROCHE' using errcode = 'P0001';
    end if;
    ecart := att - l.montant;
  else
    if l.montant > 0 then raise exception 'GBS_RAPPROCHEMENT_SENS: un crédit ne confirme pas un paiement' using errcode = 'P0001'; end if;
    select p.montant, p.devise, d.societe_id, p.dossier_id into att, dev, soc, dos
      from gbs.paiements_fournisseurs p join gbs.dossiers d on d.id = p.dossier_id
     where p.id = p_paiement and p.flux = 'gbs' and p.statut in ('execute','confirme_client');
    if exists (select 1 from gbs.lignes_releve y where y.paiement_id = p_paiement) then
      raise exception 'GBS_DEJA_RAPPROCHE' using errcode = 'P0001';
    end if;
    ecart := -l.montant - att;
  end if;
  if att is null or soc <> c.societe_id or dev <> l.devise then
    raise exception 'GBS_RAPPROCHEMENT_INCOMPATIBLE: autre société, autre devise ou opération introuvable' using errcode = 'P0001';
  end if;
  tol := gbs_private.param_num('banque.ecart_max', l.date_operation);
  if ecart < 0 or ecart > round(att * tol, 2) then
    raise exception 'GBS_RAPPROCHEMENT_MONTANT: écart hors de la tolérance' using errcode = 'P0001';
  end if;
  if ecart > 0 then
    insert into gbs.couts (nature, dossier_id, frais_generaux, categorie, libelle, date_cout, devise, montant_ht)
    values ('cout', dos, dos is null, 'frais_bancaires', left('Frais bancaires — ' || l.libelle, 300), l.date_operation, l.devise, ecart)
    returning id into cout;
  end if;
  perform set_config('gbs.rpc', 'releve', true);
  update gbs.lignes_releve set statut = 'rapprochee', encaissement_id = p_encaissement, paiement_id = p_paiement, cout_id = cout,
         automatique = false, rapproche_par = auth.uid(), rapproche_le = now()
   where id = p_ligne returning * into l;
  perform set_config('gbs.rpc', '', true);
  return l;
end $$;

-- Opération sans pendant dans l'application : frais bancaires (au dossier ou en frais
-- généraux), virement entre comptes du groupe, ou autre avec motif.
create or replace function gbs.classer_ligne_releve(p_ligne uuid, p_classement text, p_motif text, p_dossier uuid default null)
returns gbs.lignes_releve language plpgsql security definer set search_path = '' as $$
declare l gbs.lignes_releve; c gbs.comptes_bancaires; cout uuid;
begin
  select * into l from gbs.lignes_releve where id = p_ligne for update;
  perform gbs_private.exiger(l.id is not null and gbs_private.compte_bancaire_visible(l.compte_id));
  if l.statut <> 'a_rapprocher' then raise exception 'GBS_LIGNE_DEJA_TRAITEE' using errcode = 'P0001'; end if;
  if p_classement not in ('frais_bancaires','virement_interne','autre') or length(trim(coalesce(p_motif, ''))) not between 5 and 1000 then
    raise exception 'GBS_MOTIF_OBLIGATOIRE' using errcode = '22023';
  end if;
  select * into c from gbs.comptes_bancaires where id = l.compte_id;
  if p_classement = 'frais_bancaires' then
    if l.montant > 0 then raise exception 'GBS_RAPPROCHEMENT_SENS: des frais sont un débit' using errcode = 'P0001'; end if;
    if p_dossier is not null and not exists (select 1 from gbs.dossiers d where d.id = p_dossier and d.societe_id = c.societe_id) then
      raise exception 'GBS_RAPPROCHEMENT_INCOMPATIBLE: dossier d''une autre société' using errcode = 'P0001';
    end if;
    insert into gbs.couts (nature, dossier_id, frais_generaux, categorie, libelle, date_cout, devise, montant_ht)
    values ('cout', p_dossier, p_dossier is null, 'frais_bancaires', left('Frais bancaires — ' || l.libelle, 300), l.date_operation, l.devise, -l.montant)
    returning id into cout;
  elsif p_dossier is not null then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform set_config('gbs.rpc', 'releve', true);
  update gbs.lignes_releve set statut = 'classee', classement = p_classement, motif = trim(p_motif), cout_id = cout,
         rapproche_par = auth.uid(), rapproche_le = now()
   where id = p_ligne returning * into l;
  perform set_config('gbs.rpc', '', true);
  return l;
end $$;

-- Annulation d'un pointage erroné : motivée, réservée à l'administratrice ; un frais
-- bancaire déjà créé n'est pas effacé (coût validé, à corriger par une saisie inverse).
create or replace function gbs.annuler_rapprochement(p_ligne uuid, p_motif text)
returns gbs.lignes_releve language plpgsql security definer set search_path = '' as $$
declare l gbs.lignes_releve;
begin
  select * into l from gbs.lignes_releve where id = p_ligne for update;
  perform gbs_private.exiger(l.id is not null and gbs_private.is_admin());
  if l.statut = 'a_rapprocher' then raise exception 'GBS_LIGNE_NON_TRAITEE' using errcode = 'P0001'; end if;
  if l.cout_id is not null then raise exception 'GBS_RAPPROCHEMENT_AVEC_FRAIS: corrigez d''abord le frais bancaire enregistré' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_motif, ''))) not between 5 and 1000 then raise exception 'GBS_MOTIF_OBLIGATOIRE' using errcode = '22023'; end if;
  perform gbs_private.journaliser('annulation_rapprochement', 'lignes_releve', p_ligne::text, null, to_jsonb(l), null, trim(p_motif));
  perform set_config('gbs.rpc', 'releve', true);
  update gbs.lignes_releve set statut = 'a_rapprocher', encaissement_id = null, paiement_id = null, classement = null, motif = null,
         automatique = false, rapproche_par = null, rapproche_le = null
   where id = p_ligne returning * into l;
  perform set_config('gbs.rpc', '', true);
  return l;
end $$;

-- Contrôle : encaissements par virement, chèque ou lettre de crédit déclarés depuis plus de
-- N jours sur une société dotée d'un compte importé, qu'aucune ligne bancaire ne confirme.
create or replace function gbs.encaissements_non_confirmes(p_jours int default null)
returns table (encaissement_id uuid, facture text, societe text, recu_le date, montant numeric, devise text, mode text, reference text, jours int)
language plpgsql stable security definer set search_path = '' as $$
declare j int := coalesce(p_jours, gbs_private.param_num('banque.alerte_non_rapproche_jours')::int);
begin
  perform gbs_private.exiger(gbs_private.finance());
  if j not between 0 and 365 then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  return query
  select e.id, f.numero::text, s.code::text, e.recu_le, e.montant, e.devise::text, e.mode, e.reference, (current_date - e.recu_le)::int
    from gbs.encaissements e join gbs.factures f on f.id = e.facture_id join gbs.societes s on s.id = f.societe_id
   where gbs_private.societe_ok(f.societe_id) and e.mode in ('virement','cheque','lettre_credit')
     and e.recu_le <= current_date - j
     and exists (select 1 from gbs.comptes_bancaires b join gbs.releves_bancaires r on r.compte_id = b.id
                  where b.societe_id = f.societe_id and b.devise = e.devise and r.date_fin >= e.recu_le)
     and not exists (select 1 from gbs.lignes_releve l where l.encaissement_id = e.id)
   order by e.recu_le;
end $$;

-- -----------------------------------------------------------------------------
-- Droits
-- -----------------------------------------------------------------------------
alter table gbs.comptes_bancaires enable row level security;
alter table gbs.releves_bancaires enable row level security;
alter table gbs.lignes_releve enable row level security;
grant select, insert on gbs.comptes_bancaires to authenticated;
grant update (libelle, banque, actif) on gbs.comptes_bancaires to authenticated;
grant select on gbs.releves_bancaires, gbs.lignes_releve to authenticated;

create policy comptes_bancaires_lecture on gbs.comptes_bancaires for select using (gbs_private.finance() and gbs_private.societe_ok(societe_id));
create policy comptes_bancaires_creation on gbs.comptes_bancaires for insert with check (gbs_private.is_admin());
create policy comptes_bancaires_maj on gbs.comptes_bancaires for update using (gbs_private.is_admin());
create policy releves_bancaires_lecture on gbs.releves_bancaires for select using (gbs_private.compte_bancaire_visible(compte_id));
create policy lignes_releve_lecture on gbs.lignes_releve for select using (gbs_private.compte_bancaire_visible(compte_id));

revoke execute on function gbs.importer_releve(uuid, text, text, date, date, numeric, numeric, jsonb),
  gbs.propositions_rapprochement(uuid), gbs.pointer_ligne_releve(uuid, uuid, uuid), gbs.classer_ligne_releve(uuid, text, text, uuid),
  gbs.annuler_rapprochement(uuid, text), gbs.encaissements_non_confirmes(int),
  gbs_private.compte_bancaire_visible(uuid), gbs_private.trg_compte_bancaire(), gbs_private.trg_ligne_releve(),
  gbs_private.trg_releve_bancaire(),
  gbs_private.rapprocher_auto(uuid) from public;
grant execute on function gbs.importer_releve(uuid, text, text, date, date, numeric, numeric, jsonb),
  gbs.propositions_rapprochement(uuid), gbs.pointer_ligne_releve(uuid, uuid, uuid), gbs.classer_ligne_releve(uuid, text, text, uuid),
  gbs.annuler_rapprochement(uuid, text), gbs.encaissements_non_confirmes(int) to authenticated;
grant execute on all functions in schema gbs_private to authenticated, service_role;
revoke execute on function gbs_private.rapprocher_auto(uuid) from authenticated;
