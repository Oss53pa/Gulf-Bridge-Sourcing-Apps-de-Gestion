-- Paramètres : toutes les valeurs métier sont des paramètres datés, contrôlés par la base.
-- * Catalogue des paramètres : type, bornes, libellé, module ; familles par suffixe (« tva.* »).
-- * Toute nouvelle valeur est validée avant écriture (type, bornes, structure stricte des
--   valeurs composées) ; une clé inconnue est refusée. L'adresse des taux BCE est limitée
--   au site de la BCE (la base l'appelle elle-même).
-- * Valeurs restées en dur jusqu'ici, désormais paramètres : taux horaire des techniciens,
--   délai d'alerte des habilitations, devise du client selon son pays, seuils de la note qualité.

create table gbs.parametres_definitions (
  cle        text primary key check (cle ~ '^[a-z0-9_.]+(\.\*)?$'),
  type       text not null check (type in ('taux','nombre','entier','json')),
  minimum    numeric,
  maximum    numeric,
  validateur text check (validateur in ('bareme_commission','grille_offre','penalites_nc','comptes_export','borne_taux',
                                        'categories_frais','gravites_nc','sections_qualite','devise_par_pays','seuils_note','url_bce')),
  module     text not null check (length(module) <= 40),
  libelle    text not null check (length(libelle) <= 200),
  check ((type = 'json') = (validateur is not null))
);

insert into gbs.parametres_definitions (cle, type, minimum, maximum, validateur, module, libelle) values
  ('accord_cadre.alerte_jours','entier',1,365,null,'commercial','Alerte avant l''échéance d''un accord-cadre (jours)'),
  ('accord_cadre.forfait_mensuel_xof','nombre',0,1e10,null,'tarifs','Forfait mensuel de l''accord-cadre (FCFA)'),
  ('accord_cadre.remise','taux',0,0.5,null,'tarifs','Remise accord-cadre'),
  ('accord_cadre.remise_majoree','taux',0,0.5,null,'tarifs','Remise accord-cadre majorée'),
  ('accord_cadre.seuil_engagement_xof','nombre',0,1e13,null,'tarifs','Seuil d''engagement de l''accord-cadre (FCFA)'),
  ('agent.taux','taux',0,0.5,null,'finance','Commission des agents pays sans contrat'),
  ('archivage.duree_annees','entier',1,50,null,'administration','Durée d''archivage (années)'),
  ('client.verification_alerte_jours','entier',1,365,null,'commercial','Alerte avant revérification d''un client (jours)'),
  ('client.verification_validite_mois','entier',1,60,null,'commercial','Validité de la vérification d''un client (mois)'),
  ('commission.bareme','json',null,null,'bareme_commission','tarifs','Barème dégressif de la commission d''achat'),
  ('commission.majoration_sur_mesure','taux',0,0.2,null,'tarifs','Majoration de commission sur mesure'),
  ('commission.minimum_xof','nombre',0,1e10,null,'tarifs','Commission minimale (FCFA)'),
  ('commission.part_premiere_facture','taux',0,1,null,'tarifs','Part de la commission facturée à la signature'),
  ('commission.reduction_reassort','taux',0,1,null,'tarifs','Réduction de commission sur réassort'),
  ('commission.seuil_ecart_change','taux',0,0.5,null,'tarifs','Écart de change déclenchant un recalcul'),
  ('cout_global.energie_xof_kwh.*','nombre',0,10000,null,'achats','Prix local de l''énergie par pays (FCFA/kWh)'),
  ('cout_global.entretien_xof_heure.*','nombre',0,1e7,null,'achats','Coût horaire local de l''entretien par pays (FCFA)'),
  ('cout_global.horizon_ans','entier',1,50,null,'achats','Horizon du coût global (années)'),
  ('delai.seuil_alerte','taux',0,1,null,'dossiers','Seuil d''alerte orange des délais'),
  ('due_diligence.jours_deduction','entier',0,730,null,'tarifs','Délai de déduction de la due diligence (jours)'),
  ('due_diligence.taux_deduction','taux',0,1,null,'tarifs','Part de la due diligence déduite de la commission'),
  ('due_diligence.validite_mois','entier',1,60,null,'achats','Validité d''une due diligence (mois)'),
  ('export.comptes.*','json',null,null,'comptes_export','finance','Plan de comptes de l''export comptable, par société'),
  ('fob.majoration_exw_fca','taux',0,0.5,null,'achats','Frais jusqu''à bord par défaut (EXW, FCA)'),
  ('frais.justificatif_obligatoire','json',null,null,'categories_frais','finance','Catégories de frais exigeant un justificatif'),
  ('hse.habilitation_alerte_jours','entier',1,365,null,'interventions','Alerte avant expiration d''une habilitation (jours)'),
  ('inspection.nqa_critique','nombre',0,1000,null,'qualite','NQA par défaut — défauts critiques'),
  ('inspection.nqa_majeur','nombre',0,1000,null,'qualite','NQA par défaut — défauts majeurs'),
  ('inspection.nqa_mineur','nombre',0,1000,null,'qualite','NQA par défaut — défauts mineurs'),
  ('intervention.taux_horaire_xof','nombre',1,1e6,null,'interventions','Taux horaire des techniciens (FCFA), base du coût réel'),
  ('marge.seuil_directe','taux',0,1,null,'finance','Seuil de marge directe attendue'),
  ('nc.contre_inspection_requise','json',null,null,'gravites_nc','qualite','Gravités dont la clôture exige une contre-inspection'),
  ('nc.penalites','json',null,null,'penalites_nc','qualite','Pénalités de la note qualité par non-conformité'),
  ('negoce.marge_pieces','taux',0,2,null,'tarifs','Marge du négoce sur les pièces de rechange'),
  ('offre.grille','json',null,null,'grille_offre','achats','Grille pondérée d''analyse des offres (total 100)'),
  ('offre.seuil_anormalement_basse','taux',0,1,null,'achats','Seuil d''offre anormalement basse (part de la médiane)'),
  ('paiement.plafond_wallet_cny','nombre',0,1e9,null,'finance','Plafond des paiements WeChat Pay / Alipay (CNY)'),
  ('partage.*','taux',0,1,null,'finance','Parts du partage de la valeur entre sociétés'),
  ('piece.delai_blocage_jours','entier',1,90,null,'dossiers','Pièce manquante : point bloquant après (jours ouvrés)'),
  ('piece.delai_relance_jours','entier',1,60,null,'dossiers','Pièce manquante : relance après (jours ouvrés)'),
  ('prospect.devise_par_pays','json',null,null,'devise_par_pays','commercial','Devise du client selon son pays (et « defaut »)'),
  ('prospect.premier_contact_jours','entier',0,30,null,'commercial','Délai du premier contact d''un prospect (jours ouvrés)'),
  ('qualite.sections_standard','json',null,null,'sections_qualite','qualite','Sections du dossier qualité par défaut'),
  ('qualite.seuils_note','json',null,null,'seuils_note','qualite','Seuils de couleur de la note qualité des fournisseurs'),
  ('retenue.*','taux',0,0.5,null,'finance','Retenue à la source par pays'),
  ('retenue_intragroupe.*','taux',0,0.5,null,'finance','Retenue à la source intragroupe'),
  ('site.demandes_par_heure','entier',1,1000,null,'commercial','Demandes du site web par adresse et par heure'),
  ('site.demandes_par_jour','entier',1,100000,null,'commercial','Demandes du site web par jour'),
  ('suivi.consultations_max_heure','entier',1,10000,null,'dossiers','Consultations de la page de suivi par lien et par heure'),
  ('suivi.duree_max_jours','entier',1,365,null,'dossiers','Durée maximale d''un lien de suivi (jours)'),
  ('tarif.consultation_max_xof','nombre',0,1e11,null,'tarifs','Forfait de consultation maximal (FCFA)'),
  ('tarif.consultation_min_xof','nombre',0,1e11,null,'tarifs','Forfait de consultation minimal (FCFA)'),
  ('tarif.controle_qualite_jour_xof','nombre',0,1e11,null,'tarifs','Contrôle qualité, par jour (FCFA)'),
  ('tarif.due_diligence_renforcee_xof','nombre',0,1e11,null,'tarifs','Due diligence renforcée (FCFA)'),
  ('tarif.due_diligence_standard_xof','nombre',0,1e11,null,'tarifs','Due diligence standard (FCFA)'),
  ('tarif.inspection_seule_jour_xof','nombre',0,1e11,null,'tarifs','Inspection seule, par jour (FCFA)'),
  ('tarif.installation_majoration','taux',0,1,null,'tarifs','Majoration de l''installation sur le coût réel'),
  ('tarif.logistique_min_xof','nombre',0,1e11,null,'tarifs','Logistique, minimum (FCFA)'),
  ('tarif.logistique_taux','taux',0,1,null,'tarifs','Logistique, taux'),
  ('tarif.negoce_marge_max','taux',0,2,null,'tarifs','Marge du négoce maximale'),
  ('tarif.negoce_marge_min','taux',0,2,null,'tarifs','Marge du négoce minimale'),
  ('tarif.visite_usines_jour_xof','nombre',0,1e11,null,'tarifs','Visite d''usines, par jour (FCFA)'),
  ('tarif.visite_usines_jours_min','entier',1,30,null,'tarifs','Visite d''usines, jours minimum'),
  ('taux.borne.*','json',null,null,'borne_taux','finance','Bornes de plausibilité d''un taux de change (FCFA par unité)'),
  ('taux.requetes_max_jour','entier',1,48,null,'finance','Requêtes d''import des taux BCE par jour'),
  ('taux.source_url','json',null,null,'url_bce','finance','Adresse des taux de référence de la BCE'),
  ('taux.variation_max','taux',0,1,null,'finance','Variation maximale acceptée d''un taux importé'),
  ('tva.*','taux',0,0.5,null,'finance','Taux de TVA par société et par type');

insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('intervention.taux_horaire_xof', '10000', date '2026-01-01', 'Taux horaire des techniciens — à confirmer par la fondatrice'),
  ('hse.habilitation_alerte_jours', '30', date '2026-01-01', 'Alerte avant expiration d''une habilitation'),
  ('prospect.devise_par_pays', '{"CI":"XOF","SN":"XOF","BJ":"XOF","BF":"XOF","ML":"XOF","NE":"XOF","TG":"XOF","GW":"XOF","GA":"XAF","CM":"XAF","CG":"XAF","CF":"XAF","TD":"XAF","GQ":"XAF","defaut":"USD"}',
   date '2026-01-01', 'Zone UEMOA en FCFA (XOF), zone CEMAC en FCFA (XAF), ailleurs en USD'),
  ('qualite.seuils_note', '{"vert":80,"orange":60}', date '2026-01-01', 'Note qualité : verte à partir de, orange à partir de');

-- -----------------------------------------------------------------------------
-- Validation
-- -----------------------------------------------------------------------------
create or replace function gbs_private.definition_parametre(p_cle text) returns gbs.parametres_definitions
language sql stable security definer set search_path = '' as $$
  select d.* from gbs.parametres_definitions d
   where d.cle = p_cle or (d.cle like '%.*' and p_cle like replace(d.cle, '.*', '.') || '%'
                           and substring(p_cle from length(d.cle)) ~ '^[A-Za-z0-9_.]+$')
   order by (d.cle = p_cle) desc, length(d.cle) desc limit 1
$$;

create or replace function gbs_private.valeur_parametre_valide(d gbs.parametres_definitions, v jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare n numeric; e jsonb; prec numeric := 0; k text; somme numeric := 0;
begin
  if d.type in ('taux','nombre','entier') then
    if jsonb_typeof(v) <> 'number' then return false; end if;
    n := (v #>> '{}')::numeric;
    if d.type = 'entier' and n <> trunc(n) then return false; end if;
    return n >= coalesce(d.minimum, n) and n <= coalesce(d.maximum, n);
  end if;
  case d.validateur
    when 'bareme_commission' then
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) not between 1 and 20 then return false; end if;
      for e in select value from jsonb_array_elements(v) loop
        if jsonb_typeof(e) <> 'object' or exists (select 1 from jsonb_object_keys(e) x where x not in ('taux','jusqu_a'))
           or jsonb_typeof(e -> 'taux') <> 'number' or (e ->> 'taux')::numeric not between 0 and 1 then return false; end if;
        if prec is null then return false; end if;   -- tranche après la tranche ouverte
        if jsonb_typeof(e -> 'jusqu_a') = 'null' then prec := null;
        elsif jsonb_typeof(e -> 'jusqu_a') = 'number' and (e ->> 'jusqu_a')::numeric > prec then prec := (e ->> 'jusqu_a')::numeric;
        else return false; end if;
      end loop;
      return prec is null;
    when 'grille_offre' then
      if jsonb_typeof(v) <> 'object' then return false; end if;
      for k in select jsonb_object_keys(v) loop
        if k not in ('prix','technique','delai','due_diligence','paiement','garantie','capacite') or jsonb_typeof(v -> k) <> 'number'
           or (v ->> k)::numeric not between 0 and 100 then return false; end if;
        somme := somme + (v ->> k)::numeric;
      end loop;
      return somme = 100 and v ? 'prix';
    when 'penalites_nc' then
      return jsonb_typeof(v) = 'object' and (select array_agg(x order by x) from jsonb_object_keys(v) x) = array['critique','majeur','majoration_retard','mineur']
         and (select bool_and(jsonb_typeof(v -> x) = 'number') from unnest(array['critique','majeur','mineur','majoration_retard']) x)
         and (v ->> 'critique')::numeric between 0 and 100 and (v ->> 'majeur')::numeric between 0 and 100
         and (v ->> 'mineur')::numeric between 0 and 100 and (v ->> 'majoration_retard')::numeric between 1 and 5;
    when 'comptes_export' then
      return jsonb_typeof(v) = 'object'
         and (select array_agg(x order by x) from jsonb_object_keys(v) x) = array['banque','charge','journal_achats','journal_banque','tiers']
         and not exists (select 1 from jsonb_each(v) x where jsonb_typeof(x.value) <> 'string' or (x.value #>> '{}') !~ '^[0-9A-Za-z]{1,12}$');
    when 'borne_taux' then
      return jsonb_typeof(v) = 'array' and jsonb_array_length(v) = 2 and jsonb_typeof(v -> 0) = 'number' and jsonb_typeof(v -> 1) = 'number'
         and (v ->> 0)::numeric > 0 and (v ->> 1)::numeric > (v ->> 0)::numeric and (v ->> 1)::numeric <= 100000;
    when 'categories_frais' then
      return jsonb_typeof(v) = 'array' and jsonb_array_length(v) <= 20 and not exists (select 1 from jsonb_array_elements(v) x
         where jsonb_typeof(x) <> 'string' or (x #>> '{}') not in ('inspecteur','deplacement','hebergement','repas','echantillon','coursier',
           'laboratoire','traduction','sous_traitance','transitaire','frais_bancaires','change','installation','apres_livraison','autre'));
    when 'gravites_nc' then
      return jsonb_typeof(v) = 'array' and not exists (select 1 from jsonb_array_elements(v) x
         where jsonb_typeof(x) <> 'string' or (x #>> '{}') not in ('critique','majeur','mineur'));
    when 'sections_qualite' then
      return gbs_private.sections_qualite_valides(v);
    when 'devise_par_pays' then
      return jsonb_typeof(v) = 'object' and v ? 'defaut' and (select count(*) from jsonb_object_keys(v)) <= 250
         and not exists (select 1 from jsonb_each(v) x where (x.key !~ '^[A-Z]{2}$' and x.key <> 'defaut')
                          or jsonb_typeof(x.value) <> 'string' or (x.value #>> '{}') not in ('XOF','XAF','USD','CNY'));
    when 'seuils_note' then
      return jsonb_typeof(v) = 'object' and (select array_agg(x order by x) from jsonb_object_keys(v) x) = array['orange','vert']
         and jsonb_typeof(v -> 'vert') = 'number' and jsonb_typeof(v -> 'orange') = 'number'
         and (v ->> 'orange')::numeric between 0 and 100 and (v ->> 'vert')::numeric between 0 and 100
         and (v ->> 'vert')::numeric > (v ->> 'orange')::numeric;
    when 'url_bce' then
      -- La base appelle cette adresse : limitée au site de la BCE, en HTTPS, sans espace ni identifiants.
      return jsonb_typeof(v) = 'string' and length(v #>> '{}') <= 300
         and (v #>> '{}') ~ '^https://www\.ecb\.europa\.eu/[A-Za-z0-9/_.-]+$';
    else return false;
  end case;
end $$;

create or replace function gbs_private.trg_parametre_valide() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d gbs.parametres_definitions;
begin
  d := gbs_private.definition_parametre(new.cle);
  if d.cle is null then
    raise exception 'GBS_PARAMETRE_INCONNU: %', new.cle using errcode = '22023';
  end if;
  if not gbs_private.valeur_parametre_valide(d, new.valeur) then
    raise exception 'GBS_PARAMETRE_INVALIDE: %', new.cle using errcode = '22023';
  end if;
  return new;
end $$;
create trigger parametres_valide before insert on gbs.parametres
  for each row execute function gbs_private.trg_parametre_valide();

-- Catalogue lisible par l'équipe interne : définition et valeur en vigueur de chaque paramètre.
create or replace function gbs.catalogue_parametres()
returns table (cle text, definition text, type text, minimum numeric, maximum numeric, validateur text, module text, libelle text,
               valeur jsonb, date_effet date, commentaire text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.interne());
  return query
  select p.cle, d.cle, d.type, d.minimum, d.maximum, d.validateur, d.module, d.libelle, p.valeur, p.date_effet, p.commentaire
    from (select distinct on (x.cle) x.cle, x.valeur, x.date_effet, x.commentaire from gbs.parametres x
           where x.date_effet <= current_date order by x.cle, x.date_effet desc) p
    cross join lateral gbs_private.definition_parametre(p.cle) d
   order by d.module, p.cle;
end $$;

-- -----------------------------------------------------------------------------
-- Valeurs jusqu'ici en dur
-- -----------------------------------------------------------------------------
-- Taux horaire des techniciens : barème paramétré ; seule l'administratrice le remplace.
create or replace function gbs_private.trg_temps_taux() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.taux_horaire_xof is null or not gbs_private.is_admin() then
    new.taux_horaire_xof := gbs_private.param_num('intervention.taux_horaire_xof', new.date_travail);
  end if;
  return new;
end $$;
create trigger intervention_temps_taux before insert on gbs.intervention_temps
  for each row execute function gbs_private.trg_temps_taux();

-- Habilitations à renouveler : délai d'alerte paramétré par défaut.
create or replace function gbs.habilitations_a_renouveler(p_jours int default null)
returns table (habilitation_id uuid, technicien_id uuid, technicien text, type text, libelle text, expire_le date)
language plpgsql stable security definer set search_path = '' as $$
declare j int := coalesce(p_jours, gbs_private.param_num('hse.habilitation_alerte_jours')::int);
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','hub_afrique'));
  if j not between 0 and 365 then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  return query
  select a.id, a.technicien_id, p.nom, a.type, a.libelle, a.expire_le
    from gbs.habilitations a join gbs.profils p on p.id = a.technicien_id
   where p.actif and a.expire_le <= current_date + j
     and not exists (select 1 from gbs.habilitations b where b.technicien_id = a.technicien_id and b.type = a.type
                       and b.expire_le > a.expire_le)
   order by a.expire_le;
end $$;

-- Conversion d'un prospect : devise selon le pays, paramétrée.
create or replace function gbs.convertir_prospect(p_prospect uuid)
returns gbs.clients language plpgsql security definer set search_path = '' as $$
declare p gbs.prospects; c gbs.clients; soc uuid; dev text; carte jsonb;
begin
  select * into p from gbs.prospects where id = p_prospect for update;
  perform gbs_private.exiger(p.id is not null and gbs_private.prospect_visible_cols(p.pays));
  if p.statut in ('converti','perdu') then raise exception 'GBS_PROSPECT_CLOS' using errcode = 'P0001'; end if;
  if p.premier_contact_le is null then
    raise exception 'GBS_PREMIER_CONTACT_REQUIS: enregistrez d''abord le premier contact' using errcode = 'P0001';
  end if;
  soc := (select s.id from gbs.societes s where s.code = case when p.pays in ('GA','CM') then 'GBS_CN' else 'GBS_CI' end);
  carte := gbs_private.param('prospect.devise_par_pays');
  dev := coalesce(carte ->> p.pays, carte ->> 'defaut', 'USD');
  insert into gbs.clients (societe_id, raison_sociale, pays, devise, segment, specialite, origine, agent_id, langue)
  values (soc, trim(p.raison_sociale), p.pays, dev, p.segment, p.specialite,
          case when p.agent_id is not null then 'agent_pays' else 'direct' end, p.agent_id, p.langue)
  returning * into c;
  if p.contact_nom is not null then
    insert into gbs.contacts (client_id, nom, fonction, email, telephone)
    values (c.id, left(p.contact_nom, 120), p.contact_fonction, p.email, p.telephone);
  end if;
  perform set_config('gbs.rpc', 'prospect', true);
  update gbs.prospects set statut = 'converti', client_id = c.id, prochaine_relance = null where id = p_prospect;
  perform set_config('gbs.rpc', '', true);
  update gbs.taches set statut = 'faite' where prospect_id = p_prospect and statut in ('a_faire','en_cours');
  return c;
end $$;

alter table gbs.parametres_definitions enable row level security;
grant select on gbs.parametres_definitions to authenticated;
create policy parametres_definitions_lecture on gbs.parametres_definitions for select using (gbs_private.interne());

revoke execute on function gbs.catalogue_parametres(), gbs_private.definition_parametre(text),
  gbs_private.valeur_parametre_valide(gbs.parametres_definitions, jsonb), gbs_private.trg_parametre_valide(),
  gbs_private.trg_temps_taux() from public;
grant execute on function gbs.catalogue_parametres() to authenticated;
grant execute on all functions in schema gbs_private to authenticated, service_role;
