-- =============================================================================
-- Lot 0 — Règles de gestion exécutées en base : calcul de la commission (ordre
-- de la section 5), les deux verrous, contrôle à quatre yeux, agrément,
-- complétude, facturation et FNE, flux entre sociétés, tableau de bord.
-- Toutes les fonctions publiques vérifient elles-mêmes les droits.
-- =============================================================================

create or replace function private.rpc(p text) returns void
language sql as $$ select set_config('gbs.rpc', p, true) $$;

create or replace function private.exiger(p_ok boolean, p_code text default 'GBS_ACCES_REFUSE')
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception '%', p_code using errcode = '42501';
  end if;
end $$;

create or replace function private.est_validateur() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.role() = 'admin'
      or (private.role() is not null and coalesce((private.profil()).delegue_validation, false))
$$;

-- Visibilité d'un dossier à partir de ses colonnes (utilisable dans les politiques,
-- y compris pour la ligne en cours d'insertion).
create or replace function private.dossier_visible_cols(p_id uuid, p_societe uuid, p_pays text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case private.role()
    when 'admin' then true
    when 'achats_chine' then true
    when 'hub_afrique' then private.societe_ok(p_societe)
    when 'comptable' then private.societe_ok(p_societe)
    when 'agent_pays' then p_pays = (private.profil()).pays
    when 'inspecteur' then exists (select 1 from public.inspections i where i.dossier_id = p_id
                                   and i.inspecteur_id = auth.uid())
    else false end
$$;

-- Visibilité d'un dossier selon le rôle (section 2).
create or replace function private.dossier_visible(p_dossier uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case private.role()
    when 'admin' then true
    when 'achats_chine' then true
    when 'hub_afrique' then exists (select 1 from public.dossiers d where d.id = p_dossier and private.societe_ok(d.societe_id))
    when 'comptable' then exists (select 1 from public.dossiers d where d.id = p_dossier and private.societe_ok(d.societe_id))
    when 'agent_pays' then exists (select 1 from public.dossiers d where d.id = p_dossier
                                   and d.pays = (private.profil()).pays)
    when 'inspecteur' then exists (select 1 from public.inspections i where i.dossier_id = p_dossier
                                   and i.inspecteur_id = auth.uid())
    else false end
$$;

-- -----------------------------------------------------------------------------
-- Calcul de la commission (section 5, « Calcul de la commission, dans cet ordre »)
-- -----------------------------------------------------------------------------
create or replace function private.taux_tranche(p_base numeric, p_date date) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare b jsonb := private.param('commission.bareme', p_date); t jsonb;
begin
  if b is null then raise exception 'GBS_PARAM_MANQUANT: commission.bareme' using errcode = 'P0001'; end if;
  for t in select * from jsonb_array_elements(b) loop
    if t->>'jusqu_a' is null or p_base <= (t->>'jusqu_a')::numeric then
      return (t->>'taux')::numeric;
    end if;
  end loop;
  raise exception 'GBS_BAREME_INCOMPLET' using errcode = 'P0001';
end $$;

-- Calcul détaillé. p_date_change : date du cours de conversion (signature du devis).
create or replace function private.calcul_commission(p_dossier uuid, p_date_change date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  d public.dossiers; k public.dossiers; dref date; dchg date; dev public.devis;
  r record; base numeric := 0; lignes jsonb := '[]'::jsonb;
  taux_base numeric; maj numeric; remise numeric := 0; red_reassort numeric; minimum numeric;
  com numeric := 0; total numeric; ded_consult numeric := 0; ded_dd numeric := 0; ded numeric;
  premier_contrat date; t1_brut numeric; ded_t1 numeric; t1 numeric; t2 numeric;
  projet boolean; ecart_max numeric := 0; seuil_ecart numeric; v numeric; taux_l numeric; com_l numeric;
begin
  select * into d from public.dossiers where id = p_dossier;
  if d.id is null then raise exception 'GBS_DOSSIER_INCONNU' using errcode = 'P0002'; end if;
  dref := d.ouvert_le;     -- règles datées en vigueur à l'ouverture du dossier
  select * into dev from public.devis where dossier_id = p_dossier and statut = 'accepte'
   order by version desc limit 1;
  dchg := coalesce(p_date_change, dev.accepte_le, current_date);
  projet := d.modele = 'equipement_site';
  maj := private.param_num('commission.majoration_sur_mesure', dref);
  red_reassort := private.param_num('commission.reduction_reassort', dref);
  minimum := private.param_num('commission.minimum_xof', dref);
  seuil_ecart := private.param_num('commission.seuil_ecart_change', dref);

  -- 1. Base : valeur FOB de toutes les commandes du dossier, en XOF au cours de la signature du devis.
  for r in
    select c.id as commande_id, c.reference, c.devise, c.fob_montant, c.montant_marchandise,
           l.id as ligne_id, l.montant, coalesce(l.sur_mesure, c.sur_mesure) as sur_mesure,
           coalesce(l.reassort, false) as reassort
    from public.commandes c
    left join public.lignes_commande l on l.commande_id = c.id
    where c.dossier_id = p_dossier and c.statut <> 'annulee'
    union all
    -- Avant toute commande, le devis se calcule sur les offres retenues.
    select o.id, 'OFFRE ' || f.raison_sociale_en, o.devise, o.fob_montant, o.montant, null::uuid, null::numeric,
           o.sur_mesure, o.reassort
    from public.offres o join public.fournisseurs f on f.id = o.fournisseur_id
    where o.dossier_id = p_dossier and o.retenue
      and not exists (select 1 from public.commandes c where c.dossier_id = p_dossier and c.statut <> 'annulee')
    order by 2
  loop
    v := case when r.ligne_id is null then r.fob_montant
              when coalesce(r.montant_marchandise, 0) = 0 then 0
              else r.montant * r.fob_montant / r.montant_marchandise end;
    v := round(coalesce(v, 0) * private.taux_xof(r.devise, dchg));
    base := base + v;
    lignes := lignes || jsonb_build_object('commande', r.reference, 'ligne', r.ligne_id, 'devise', r.devise,
                'fob_xof', v, 'sur_mesure', r.sur_mesure, 'reassort', r.reassort);
    -- Écart de change entre le devis et la signature du contrat
    if r.devise <> 'XOF' then
      select min(contrat_signe_le) into premier_contrat from public.commandes
       where dossier_id = p_dossier and contrat_signe_le is not null and statut <> 'annulee';
      if premier_contrat is not null then
        ecart_max := greatest(ecart_max, abs(private.taux_xof(r.devise, premier_contrat)
                                             / private.taux_xof(r.devise, dchg) - 1));
      end if;
    end if;
  end loop;

  -- 2. Taux de la tranche (lu sur la valeur totale), ou taux réduit du forfait au projet.
  taux_base := case when projet then d.taux_commission_projet else private.taux_tranche(base, dref) end;

  -- 3. Remise d'accord-cadre
  if d.cadre_id is not null then
    select * into k from public.dossiers where id = d.cadre_id;
    remise := case when coalesce(k.engagement_annuel_xof, 0) > private.param_num('accord_cadre.seuil_engagement_xof', dref)
                   then private.param_num('accord_cadre.remise_majoree', dref)
                   else private.param_num('accord_cadre.remise', dref) end;
  end if;

  -- 2 à 4, ligne par ligne : +2 points sur mesure, remise d'accord-cadre, -50 % en réassort.
  for r in select * from jsonb_array_elements(lignes) e(x) loop
    taux_l := greatest(taux_base + case when (r.x->>'sur_mesure')::boolean then maj else 0 end - remise, 0);
    com_l := (r.x->>'fob_xof')::numeric * taux_l
             * case when (r.x->>'reassort')::boolean then 1 - red_reassort else 1 end;
    com := com + com_l;
  end loop;
  com := round(com);

  -- 5. Minimum par dossier, appliqué une fois au total.
  total := case when base = 0 then 0 else greatest(com, minimum) end;

  -- 6. Déduction du forfait de consultation déjà payé (pas pour un forfait au projet).
  if not projet then
    select coalesce(sum(round(private.to_xof(f.montant_ht, f.devise, f.date_emission))), 0) into ded_consult
      from public.factures f
     where f.dossier_id = p_dossier and f.type = 'forfait_consultation' and f.statut = 'payee';
  end if;

  -- 7. Déduction de 50 % d'une vérification de fournisseur commandée dans les 90 jours
  --    qui précèdent la signature du premier contrat d'achat du dossier.
  select min(contrat_signe_le) into premier_contrat from public.commandes
   where dossier_id = p_dossier and contrat_signe_le is not null and statut <> 'annulee';
  if premier_contrat is not null then
    select coalesce(sum(round(private.to_xof(f.montant_ht, f.devise, f.date_emission)
                        * private.param_num('due_diligence.taux_deduction', dref))), 0) into ded_dd
      from public.factures f
     where f.client_id = d.client_id and f.type = 'due_diligence'
       and f.statut not in ('brouillon','annulee')
       and f.date_emission between premier_contrat - private.param_num('due_diligence.jours_deduction', dref)::int
                               and premier_contrat;
  end if;
  -- Rien n'est remboursé : les déductions sont plafonnées à la commission.
  ded := least(ded_consult + ded_dd, total);

  -- 8. Facturation : 50 % à la signature du premier contrat, le solde avant le départ.
  t1_brut := round(total * private.param_num('commission.part_premiere_facture', dref));
  ded_t1 := least(ded, t1_brut);
  t1 := t1_brut - ded_t1;
  t2 := total - t1_brut - (ded - ded_t1);

  return jsonb_build_object(
    'dossier', d.reference, 'date_regles', dref, 'date_change', dchg,
    'base_fob_xof', base, 'taux_tranche', taux_base, 'forfait_projet', projet,
    'majoration_sur_mesure', maj, 'remise_accord_cadre', remise, 'reduction_reassort', red_reassort,
    'commission_calculee', com, 'minimum', minimum, 'minimum_applique', base > 0 and com < minimum,
    'commission_totale', total,
    'deduction_forfait_consultation', least(ded_consult, total),
    'deduction_verification_fournisseur', least(ded_dd, greatest(total - ded_consult, 0)),
    'commission_nette', total - ded, 'deductions_totales', ded,
    'premiere_facture', t1, 'solde', t2,
    'ecart_change_max', round(ecart_max, 4), 'recalcul_requis', ecart_max > seuil_ecart,
    'lignes', lignes);
end $$;

create or replace function public.calcul_commission(p_dossier uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exiger(private.has_role('admin','hub_afrique','agent_pays','comptable')
                         and private.dossier_visible(p_dossier));
  return private.calcul_commission(p_dossier, null);
end $$;

-- -----------------------------------------------------------------------------
-- Verrous (section 5, « Les deux verrous »)
-- -----------------------------------------------------------------------------
create or replace function private.verrou1_contrat_ok(p_commande uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.commandes c join public.dossiers d on d.id = c.dossier_id
    where c.id = p_commande and c.contrat_valide_le is not null
      and exists (select 1 from public.devis v where v.dossier_id = d.id and v.statut = 'accepte'
                  and v.mandat_valide_le is not null))
$$;

create or replace function private.verrou1_production_ok(p_commande uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare c public.commandes;
begin
  select * into c from public.commandes where id = p_commande;
  if not private.verrou1_contrat_ok(p_commande) then
    return 'GBS_VERROU1: mandat client et contrat fournisseur signés exigés';
  end if;
  if not exists (select 1 from public.paiements_fournisseurs p where p.commande_id = p_commande
                 and p.nature = 'acompte' and p.statut in ('execute','confirme_client') and p.justificatif is not null) then
    return 'GBS_VERROU1_ACOMPTE: justificatif de l''acompte versé au fournisseur exigé';
  end if;
  if (c.sur_mesure or exists (select 1 from public.lignes_commande l where l.commande_id = p_commande and l.sur_mesure))
     and c.approbation_valide_le is null then
    return 'GBS_VERROU1_APPROBATION: commande sur mesure sans approbation technique signée par le client';
  end if;
  return null;
end $$;

create or replace function private.verrou2_inspection_ok(p_commande uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.inspections i where i.commande_id = p_commande
                 and i.type in ('avant_expedition','contre_inspection') and i.statut = 'validee' and i.decision = 'liberation')
      or exists (select 1 from public.derogations g where g.commande_id = p_commande and g.objet = 'verrou_inspection')
$$;

-- Factures de commission dues réglées avant le départ (section 5).
create or replace function private.commission_reglee(p_dossier uuid, p_expedition uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select mode_financier from public.dossiers where id = p_dossier) <> 'accompagne'
      or (exists (select 1 from public.factures f where f.dossier_id = p_dossier and f.type = 'commission')
          and not exists (select 1 from public.factures f where f.dossier_id = p_dossier and f.type = 'commission'
                          and f.statut not in ('payee','annulee'))
          and exists (select 1 from public.factures f where f.dossier_id = p_dossier and f.type = 'commission'
                      and f.tranche = 2 and f.statut = 'payee'))
      or exists (select 1 from public.derogations g where g.dossier_id = p_dossier and g.objet = 'commission_impayee'
                 and (g.expedition_id is null or g.expedition_id = p_expedition))
$$;

-- -----------------------------------------------------------------------------
-- Commandes : création contrôlée et changements de statut
-- -----------------------------------------------------------------------------
create or replace function private.trg_commande() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d public.dossiers; f public.fournisseurs; n int; rpc text := coalesce(current_setting('gbs.rpc', true), '');
begin
  select * into d from public.dossiers where id = new.dossier_id;
  select * into f from public.fournisseurs where id = new.fournisseur_id;
  if tg_op = 'INSERT' then
    if d.statut <> 'ouvert' then raise exception 'GBS_DOSSIER_FERME' using errcode = 'P0001'; end if;
    if d.mode_financier = 'service_seul' then
      raise exception 'GBS_SERVICE_SEUL_SANS_ACHAT: ce dossier ne comporte pas d''achat' using errcode = 'P0001';
    end if;
    if not private.fournisseur_commandable(new.fournisseur_id) then
      raise exception 'GBS_FOURNISSEUR_NON_AGREE: fournisseur non agréé ou due diligence expirée' using errcode = 'P0001';
    end if;
    if new.incoterm in ('EXW','DDP') and new.derogation_incoterm is null then
      raise exception 'GBS_INCOTERM_BLOQUE: % exige une dérogation motivée de l''administratrice', new.incoterm
        using errcode = 'P0001';
    end if;
    if new.derogation_incoterm is not null and not private.is_admin() then
      raise exception 'GBS_DEROGATION_ADMIN' using errcode = '42501';
    end if;
    new.statut := 'brouillon';
    new.contrat_valide_le := null; new.contrat_valide_par := null;
    new.approbation_valide_le := null; new.approbation_valide_par := null;
    perform pg_advisory_xact_lock(7318);
    select count(*) + 1 into n from public.commandes where dossier_id = new.dossier_id;
    new.reference := 'CMD-' || substring(d.reference from 5) || '-' || lpad(n::text, 2, '0');
  else
    if new.montant_marchandise is distinct from old.montant_marchandise and rpc <> 'recalcul_commande' then
      raise exception 'GBS_MONTANTS_CALCULES: le montant découle des lignes de commande' using errcode = 'P0001';
    end if;
    if new.dossier_id <> old.dossier_id or new.fournisseur_id <> old.fournisseur_id or new.devise <> old.devise
       or new.reference <> old.reference then
      raise exception 'GBS_COMMANDE_FIGEE' using errcode = 'P0001';
    end if;
    if new.statut <> old.statut and rpc <> 'changer_statut_commande' then
      raise exception 'GBS_VALIDATION_RPC: le statut change par changer_statut_commande()' using errcode = 'P0001';
    end if;
    if (new.contrat_valide_le is distinct from old.contrat_valide_le and rpc <> 'valider_contrat')
       or (new.approbation_valide_le is distinct from old.approbation_valide_le and rpc <> 'valider_approbation') then
      raise exception 'GBS_VALIDATION_RPC' using errcode = 'P0001';
    end if;
    if old.contrat_valide_le is not null and rpc not in ('changer_statut_commande','valider_approbation','recalcul_commande')
       and (new.incoterm, new.lieu, new.fret, new.assurance, new.frais_jusqu_a_bord, new.sur_mesure, new.montant_marchandise,
            new.contrat_document, new.contrat_mode, new.contrat_signe_le)
           is distinct from (old.incoterm, old.lieu, old.fret, old.assurance, old.frais_jusqu_a_bord, old.sur_mesure,
            old.montant_marchandise, old.contrat_document, old.contrat_mode, old.contrat_signe_le) then
      raise exception 'GBS_DOCUMENT_SIGNE: contrat signé ; passez par un avenant' using errcode = 'P0001';
    end if;
  end if;
  new.fob_montant := private.base_fob(new.incoterm, new.montant_marchandise, new.fret, new.assurance,
                                      new.frais_jusqu_a_bord, current_date);
  return new;
end $$;
create trigger commandes_regles before insert or update on public.commandes
  for each row execute function private.trg_commande();

-- Registre des fournisseurs présentés : inscription automatique à la commande.
create or replace function private.trg_commande_registre() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not (select apporte_par_client from public.fournisseurs where id = new.fournisseur_id) then
    insert into public.registre_presentations (client_id, fournisseur_id, dossier_id, origine)
    select d.client_id, new.fournisseur_id, d.id, 'commande' from public.dossiers d where d.id = new.dossier_id
    on conflict do nothing;
  end if;
  return null;
end $$;
create trigger commandes_registre after insert on public.commandes
  for each row execute function private.trg_commande_registre();

-- Lignes : montant de la commande tenu à jour ; figées après signature du contrat.
create or replace function private.trg_ligne_commande() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c public.commandes;
begin
  select * into c from public.commandes where id = coalesce(new.commande_id, old.commande_id);
  if c.contrat_valide_le is not null then
    raise exception 'GBS_DOCUMENT_SIGNE: lignes figées après signature ; passez par un avenant' using errcode = 'P0001';
  end if;
  if tg_op <> 'DELETE' then new.dossier_id := c.dossier_id; return new; end if;
  return old;
end $$;
create or replace function private.trg_ligne_commande_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cid uuid := coalesce(new.commande_id, old.commande_id);
        prev text := coalesce(current_setting('gbs.rpc', true), '');
begin
  perform private.rpc('recalcul_commande');
  update public.commandes c set
    montant_marchandise = coalesce((select sum(montant) from public.lignes_commande where commande_id = cid), 0),
    sur_mesure = c.sur_mesure or exists (select 1 from public.lignes_commande where commande_id = cid and sur_mesure)
  where c.id = cid;
  perform private.rpc('');
  perform private.rpc(prev);
  return null;
end $$;
drop trigger if exists lignes_commande_nodel on public.lignes_commande;
create trigger lignes_commande_regles before insert or update or delete on public.lignes_commande
  for each row execute function private.trg_ligne_commande();
create trigger lignes_commande_calc after insert or update or delete on public.lignes_commande
  for each row execute function private.trg_ligne_commande_after();

create or replace function public.changer_statut_commande(p_commande uuid, p_statut text, p_motif text default null)
returns public.commandes language plpgsql security definer set search_path = '' as $$
declare c public.commandes; err text;
begin
  perform private.exiger(private.has_role('admin','achats_chine'));
  select * into c from public.commandes where id = p_commande for update;
  if c.id is null then raise exception 'GBS_COMMANDE_INCONNUE' using errcode = 'P0002'; end if;
  if p_statut = 'annulee' then
    perform private.exiger(private.is_admin(), 'GBS_ANNULATION_ADMIN');
    perform private.motif(p_motif);
  elsif not ((c.statut, p_statut) in (('brouillon','contrat_signe'), ('contrat_signe','en_production'),
                                      ('en_production','production_terminee'))) then
    raise exception 'GBS_TRANSITION_INVALIDE: % vers %', c.statut, p_statut using errcode = 'P0001';
  end if;
  if p_statut = 'contrat_signe' and c.contrat_valide_le is null then
    raise exception 'GBS_VERROU1: contrat fournisseur non validé' using errcode = 'P0001';
  end if;
  if p_statut = 'en_production' then
    err := private.verrou1_production_ok(p_commande);
    if err is not null then raise exception '%', err using errcode = 'P0001'; end if;
  end if;
  perform private.rpc('changer_statut_commande');
  update public.commandes set statut = p_statut,
         annule_le = case when p_statut = 'annulee' then now() else annule_le end
   where id = p_commande returning * into c;
  perform private.rpc('');
  return c;
end $$;

-- Lot 0 : la signature électronique est hors outil ; l'administratrice valide le
-- document signé déposé (ou le contrat au cachet contrôlé par les achats).
create or replace function public.valider_mandat(p_devis uuid, p_document text, p_signe_le date)
returns public.devis language plpgsql security definer set search_path = '' as $$
declare v public.devis; calc jsonb;
begin
  perform private.exiger(private.is_admin(), 'GBS_VALIDATION_ADMIN');
  if p_document is null or length(p_document) > 400 or p_signe_le is null or p_signe_le > current_date then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  select * into v from public.devis where id = p_devis for update;
  if v.statut not in ('envoye','accepte') then
    raise exception 'GBS_DEVIS_NON_ENVOYE' using errcode = 'P0001';
  end if;
  calc := private.calcul_commission(v.dossier_id, p_signe_le);
  perform private.rpc('valider_mandat');
  update public.devis set statut = 'remplace' where dossier_id = v.dossier_id and id <> v.id and statut = 'accepte';
  update public.devis set statut = 'accepte', accepte_le = p_signe_le, mandat_document = p_document,
         mandat_valide_par = auth.uid(), mandat_valide_le = now(),
         calcul = calc, commission_ht = (calc->>'commission_totale')::numeric
   where id = p_devis returning * into v;
  return v;
end $$;

create or replace function public.calculer_devis(p_devis uuid)
returns public.devis language plpgsql security definer set search_path = '' as $$
declare v public.devis; calc jsonb;
begin
  select * into v from public.devis where id = p_devis for update;
  perform private.exiger(private.has_role('admin','hub_afrique','agent_pays') and private.dossier_visible(v.dossier_id));
  if v.mandat_valide_le is not null then
    raise exception 'GBS_DOCUMENT_SIGNE: créez une nouvelle version' using errcode = 'P0001';
  end if;
  calc := private.calcul_commission(v.dossier_id, null);
  update public.devis set calcul = calc, commission_ht = (calc->>'commission_totale')::numeric
   where id = p_devis returning * into v;
  return v;
end $$;

create or replace function public.valider_contrat(p_commande uuid, p_document text, p_mode text, p_signe_le date)
returns public.commandes language plpgsql security definer set search_path = '' as $$
declare c public.commandes; d public.dossiers;
begin
  perform private.exiger(private.is_admin(), 'GBS_VALIDATION_ADMIN');
  if p_document is null or length(p_document) > 400 or p_mode not in ('electronique','cachet')
     or p_signe_le is null or p_signe_le > current_date then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  select * into c from public.commandes where id = p_commande for update;
  select * into d from public.dossiers where id = c.dossier_id;
  if not exists (select 1 from public.devis v where v.dossier_id = c.dossier_id and v.statut = 'accepte'
                 and v.mandat_valide_le is not null) then
    raise exception 'GBS_VERROU1: le mandat client doit être signé avant le contrat fournisseur' using errcode = 'P0001';
  end if;
  if not private.fournisseur_commandable(c.fournisseur_id) then
    raise exception 'GBS_FOURNISSEUR_NON_AGREE: fournisseur non agréé ou due diligence expirée' using errcode = 'P0001';
  end if;
  perform private.rpc('valider_contrat');
  update public.commandes set contrat_document = p_document, contrat_mode = p_mode, contrat_signe_le = p_signe_le,
         contrat_valide_par = auth.uid(), contrat_valide_le = now()
   where id = p_commande returning * into c;
  perform private.rpc('');
  perform private.rpc('changer_statut_commande');
  update public.commandes set statut = 'contrat_signe' where id = p_commande and statut = 'brouillon' returning * into c;
  perform private.rpc('');
  return c;
end $$;

create or replace function public.valider_approbation(p_commande uuid, p_document text)
returns public.commandes language plpgsql security definer set search_path = '' as $$
declare c public.commandes;
begin
  perform private.exiger(private.has_role('admin','achats_chine'));
  if p_document is null or length(p_document) > 400 then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform private.rpc('valider_approbation');
  update public.commandes set approbation_document = p_document, approbation_valide_par = auth.uid(),
         approbation_valide_le = now()
   where id = p_commande returning * into c;
  perform private.rpc('');
  return c;
end $$;

-- Dérogation : administratrice seule, motif inscrit au journal.
create or replace function public.deroger(p_dossier uuid, p_objet text, p_motif text,
  p_commande uuid default null, p_expedition uuid default null)
returns public.derogations language plpgsql security definer set search_path = '' as $$
declare g public.derogations;
begin
  perform private.exiger(private.is_admin(), 'GBS_DEROGATION_ADMIN');
  perform private.motif(p_motif);
  insert into public.derogations (dossier_id, commande_id, expedition_id, objet, motif, accordee_par)
  values (p_dossier, p_commande, p_expedition, p_objet, p_motif, auth.uid()) returning * into g;
  return g;
end $$;

-- -----------------------------------------------------------------------------
-- Inspection : validation (libération ou refus)
-- -----------------------------------------------------------------------------
create or replace function public.valider_inspection(p_inspection uuid, p_decision text, p_motif text default null)
returns public.inspections language plpgsql security definer set search_path = '' as $$
declare i public.inspections;
begin
  perform private.exiger(private.est_validateur(), 'GBS_VALIDATION_ADMIN');
  if p_decision not in ('liberation','refus') then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  select * into i from public.inspections where id = p_inspection for update;
  if i.statut <> 'realisee' or i.date_realisee is null then
    raise exception 'GBS_INSPECTION_NON_REALISEE' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.non_conformites n where n.inspection_id = p_inspection and n.statut <> 'close') then
    raise exception 'GBS_NC_OUVERTE: une non-conformité ouverte empêche de valider l''inspection' using errcode = 'P0001';
  end if;
  if p_decision = 'liberation' and i.decision_proposee = 'refusee' then
    perform private.exiger(private.is_admin(), 'GBS_DEROGATION_ADMIN');
    perform private.motif(p_motif);
  elsif p_motif is not null then
    perform private.motif(p_motif);
  end if;
  perform private.rpc('valider_inspection');
  update public.inspections set decision = p_decision,
         statut = case when p_decision = 'liberation' then 'validee' else 'refusee' end,
         validee_par = auth.uid(), validee_le = now()
   where id = p_inspection returning * into i;
  perform private.rpc('');
  return i;
end $$;

-- -----------------------------------------------------------------------------
-- Expéditions : passage au statut « expédiée » contrôlé
-- -----------------------------------------------------------------------------
create or replace function private.trg_expedition_statut() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.statut <> old.statut and coalesce(current_setting('gbs.rpc', true), '') <> 'changer_statut_expedition' then
    raise exception 'GBS_VALIDATION_RPC: le statut change par changer_statut_expedition()' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger expeditions_statut before update on public.expeditions
  for each row execute function private.trg_expedition_statut();

create or replace function public.changer_statut_expedition(p_expedition uuid, p_statut text)
returns public.expeditions language plpgsql security definer set search_path = '' as $$
declare e public.expeditions; ordre text[] := array['preparation','remise_transporteur','expediee','en_transit',
          'arrivee','mise_a_disposition','livree']; c record; dangereux boolean;
begin
  perform private.exiger(private.has_role('admin','achats_chine')
                         or (private.has_role('hub_afrique') and p_statut in ('arrivee','mise_a_disposition','livree')));
  select * into e from public.expeditions where id = p_expedition for update;
  perform private.exiger(private.dossier_visible(e.dossier_id));
  if array_position(ordre, p_statut) is null or array_position(ordre, p_statut) <= array_position(ordre, e.statut) then
    raise exception 'GBS_TRANSITION_INVALIDE: % vers %', e.statut, p_statut using errcode = 'P0001';
  end if;
  if array_position(ordre, p_statut) >= 3 and array_position(ordre, e.statut) < 3 then
    if not exists (select 1 from public.expedition_commandes x where x.expedition_id = e.id) then
      raise exception 'GBS_EXPEDITION_VIDE' using errcode = 'P0001';
    end if;
    -- Verrou 2 sur chaque commande
    for c in select cm.id, cm.reference from public.expedition_commandes x
             join public.commandes cm on cm.id = x.commande_id where x.expedition_id = e.id loop
      if not private.verrou2_inspection_ok(c.id) then
        raise exception 'GBS_VERROU2: aucune expédition sans inspection validée (commande %)', c.reference
          using errcode = 'P0001';
      end if;
    end loop;
    -- Facture de commission réglée
    if not private.commission_reglee(e.dossier_id, e.id) then
      raise exception 'GBS_COMMISSION_IMPAYEE: l''expédition attend le règlement de la commission' using errcode = 'P0001';
    end if;
    -- Bordereau électronique de suivi des cargaisons du pays de destination
    if e.pays_destination in ('CI','CM','GA') and e.bordereau_reference is null
       and not exists (select 1 from public.derogations g where g.expedition_id = e.id and g.objet = 'bordereau_suivi') then
      raise exception 'GBS_BORDEREAU_SUIVI: le bordereau de suivi des cargaisons (%) est exigé',
        case e.pays_destination when 'CI' then 'BSC' when 'CM' then 'BESC' else 'BIETC' end using errcode = 'P0001';
    end if;
    -- Marchandises dangereuses : FDS et déclaration au transporteur (code IMDG), UN38.3 pour les batteries
    select exists (select 1 from public.expedition_commandes x join public.lignes_commande l on l.commande_id = x.commande_id
                   join public.articles a on a.id = l.article_id where x.expedition_id = e.id and a.dangereux) into dangereux;
    if dangereux and (e.fds_document is null or e.declaration_imdg_document is null) then
      raise exception 'GBS_MARCHANDISE_DANGEREUSE: fiche de données de sécurité et déclaration IMDG exigées'
        using errcode = 'P0001';
    end if;
    if exists (select 1 from public.expedition_commandes x join public.lignes_commande l on l.commande_id = x.commande_id
               join public.articles a on a.id = l.article_id where x.expedition_id = e.id and a.dangereux
               and a.classe_danger = '9' and 'UN38.3' = any(a.certificats)) and e.un38_3_document is null then
      raise exception 'GBS_UN38_3: rapport de test UN38.3 exigé pour les batteries au lithium' using errcode = 'P0001';
    end if;
  end if;
  perform private.rpc('changer_statut_expedition');
  update public.expeditions set statut = p_statut,
         expediee_le = case when p_statut = 'expediee' then now() else expediee_le end
   where id = e.id returning * into e;
  perform private.rpc('');
  if p_statut in ('expediee','livree') then
    perform private.rpc('changer_statut_commande');
    update public.commandes set statut = case when p_statut = 'livree' then 'livree' else 'expediee' end
     where id in (select commande_id from public.expedition_commandes where expedition_id = e.id)
       and statut <> 'annulee';
  perform private.rpc('');
  end if;
  return e;
end $$;

-- -----------------------------------------------------------------------------
-- Comptes de paiement et paiements : contrôle à quatre yeux
-- -----------------------------------------------------------------------------
create or replace function public.demander_verification_compte(p_compte uuid)
returns public.comptes_paiement language plpgsql security definer set search_path = '' as $$
declare c public.comptes_paiement;
begin
  perform private.exiger(private.has_role('admin','achats_chine'));
  update public.comptes_paiement set verification_demandee_par = auth.uid(), verification_demandee_le = now()
   where id = p_compte and not verifie returning * into c;
  if c.id is null then raise exception 'GBS_COMPTE_DEJA_VERIFIE' using errcode = 'P0001'; end if;
  return c;
end $$;

create or replace function public.verifier_compte(p_compte uuid)
returns public.comptes_paiement language plpgsql security definer set search_path = '' as $$
declare c public.comptes_paiement;
begin
  perform private.exiger(private.est_validateur(), 'GBS_VALIDATION_ADMIN');
  select * into c from public.comptes_paiement where id = p_compte for update;
  if c.verification_demandee_par is null then
    raise exception 'GBS_VERIFICATION_NON_DEMANDEE' using errcode = 'P0001';
  end if;
  if c.verification_demandee_par = auth.uid() then
    raise exception 'GBS_QUATRE_YEUX: la personne qui prépare une vérification ne peut pas la valider'
      using errcode = 'P0001';
  end if;
  perform private.rpc('verifier_compte');
  update public.comptes_paiement set verifie = true, verifie_par = auth.uid(), verifie_le = now()
   where id = p_compte returning * into c;
  perform private.rpc('');
  return c;
end $$;

create or replace function public.valider_paiement(p_paiement uuid)
returns public.paiements_fournisseurs language plpgsql security definer set search_path = '' as $$
declare p public.paiements_fournisseurs; preparateur public.profils; moi public.profils := private.profil();
begin
  select * into p from public.paiements_fournisseurs where id = p_paiement for update;
  if p.id is null then raise exception 'GBS_PAIEMENT_INCONNU' using errcode = 'P0002'; end if;
  if p.statut <> 'prepare' then raise exception 'GBS_PAIEMENT_DEJA_TRAITE' using errcode = 'P0001'; end if;
  if p.prepare_par = auth.uid() then
    raise exception 'GBS_QUATRE_YEUX: un ordre de paiement ne peut pas être validé par la personne qui l''a préparé'
      using errcode = 'P0001';
  end if;
  select * into preparateur from public.profils where id = p.prepare_par;
  if preparateur.role = 'admin' then
    -- Paiement préparé par l'administratrice : seconde personne désignée nominativement.
    perform private.exiger(private.role() is not null and moi.delegue_validation, 'GBS_QUATRE_YEUX_DELEGUE');
  else
    perform private.exiger(private.est_validateur(), 'GBS_VALIDATION_ADMIN');
  end if;
  perform private.rpc('valider_paiement');
  update public.paiements_fournisseurs set statut = 'valide', valide_par = auth.uid(), valide_le = now()
   where id = p_paiement returning * into p;
  perform private.rpc('');
  return p;
end $$;

create or replace function public.executer_paiement(p_paiement uuid, p_reference text, p_justificatif text)
returns public.paiements_fournisseurs language plpgsql security definer set search_path = '' as $$
declare p public.paiements_fournisseurs;
begin
  perform private.exiger(private.has_role('admin','achats_chine'));
  if p_reference is null or length(p_reference) > 80 or p_justificatif is null or length(p_justificatif) > 400 then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  select * into p from public.paiements_fournisseurs where id = p_paiement for update;
  if p.statut <> 'valide' then raise exception 'GBS_PAIEMENT_NON_VALIDE' using errcode = 'P0001'; end if;
  perform private.rpc('executer_paiement');
  update public.paiements_fournisseurs set
    statut = case when flux = 'gbs' then 'execute' else 'confirme_client' end,
    execute_le = now(), reference_transaction = p_reference, justificatif = p_justificatif
   where id = p_paiement returning * into p;
  perform private.rpc('');
  return p;
end $$;

create or replace function public.refuser_paiement(p_paiement uuid, p_motif text)
returns public.paiements_fournisseurs language plpgsql security definer set search_path = '' as $$
declare p public.paiements_fournisseurs;
begin
  perform private.exiger(private.est_validateur(), 'GBS_VALIDATION_ADMIN');
  perform private.motif(p_motif);
  perform private.rpc('refuser_paiement');
  update public.paiements_fournisseurs set statut = 'refuse', motif_refus = p_motif
   where id = p_paiement and statut in ('prepare','valide') returning * into p;
  perform private.rpc('');
  if p.id is null then raise exception 'GBS_PAIEMENT_DEJA_TRAITE' using errcode = 'P0001'; end if;
  return p;
end $$;

-- -----------------------------------------------------------------------------
-- Due diligence et agrément
-- -----------------------------------------------------------------------------
create or replace function public.valider_due_diligence(p_dd uuid, p_statut text, p_conclusion text default null)
returns public.due_diligences language plpgsql security definer set search_path = '' as $$
declare x public.due_diligences; mois int;
begin
  perform private.exiger(private.is_admin(), 'GBS_VALIDATION_ADMIN');
  if p_statut not in ('validee','refusee') or length(p_conclusion) > 4000 then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  select * into x from public.due_diligences where id = p_dd for update;
  if x.statut <> 'en_cours' then raise exception 'GBS_DD_DEJA_STATUEE' using errcode = 'P0001'; end if;
  if jsonb_array_length(x.grille) = 0 then raise exception 'GBS_GRILLE_VIDE' using errcode = 'P0001'; end if;
  mois := private.param_num('due_diligence.validite_mois')::int;
  perform private.rpc('valider_due_diligence');
  update public.due_diligences set statut = p_statut, conclusion = coalesce(p_conclusion, conclusion),
         realisee_le = coalesce(realisee_le, current_date),
         valide_jusqu_au = case when p_statut = 'validee'
                                then (coalesce(realisee_le, current_date) + make_interval(months => mois))::date end,
         validee_par = auth.uid()
   where id = p_dd returning * into x;
  perform private.rpc('');
  return x;
end $$;

create or replace function public.agreer_fournisseur(p_fournisseur uuid)
returns public.fournisseurs language plpgsql security definer set search_path = '' as $$
declare f public.fournisseurs;
begin
  perform private.exiger(private.is_admin(), 'GBS_VALIDATION_ADMIN');
  select * into f from public.fournisseurs where id = p_fournisseur for update;
  if f.engagement_non_commission_le is null then
    raise exception 'GBS_ENGAGEMENT_NON_COMMISSION: un fournisseur sans engagement de non-commission signé ne peut pas être agréé'
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.due_diligences dd where dd.fournisseur_id = f.id and dd.statut = 'validee'
                 and dd.valide_jusqu_au >= current_date) then
    raise exception 'GBS_DD_REQUISE: due diligence validée et en cours de validité exigée' using errcode = 'P0001';
  end if;
  perform private.rpc('agreer_fournisseur');
  update public.fournisseurs set statut_agrement = 'agree', agree_le = current_date, agree_par = auth.uid()
   where id = p_fournisseur returning * into f;
  perform private.rpc('');
  return f;
end $$;

-- -----------------------------------------------------------------------------
-- Pièces et phases (complétude)
-- -----------------------------------------------------------------------------
create or replace function public.deposer_piece(p_piece uuid, p_chemin text, p_empreinte text)
returns public.pieces language plpgsql security definer set search_path = '' as $$
declare x public.pieces;
begin
  select * into x from public.pieces where id = p_piece for update;
  perform private.exiger(private.has_role('admin','achats_chine','hub_afrique','agent_pays')
                         and private.dossier_visible(x.dossier_id));
  if p_chemin is null or length(p_chemin) > 400 or p_chemin !~ '^[a-zA-Z0-9/_.-]+$'
     or (p_empreinte is not null and p_empreinte !~ '^[0-9a-f]{64}$') then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform private.rpc('deposer_piece');
  update public.pieces set document_chemin = p_chemin, document_empreinte = p_empreinte, statut = 'recue'
   where id = p_piece returning * into x;
  perform private.rpc('');
  return x;
end $$;

create or replace function public.statuer_piece(p_piece uuid, p_statut text, p_commentaire text default null)
returns public.pieces language plpgsql security definer set search_path = '' as $$
declare x public.pieces;
begin
  select * into x from public.pieces where id = p_piece for update;
  perform private.exiger(private.has_role('admin','achats_chine','hub_afrique') and private.dossier_visible(x.dossier_id));
  if p_statut not in ('manquante','recue','a_verifier','validee','refusee','expiree') or length(p_commentaire) > 1000 then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if p_statut = 'validee' and x.document_chemin is null then
    raise exception 'GBS_PIECE_SANS_DOCUMENT' using errcode = 'P0001';
  end if;
  perform private.rpc('statuer_piece');
  update public.pieces set statut = p_statut, commentaire = coalesce(p_commentaire, commentaire)
   where id = p_piece returning * into x;
  perform private.rpc('');
  return x;
end $$;

create or replace function public.avancer_phase(p_dossier uuid, p_motif_derogation text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.dossiers; m public.modeles_dossier; i int; manquantes text[]; facultatives text[]; suivante text;
begin
  perform private.exiger(private.has_role('admin','achats_chine','hub_afrique','agent_pays')
                         and private.dossier_visible(p_dossier));
  select * into d from public.dossiers where id = p_dossier for update;
  if d.statut <> 'ouvert' then raise exception 'GBS_DOSSIER_FERME' using errcode = 'P0001'; end if;
  select * into m from public.modeles_dossier where code = d.modele;
  i := array_position(m.phases, d.phase_courante);
  select array_agg(libelle order by libelle) into manquantes from public.pieces
   where dossier_id = p_dossier and phase = d.phase_courante and obligatoire and statut <> 'validee';
  select array_agg(libelle order by libelle) into facultatives from public.pieces
   where dossier_id = p_dossier and phase = d.phase_courante and not obligatoire and statut <> 'validee';
  if manquantes is not null then
    if p_motif_derogation is null then
      raise exception 'GBS_PIECES_MANQUANTES: %', array_to_string(manquantes, ' ; ') using errcode = 'P0001';
    end if;
    perform private.exiger(private.is_admin(), 'GBS_DEROGATION_ADMIN');
    perform private.motif(p_motif_derogation);
    insert into public.derogations (dossier_id, objet, motif, accordee_par)
    values (p_dossier, 'piece_obligatoire', p_motif_derogation, auth.uid());
  end if;
  suivante := m.phases[i + 1];
  update public.dossier_phases set statut = 'validee', reelle_fin = current_date
   where dossier_id = p_dossier and phase = d.phase_courante;
  if suivante is not null then
    update public.dossier_phases set statut = 'en_cours', reelle_debut = current_date
     where dossier_id = p_dossier and phase = suivante;
  end if;
  perform private.rpc('avancer_phase');
  update public.dossiers set phase_courante = coalesce(suivante, phase_courante),
         statut = case when suivante is null then 'clos' else statut end,
         clos_le = case when suivante is null then now() else clos_le end
   where id = p_dossier;
  perform private.rpc('');
  return jsonb_build_object('phase', coalesce(suivante, d.phase_courante), 'clos', suivante is null,
                            'facultatives_manquantes', coalesce(to_jsonb(facultatives), '[]'::jsonb),
                            'derogation', manquantes is not null);
end $$;

-- Escalade automatique des points bloquants échus (à planifier chaque jour).
create or replace function public.escalader_points_bloquants() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform private.exiger(private.is_admin() or coalesce(auth.role(), '') = 'service_role');
  with u as (
    update public.points_bloquants set escalade_le = now()
     where resolu_le is null and escalade_le is null and echeance < current_date returning 1)
  select count(*) into n from u;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- Facturation : émission, FNE, commission
-- -----------------------------------------------------------------------------
create or replace function private.peut_facturer(p_societe uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin()
      or (private.has_role('hub_afrique') and private.societe_ok(p_societe)
          and (select code from public.societes where id = p_societe) = 'GBS_CI')
$$;

create or replace function public.emettre_facture(p_facture uuid)
returns public.factures language plpgsql security definer set search_path = '' as $$
declare f public.factures; s public.societes; v_serie text; an int; num int; larg int;
begin
  select * into f from public.factures where id = p_facture for update;
  perform private.exiger(private.peut_facturer(f.societe_id));
  if f.statut <> 'brouillon' then raise exception 'GBS_FACTURE_DEJA_EMISE' using errcode = 'P0001'; end if;
  if f.montant_ht = 0 then raise exception 'GBS_FACTURE_VIDE' using errcode = 'P0001'; end if;
  if f.type <> 'avoir' and f.montant_ht < 0 then raise exception 'GBS_MONTANT_NEGATIF' using errcode = 'P0001'; end if;
  select * into s from public.societes where id = f.societe_id;
  an := extract(year from current_date)::int;
  v_serie := case when f.type = 'avoir' then 'AV'
                when f.type = 'intragroupe' then 'IG'
                when s.code = 'GBS_CI' then 'FNE'
                when f.devise = 'CNY' then 'FP'
                else 'EX' end;
  insert into public.series_factures (societe_id, serie, annee, largeur)
  values (s.id, v_serie, an, case when s.code = 'GBS_CI' then 5 else 4 end)
  on conflict do nothing;
  update public.series_factures set dernier = dernier + 1
   where societe_id = s.id and serie = v_serie and annee = an
  returning dernier, largeur into num, larg;
  perform private.rpc('emettre_facture');
  update public.factures set
    numero = case when s.code = 'GBS_CI' then v_serie || '-' || an || '-' || lpad(num::text, larg, '0')
                  else 'GBS-' || v_serie || '-' || an || '-' || lpad(num::text, larg, '0') end,
    date_emission = current_date,
    echeance = coalesce(echeance, current_date + 30),
    statut = case when fne_requise then 'en_attente_fne' else 'emise' end
   where id = p_facture returning * into f;
  perform private.rpc('');
  return f;
end $$;

-- Retour de la plateforme FNE de la DGI : numéro et QR code (saisie ou interface).
create or replace function public.certifier_fne(p_facture uuid, p_numero text, p_qr text)
returns public.factures language plpgsql security definer set search_path = '' as $$
declare f public.factures;
begin
  select * into f from public.factures where id = p_facture for update;
  perform private.exiger(private.peut_facturer(f.societe_id));
  if f.statut <> 'en_attente_fne' then raise exception 'GBS_FACTURE_NON_EN_ATTENTE' using errcode = 'P0001'; end if;
  if p_numero is null or p_numero !~ '^[A-Za-z0-9-]{4,60}$' or p_qr is null or length(p_qr) not between 10 and 2000 then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform private.rpc('certifier_fne');
  update public.factures set fne_numero = p_numero, fne_qr = p_qr, fne_certifiee_le = now(), statut = 'emise'
   where id = p_facture returning * into f;
  perform private.rpc('');
  return f;
end $$;

create or replace function public.annuler_facture(p_facture uuid, p_motif text)
returns public.factures language plpgsql security definer set search_path = '' as $$
declare f public.factures;
begin
  select * into f from public.factures where id = p_facture for update;
  perform private.exiger(private.is_admin(), 'GBS_VALIDATION_ADMIN');
  perform private.motif(p_motif);
  if f.statut not in ('brouillon','en_attente_fne') then
    raise exception 'GBS_FACTURE_EMISE: émettez un avoir' using errcode = 'P0001';
  end if;
  perform private.rpc('annuler_facture');
  update public.factures set statut = 'annulee' where id = p_facture returning * into f;
  perform private.rpc('');
  return f;
end $$;

-- Facture de commission (tranche 1 : sur le devis ; tranche 2 : sur la valeur FOB réelle).
create or replace function public.facturer_commission(p_dossier uuid, p_tranche int)
returns public.factures language plpgsql security definer set search_path = '' as $$
declare d public.dossiers; c public.clients; s public.societes; calc jsonb; montant_xof numeric; dev text;
        f public.factures; deja numeric; t1 public.factures; tx numeric; dec int;
begin
  select * into d from public.dossiers where id = p_dossier;
  select * into c from public.clients where id = d.client_id;
  select * into s from public.societes
   where code = private.societe_facturante(c.pays, 'commission', current_date);
  perform private.exiger(private.peut_facturer(s.id) and private.dossier_visible(p_dossier));
  if p_tranche not in (1,2) then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  if d.mode_financier <> 'accompagne' then
    raise exception 'GBS_COMMISSION_MODE1: la commission ne concerne que l''achat accompagné' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.commandes where dossier_id = p_dossier and contrat_valide_le is not null) then
    raise exception 'GBS_CONTRAT_NON_SIGNE: la commission se facture à la signature du premier contrat fournisseur'
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.factures where dossier_id = p_dossier and type = 'commission'
             and tranche = p_tranche and statut <> 'annulee') then
    raise exception 'GBS_TRANCHE_DEJA_FACTUREE' using errcode = 'P0001';
  end if;
  if p_tranche = 1 then
    -- 50 % calculés sur le devis signé ; déductions (forfait payé, vérification) établies à ce jour.
    select calcul into calc from public.devis where dossier_id = p_dossier and statut = 'accepte'
     order by version desc limit 1;
    if calc is null then raise exception 'GBS_DEVIS_NON_SIGNE' using errcode = 'P0001'; end if;
    deja := round((calc->>'commission_totale')::numeric
                  * private.param_num('commission.part_premiere_facture', d.ouvert_le));
    montant_xof := deja - least(deja, least((private.calcul_commission(p_dossier, (calc->>'date_change')::date)
                                             ->>'deductions_totales')::numeric,
                                            (calc->>'commission_totale')::numeric));
  else
    select * into t1 from public.factures where dossier_id = p_dossier and type = 'commission' and tranche = 1
       and statut not in ('brouillon','annulee');
    if t1.id is null then raise exception 'GBS_TRANCHE1_NON_EMISE' using errcode = 'P0001'; end if;
    -- Recalcul sur la valeur FOB réelle, avenants compris.
    calc := private.calcul_commission(p_dossier, null);
    deja := round(private.to_xof(t1.montant_ht, t1.devise, t1.date_emission));
    montant_xof := (calc->>'commission_nette')::numeric - deja;
  end if;
  dev := case when s.code = 'GBS_CI' then case when c.pays in ('GA','CM') then 'XAF' else 'XOF' end else 'USD' end;
  dec := case when dev in ('XOF','XAF') then 0 else 2 end;
  tx := private.taux_xof(dev, current_date);
  insert into public.factures (societe_id, client_id, dossier_id, type, tranche, objet, devise, langue,
                               avoir_de)
  values (s.id, c.id, p_dossier, case when montant_xof < 0 then 'avoir' else 'commission' end,
          case when montant_xof < 0 then null else p_tranche end,
          'Commission d''achat ' || p_tranche || '/2 — ' || d.reference, dev, c.langue,
          case when montant_xof < 0 then t1.id end)
  returning * into f;
  insert into public.lignes_facture (facture_id, libelle, service, dossier_ref, quantite, prix_unitaire)
  values (f.id, 'Commission d''achat ' || p_tranche || '/2 — base FOB ' || (calc->>'base_fob_xof') || ' XOF',
          'S3', p_dossier, 1, round(montant_xof / tx, dec));
  select * into f from public.factures where id = f.id;
  return f;
end $$;

-- -----------------------------------------------------------------------------
-- Flux entre sociétés : validation du relevé et factures intragroupe
-- -----------------------------------------------------------------------------
create or replace function public.valider_releve(p_mois date)
returns public.releves_valides language plpgsql security definer set search_path = '' as $$
declare r public.releves_valides; m date := date_trunc('month', p_mois)::date;
begin
  perform private.exiger(private.is_admin(), 'GBS_VALIDATION_ADMIN');
  insert into public.releves_valides (mois, valide_par, total_ci_vers_cn, total_cn_vers_ci, total_agents)
  select m, auth.uid(),
         coalesce(sum(montant_xof) filter (where du_par = 'GBS_CI' and du_a = 'GBS_CN'), 0),
         coalesce(sum(montant_xof) filter (where du_par = 'GBS_CN' and du_a = 'GBS_CI'), 0),
         coalesce(sum(montant_xof) filter (where du_a = 'agent'), 0)
  from public.partages where mois = m
  returning * into r;
  return r;
end $$;

create or replace function public.generer_factures_intragroupe(p_mois date)
returns setof public.factures language plpgsql security definer set search_path = '' as $$
declare m date := date_trunc('month', p_mois)::date; ci public.societes; cn public.societes; f public.factures;
        r record; tx numeric;
begin
  perform private.exiger(private.is_admin(), 'GBS_VALIDATION_ADMIN');
  if not exists (select 1 from public.releves_valides where mois = m) then
    raise exception 'GBS_RELEVE_NON_VALIDE: validez le relevé avant d''émettre les factures intragroupe' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.factures where type = 'intragroupe' and objet like '%' || to_char(m, 'YYYY-MM') || '%'
             and statut <> 'annulee') then
    raise exception 'GBS_INTRAGROUPE_DEJA_EMIS' using errcode = 'P0001';
  end if;
  select * into ci from public.societes where code = 'GBS_CI';
  select * into cn from public.societes where code = 'GBS_CN';
  -- GBS Chine facture à GBS Côte d'Ivoire sa part (en USD) ; GBS Côte d'Ivoire facture à GBS Chine la sienne (en XOF).
  if exists (select 1 from public.partages where mois = m and du_par = 'GBS_CI' and du_a = 'GBS_CN') then
    tx := private.taux_xof('USD', (m + interval '1 month - 1 day')::date);
    insert into public.factures (societe_id, societe_dest_id, type, objet, devise, langue, date_emission)
    values (cn.id, ci.id, 'intragroupe', 'Part de GBS Chine — relevé ' || to_char(m, 'YYYY-MM'), 'USD', 'fr', current_date)
    returning * into f;
    for r in select dossier_id, sum(montant_xof) as t from public.partages
             where mois = m and du_par = 'GBS_CI' and du_a = 'GBS_CN' group by dossier_id loop
      insert into public.lignes_facture (facture_id, libelle, service, dossier_ref, prix_unitaire)
      values (f.id, 'Part GBS Chine — ' || coalesce((select reference from public.dossiers where id = r.dossier_id), 'hors dossier'),
              'IG', r.dossier_id, round(r.t / tx, 2));
    end loop;
    return query select * from public.factures where id = f.id;
  end if;
  if exists (select 1 from public.partages where mois = m and du_par = 'GBS_CN' and du_a = 'GBS_CI') then
    insert into public.factures (societe_id, societe_dest_id, type, objet, devise, langue, date_emission)
    values (ci.id, cn.id, 'intragroupe', 'Part de GBS Côte d''Ivoire — relevé ' || to_char(m, 'YYYY-MM'), 'XOF', 'fr', current_date)
    returning * into f;
    for r in select dossier_id, sum(montant_xof) as t from public.partages
             where mois = m and du_par = 'GBS_CN' and du_a = 'GBS_CI' group by dossier_id loop
      insert into public.lignes_facture (facture_id, libelle, service, dossier_ref, prix_unitaire)
      values (f.id, 'Part GBS Côte d''Ivoire — ' || coalesce((select reference from public.dossiers where id = r.dossier_id), 'hors dossier'),
              'IG', r.dossier_id, r.t);
    end loop;
    return query select * from public.factures where id = f.id;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Hub Afrique : valeur FOB des dossiers ivoiriens en achat accompagné, sans détail des prix.
-- -----------------------------------------------------------------------------
create or replace function public.dossier_fob(p_dossier uuid)
returns table (commande text, devise text, fob_montant numeric, statut text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exiger(private.has_role('admin','hub_afrique') and private.dossier_visible(p_dossier));
  return query select c.reference, c.devise::text, c.fob_montant, c.statut from public.commandes c
   join public.dossiers d on d.id = c.dossier_id
   where c.dossier_id = p_dossier and (private.is_admin() or (d.mode_financier = 'accompagne' and d.pays = 'CI'));
end $$;

-- -----------------------------------------------------------------------------
-- Tableau de bord simple par société (M15, M38 lot 0)
-- -----------------------------------------------------------------------------
create or replace function public.tableau_de_bord(p_societe uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r text := private.role(); montants boolean; res jsonb; debut date := date_trunc('month', current_date)::date;
begin
  perform private.exiger(r is not null and r not in ('client','fournisseur','transitaire'));
  if p_societe is not null then perform private.exiger(private.societe_ok(p_societe)); end if;
  montants := r in ('admin','comptable','hub_afrique');
  select jsonb_build_object(
    'montants_visibles', montants,
    'ca_mois_xof', case when montants then (
        select coalesce(sum(round(private.to_xof(f.montant_ht, f.devise, f.date_emission))), 0)
        from public.factures f where f.statut in ('emise','partiellement_payee','payee') and f.client_id is not null
          and f.date_emission >= debut and (p_societe is null or f.societe_id = p_societe)
          and private.societe_ok(f.societe_id)) end,
    'a_encaisser_xof', case when montants then (
        select coalesce(sum(round(private.to_xof(f.net_a_payer - f.encaisse, f.devise, current_date))), 0)
        from public.factures f where f.statut in ('emise','partiellement_payee') and f.client_id is not null
          and (p_societe is null or f.societe_id = p_societe) and private.societe_ok(f.societe_id)) end,
    'factures_en_retard', (
        select count(*) from public.factures f where f.statut in ('emise','partiellement_payee')
          and f.echeance < current_date and (p_societe is null or f.societe_id = p_societe)
          and private.societe_ok(f.societe_id)),
    'fne_en_attente', (
        select count(*) from public.factures f where f.statut = 'en_attente_fne'
          and (p_societe is null or f.societe_id = p_societe) and private.societe_ok(f.societe_id)),
    'fob_en_production_xof', case when r in ('admin','achats_chine') then (
        select coalesce(sum(round(private.to_xof(c.fob_montant, c.devise, current_date))), 0)
        from public.commandes c join public.dossiers d on d.id = c.dossier_id
        where c.statut = 'en_production' and (p_societe is null or d.societe_id = p_societe)) end,
    'commandes_en_production', (
        select count(*) from public.commandes c join public.dossiers d on d.id = c.dossier_id
        where c.statut = 'en_production' and (p_societe is null or d.societe_id = p_societe)
          and private.dossier_visible(d.id)),
    'dossiers_ouverts', (
        select count(*) from public.dossiers d where d.statut = 'ouvert'
          and (p_societe is null or d.societe_id = p_societe) and private.dossier_visible(d.id)),
    'points_bloquants_ouverts', (
        select count(*) from public.points_bloquants b join public.dossiers d on d.id = b.dossier_id
        where b.resolu_le is null and (p_societe is null or d.societe_id = p_societe) and private.dossier_visible(d.id)),
    'points_bloquants_escalades', (
        select count(*) from public.points_bloquants b join public.dossiers d on d.id = b.dossier_id
        where b.resolu_le is null and b.escalade_le is not null and (p_societe is null or d.societe_id = p_societe)
          and private.dossier_visible(d.id)),
    'pieces_manquantes', (
        select count(*) from public.pieces p join public.dossiers d on d.id = p.dossier_id
        where p.obligatoire and p.statut in ('manquante','refusee','expiree') and d.statut = 'ouvert'
          and p.phase = d.phase_courante and (p_societe is null or d.societe_id = p_societe)
          and private.dossier_visible(d.id)),
    'paiements_a_valider', case when r in ('admin','achats_chine') or private.est_validateur() then (
        select count(*) from public.paiements_fournisseurs where statut = 'prepare') end,
    'dd_expirant_60j', case when r in ('admin','achats_chine') then (
        select count(*) from public.due_diligences where statut = 'validee'
          and valide_jusqu_au between current_date and current_date + 60) end
  ) into res;
  return res;
end $$;

-- -----------------------------------------------------------------------------
-- Administration des profils
-- -----------------------------------------------------------------------------
create or replace function public.admin_definir_profil(p_user uuid, p_role text, p_societes uuid[],
  p_pays text default null, p_delegue boolean default false, p_actif boolean default true)
returns public.profils language plpgsql security definer set search_path = '' as $$
declare x public.profils;
begin
  perform private.exiger(private.is_admin(), 'GBS_VALIDATION_ADMIN');
  if p_role is not null and p_role not in ('admin','achats_chine','hub_afrique','agent_pays','inspecteur','comptable',
                                           'client','fournisseur','transitaire') then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if p_role = 'agent_pays' and p_pays is null then
    raise exception 'GBS_PAYS_AGENT_REQUIS' using errcode = '22023';
  end if;
  update public.profils set role = p_role, societes = coalesce(p_societes, '{}'), pays = p_pays,
         delegue_validation = coalesce(p_delegue, false), actif = coalesce(p_actif, true)
   where id = p_user returning * into x;
  if x.id is null then raise exception 'GBS_PROFIL_INCONNU' using errcode = 'P0002'; end if;
  return x;
end $$;

-- Un profil ne modifie jamais lui-même son rôle, ses sociétés ni sa délégation.
-- Pas SECURITY DEFINER : current_user est le rôle appelant (authenticated via l'API,
-- postgres dans les fonctions de règles).
create or replace function private.trg_profil_protege() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.role, new.societes, new.pays, new.delegue_validation, new.actif, new.id, new.email)
     is distinct from (old.role, old.societes, old.pays, old.delegue_validation, old.actif, old.id, old.email)
     and not private.is_admin() and current_user in ('authenticated','anon') then
    raise exception 'GBS_ACCES_REFUSE' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profils_protege before update on public.profils
  for each row execute function private.trg_profil_protege();

-- -----------------------------------------------------------------------------
-- Forfait au projet (équipement d'un site) : échéancier et factures par étape
-- -----------------------------------------------------------------------------
create table public.echeances_projet (
  id          uuid primary key default gen_random_uuid(),
  dossier_id  uuid not null references public.dossiers(id),
  ordre       int not null check (ordre between 1 and 20),
  libelle     text not null check (length(libelle) between 2 and 200),
  montant_ht  numeric(14,0) not null check (montant_ht > 0),   -- XOF
  facture_id  uuid references public.factures(id),
  atteinte_le date,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  unique (dossier_id, ordre)
);
create trigger echeances_touch before update on public.echeances_projet for each row execute function private.trg_touch();
create trigger echeances_cree before insert on public.echeances_projet for each row execute function private.trg_cree_par();
create trigger echeances_audit after insert or update or delete on public.echeances_projet for each row execute function private.trg_audit();
create trigger echeances_nodel before delete on public.echeances_projet for each row execute function private.trg_no_delete();

create or replace function private.trg_echeance() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.dossiers where id = new.dossier_id and modele = 'equipement_site') then
    raise exception 'GBS_ECHEANCIER_PROJET: réservé aux dossiers d''équipement d''un site' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and old.facture_id is not null
     and (new.montant_ht, new.ordre, new.facture_id) is distinct from (old.montant_ht, old.ordre, old.facture_id) then
    raise exception 'GBS_ECHEANCE_FACTUREE' using errcode = 'P0001';
  end if;
  if new.facture_id is distinct from (case when tg_op = 'UPDATE' then old.facture_id end)
     and coalesce(current_setting('gbs.rpc', true), '') <> 'facturer_echeance' then
    raise exception 'GBS_VALIDATION_RPC' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger echeances_regles before insert or update on public.echeances_projet
  for each row execute function private.trg_echeance();

alter table public.echeances_projet enable row level security;
create policy echeances_lecture on public.echeances_projet for select using (
  private.has_role('admin','hub_afrique','agent_pays','comptable') and private.dossier_visible(dossier_id));
create policy echeances_ecriture on public.echeances_projet for insert with check (
  private.has_role('admin','hub_afrique') and private.dossier_visible(dossier_id));
create policy echeances_maj on public.echeances_projet for update using (
  private.has_role('admin','hub_afrique') and private.dossier_visible(dossier_id));

create or replace function public.facturer_echeance(p_dossier uuid, p_ordre int)
returns public.factures language plpgsql security definer set search_path = '' as $$
declare d public.dossiers; c public.clients; s public.societes; e public.echeances_projet; f public.factures;
        total_ech numeric; deja_fact numeric; deja_enc numeric; dev text; tx numeric; dec int;
begin
  select * into d from public.dossiers where id = p_dossier;
  select * into c from public.clients where id = d.client_id;
  select * into s from public.societes where code = private.societe_facturante(c.pays, 'forfait_projet', current_date);
  perform private.exiger(private.peut_facturer(s.id) and private.dossier_visible(p_dossier));
  if d.modele <> 'equipement_site' then raise exception 'GBS_ECHEANCIER_PROJET' using errcode = 'P0001'; end if;
  select coalesce(sum(montant_ht), 0) into total_ech from public.echeances_projet where dossier_id = p_dossier;
  if total_ech <> d.forfait_projet_ht then
    raise exception 'GBS_ECHEANCIER_INCOHERENT: % échéancés pour un forfait de % XOF', total_ech, d.forfait_projet_ht
      using errcode = 'P0001';
  end if;
  select * into e from public.echeances_projet where dossier_id = p_dossier and ordre = p_ordre for update;
  if e.id is null then raise exception 'GBS_ECHEANCE_INCONNUE' using errcode = 'P0002'; end if;
  if e.facture_id is not null then raise exception 'GBS_ECHEANCE_DEJA_FACTUREE' using errcode = 'P0001'; end if;
  if exists (select 1 from public.echeances_projet where dossier_id = p_dossier and ordre < p_ordre and facture_id is null) then
    raise exception 'GBS_ECHEANCE_PRECEDENTE: facturez les versements dans l''ordre' using errcode = 'P0001';
  end if;
  select coalesce(sum(x.montant_ht), 0) into deja_fact from public.echeances_projet x
   where x.dossier_id = p_dossier and x.ordre < p_ordre;
  select coalesce(sum(round(fa.encaisse * fa.montant_ht / nullif(fa.net_a_payer, 0) * private.taux_xof(fa.devise, current_date))), 0)
    into deja_enc from public.echeances_projet x join public.factures fa on fa.id = x.facture_id
   where x.dossier_id = p_dossier and x.ordre < p_ordre;
  dev := case when s.code = 'GBS_CI' then case when c.pays in ('GA','CM') then 'XAF' else 'XOF' end else 'USD' end;
  dec := case when dev in ('XOF','XAF') then 0 else 2 end;
  tx := private.taux_xof(dev, current_date);
  insert into public.factures (societe_id, client_id, dossier_id, type, objet, devise, langue)
  values (s.id, c.id, p_dossier, 'forfait_projet', 'Forfait au projet — versement ' || p_ordre || ' — ' || d.reference,
          dev, c.langue) returning * into f;
  insert into public.lignes_facture (facture_id, libelle, service, dossier_ref, prix_unitaire)
  values (f.id, 'Versement ' || p_ordre || ' : ' || e.libelle, 'S2bis', p_dossier, round(e.montant_ht / tx, dec));
  perform private.rpc('recalcul_facture');
  update public.factures set recapitulatif = jsonb_build_object(
      'forfait_total_xof', d.forfait_projet_ht,
      'versements_factures_xof', deja_fact,
      'versements_encaisses_xof', deja_enc,
      'ce_versement_xof', e.montant_ht,
      'reste_du_xof', d.forfait_projet_ht - deja_fact - e.montant_ht)
   where id = f.id returning * into f;
  perform private.rpc('');
  perform private.rpc('facturer_echeance');
  update public.echeances_projet set facture_id = f.id, atteinte_le = coalesce(atteinte_le, current_date) where id = e.id;
  perform private.rpc('');
  return f;
end $$;
