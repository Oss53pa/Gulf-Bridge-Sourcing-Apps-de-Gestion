-- =============================================================================
-- Lot 0 — Configuration par défaut (valeurs du cahier des charges, section 5).
-- Toutes ces valeurs sont des paramètres datés, modifiables par l'administratrice
-- en créant une nouvelle ligne avec une date d'effet : un dossier garde la règle
-- en vigueur à son ouverture. Les valeurs marquées « à confirmer » doivent être
-- validées par le fiscaliste, le juriste ou le transitaire avant la production.
-- =============================================================================

-- Sociétés. Dates de création à ajuster aux dates réelles d'immatriculation
-- (GBS Côte d'Ivoire : mois 1 ; GBS Chine, WFOE de Guangzhou : mois 4).
insert into gbs.societes (code, raison_sociale, pays, devise, forme, date_creation, fne) values
  ('GBS_CI', 'Gulf Bridge Sourcing Côte d''Ivoire', 'CI', 'XOF', 'SARL — Abidjan', date '2026-01-01', true),
  ('GBS_CN', 'Gulf Bridge Sourcing (Guangzhou)', 'CN', 'CNY', 'WFOE — Guangzhou', date '2026-04-01', false);

-- Parités fixes avec l'euro (XOF et XAF : 655,957 pour 1 EUR). USD et CNY : cours du jour.
insert into gbs.taux_change (devise, date_taux, taux_xof, source) values
  ('EUR', date '2000-01-01', 655.957, 'Parité fixe BCEAO / BEAC'),
  ('XAF', date '2000-01-01', 1, 'Même parité fixe avec l''euro que le XOF');

-- Paramètres (date d'effet commune : ouverture de l'activité)
insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('commission.bareme', '[{"jusqu_a":10000000,"taux":0.12},{"jusqu_a":50000000,"taux":0.10},
     {"jusqu_a":150000000,"taux":0.08},{"jusqu_a":500000000,"taux":0.06},{"jusqu_a":null,"taux":0.045}]',
     date '2026-01-01', 'Commission par tranche de valeur FOB (XOF), tranche lue sur la valeur totale du dossier'),
  ('commission.majoration_sur_mesure', '0.02', date '2026-01-01', '+2 points sur les lignes sur mesure'),
  ('commission.reduction_reassort', '0.5', date '2026-01-01', 'Commission réduite de 50 % en réassort'),
  ('commission.minimum_xof', '1000000', date '2026-01-01', 'Minimum par dossier, appliqué une fois'),
  ('commission.part_premiere_facture', '0.5', date '2026-01-01', '50 % à la signature du premier contrat'),
  ('commission.seuil_ecart_change', '0.05', date '2026-01-01', 'Écart de change déclenchant un nouveau calcul'),
  ('accord_cadre.remise', '0.01', date '2026-01-01', '-1 point sur la commission'),
  ('accord_cadre.remise_majoree', '0.02', date '2026-01-01', '-2 points au-delà du seuil d''engagement'),
  ('accord_cadre.seuil_engagement_xof', '100000000', date '2026-01-01', 'À définir par la fondatrice'),
  ('accord_cadre.forfait_mensuel_xof', '350000', date '2026-01-01', 'Forfait mensuel par défaut'),
  ('due_diligence.taux_deduction', '0.5', date '2026-01-01', '50 % déduits de la commission'),
  ('due_diligence.jours_deduction', '90', date '2026-01-01', 'Si un contrat d''achat est signé dans les 90 jours'),
  ('due_diligence.validite_mois', '12', date '2026-01-01', 'Validité d''une due diligence'),
  ('tarif.consultation_min_xof', '300000', date '2026-01-01', null),
  ('tarif.consultation_max_xof', '1000000', date '2026-01-01', null),
  ('tarif.controle_qualite_jour_xof', '250000', date '2026-01-01', 'Contrôle qualité intégré à une commande'),
  ('tarif.inspection_seule_jour_xof', '160000', date '2026-01-01', 'Inspection vendue seule'),
  ('tarif.due_diligence_standard_xof', '500000', date '2026-01-01', null),
  ('tarif.due_diligence_renforcee_xof', '850000', date '2026-01-01', null),
  ('tarif.visite_usines_jour_xof', '250000', date '2026-01-01', '2 jours minimum'),
  ('tarif.visite_usines_jours_min', '2', date '2026-01-01', null),
  ('tarif.installation_majoration', '0.15', date '2026-01-01', 'Coût réel + 15 %'),
  ('tarif.logistique_taux', '0.065', date '2026-01-01', '6,5 % du coût logistique'),
  ('tarif.logistique_min_xof', '150000', date '2026-01-01', 'Minimum par expédition'),
  ('tarif.negoce_marge_min', '0.15', date '2026-01-01', null),
  ('tarif.negoce_marge_max', '0.25', date '2026-01-01', null),
  ('fob.majoration_exw_fca', '0.03', date '2026-01-01', 'Frais jusqu''à bord par défaut — à confirmer par le transitaire'),
  ('offre.seuil_anormalement_basse', '0.7', date '2026-01-01', 'Sous 70 % de la médiane des offres'),
  ('retenue.CI', '0.20', date '2026-01-01', 'Retenue à la source, non-résidents — à confirmer par le fiscaliste'),
  ('retenue.CM', '0.15', date '2026-01-01', 'À confirmer par le fiscaliste'),
  ('retenue.GA', '0.25', date '2026-01-01', 'À confirmer par le fiscaliste'),
  ('retenue_intragroupe.CI', '0.20', date '2026-01-01', 'Services payés par GBS CI à GBS Chine — à confirmer'),
  ('retenue_intragroupe.CN', '0', date '2026-01-01', 'Services rendus en Afrique — à confirmer'),
  ('tva.GBS_CI', '0.18', date '2026-01-01', 'TVA Côte d''Ivoire'),
  ('tva.GBS_CN', '0.06', date '2026-01-01', 'TVA sur les services de GBS Chine — régime export à confirmer'),
  ('tva.GBS_CI.intragroupe', '0', date '2026-01-01', 'À confirmer par le fiscaliste'),
  ('tva.GBS_CN.intragroupe', '0', date '2026-01-01', 'À confirmer par le fiscaliste'),
  ('partage.ci_vers_cn.forfaits', '0.60', date '2026-01-01', 'Part de GBS Chine sur les forfaits encaissés par GBS CI'),
  ('partage.ci_vers_cn.commissions', '0.70', date '2026-01-01', 'Part de GBS Chine sur les commissions encaissées par GBS CI'),
  ('partage.cn_vers_ci.frais_gestion', '0.05', date '2026-01-01', 'Frais de gestion de GBS CI sur les services réalisés en Chine'),
  ('partage.cn_vers_ci.marge_negoce', '0.30', date '2026-01-01', '30 % de la marge du négoce des clients ivoiriens'),
  ('agent.taux', '0.15', date '2026-01-01', 'Commission des agents pays (Gabon, Cameroun)'),
  ('paiement.plafond_wallet_cny', '50000', date '2026-01-01', 'Plafond WeChat Pay / Alipay par paiement — à fixer'),
  ('marge.seuil_directe', '0.35', date '2026-01-01', 'Seuil de marge directe prévue (lot 2)'),
  ('inspection.nqa_critique', '0', date '2026-01-01', 'Tolérance zéro'),
  ('inspection.nqa_majeur', '2.5', date '2026-01-01', null),
  ('inspection.nqa_mineur', '4.0', date '2026-01-01', null),
  ('archivage.duree_annees', '10', date '2026-01-01', 'À confirmer par le comptable');

-- Modèles de dossier (section 4 bis)
insert into gbs.modeles_dossier (code, libelle, mode_financier, phases) values
  ('achat_accompagne', 'Achat accompagné', 'accompagne', array['consultation','verification','mise_en_concurrence','devis_mandat',
     'contrat','approbation_technique','production','inspection','expedition','livraison','cloture']),
  ('equipement_site', 'Équipement d''un site avant ouverture (forfait au projet)', 'accompagne',
     array['consultation','verification','mise_en_concurrence','devis_mandat','contrat','approbation_technique',
           'production','inspection','expedition','livraison','cloture']),
  ('negoce', 'Négoce et clé en main', 'negoce', array['consultation','verification','mise_en_concurrence','devis_mandat',
     'contrat','approbation_technique','production','inspection','expedition','livraison','cloture']),
  ('due_diligence', 'Due diligence seule', 'service_seul', array['verification','cloture']),
  ('consultation', 'Consultation seule', 'service_seul', array['consultation','mise_en_concurrence','cloture']),
  ('inspection_seule', 'Inspection seule', 'service_seul', array['inspection','cloture']),
  ('visite_usines', 'Visite d''usines accompagnée', 'service_seul', array['consultation','cloture']),
  ('logistique', 'Logistique seule', 'service_seul', array['expedition','livraison','cloture']),
  ('installation', 'Installation seule', 'service_seul', array['livraison','cloture']),
  ('accord_cadre', 'Dossier-cadre annuel (accord-cadre)', 'service_seul', array['devis_mandat','cloture']);

-- Pièces exigées par défaut (à valider et paramétrer par la fondatrice) ;
-- les modèles complets reçoivent toutes les pièces de leurs phases.
insert into gbs.pieces_modele (modele_code, phase, code, libelle, obligatoire, ordre)
select m.code, p.phase, p.code, p.libelle, p.obligatoire, p.ordre
from gbs.modeles_dossier m join (values
('consultation','client_cdc_signe','Cahier des charges du client validé et signé',true,1),
  ('consultation','facture_forfait_reglee','Facture du forfait réglée',true,2),
  ('verification','fiche_verification_client','Fiche de vérification du client',false,1),
  ('verification','licence_fournisseur','Licence du fournisseur',true,2),
  ('verification','rapport_dd','Rapport de due diligence valide',true,3),
  ('verification','engagement_non_commission','Engagement de non-commission signé par le fournisseur',true,4),
  ('mise_en_concurrence','offres_plis_fermes','Offres reçues sous pli fermé avec leur Incoterm',true,1),
  ('mise_en_concurrence','grille_analyse','Grille d''analyse',true,2),
  ('mise_en_concurrence','rapport_3_offres','Rapport des 3 offres analysées',true,3),
  ('mise_en_concurrence','client_choix_signe','Choix signé du client',true,4),
  ('devis_mandat','client_devis_accepte','Devis accepté',true,1),
  ('devis_mandat','client_mandat_signe','Mandat signé',true,2),
  ('devis_mandat','client_domiciliation','Référence de domiciliation du client',true,3),
  ('contrat','contrat_fournisseur_signe','Contrat fournisseur signé',true,1),
  ('contrat','facture_pro_forma','Facture pro forma',true,2),
  ('approbation_technique','client_plans_valides','Plans et fiches techniques validés par le client',false,1),
  ('approbation_technique','client_echantillon_approuve','Échantillon de référence approuvé',false,2),
  ('approbation_technique','pv_essais_usine','Procès-verbal d''essais en usine',false,3),
  ('production','justificatif_acompte','Justificatif de l''acompte',true,1),
  ('production','points_avancement','Points d''avancement',false,2),
  ('inspection','rapport_inspection_valide','Rapport d''inspection validé',true,1),
  ('inspection','certificat_inspection','Certificat d''inspection',true,2),
  ('expedition','facture_commerciale','Facture commerciale',true,1),
  ('expedition','liste_colisage','Liste de colisage',true,2),
  ('expedition','projet_connaissement','Projet de connaissement validé',true,3),
  ('expedition','connaissement','Connaissement',true,4),
  ('expedition','envoi_originaux','Preuve d''envoi des originaux',true,5),
  ('expedition','certificat_origine','Certificat d''origine',true,6),
  ('expedition','conformite_pays','Documents de conformité exigés par le pays',true,7),
  ('expedition','marchandises_dangereuses','Déclaration et documents des marchandises dangereuses (le cas échéant)',false,8),
  ('expedition','attestation_assurance','Attestation d''assurance (si prévue)',false,9),
  ('livraison','avis_mise_a_disposition','Avis de mise à disposition au port',true,1),
  ('livraison','client_pv_reception','Procès-verbal de réception sur site',true,2),
  ('livraison','levee_reserves','Levée des réserves',false,3),
  ('livraison','pv_mise_en_service','Procès-verbal de mise en service (clé en main)',false,4),
  ('cloture','justificatif_solde','Justificatif du solde',true,1),
  ('cloture','facture_commission_reglee','Facture de commission réglée',true,2),
  ('cloture','client_accuse_reception','Accusé de réception du client',true,3),
  ('cloture','dossier_qualite_remis','Dossier qualité remis au client',false,4)
) as p (phase, code, libelle, obligatoire, ordre) on p.phase = any(m.phases)
where m.code in ('achat_accompagne','equipement_site','negoce')
  and not (m.code = 'negoce' and p.code in ('client_domiciliation','facture_commission_reglee'))
  and not (m.code = 'equipement_site' and p.code = 'facture_forfait_reglee');

-- Modèles de service seul : pièces propres à leur livrable
insert into gbs.pieces_modele (modele_code, phase, code, libelle, obligatoire, ordre) values
  ('due_diligence','verification','licence_fournisseur','Licence du fournisseur',true,1),
  ('due_diligence','verification','rapport_dd','Rapport de due diligence',true,2),
  ('due_diligence','cloture','facture_reglee','Facture de la mission réglée',true,1),
  ('consultation','consultation','client_cdc_signe','Cahier des charges du client validé et signé',true,1),
  ('consultation','consultation','facture_forfait_reglee','Facture du forfait réglée',true,2),
  ('consultation','mise_en_concurrence','rapport_3_offres','Rapport des 3 offres analysées',true,1),
  ('consultation','cloture','client_accuse_reception','Accusé de réception du client',true,1),
  ('inspection_seule','inspection','client_lot_declare','Lot à inspecter déclaré par le client',true,1),
  ('inspection_seule','inspection','rapport_inspection_valide','Rapport d''inspection validé',true,2),
  ('inspection_seule','inspection','certificat_inspection','Certificat d''inspection',true,3),
  ('inspection_seule','cloture','facture_reglee','Facture de la mission réglée',true,1),
  ('visite_usines','consultation','programme_visite','Programme et rendez-vous',true,1),
  ('visite_usines','cloture','facture_reglee','Facture de la mission réglée',true,1),
  ('logistique','expedition','facture_commerciale','Facture commerciale',true,1),
  ('logistique','expedition','liste_colisage','Liste de colisage',true,2),
  ('logistique','expedition','connaissement','Connaissement',true,3),
  ('logistique','livraison','avis_mise_a_disposition','Avis de mise à disposition au port',true,1),
  ('logistique','cloture','facture_reglee','Facture de la mission réglée',true,1),
  ('installation','livraison','client_pv_reception','Procès-verbal de réception sur site',true,1),
  ('installation','livraison','pv_mise_en_service','Procès-verbal de mise en service',true,2),
  ('installation','cloture','facture_reglee','Facture de la mission réglée',true,1),
  ('accord_cadre','devis_mandat','client_accord_cadre_signe','Accord-cadre annuel signé',true,1),
  ('accord_cadre','cloture','bilan_annuel','Bilan annuel de l''accord-cadre',false,1);

-- Création automatique d'un profil sans droits, uniquement pour les comptes invités
-- dans GBS (métadonnée app = « gbs »). Le projet est partagé : la fonction ne doit
-- jamais faire échouer l'inscription d'un utilisateur d'une autre application.
create or replace function gbs_private.trg_nouvel_utilisateur() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'app', '') = 'gbs' then
    begin
      insert into gbs.profils (id, nom, email)
      values (new.id, coalesce(left(new.raw_user_meta_data ->> 'nom', 120), split_part(new.email, '@', 1)), new.email)
      on conflict (id) do nothing;
    exception when others then
      raise warning 'gbs: profil non créé pour un nouvel utilisateur';
    end;
  end if;
  return new;
end $$;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'users') then
    execute 'create or replace trigger gbs_nouvel_utilisateur after insert on auth.users
             for each row execute function gbs_private.trg_nouvel_utilisateur()';
  end if;
end $$;

-- Un objet du bucket GBS est lisible si son premier dossier est un dossier GBS visible.
-- Le nom est contrôlé avant toute conversion : les objets des autres applications
-- (autres buckets) ne sont jamais évalués comme des identifiants GBS.
create or replace function gbs_private.document_visible(p_bucket text, p_nom text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_bucket = 'gbs-documents'
     and p_nom ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
     and gbs_private.dossier_visible(substring(p_nom from 1 for 36)::uuid)
$$;
grant execute on function gbs_private.document_visible(text, text) to authenticated;

-- Stockage privé (Supabase Storage) : aucun fichier public, URL signées uniquement.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('gbs-documents', 'gbs-documents', false, 26214400,
            array['application/pdf','image/jpeg','image/png','image/webp'])
    on conflict (id) do nothing;
    -- Lecture réservée aux rôles qui voient le dossier ; l'écriture passe par la fonction « depot ».
    execute $p$create policy gbs_docs_lecture on storage.objects for select to authenticated
      using (bucket_id = 'gbs-documents' and gbs_private.document_visible(bucket_id, name))$p$;
  end if;
end $$;
