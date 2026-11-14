-- Export comptable des ventes, encaissements et règlements fournisseurs (cahier des charges, connexions :
-- lot 1 ; plan SYSCOHADA révisé pour GBS Côte d'Ivoire, normes comptables chinoises pour GBS Chine).
-- * Plan de comptes en paramètre daté par société (export.ventes.<code>), à confirmer par chaque cabinet.
-- * Écritures de la période, en partie double et équilibrées par pièce, en FCFA et dans la devise de tenue :
--   - facture émise (non brouillon, non annulée) : client et retenue à la source subie au débit, produit
--     (négoce à part) et TVA collectée au crédit ; un avoir (montants négatifs) inverse les sens ;
--   - encaissement : banque au débit, client au crédit, au cours enregistré à la réception ;
--   - règlement d'un fournisseur exécuté par GBS (flux « gbs ») : fournisseur au débit, banque au crédit.
--     Les paiements faits par le client sur instruction ne passent pas par la banque de GBS : exclus.
--     La facture du fabricant et son imputation restent au cabinet.
-- * Réservé à la finance de la société (administratrice ou membre de la société).

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
      -- Deux formes : comptes des commissions (export.comptes.*) ou comptes des ventes et règlements (export.ventes.*).
      return jsonb_typeof(v) = 'object'
         and (select array_agg(x order by x) from jsonb_object_keys(v) x) in (
               array['banque','charge','journal_achats','journal_banque','tiers'],
               array['banque','clients','fournisseurs','journal_banque','journal_ventes','produits','produits_negoce','retenue','tva_collectee'])
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


insert into gbs.parametres_definitions (cle, type, minimum, maximum, validateur, module, libelle) values
  ('export.ventes.*', 'json', null, null, 'comptes_export', 'finance', 'Plan de comptes de l''export des ventes et règlements, par société');
insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('export.ventes.GBS_CI', '{"clients":"4111","produits":"7061","produits_negoce":"7011","tva_collectee":"4431","retenue":"4492","fournisseurs":"4011","banque":"5211","journal_ventes":"VTE","journal_banque":"BQ"}',
   date '2026-01-01', 'SYSCOHADA révisé : clients, services vendus, marchandises, TVA facturée, retenue subie, fournisseurs, banque — à confirmer par le cabinet'),
  ('export.ventes.GBS_CN', '{"clients":"1122","produits":"6001","produits_negoce":"6001","tva_collectee":"2221","retenue":"2221","fournisseurs":"2202","banque":"1002","journal_ventes":"JZ","journal_banque":"YH"}',
   date '2026-01-01', 'Normes comptables chinoises : 应收账款, 主营业务收入, 应交税费, 应付账款, 银行存款 — à confirmer par le cabinet');

create or replace function gbs.export_ecritures(p_societe uuid, p_du date, p_au date)
returns table (date_ecriture date, journal text, compte text, compte_tiers text, piece text, libelle text,
               debit_xof numeric, credit_xof numeric, devise_tenue text, debit_devise numeric, credit_devise numeric)
language plpgsql stable security definer set search_path = '' as $$
declare s gbs.societes; r record; pc jsonb; tx numeric; txt numeric; ht numeric; tv numeric; rt numeric; cl numeric;
        htd numeric; tvd numeric; rtd numeric; cld numeric; tiers text; m numeric; md numeric;
begin
  perform gbs_private.exiger(gbs_private.finance()
    and (gbs_private.is_admin() or p_societe = any((gbs_private.profil()).societes)));
  if p_du is null or p_au is null or p_au < p_du or p_au - p_du > 366 then
    raise exception 'GBS_PERIODE_INVALIDE' using errcode = '22023';
  end if;
  select * into s from gbs.societes where id = p_societe;
  if s.id is null then raise exception 'GBS_ACCES_REFUSE' using errcode = '42501'; end if;
  devise_tenue := s.devise;

  -- Factures émises (un avoir est une facture à montants négatifs).
  for r in select f.*, coalesce(c.raison_sociale, so.code) tiers_nom, coalesce('CLI-' || left(f.client_id::text, 8), 'GRP-' || so.code) tiers_code
             from gbs.factures f left join gbs.clients c on c.id = f.client_id left join gbs.societes so on so.id = f.societe_dest_id
            where f.societe_id = p_societe and f.statut in ('emise','partiellement_payee','payee')
              and f.date_emission between p_du and p_au
            order by f.date_emission, f.numero loop
    pc := gbs_private.param('export.ventes.' || s.code, r.date_emission);
    if pc is null then raise exception 'GBS_PARAM_MANQUANT: export.ventes.%', s.code using errcode = 'P0001'; end if;
    tx := gbs_private.taux_xof(r.devise, r.date_emission); txt := gbs_private.taux_xof(s.devise, r.date_emission);
    ht := round(r.montant_ht * tx); tv := round(coalesce(r.tva, 0) * tx); rt := round(coalesce(r.retenue, 0) * tx); cl := ht + tv - rt;
    htd := round(ht / txt, 2); tvd := round(tv / txt, 2); rtd := round(rt / txt, 2); cld := htd + tvd - rtd;
    date_ecriture := r.date_emission; journal := pc ->> 'journal_ventes'; piece := r.numero;
    libelle := left(coalesce(r.objet, r.type) || ' · ' || r.tiers_nom, 200);
    -- Débits : client (net à recevoir) et retenue subie ; crédits : produit et TVA. Signes inversés pour un avoir.
    compte := pc ->> 'clients'; compte_tiers := r.tiers_code; m := cl; md := cld;
    debit_xof := greatest(m, 0); credit_xof := greatest(-m, 0); debit_devise := greatest(md, 0); credit_devise := greatest(-md, 0); return next;
    if rt <> 0 then
      compte := pc ->> 'retenue'; compte_tiers := null; m := rt; md := rtd;
      debit_xof := greatest(m, 0); credit_xof := greatest(-m, 0); debit_devise := greatest(md, 0); credit_devise := greatest(-md, 0); return next;
    end if;
    compte := case when r.type = 'negoce' then pc ->> 'produits_negoce' else pc ->> 'produits' end; compte_tiers := null; m := ht; md := htd;
    debit_xof := greatest(-m, 0); credit_xof := greatest(m, 0); debit_devise := greatest(-md, 0); credit_devise := greatest(md, 0); return next;
    if tv <> 0 then
      compte := pc ->> 'tva_collectee'; m := tv; md := tvd;
      debit_xof := greatest(-m, 0); credit_xof := greatest(m, 0); debit_devise := greatest(-md, 0); credit_devise := greatest(md, 0); return next;
    end if;
  end loop;

  -- Encaissements reçus.
  for r in select e.*, f.numero, coalesce('CLI-' || left(f.client_id::text, 8), 'GRP-' || so.code) tiers_code
             from gbs.encaissements e join gbs.factures f on f.id = e.facture_id left join gbs.societes so on so.id = f.societe_dest_id
            where f.societe_id = p_societe and e.recu_le between p_du and p_au order by e.recu_le, e.cree_le loop
    pc := gbs_private.param('export.ventes.' || s.code, r.recu_le);
    if pc is null then raise exception 'GBS_PARAM_MANQUANT: export.ventes.%', s.code using errcode = 'P0001'; end if;
    txt := gbs_private.taux_xof(s.devise, r.recu_le);
    m := round(r.montant_xof); md := round(m / txt, 2);
    date_ecriture := r.recu_le; journal := pc ->> 'journal_banque'; piece := r.numero;
    libelle := left('Encaissement ' || r.numero || coalesce(' · ' || r.reference, ''), 200);
    compte := pc ->> 'banque'; compte_tiers := null;
    debit_xof := m; credit_xof := 0; debit_devise := md; credit_devise := 0; return next;
    compte := pc ->> 'clients'; compte_tiers := r.tiers_code;
    debit_xof := 0; credit_xof := m; debit_devise := 0; credit_devise := md; return next;
  end loop;

  -- Règlements des fournisseurs exécutés par GBS sur le dossier d'une société.
  for r in select p.*, k.fournisseur_id, fo.raison_sociale_en
             from gbs.paiements_fournisseurs p join gbs.dossiers d on d.id = p.dossier_id
             left join gbs.commandes k on k.id = p.commande_id left join gbs.fournisseurs fo on fo.id = k.fournisseur_id
            where d.societe_id = p_societe and p.flux = 'gbs' and p.statut in ('execute','confirme_client')
              and p.execute_le::date between p_du and p_au order by p.execute_le loop
    pc := gbs_private.param('export.ventes.' || s.code, r.execute_le::date);
    if pc is null then raise exception 'GBS_PARAM_MANQUANT: export.ventes.%', s.code using errcode = 'P0001'; end if;
    tx := gbs_private.taux_xof(r.devise, r.execute_le::date); txt := gbs_private.taux_xof(s.devise, r.execute_le::date);
    m := round((r.montant - coalesce(r.penalite_retenue, 0)) * tx); md := round(m / txt, 2);
    tiers := case when r.fournisseur_id is null then null else 'FOU-' || left(r.fournisseur_id::text, 8) end;
    date_ecriture := r.execute_le::date; journal := pc ->> 'journal_banque'; piece := coalesce(r.reference, left(r.id::text, 8));
    libelle := left('Règlement ' || r.nature || coalesce(' · ' || r.raison_sociale_en, '') || coalesce(' · ' || r.reference_transaction, ''), 200);
    compte := pc ->> 'fournisseurs'; compte_tiers := tiers;
    debit_xof := m; credit_xof := 0; debit_devise := md; credit_devise := 0; return next;
    compte := pc ->> 'banque'; compte_tiers := null;
    debit_xof := 0; credit_xof := m; debit_devise := 0; credit_devise := md; return next;
  end loop;
end $$;

revoke all on function gbs.export_ecritures(uuid, date, date) from public, anon;
grant execute on function gbs.export_ecritures(uuid, date, date) to authenticated;
