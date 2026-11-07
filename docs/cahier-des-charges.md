# Gulf Bridge Sourcing : cahier des charges de l'application de gestion

Nov 7, 2026, @Pamela Atokouna

## 1. Contexte et objectifs

L'application doit piloter toute l'activité de Gulf Bridge Sourcing, de la prospection d'un client africain jusqu'au service après-vente d'une commande livrée, en français, en anglais et en mandarin.

**Proposition de valeur**

> Nous équipons vos sites depuis la Chine comme un exploitant l'exigerait : au meilleur coût global, conforme aux standards de vos donneurs d'ordre, livré à votre date d'ouverture, en toute transparence.

**Positionnement, décidé le 7 novembre 2026**

Gulf Bridge Sourcing est le bureau d'achat en Chine des exploitants et de leurs sous-traitants, sur deux spécialités :

| Spécialité | Clients | Priorité géographique | Offre | Rémunération |
| --- | --- | --- | --- | --- |
| Équipement d'un site avant son ouverture | Promoteurs de centres commerciaux, hôtels, enseignes du retail, programmes résidentiels, cliniques et écoles privées | Côte d'Ivoire | Projet d'équipement complet, planifié à rebours depuis la date d'ouverture | Forfait au projet payé par étapes et commission réduite |
| Approvisionnement récurrent des sites industriels | Sous-traitants Oil & Gas et miniers, exploitants de bases-vie, sites industriels | Gabon et Cameroun | Accord-cadre annuel | Forfait mensuel et commission réduite |

Les autres secteurs sont traités sur demande. Deux offres d'entrée ouvrent la relation dans tous les secteurs : la vérification d'un fournisseur (due diligence vendue au client), dont 50% sont déduits de la commission si un contrat d'achat est signé dans les 90 jours, et l'inspection seule.

Vocabulaire : « centrale d'achat » s'emploie seulement dans le discours commercial, toujours comme un service rendu. Les documents produits par l'application (devis, mandats, contrats, factures) emploient « bureau d'achat » ou « mandataire », car en achat accompagné le client achète en son nom.

Chaque promesse doit être prouvée par une fonction de l'application :

| Promesse | Fonction qui la prouve | Modules | Lot |
| --- | --- | --- | --- |
| Meilleur coût global | Données de coût global exigées des fournisseurs dans chaque réponse, calcul et comparaison dans le rapport des 3 offres | M5 | 1 |
| Conforme aux standards des donneurs d'ordre | Due diligence, inspection, dossier qualité au format du client final | M16, M8, M32 | 0 et 1 |
| Livré à la date d'ouverture | Planning à rebours depuis la date d'ouverture, alertes, avance sur la date d'ouverture visible par le client | M23, M33 | 1 |
| Transparence | Facture originale du fabricant et honoraires présentés séparément, engagement de non-commission des fournisseurs, journal du dossier | M14, M30, M23 | 0 et 1 |
| Sans blocage à la banque ni au port | Pack documentaire par expédition, certificat rédigé selon la lettre de crédit, dossier de domiciliation | M9, M12 | 0 et 1 |
| Suivi après la livraison | Pièces de rechange proposées au devis, réception sur site, garantie | M6, M28, M13 | 1 et 2 |

**L'activité à outiller**

- Une marque, deux sociétés détenues par la fondatrice : GBS Chine, WFOE de Guangzhou, qui réalise les services en Chine ; GBS Côte d'Ivoire, à Abidjan, qui contracte avec les clients ivoiriens et assure la présence sur place (section 1 bis).
- Trois marchés : Côte d'Ivoire, Gabon, Cameroun.
- Deux spécialités, plus les autres secteurs traités sur demande ; neuf segments, tenus dans le paramétrage, détaillent les clients : immobilier commercial et hôtelier, retail et grande distribution, bases-vie et sites industriels, Oil & Gas, équipement et matériel industriel, agro-industrie et chaîne du froid, promotion immobilière résidentielle, éducation et santé hors équipement médical, sport et loisirs.
- Dix services : due diligence des fournisseurs, consultation et sourcing, achat accompagné, contrôle qualité intégré à une commande, inspection seule, logistique export, négoce et clé en main (à partir de l'année 2), visite d'usines accompagnée, installation et mise en service, accord-cadre d'approvisionnement ; le forfait au projet, pour l'équipement d'un site, est un mode de rémunération de la consultation et de l'achat accompagné, et non un onzième service.

**Objectifs de l'application**

1. Un seul outil pour l'équipe de GBS Chine, l'équipe de GBS Côte d'Ivoire à Abidjan, les agents pays, les inspecteurs partenaires, les clients et les fournisseurs, avec une messagerie intégrée.
2. Faire respecter les deux verrous de la méthode : aucun achat sans contrat signé, aucune expédition sans inspection validée.
3. Calculer automatiquement les devis selon la grille tarifaire, sans saisie manuelle des commissions.
4. Offrir au client une transparence totale : facture originale du fabricant, rapports d'inspection, avancement en temps réel.
5. Suivre l'argent de bout en bout, en quatre devises identifiées par leur code ISO 4217 : XOF (franc CFA d'Afrique de l'Ouest, Côte d'Ivoire), XAF (franc CFA d'Afrique centrale, Gabon et Cameroun), USD et CNY (renminbi), y compris les paiements via WeChat Pay et Alipay.
6. Alimenter le pilotage avec les mêmes indicateurs que le modèle financier Excel.

**Hors périmètre**

- La comptabilité générale : l'application exporte vers le logiciel du cabinet comptable, sans le remplacer.
- La paie de l'équipe.
- Le dédouanement à l'arrivée, qui reste chez le transitaire du client.

## 1 bis. Organisation : GBS Chine et GBS Côte d'Ivoire

La marque Gulf Bridge Sourcing est portée par deux sociétés sœurs, toutes deux détenues directement par la fondatrice. L'application trace chaque dossier, chaque facture et chaque flux par société. Les deux sociétés sont des entreprises liées : les règles de prix de transfert s'appliquent à leurs échanges.

| Société | Pays | Rôle | Factures | Impôt (à confirmer par le fiscaliste) |
| --- | --- | --- | --- | --- |
| GBS Chine | Chine, WFOE de Guangzhou, créée au mois 4 | Services réalisés en Chine : due diligence, mise en concurrence, inspection, visites d'usines, logistique au départ ; négoce ; propriétaire de l'application | Factures chinoises (fapiao) en CNY, factures export en USD | 25%, ou environ 5% effectif au régime des petites entreprises à faible bénéfice ; TVA 6% |
| GBS Côte d'Ivoire | Côte d'Ivoire, Abidjan, créée au mois 1 | Vente, contrat local et facturation aux clients ivoiriens, réception, installation, après-vente, stock de pièces à Abidjan | Factures normalisées électroniques (FNE) en FCFA | 25% ; impôt minimum de 0,5% du chiffre d'affaires, 3 M FCFA au moins ; TVA 18% |

**Les dix services, la société qui les réalise et le partage**

| N° | Service | Réalisé par | Part de GBS Côte d'Ivoire (clients ivoiriens) |
| --- | --- | --- | --- |
| S1 | Due diligence fournisseur | GBS Chine | 5% de frais de gestion |
| S2 | Consultation et sourcing (forfait de consultation ou forfait au projet) | Les deux | 40% |
| S2 bis | Forfait au projet (équipement d'un site avant ouverture) | Les deux | 40% du forfait ; 30% de la commission réduite sur les achats du projet |
| S3 | Achat accompagné (commission, réassort à 50%) | Les deux | 30% |
| S4 | Contrôle qualité intégré à une commande | GBS Chine | 5% de frais de gestion |
| S5 | Inspection seule | GBS Chine | 5% de frais de gestion |
| S6 | Logistique export | GBS Chine | 5% de frais de gestion |
| S7 | Négoce et clé en main | GBS Chine, qui achète et revend | 30% de la marge |
| S8 | Visite d'usines accompagnée | GBS Chine | 5% de frais de gestion |
| S9 | Installation et mise en service | GBS Côte d'Ivoire | 100% |
| S10 | Accord-cadre d'approvisionnement | Les deux | 40% du forfait mensuel, 30% des commissions |

Ces parts sont des paramètres datés : une modification ne s'applique qu'aux dossiers ouverts après sa date d'effet. Au Gabon et au Cameroun, GBS Chine facture directement et un agent pays perçoit 15%, tant qu'aucune société n'est créée dans ces pays.

**Règles d'organisation**

- Chaque dossier porte la société qui contracte avec le client, le pays et l'origine du client (direct ou agent pays). Les mois 1 à 3, avant la création de la WFOE, GBS Côte d'Ivoire contracte et facture seule.
- GBS Côte d'Ivoire ne reçoit jamais l'argent d'un client destiné à un fournisseur. En achat accompagné, le client paie lui-même l'usine ; le négoce est porté par GBS Chine.
- Les documents commerciaux et le site indiquent, pour chaque pays, la société qui contracte ; la marque appartient à la fondatrice, qui en concède l'usage aux deux sociétés.
- L'application est conçue dès le lot 0 pour plusieurs sociétés aux données cloisonnées.

## 2. Utilisateurs, rôles et droits d'accès

Neuf rôles, chacun limité aux données dont il a besoin ; un client ne voit jamais les données d'un autre client, et un fournisseur jamais celles d'un autre fournisseur.

| Rôle | Qui | Langue principale | Accès | Appareil |
| --- | --- | --- | --- | --- |
| Administratrice | La fondatrice | Français | Tout, y compris paramétrage, marges, validation des paiements et des agréments | Ordinateur et mobile |
| Achats Chine | Assistant(e) achats à Guangzhou | Mandarin, anglais | Fournisseurs, due diligence, cotations, commandes, production, entrepôt, logistique ; pas les marges ni la facturation client | Ordinateur et mobile |
| Hub Afrique | Responsable des opérations de GBS Côte d'Ivoire à Abidjan | Français | Prospects, clients, consultations, devis et factures FNE de GBS Côte d'Ivoire, encaissements, réceptions, installations, stock de pièces à Abidjan, relevé des flux avec GBS Chine ; pas les prix fournisseurs détaillés, sauf la valeur FOB et l'instruction de paiement des dossiers de ses clients ivoiriens en achat accompagné, ni les comptes de GBS Chine | Ordinateur et mobile |
| Agent pays | Agent commercial au Gabon ou au Cameroun | Français | Prospects et clients de son pays, consultations et devis de ses clients, relevé de ses commissions ; pas les prix fournisseurs détaillés ni les clients d'un autre pays | Ordinateur et mobile |
| Inspecteur partenaire | Société d'inspection ou indépendant en Chine ; technicien d'installation en Afrique | Mandarin, anglais ; français pour les techniciens en Afrique | Uniquement les inspections, audits d'usine et interventions sur site qui lui sont confiés : liste de contrôle, photos, résultat ; ses notes de frais | Mobile, mode hors ligne |
| Client | Utilisateurs du client, en quatre sous-rôles : demandeur, technique, valideur, finance (cahier des charges des portails, section 3.3) | Français, anglais | Guide d'expression du besoin, suivi de ses dossiers, devis, commandes, rapports d'inspection et de due diligence, factures, documents, fils de messagerie qui le concernent | Ordinateur et mobile |
| Fournisseur | Utilisateurs du fournisseur, en sous-rôles commercial, qualité, logistique et finance (cahier des charges des portails, section 3.4) | Mandarin, anglais | Uniquement ses demandes de cotation, son dossier de due diligence, ses commandes et les fils de messagerie qui le concernent ; jamais les prix de vente au client ni les autres fournisseurs | Mobile et ordinateur ; formulaires par lien sécurisé au lot 1 |
| Comptable | Cabinet comptable | Français, anglais, mandarin | Lecture des factures, paiements, flux entre sociétés, commissions des agents pays, notes de frais et exports comptables, pour la seule société dont il tient les comptes | Ordinateur |
| Transitaire | Transitaire ou commissionnaire de transport choisi pour une expédition | Français, anglais, mandarin | Par lien sécurisé (lot 1), uniquement les expéditions qui lui sont confiées : saisie des étapes, dépôt des documents de transport ; jamais les prix des marchandises, les marges ni les autres dossiers | Ordinateur et mobile |

**Règles d'accès**

- Les droits sont appliqués côté base de données (règles par ligne), pas seulement dans l'interface.
- Toute validation sensible (agrément d'un fournisseur, libération d'une marchandise, paiement d'un solde fournisseur, modification de la grille tarifaire) est réservée à l'administratrice ou à une personne qu'elle délègue nominativement.
- Chaque action est horodatée et attribuée à un utilisateur dans un journal d'audit en ajout seul : aucune ligne ne peut être modifiée ni supprimée par l'application, et chaque ligne porte l'empreinte numérique de la précédente, de sorte que toute altération faite directement dans la base est détectable.

## 3. Parcours de bout en bout

Un dossier traverse les 11 phases de la section 4 bis, précédées de la prospection et suivies du service après-vente ; l'application bloque deux passages tant que leur condition n'est pas remplie.

&#91;embedded content: parcours d'un dossier, 11 phases et 2 verrous\]

Le premier verrou interdit toute production et tout acompte fournisseur sans contrat signé ; le second interdit le paiement du solde et l'expédition sans inspection validée.

## 4. Modules fonctionnels

Trente-huit modules, numérotés de M1 à M38, couvrent l'activité de bout en bout. La gestion des dossiers (M23), la mise en concurrence (M5), le suivi des expéditions (M9) et le guide d'expression du besoin (M31) sont détaillés en sections 4 bis à 4 quinquies.

| N° | Module | Fonctions principales | Écrans | Lot |
| --- | --- | --- | --- | --- |
| M1 | Prospection | Fiches prospects par spécialité (équipement d'un site, approvisionnement industriel, autre secteur sur demande), pays et segment, sources, relances programmées, entonnoir prospect, consultation, commande ; demandes entrantes du site web : reçues dans la console Atlas Studio jusqu'à la mise en service de l'application, puis créées directement en prospects avec leur source, leur spécialité, leur pays, leurs fichiers et leur page d'origine, la console n'en gardant qu'une notification (lot 1) ; alerte si le premier contact n'a pas eu lieu sous 1 jour ouvré | Liste, fiche, entonnoir | 0 (site web : lot 1) |
| M2 | Clients et vérification | Fiches sociétés et contacts, pays, devise, conditions de paiement, historique complet, registre des fournisseurs présentés ; vérification avant ouverture d'une affaire : identité, immatriculation, bénéficiaires effectifs, solvabilité, listes de sanctions, contrôle refait chaque année et à chaque changement d'actionnaire | Liste, fiche 360°, fiche de vérification | Fiches : lot 0 ; vérification : lot 1 |
| M3 | Consultations | Saisie du besoin et du cahier des charges client, pièces jointes, facturation du forfait d'avance, statut | Liste, fiche, formulaire de demande | 0 |
| M4 | Fournisseurs | Fiches fabricants, statut d'agrément, catégories, contacts, comptes bancaires et comptes WeChat Pay ou Alipay vérifiés ; indicateurs de performance calculés : livraison complète et à l'heure, taux de défaut en inspection en parties par million, délai de réponse aux cotations, non-conformités ouvertes | Liste, fiche | 0 (indicateurs de performance : lot 2) |
| M5 | Sourcing et mise en concurrence | Mise en concurrence des fournisseurs agréés sous pli fermé, offres ramenées à une base FOB, données de coût global exigées des fournisseurs, analyse pondérée incluant le coût global, négociation, rapport des 3 offres analysées au client (section 4 ter) ; échantillons (demande, envoi, numéro de suivi, coût, refacturation au client ou prise en charge) ; historique des prix par produit et par fournisseur | Demande de cotation, comparatif, historique des prix | Comparatif des offres saisies : lot 0 ; rapport automatique, coût global et suivi des échantillons : lot 1 ; enchère inversée : lot 3 |
| M6 | Devis, cotation client et mandats | Deux inspections prévues et chiffrées par défaut dans chaque devis, en cours de production et avant expédition ; le client peut renoncer par écrit à la première, jamais à la seconde ; liste de pièces de rechange proposée au client ; tarif de réassort proposé automatiquement ; cotation au client à partir de l'offre retenue (commission en mode 1, prix de vente et marge en mode 2), versions successives, Incoterm, mandat d'achat, signature électronique | Éditeur de devis, aperçu PDF | 0 (pièces de rechange au devis et signature intégrée : lot 1) |
| M7 | Commandes | Contrat fournisseur avec spécifications, Incoterm, jalons et pénalités de retard calculées automatiquement selon le contrat (taux par jour, plafond) et proposées en retenue sur le solde ; échéancier ; suivi de production ; alertes d'écart ; calendrier des fermetures d'usines (Nouvel An chinois, Golden Week) avec alerte sur les délais promis | Liste, fiche commande, calendrier | 0 (pénalités de retard calculées : lot 1) |
| M8 | Contrôle qualité | Planning des inspections, listes de contrôle par famille de produits (16 familles, cahier des charges du module mobile de terrain, section 5), échantillonnage selon la norme ISO 2859-1 (taille d'échantillon calculée selon la taille du lot, niveaux de qualité acceptables paramétrés pour les défauts critiques, majeurs et mineurs, décision proposée automatiquement), photos et vidéos, mesures, décision libération ou refus, rapport PDF trilingue ; détail complet dans le cahier des charges du module mobile de terrain (11 types de mission, en Chine et en Afrique) | Planning, application mobile d'inspection, rapport | 0 (rapport en français et en anglais) ; mobile hors ligne et rapport en mandarin : lot 1 |
| M9 | Logistique et suivi des expéditions | Remise au transporteur, connaissement, voyage et suivi jusqu'à destination, visibilité permanente du client, jours de franchise au port (section 4 quater) ; documents export, transitaires ; assurance transport : police, valeur assurée, déclaration de sinistre | Fiche expédition, suivi, sinistres | Suivi manuel et pièces exigées : lot 0 ; pack documentaire et formulaire du transitaire par lien : lot 1 ; gestion des transitaires et assurance : lot 2 ; suivi automatique : lot 3 |
| M10 | Négoce | Projets clé en main : prix de vente, achats, marge, acomptes clients et fournisseurs | Fiche projet, marge | 2 |
| M11 | Facturation et encaissements | Factures en XOF, XAF, USD ou CNY émises par la société qui contracte, avec sa propre numérotation ; factures de GBS Côte d'Ivoire certifiées par la FNE (QR code) ; échéancier 50/50, retenues à la source, relances, rapprochement des encaissements à partir des relevés bancaires importés aux formats standard (ISO 20022 camt.053 ou MT940 selon la banque, à défaut tableur) | Liste, facture, relances | 0 (import des relevés bancaires : lot 1) |
| M12 | Paiements | Mode 1 : instructions d'acompte et bons à payer émis au client, justificatifs de ses paiements, lettres de crédit, dossier de domiciliation. Mode 2 : acomptes et soldes payés par Gulf Bridge Sourcing en CNY ou USD, par virement, WeChat Pay ou Alipay ; solde bloqué tant que l'inspection n'est pas validée (voir section 5 bis) | File de paiements, validation | 0 (lettres de crédit : lot 1, avec la vérification des clients) |
| M13 | Garantie et service après-vente | Réclamations client, photos, recours auprès du fabricant, pièces détachées, retour ou remplacement de la marchandise (logistique retour, coûts, prise en charge), clôture | Liste, fiche réclamation | 2 |
| M14 | Portail client | Niveau 1 : page de suivi par lien sécurisé (étape en cours, jalons, documents, rapports, facture originale du fabricant et honoraires présentés séparément, avance sur la date d'ouverture, en jours) avec fil de messagerie. Niveau 2 : portail complet avec compte (demandes, devis à signer, factures, réclamations, historique) et rapport périodique de ses dossiers généré automatiquement | Page de suivi, espace client | Page de suivi en lecture seule et messagerie : lot 1 ; niveau 2 : lot 2 |
| M15 | Pilotage | Tableau de bord : entonnoir, chiffre d'affaires, encaissements à venir, point mort, alertes ; analytique des coûts et marge réelle par mission, dossier, client et accord-cadre, avec la liste des missions à perte et leur cause (règles en section 5, « Analytique des coûts et marge réelle ») | Tableau de bord, fiche de rentabilité, exports | Tableau de bord : lot 0 ; marge directe et missions à perte : lot 1 ; marge complète, budget au devis et tableaux de bord de rentabilité : lot 2 |
| M16 | Due diligence | Agrément interne obligatoire des fournisseurs (candidat, en évaluation, agréé, sous surveillance, suspendu, radié ; revue annuelle) et service vendu au client. Contrôles : existence légale et licence, capacité d'export, audit d'usine, capacités de production, certifications, références, litiges, conformité sociale et environnementale (référentiels reconnus : guide de l'OCDE sur le devoir de diligence pour une conduite responsable des entreprises, audit social de type SMETA ou amfori BSCI quand le client final l'exige), bénéficiaires effectifs, listes de sanctions refaites à chaque revue annuelle, concordance du compte bancaire avec la licence. Résultat : note, conclusions, date de validité, rapport PDF trilingue | Grille d'évaluation, rapport, registre des fournisseurs agréés | 0 (rapport en français et en anglais) ; bénéficiaires effectifs et sanctions refaites chaque année, rapport en mandarin : lot 1 ; audit d'usine sur l'application de terrain : lot 2 |
| M17 | Portail fournisseur | Niveau 1 : formulaires en mandarin par lien sécurisé, sans compte (réponse à une cotation, dépôt des pièces de due diligence). Niveau 2 : espace fournisseur (cotations, commandes, avancement de production, factures, documents export, messagerie) | Formulaires, espace fournisseur | Niveau 1 : lot 1 ; niveau 2 : lot 2 |
| M18 | Messagerie intégrée | Fils rattachés à chaque dossier ; fils interne, client et fournisseur aux droits distincts ; messages directs internes ; traduction automatique avec original conservé ; pièces jointes et photos ; accusés de lecture ; recherche ; messages non supprimables ; alerte des messages non lus | Boîte de réception, fil de dossier | Fils interne, client et fournisseur, avec traduction automatique : lot 1 ; messages vocaux transcrits et traduits : lot 3 |
| M19 | Entrepôt de consolidation | Réception des marchandises de plusieurs fournisseurs : contrôle des quantités, photos, réserves ; stockage par affaire ; liste de colisage ; préparation de l'empotage | Réceptions, stock par affaire, liste de colisage | 2 |
| M20 | Conformité à l'import | Référentiel, par pays et par catégorie de produits, des documents exigés à l'import (certificats de conformité avant embarquement, certificats d'origine, bordereau électronique de suivi des cargaisons exigé par chaque pays de destination, autres) ; liste de contrôle par expédition ; marchandises dangereuses (batteries au lithium, gaz, produits chimiques) : indicateur sur l'article, fiche de données de sécurité, rapport de test UN38.3 pour les batteries, déclaration au transporteur selon le code maritime IMDG, expédition bloquée tant que ces pièces manquent. Bordereau de suivi des cargaisons et marchandises dangereuses exigés dès le lot 0 dans les pièces de la phase Expédition | Référentiel, liste de contrôle | 2 |
| M21 | Partage de la valeur et commissions | Calcul, affaire par affaire à l'encaissement client, de la part de GBS Côte d'Ivoire, des frais de gestion et des commissions des agents pays selon les règles datées de la section 1 bis ; relevé mensuel, validation, export comptable (lot 1) | Règles de partage, relevé, validation | 0 (agents pays : lot 1) |
| M22 | Notes de frais | Saisie mobile des frais de l'équipe et des inspecteurs avec justificatif photo, rattachement obligatoire à un dossier ou aux frais généraux, validation, remboursement | Saisie, validation | 1 |
| M23 | Gestion des dossiers en mode projet | Dossier géré comme un projet : modèles par type, phases et statuts, délais cibles en jours ouvrés, contrôle de complétude des pièces, points bloquants avec escalade, avenants, journal, continuité, clôture, indicateurs de productivité (voir section 4 bis) | Portefeuille, fiche dossier, mes tâches, pièces manquantes, points bloquants, Gantt, productivité | Simplifié : lot 0 ; délais, avenants, mes tâches : lot 1 ; Gantt, productivité, satisfaction, archivage : lot 2 |
| M24 | Appels d'offres clients et préqualification | Enregistrement des appels d'offres et des référencements fournisseurs exigés par les grands clients ; dates limites ; pièces administratives ; offre technique et financière ; questions ; résultat et motifs | Liste, fiche d'appel d'offres, calendrier des échéances | 2 |
| M25 | Garanties bancaires | Cautions de bonne exécution, garanties de restitution d'acompte, retenues de garantie : banque, montant, échéance, mainlevée, alertes | Registre, alertes | 2 |
| M26 | Approbation technique et essais en usine | Soumission au client des plans, fiches techniques et échantillon de référence ; versions ; validation signée ; l'échantillon de référence devient la base de l'inspection ; essais en usine avec procès-verbal pour les équipements techniques | Circuit d'approbation, visionneuse de plans, procès-verbal d'essais | 1 |
| M27 | Non-conformités et actions correctives | Chaque défaut relevé : gravité, photos, correction exigée, délai, contre-inspection, clôture ; impact sur la note du fournisseur | Registre, fiche de non-conformité | 1 |
| M28 | Livraison, réception et installation | Lien avec le transitaire du client à destination (documents transmis, dédouanement, date de livraison) ; procès-verbal de réception sur site, réserves et levée ; pour le clé en main : équipes de pose, techniciens venus de Chine et leurs visas, planning sur site, procès-verbal de mise en service | Fiche de livraison, procès-verbal de réception, planning d'installation | Réception et installation par GBS Côte d'Ivoire : lot 1 ; clé en main avec équipes venues de Chine : lot 2 |
| M29 | Trésorerie et risque de change | Prévision des encaissements et décaissements par dossier, consolidée ; exposition au change entre XOF, XAF, CNY et USD entre le devis et le paiement ; clause de révision de prix dans les devis du négoce | Prévision de trésorerie, exposition de change | 2 |
| M30 | Éthique et conformité | Registre des cadeaux et invitations, déclarations de conflits d'intérêts, engagement anti-corruption signé par chaque fournisseur ; interdiction de toute commission versée par un fournisseur ; dispositif fondé sur les principes de la norme ISO 37001 sur le management anti-corruption | Registres, engagements | Engagement de non-commission : lot 0 ; registres : lot 2 |
| M31 | Guide d'expression du besoin | Questionnaire guidé par catégorie de produit, contrôle de complétude et de cohérence en temps réel, génération du cahier des charges en français et en mandarin, questions et réponses par champ, versions, validation signée (voir section 4 quinquies) | Assistant pas à pas, cahier des charges généré, revue par champ | Usage interne et ouvert au client : lot 1 ; assistance par IA : lot 3 |
| M32 | Dossier qualité grands comptes | Assemblage par dossier du dossier qualité de fin de fabrication : certificats, rapports d'inspection et d'essais, traçabilité (numéros de série), rapport de due diligence et engagement éthique du fournisseur ; mise en forme selon le référentiel du client final, avec une liste de contrôle propre à chaque client | Dossier qualité, liste de contrôle par client | PDF assemblé et format du client final : lot 1 |
| M33 | Planning à rebours depuis la date d'ouverture | Date d'ouverture du site saisie dans le dossier ; planning calculé à rebours à partir des délais cibles de chaque phase ; alerte dès que la date devient intenable ; avance sur la date d'ouverture affichée sur la page de suivi du client | Rétroplanning, alertes | 1 |
| M34 | Fiches de référence clients | Génération, à partir d'un dossier clos et avec l'accord du client, d'une fiche de référence (besoin, solution, délais tenus, écart de coût global obtenu) pour la plaquette et les réponses aux appels d'offres | Fiche de référence, accord du client | 2 |
| M35 | Sociétés | Fiche de chaque société (pays, devise, numérotation des factures, taux d'impôt, coordonnées bancaires) ; société contractante, pays et origine portés par chaque dossier ; données cloisonnées par société utilisatrice | Fiche société, sélecteur de société | 0 |
| M36 | Flux entre sociétés | Relevé mensuel des sommes dues entre GBS Chine et GBS Côte d'Ivoire, factures intragroupe générées, retenues à la source, pièces justificatives des prix de transfert (voir section 5 ter) | Relevé, factures intragroupe, dossier prix de transfert | Relevé : lot 0 ; dossier prix de transfert : lot 2 |
| M37 | Stock de pièces et interventions sur site | Stock de pièces de rechange à Abidjan (entrées, sorties, inventaire, seuil de réassort) ; interventions d'installation, de mise en service et d'après-vente : planning, techniciens, temps passé, coût réel, facturation au coût + 15% ; hygiène, sécurité et environnement : analyse de risques par intervention, permis de travail exigés par le site, habilitations et formations d'accueil des techniciens avec dates de validité, équipements de protection, registre des incidents et presque-accidents | Stock, fiche d'intervention, planning | Interventions : lot 1 ; stock : lot 2 |
| M38 | Pilotage par société, segment et service | Chiffre d'affaires et contribution par société, par spécialité, par segment (9) et par service (10) ; matrice spécialités et segments x services ; vue consolidée des deux sociétés, flux internes éliminés ; comparaison au modèle financier | Tableau de bord par société, matrice, vue consolidée | Par société : lot 0 ; matrice et consolidation : lot 2 |

Trois modules transverses complètent l'ensemble.

- **Documents** : contrats, conditions générales, rapports, factures, classés par client, commande et fournisseur, avec versions ; modèles des cinq contrats types de droit OHADA (conditions générales de prestation, mandat d'achat, contrat de mission ponctuelle, engagement du fournisseur, contrat d'agent commercial), remplis automatiquement à partir du dossier ; chaque version de modèle est datée et ne sert qu'après validation par l'avocat.
- **Paramétrage** : grille tarifaire, spécialités, catalogue des dix services et leurs tarifs, règles de partage entre sociétés, taux des agents pays, sociétés, Incoterms autorisés, référentiel de conformité à l'import, taux de change, pays, segments, catégories de produits, modèles de documents, utilisateurs et rôles.

* Référentiel articles (lot 0, droits de douane : lot 2) : chaque article commandé porte une référence unique, sa catégorie, son unité de mesure, sa nomenclature douanière (code SH à 6 chiffres, complété selon le pays), son poids et son volume unitaires, son indicateur « marchandise dangereuse » avec sa classe, et ses certificats exigés. Un barème de droits et taxes à l'import par zone (tarif extérieur commun de l'UEMOA pour la Côte d'Ivoire, de la CEMAC pour le Gabon et le Cameroun), paramétrable et daté, alimente les droits estimés du coût global ; les taux sont à confirmer avec le transitaire.

## 4 bis. Gestion des dossiers en mode projet (M23)

Chaque affaire est un dossier géré comme un projet : il s'ouvre à la première demande du client et regroupe consultations, due diligence, cotations, commandes fournisseurs, inspections, expéditions, factures, messages et documents.

&#91;embedded content: dossier en mode projet, 10 entités\]

Un dossier peut contenir plusieurs commandes fournisseurs consolidées dans une même expédition ; chaque phase porte ses tâches et ses pièces exigées.

**Fiche et modèles de dossier**

- Fiche : client, mode financier (section 5 bis), chef de dossier, équipe, priorité, dates promises au client, spécialité, date d'ouverture du site (base du planning à rebours, M33).
- Modèles par type de dossier : due diligence seule, consultation seule, inspection seule, visite d'usines accompagnée, logistique seule, installation seule, achat accompagné, équipement d'un site avant ouverture (forfait au projet, section 5), négoce, et dossier-cadre annuel pour chaque accord-cadre, auquel se rattachent les dossiers de commande de la période. Chaque modèle définit ses phases, ses tâches types, ses pièces exigées et ses délais cibles.

**Phases et statuts**

- Phases standard, selon le modèle : consultation, vérification et due diligence, mise en concurrence, devis et mandat, contrat, approbation technique, production, inspection, expédition, livraison et installation, clôture.
- Statut de chaque phase : non commencée, en cours, en attente d'un tiers, bloquée, complète, validée.
- Dates prévues et réelles, responsable, tâches générées automatiquement et complétables par l'équipe.

**Délais**

- Délai cible par phase et par type de dossier, paramétrable ; les valeurs sont à définir par la fondatrice.
- Calcul en jours ouvrés, avec les jours fériés de chaque pays concerné : Chine, Côte d'Ivoire, Gabon, Cameroun.
- Voyants vert, orange et rouge sur chaque phase, et alerte avant dépassement.
- L'horloge interne s'arrête quand le dossier attend un tiers (client, fournisseur, transporteur) : délai interne et délai externe sont mesurés séparément.
- Comparaison entre les dates promises au client et les dates réelles.

**Contrôle de complétude**

- Chaque phase a sa liste de pièces exigées, obligatoires ou facultatives, avec leur état : manquante, reçue, à vérifier, validée, refusée, expirée ; l'auteur et la date sont conservés.
- Taux de complétude par phase et par dossier.
- Le passage à la phase suivante est bloqué si une pièce obligatoire manque, et signalé si une pièce facultative manque. Une dérogation n'est possible que par l'administratrice, avec un motif inscrit au journal d'audit.
- Une pièce manquante se demande en un clic à qui doit la fournir : le client par sa page de suivi, le fournisseur par son formulaire, l'équipe par ses tâches. Les relances sont automatiques ; au-delà du délai paramétré, la pièce manquante devient un point bloquant.
- Les pièces datées (due diligence, licence, certificats) déclenchent une alerte avant leur expiration.

| Phase | Pièces exigées par défaut |
| --- | --- |
| Consultation | Cahier des charges du client validé et signé (guide d'expression du besoin), facture du forfait réglée |
| Vérification et due diligence | Fiche de vérification du client ; licence du fournisseur, rapport de due diligence valide, engagement de non-commission signé par le fournisseur |
| Mise en concurrence | Offres reçues sous pli fermé avec leur Incoterm, grille d'analyse, rapport des 3 offres analysées, choix signé du client |
| Devis et mandat | Devis accepté, mandat signé, référence de domiciliation du client |
| Contrat | Contrat fournisseur signé, facture pro forma |
| Approbation technique | Plans et fiches techniques validés par le client, échantillon de référence approuvé, procès-verbal d'essais en usine si l'équipement l'exige |
| Production | Justificatif de l'acompte, points d'avancement |
| Inspection | Rapport validé, certificat d'inspection |
| Expédition | Facture commerciale, liste de colisage, projet de connaissement validé puis connaissement, preuve d'envoi des originaux, certificat d'origine, documents de conformité exigés par le pays, bordereau électronique de suivi des cargaisons du pays de destination (BSC en Côte d'Ivoire, BESC au Cameroun, BIETC au Gabon), déclaration et documents des marchandises dangereuses le cas échéant, attestation d'assurance si prévue |
| Livraison et installation | Avis de mise à disposition au port, procès-verbal de réception sur site avec réserves éventuelles, levée des réserves, procès-verbal de mise en service pour le clé en main |
| Clôture | Justificatif du solde, facture de commission réglée, accusé de réception du client, dossier qualité remis au client |

Cette liste est à valider et à paramétrer par la fondatrice ; les documents d'import exigés pays par pays restent à confirmer avec le transitaire.

**Points bloquants**

- Registre par dossier : description, catégorie (client, fournisseur, qualité, paiement, logistique, documents, interne), impact estimé sur le délai, responsable, échéance de résolution, actions menées, résolution.
- Escalade automatique vers l'administratrice si le point n'est pas résolu dans le délai fixé.
- Visibilité sur la page de suivi du client choisie point par point.

**Modifications en cours de dossier**

- Un avenant enregistre la modification (quantité, spécification, délai), son impact sur le prix et sur le planning, sa validation interne et sa signature électronique ; le planning est ensuite recalculé automatiquement.

**Journal, continuité, clôture**

- Journal du dossier : chronologie unique, en ajout seul et à altération détectable (section 2), des étapes, pièces, messages, paiements et décisions.
- Réaffectation d'un dossier ou délégation de tâches en cas d'absence, sans perte d'historique.
- Clôture : revue rapide (délais tenus, points bloquants rencontrés, leçons) et enquête de satisfaction auprès du client.
- Archivage des dossiers clos, selon les règles d'archivage à valeur probante de la section 10 bis (10 ans par défaut, à confirmer par le comptable).

**Vues**

- Portefeuille des dossiers, en liste ou en colonnes par phase.
- « Mes tâches » pour chaque membre de l'équipe.
- Dossiers en retard, points bloquants ouverts, pièces manquantes de tous les dossiers triées par urgence.
- Planning de chaque dossier en diagramme de Gantt.

**Indicateurs de productivité**

| Indicateur | Définition |
| --- | --- |
| Taux de diligence | Part des phases traitées dans leur délai cible, sur le délai interne |
| Délai moyen par phase | Comparé au délai cible, par type de dossier |
| Retards par cause | Internes ou externes, par catégorie |
| Charge | Dossiers actifs et tâches en cours par personne |
| Points bloquants | Nombre ouverts, ancienneté, temps moyen de résolution |
| Complétude | Taux moyen de complétude, pièces manquantes en retard |
| Engagements client | Part des dates promises au client tenues |
| Satisfaction | Résultat des enquêtes de clôture |

**Découpage** : au lot 0, la fiche, les modèles, les phases et leurs statuts, la complétude, les points bloquants et le journal ; au lot 1, les délais en jours ouvrés avec alertes, les avenants, « mes tâches » et la continuité en cas d'absence ; au lot 2, le diagramme de Gantt, le tableau de productivité complet, l'enquête de satisfaction et l'archivage.

## 4 ter. Mise en concurrence des fournisseurs (M5)

La mise en concurrence produit le livrable central du service de sourcing : un rapport présentant au client 3 offres analysées et une recommandation argumentée.

**Dossier de consultation fournisseurs**

- Spécifications, quantités, Incoterm et lieu demandés, délai de livraison, conditions de paiement, garantie exigée, date limite de réponse.
- Envoi simultané à plusieurs fournisseurs agréés, en mandarin, par le formulaire fournisseur.

**Données de coût global exigées dans chaque réponse**

Le formulaire de réponse des fournisseurs impose, pour chaque article, les données qui permettent de calculer le coût sur la durée de vie :

- puissance et consommation d'énergie dans l'usage décrit par le cahier des charges ;
- durée de vie attendue et durée de garantie ;
- plan d'entretien recommandé : opérations, fréquence, temps nécessaire ;
- liste et prix des pièces d'usure et de rechange, et durée pendant laquelle elles restent disponibles ;
- service après-vente ou partenaire en Afrique de l'Ouest et du Centre, et délai de livraison des pièces.

Une réponse sans ces données est signalée incomplète. Les données déclarées par le fournisseur retenu sont reprises dans son contrat comme engagements (prix et disponibilité des pièces, consommation annoncée), et la consommation est vérifiée lors des essais en usine ou de l'inspection.

Deux paramètres restent locaux, parce qu'aucun fournisseur ne peut les fournir : le coût de l'énergie dans chaque pays et le coût horaire de l'entretien sur place. L'horizon de calcul est aussi un paramètre, ajustable par dossier.

**Équité et confidentialité**

- Plis fermés : dès que les offres arrivent par le formulaire fournisseur (lot 1), chaque offre est chiffrée jusqu'à la date limite et aucun utilisateur, administratrice comprise, ne peut la consulter dans l'application ; tout accès technique à la base pendant cette période est tracé et signalé à l'administratrice. Au lot 0, les offres reçues par WeChat ou e-mail ne sont enregistrées qu'après la date limite, avec leur date et heure de réception.
- Questions et réponses partagées : la réponse à la question d'un fournisseur est transmise à tous, sans révéler qui l'a posée.
- Un fournisseur ne voit jamais ni les prix ni l'identité des autres.

**Analyse des offres**

- Normalisation : toutes les offres sont ramenées à la même base (FOB, même devise, mêmes options, frais annexes inclus).
- Grille pondérée et paramétrable : prix, conformité technique, délai, note de due diligence, conditions de paiement, garantie, capacité de production.
- Alertes : offre anormalement basse, réponse incomplète, écart important avec l'historique des prix.
- Coût global calculé automatiquement pour chaque offre : prix rendu, énergie, entretien et pièces sur l'horizon choisi.

**Négociation**

- Un ou plusieurs tours avec les fournisseurs retenus, puis une offre finale ; chaque tour est tracé.

**Rapport au client**

- Rapport généré automatiquement : tableau comparatif des 3 offres, notes par critère, points forts et risques de chaque offre, recommandation argumentée.
- Fournisseurs présentés de façon anonyme (fournisseur A, B, C) pour éviter le contournement ; après la signature du mandat, en achat accompagné, l'identité du fournisseur retenu n'apparaît que sur le contrat, la facture et le paiement (section 5, « Anonymat réciproque »).
- Choix du client enregistré et signé ; réponse automatique aux fournisseurs non retenus.
- Prix d'achat et coût global affichés côte à côte, avec l'explication lorsque l'offre recommandée n'est pas la moins chère à l'achat.

**Option, lot 3** : enchère inversée en ligne, à tester auprès des usines avant tout développement ; son acceptation par les fournisseurs chinois des catégories visées n'est pas vérifiée.

## 4 quater. Suivi des expéditions jusqu'à destination (M9)

Le client doit savoir à tout moment où se trouve sa marchandise, de la remise au transporteur jusqu'à sa mise à disposition au port d'arrivée.

**Remise au transporteur**

- Date et lieu de remise (usine, entrepôt de consolidation, port), transitaire, réservation, numéros de conteneur et de plomb, photos de chargement et d'empotage.
- Trois cas gérés : conteneur complet, groupage, fret aérien.

**Connaissement**

- Type : connaissement original, télex release ou connaissement non négociable ; lettre de transport aérien pour l'aérien. Connaissement maître et connaissement du transitaire en cas de groupage.
- Vérification du projet de connaissement avant émission : cohérence avec la facture, la liste de colisage et, le cas échéant, la lettre de crédit.
- Suivi de l'envoi des originaux par courrier vers le client ou sa banque : numéro de suivi, date de remise.
- Date de mainlevée, à partir de laquelle le client peut retirer sa marchandise.

**Pack documentaire banque et douane** : pour chaque expédition, un seul dossier téléchargeable regroupe les pièces attendues par la banque et le transitaire du client (facture, liste de colisage, connaissement, certificat d'inspection rédigé selon la lettre de crédit, certificat d'origine, documents de conformité, bordereau électronique de suivi des cargaisons, référence de domiciliation). Lot 1 ; au lot 0, chaque pièce est exigée une à une dans la phase Expédition.

**Voyage jusqu'à destination**

- Étapes : départ du port chinois, transbordements éventuels, arrivée au port de destination (Abidjan, San-Pédro, Owendo, Douala ou Kribi), déchargement, mise à disposition.
- Date d'arrivée prévue et ses mises à jour, avec alerte au client et à l'équipe en cas de retard.
- Jours de franchise au port d'arrivée : alerte avant le début des frais de stationnement du conteneur.

**Visibilité pour le client**

- Sur sa page de suivi : étape actuelle, date d'arrivée prévue, navire, numéro de conteneur, documents (copie du connaissement, facture, liste de colisage), historique des étapes.
- Notification automatique à chaque étape importante.

**Deux niveaux d'automatisation**

- Lot 0 : saisie des étapes par l'équipe ; au lot 1, saisie possible par le transitaire au moyen d'un formulaire par lien sécurisé.
- Lot 3 : suivi automatique par un service de suivi de conteneurs (étapes, position du navire, carte). La couverture des ports d'Afrique de l'Ouest et du Centre par ces services et leur coût ne sont pas vérifiés.

## 4 quinquies. Guide d'expression du besoin (M31)

Le guide aide le client à exprimer un besoin complet du premier coup : il réduit les allers-retours qui retardent les dossiers et évite les produits non conformes.

**Questionnaire guidé, par catégorie de produit**

- Le client choisit une catégorie (12 catégories rattachées aux 7 premiers segments, définies dans le référentiel, et 4 catégories proposées pour les 2 derniers segments, à valider par la fondatrice : « groupes électrogènes, pompes et compresseurs » et « manutention, outillage et pièces de rechange » pour l'équipement et matériel industriel ; « revêtements sportifs et éclairage de terrains » et « équipements de salle, vestiaires et tribunes » pour le sport et loisirs), puis répond étape par étape.
- Contenu : usage, quantités, dimensions, matériaux, finitions ; contraintes locales souvent oubliées (tension électrique et type de prises du pays, climat tropical, chaleur, humidité, air salin en zone côtière) ; normes et certifications exigées ; budget indicatif, délai souhaité, lieu de livraison, besoin d'installation ; garantie et pièces détachées attendues ; pièces jointes (plans, photos, références, exemples de produits).
- Chaque question est accompagnée d'une explication et d'un exemple de bonne réponse.
- Les questionnaires par catégorie figurent dans le [référentiel des questionnaires d'expression du besoin](https://claude.ai/code/artifact/3afb0e72-90be-4e1e-a19c-d7b0253de608) (tronc commun, 16 catégories dont 4 à valider, alertes de cohérence), à valider par la fondatrice ; ils sont paramétrables sans développement.

**Contrôle en temps réel**

- Champs indispensables définis par catégorie ; taux de complétude affiché ; envoi impossible si une information critique manque.
- Alertes d'incohérence, par exemple une tension électrique qui ne correspond pas au pays de livraison.

**Cahier des charges généré automatiquement**

- À partir des réponses, l'application produit le cahier des charges du client en PDF, en français.
- Elle en produit la version en mandarin, qui alimente directement le dossier de consultation des fournisseurs (section 4 ter), sans ressaisie.

**Validation sans allers-retours par e-mail**

- L'équipe relit et pose ses questions sur le champ concerné ; le client répond au même endroit.
- Chaque version est conservée.
- Le client valide la version finale par signature : elle devient la référence contractuelle des spécifications, puis la base de l'approbation technique et de la liste de contrôle d'inspection.

**Fonctions pratiques**

- Brouillon enregistré automatiquement.
- Plusieurs contributeurs côté client, par exemple l'acheteur et le responsable technique.
- Modèles de cahier des charges par catégorie, dont le client peut partir.

**Mesure du gain** : nombre d'allers-retours par besoin, et délai entre la première demande et le cahier des charges validé.

**Découpage** : au lot 0, besoin recueilli sur un modèle de document ; au lot 1, guide en usage interne (l'équipe le remplit avec le client, par exemple en visioconférence) et ouvert au client en ligne, avec les questions par champ et la validation signée ; au lot 3, assistance par IA pour reformuler une réponse et suggérer les questions manquantes.

## 5. Règles de gestion

Les règles ci-dessous sont celles du modèle financier ; leurs valeurs sont paramétrables, jamais écrites en dur dans le code.

**Tarification (module Devis)**

| Règle | Valeur par défaut | Calcul |
| --- | --- | --- |
| Commission par tranche de valeur FOB | 12% jusqu'à 10 M FCFA ; 10% jusqu'à 50 M ; 8% jusqu'à 150 M ; 6% jusqu'à 500 M ; 4,5% au-delà | Taux de la tranche dans laquelle tombe la valeur de la commande |
| Majoration sur-mesure | +2 points | Ajoutée au taux si la commande est marquée sur mesure |
| Commission minimale | 1 000 000 FCFA | Maximum entre la commission calculée et le minimum, appliqué une fois par dossier quel que soit le nombre de commandes |
| Forfait de consultation | 300 000 à 1 000 000 FCFA, saisi par consultation | Payé d'avance ; déduit de la commission si une commande suit |
| Forfait au projet (équipement d'un site avant ouverture) | Fixé pour chaque projet dans la proposition chiffrée | Payé par étapes ; le premier versement, payé à la signature, est déduit du solde ; commission réduite sur les achats du projet, taux fixé dans la proposition ; le forfait de consultation ne s'applique pas |
| Contrôle qualité intégré à une commande | 250 000 FCFA par jour, certificat pour la lettre de crédit et dossier qualité compris | Nombre de jours d'inspection prévus x tarif |
| Inspection vendue seule | 160 000 FCFA par jour | Aligné sur le marché (environ 270 USD par homme-jour chez une société d'inspection établie) ; nombre de jours x tarif |
| Commande de réassort | Commission réduite de 50% | Appliquée quand le client recommande le même produit au même fournisseur ; le forfait de consultation ne s'applique pas |
| Due diligence fournisseur vendue au client | Standard : 500 000 FCFA ; renforcée : 850 000 FCFA | Standard : une usine, audit d'une journée, existence légale, certifications, références, concordance du compte bancaire. Renforcée : deux jours sur place, sous-traitants, exigences du donneur d'ordre. Payée d'avance ; 50% déduits de la commission si un contrat d'achat est signé dans les 90 jours |
| Visite d'usines accompagnée | 250 000 FCFA par jour, 2 jours minimum | Programme et rendez-vous compris ; transport et hébergement de l'accompagnant facturés au réel |
| Installation et mise en service | Coût réel + 15% | Réalisée et facturée par GBS Côte d'Ivoire ; coût réel = temps des techniciens, sous-traitants et déplacements saisis dans l'intervention (M37) |
| Frais de gestion logistique | 6,5% du coût logistique, minimum 150 000 FCFA par expédition | En achat accompagné, le client paie lui-même le fret au transitaire ; en négoce, le fret est compris dans le prix de vente |
| Accord-cadre | 350 000 FCFA par mois, et -1 à -2 points sur la commission | Contrat annuel : priorité de traitement, veille fournisseurs, cotations sans limite, point mensuel ; les commandes restent facturées à la commission réduite. Le forfait mensuel se situe dans le bas de la fourchette du marché (500 à 3 000 USD par mois chez les agents de sourcing) |
| Négoce | Marge de 15 à 25% | Prix de vente rendu port = coût d'achat / (1 - taux de marge) |

**Les deux verrous, bloquants dans l'application**

1. **Aucun achat sans contrat signé** : une commande ne peut pas passer au statut « en production », et aucun acompte fournisseur ne peut être payé, tant que le mandat client et le contrat fournisseur ne sont pas signés électroniquement. Le passage au statut « en production » exige en outre le justificatif de l'acompte versé au fournisseur (payé par le client en achat accompagné, par GBS Chine en négoce) ; une commande sur mesure exige aussi l'approbation technique signée par le client (M26 ; au lot 0, accord écrit du client déposé dans le dossier).
2. **Aucune expédition sans inspection validée** : le paiement du solde fournisseur et le passage au statut « expédiée » sont bloqués tant que le rapport d'inspection avant expédition n'est pas validé. Une dérogation n'est possible que par l'administratrice, avec un motif obligatoire inscrit au journal d'audit.

Ces deux verrous s'appliquent différemment selon le mode de flux financier de l'affaire : bloquants techniquement en négoce, contractuels en achat accompagné (section 5 bis).

**Facturation et paiements**

- La société qui facture est fixée par la règle suivante, identique à celle du modèle financier. Client ivoirien : GBS Côte d'Ivoire facture les forfaits de consultation, les forfaits au projet, les commissions, les forfaits d'accords-cadres et les installations, en XOF par la FNE ; GBS Chine facture directement les services réalisés en Chine (due diligence, contrôle qualité, inspection, logistique, visites d'usines) et le négoce, en USD. Client gabonais ou camerounais : GBS Chine facture tous les services et le négoce, en USD. Mois 1 à 3, avant la création de GBS Chine : GBS Côte d'Ivoire facture tous les services. Chaque société a sa propre numérotation. Une facture de GBS Côte d'Ivoire n'est valable qu'après certification par la plateforme FNE de la DGI (numéro, QR code) ; en cas d'indisponibilité de la plateforme, elle reste en attente et ne part pas au client.
- La commission est facturée en deux fois : 50% à la signature du contrat fournisseur, 50% avant le départ de la marchandise.
- L'expédition est bloquée tant que la facture de commission due n'est pas réglée, sauf dérogation de l'administratrice.
- Les paiements faits par Gulf Bridge Sourcing (négoce et paiements propres) ne peuvent aller que vers un compte (bancaire, WeChat Pay ou Alipay) marqué « vérifié » dans la fiche fournisseur ; en achat accompagné, ce compte vérifié est celui qui figure sur l'instruction de paiement envoyée au client. Toute modification d'un compte vérifié le repasse à « non vérifié », ce qui protège contre la fraude au changement de coordonnées. Contrôle à quatre yeux : la personne qui prépare un ordre de paiement ou la vérification d'un compte ne peut pas la valider ; au démarrage, l'assistant(e) achats prépare et l'administratrice valide, et un paiement préparé par l'administratrice elle-même exige la validation d'une seconde personne qu'elle désigne nominativement.
- Les retenues à la source s'appliquent aux seules factures d'une société non résidente du pays du client (factures de GBS Chine aux clients africains, factures intragroupe de la section 5 ter) et sont calculées par pays selon un taux paramétré ; l'attestation de retenue remise par le client est demandée et rattachée à la facture. Valeurs par défaut, hors convention fiscale : Côte d'Ivoire 20%, Cameroun 15%, Gabon 25% (taux général sur les revenus des non-résidents) ; à confirmer par le fiscaliste. La facture indique si le prix est exprimé avant ou après retenue. TVA : un taux paramétré et daté par pays, par société émettrice et par type de service ; la règle applicable aux services facturés depuis l'étranger (autoliquidation par le client ou non) est à confirmer par le fiscaliste pour chaque pays. Valeurs par défaut du taux général : Côte d'Ivoire 18% ; Cameroun 19,25% (17,5% plus 10% de centimes additionnels communaux) ; Gabon 18% (taux normal, à confirmer) ; Chine 6% sur les services de GBS Chine.
- Chaque montant est enregistré dans sa devise d'origine, identifiée par son code ISO 4217, avec le taux de change du jour, et converti en XOF pour le pilotage. Le XOF (Côte d'Ivoire) et le XAF (Gabon, Cameroun) ont la même parité fixe avec l'euro mais ne sont pas interchangeables : chaque facture, paiement, relevé et rapprochement porte le code exact. Les montants de la grille tarifaire exprimés en FCFA s'appliquent à parité dans les deux zones.

**Calcul de la commission, dans cet ordre**

1. Base : valeur FOB de toutes les commandes fournisseurs du dossier, convertie en XOF au cours du jour de signature du devis (parité fixe pour l'euro, cours du jour pour l'USD et le CNY). La tranche du barème se lit sur cette valeur totale, pour que le découpage en plusieurs commandes ne change pas le taux.
2. Taux de la tranche, plus 2 points sur la valeur des lignes sur mesure.
3. Remise d'accord-cadre : -1 point par défaut, -2 points si l'engagement annuel d'achats du client dépasse un seuil paramétré.
4. Réassort : commission réduite de 50% sur la valeur des lignes en réassort.
5. Minimum de 1 000 000 FCFA par dossier, appliqué au total.
6. Déduction du forfait de consultation déjà payé, sur la première facture de commission ; si la commission est inférieure au forfait, rien n'est remboursé.
7. Déduction de la vérification d'un fournisseur : si le client a commandé une vérification dans les 90 jours qui précèdent la signature du premier contrat d'achat du dossier, 50% du prix de cette vérification sont déduits de la première facture de commission ; si la commission restante est inférieure à cette déduction, rien n'est remboursé.
8. Facturation : 50% à la signature du premier contrat fournisseur, calculés sur le devis ; le solde avant le départ de la dernière expédition, recalculé sur la valeur FOB réelle avenants compris, avec facture complémentaire ou avoir. Un écart de change de plus de 5% entre le devis et la signature du contrat déclenche un nouveau calcul.

Les seuils et pourcentages sont paramétrables. Cet ordre de calcul doit être reporté dans le modèle financier, pour que le test de recette « devis identique au modèle Excel » reste valable.

**Annulation par le client**

- Avant la signature du contrat fournisseur : le forfait de consultation reste acquis, aucune commission n'est due.
- Après la signature du contrat fournisseur et avant le début de la production : la première moitié de la commission reste acquise, plus les frais engagés (jours d'inspection, déplacements, échantillons) refacturés au coût.
- Après le début de la production : la commission totale est due, plus les frais engagés.
- Acompte fournisseur : en achat accompagné, son sort suit le contrat fournisseur et reste à la charge du client ; en négoce, les conditions générales de vente prévoient que l'acompte du client couvre les sommes déjà engagées par GBS Chine.
- L'application gère le statut « annulé » du dossier et de chaque commande, calcule les montants dus selon la phase atteinte, émet l'avoir correspondant (certifié par la FNE pour GBS Côte d'Ivoire) et recalcule le partage entre sociétés et la commission des agents pays.
- Ces règles sont reprises dans le mandat d'achat et les conditions générales, à valider par le juriste.

**Accord-cadre**

- Un dossier-cadre porte le contrat : client, dates de début et de fin, renouvellement, forfait mensuel, remise de commission, engagement annuel éventuel, articles et prix de réassort convenus.
- Le forfait mensuel est facturé automatiquement chaque mois par la société qui contracte, tant que le contrat est actif.
- Chaque commande de la période ouvre un dossier de commande rattaché au dossier-cadre, qui applique la remise ; une alerte précède l'échéance du contrat de 60 jours.

**Forfait au projet (équipement d'un site avant ouverture)**

- Un dossier de type « équipement d'un site » porte la date d'ouverture, le périmètre (familles de produits et lots), le montant du forfait, l'échéancier des versements et le taux de commission réduite sur les achats du projet ; il ne peut pas être ouvert sans date d'ouverture, base du planning à rebours (M33).
- Échéancier : premier versement à la signature de la proposition de projet, versements suivants aux étapes fixées dans la proposition ; chaque étape atteinte génère sa facture, émise par la société qui contracte.
- Le premier versement est déduit du solde du forfait : chaque facture affiche le forfait total, les versements déjà encaissés et le reste dû.
- Commission réduite : calculée dans l'ordre ci-dessus avec le taux fixé dans la proposition à la place du barème par tranche ; le forfait de consultation ne s'applique pas.
- Lot : échéancier, factures et commission réduite au lot 0, car la Côte d'Ivoire et cette spécialité portent les premières ventes ; liaison avec le planning à rebours au lot 1, avec M33.

**Fret en achat accompagné**

Le client paie lui-même le fret et les frais du transitaire, sur facture établie à son nom ; Gulf Bridge Sourcing choisit ou coordonne le transitaire et ne facture que ses frais de gestion logistique. Aucun débours n'est encaissé par Gulf Bridge Sourcing pour le compte du client. En négoce, le fret est compris dans le prix de vente.

**Inspection d'une commande externe**

Une inspection seule porte sur un « lot à inspecter » déclaré par le client chez son propre fournisseur. Ce fournisseur n'a pas besoin d'être agréé, n'entre pas au registre des fournisseurs présentés et est marqué « apporté par le client » ; les verrous ne s'appliquent pas, le rapport et le certificat d'inspection étant les seuls livrables. Une contre-inspection est facturée au client au même tarif, sauf si son contrat avec son fournisseur la met à la charge de ce dernier.

**Anonymat réciproque du client et du fournisseur**

- Le fournisseur ne voit jamais le nom du client final, et le client ne voit jamais l'identité des fournisseurs consultés, dans aucun écran, document, photo ou message ; tous les échanges passent par Gulf Bridge Sourcing.
- En négoce, l'anonymat est total : Gulf Bridge Sourcing achète et revend en son nom et figure comme acheteur et vendeur sur tous les documents.
- En achat accompagné, l'anonymat dure jusqu'à la signature du mandat. Ensuite, le client achetant en son nom et payant lui-même l'usine, les deux parties figurent forcément sur trois documents : le contrat tripartite, la facture du fabricant et le paiement. Tous les autres échanges restent anonymes et passent par Gulf Bridge Sourcing ; la clause de non-contournement et le registre des fournisseurs présentés protègent la relation.
- Les fournisseurs non retenus restent anonymes définitivement.

**Analytique des coûts et marge réelle**

L'application calcule, pour chaque mission, dossier, client et accord-cadre, les honoraires, les coûts engagés et la marge réelle en FCFA et en %, afin de distinguer les missions qui rapportent de celles qui font perdre de l'argent.

- Deux niveaux de marge : la marge directe (honoraires moins coûts propres à la mission) et la marge complète (marge directe moins une quote-part des frais fixes, salaires, loyer et logiciels, répartie selon le temps passé).
- Coûts rattachés obligatoirement à un dossier ou à une mission : rémunération des inspecteurs reprise du module de terrain (jours × tarif) ; déplacements, hébergement et repas par note de frais avec photo du justificatif ; échantillons, coursiers, essais en laboratoire, traduction, sous-traitants ; commission des agents pays ; frais du transitaire à la charge de GBS ; frais bancaires repris du relevé ; pertes et gains de change ; coûts d'installation (techniciens, pièces, location de matériel) ; coûts après livraison (retours, réinspections, pénalités), rattachés au dossier même après sa clôture.
- Une dépense sans code dossier n'est pas remboursée tant qu'elle n'est pas affectée à un dossier ou classée en frais généraux.
- Temps interne : saisie en un geste du temps passé par dossier (fondatrice, assistante achats, responsable des opérations), valorisé à un coût horaire par personne paramétré par l'administratrice ; il alimente la marge complète.
- Revenus rattachés : forfaits, commissions, jours de contrôle qualité, logistique, marge de négoce, installation, mensualités d'accord-cadre réparties sur les commandes de la période, avoirs déduits ; deux vues, facturé et encaissé, un impayé réduisant la marge encaissée.
- Règles de calcul : montants hors taxes, la TVA récupérable n'étant pas un coût ; conversion en FCFA au cours du jour de la dépense ; un coût partagé entre plusieurs dossiers est réparti selon le temps passé, avec une règle tracée au journal ; vue par société, où les flux entre GBS Chine et GBS Côte d'Ivoire comptent, et vue groupe consolidée, où ils s'annulent.
- Clôture analytique : la marge reste provisoire jusqu'à la clôture, par défaut 30 jours après la livraison ou le dernier constat ; un coût saisi après la clôture rouvre la marge, avec trace au journal.
- Avant, pendant et après la mission : au devis, estimation des coûts à partir de coûts standards (jour d'inspecteur, déplacement par ville) et affichage de la marge prévue ; si la marge directe prévue est sous le seuil, 35 % par défaut et modifiable par l'administratrice, une alerte s'affiche et l'envoi exige une confirmation tracée au journal ; pendant la mission, alerte dès que les coûts dépassent le budget de 10 % ; à la clôture, comparaison du budget et du réel poste par poste.
- Missions à perte : liste des missions à marge négative avec leur cause principale (jours dépassés, contre-inspection non facturée, déplacement imprévu, remise accordée, impayé).
- Tableaux de bord : classement des missions les plus et les moins rentables ; rentabilité par client, service, segment, pays, agent, inspecteur et usine ; rentabilité de chaque accord-cadre ; prix plancher recommandé par service, calculé à partir des coûts réels.
- Accès : réservé à l'administratrice et aux utilisateurs habilités à la finance ; les agents pays ne voient que leur commission ; clients et fournisseurs n'y ont jamais accès.

**Fournisseurs et clients**

- **Agrément obligatoire** : une demande de cotation ne part qu'à des fournisseurs agréés, et une commande ne peut être passée qu'auprès d'un fournisseur agréé ou dont la due diligence est validée et en cours de validité. Validité par défaut : 12 mois, paramétrable.
- **Due diligence vendue au client** : forfait paramétrable, facturé d'avance comme la consultation : 500 000 FCFA en standard, 850 000 FCFA en renforcée (tableau de tarification ci-dessus, modèle financier et plaquette) ; c'est l'offre d'entrée de tous les secteurs, et 50% de son prix sont déduits de la commission si un contrat d'achat est signé dans les 90 jours (calcul de la commission, étape 7).
- **Vérification du client** : obligatoire avant d'ouvrir une affaire en négoce ou avec lettre de crédit, recommandée dans tous les autres cas.

**Incoterms**

- Chaque offre fournisseur, contrat fournisseur et vente en négoce porte un Incoterm, son lieu nommé et sa version (Incoterms 2020 à ce jour).
- Les offres sont comparées, et la commission calculée, sur une base FOB : une offre EXW est majorée des frais jusqu'à bord (barème paramétré) ; une offre CFR ou CIF est diminuée du fret et de l'assurance indiqués dans l'offre.
- Incoterms par défaut : FOB port chinois ou FCA entrepôt de consolidation en achat accompagné ; CFR ou CIF port d'arrivée en négoce. EXW et DDP sont bloqués, sauf dérogation motivée de l'administratrice. Ces choix sont à confirmer par le transitaire et le juriste.
- Le point de transfert des risques est affiché sur chaque commande ; l'inspection doit être validée avant ce point.

**Hub Afrique et agents pays**

- Côte d'Ivoire : GBS Côte d'Ivoire contracte, facture par la FNE et reçoit sa part selon le tableau de la section 1 bis ; un responsable des opérations à Abidjan (500 000 FCFA par mois) signe, facture et réceptionne.
- Gabon et Cameroun : un agent pays perçoit 15% des honoraires (ou de la marge en négoce) de ses clients, calculés à l'encaissement, tant qu'aucune société n'est créée dans le pays. La base exacte est fixée dans son contrat d'agent commercial.
- Les parts sont des paramètres datés ; un dossier garde la règle en vigueur à son ouverture.

**Messagerie**

- Un prix, une spécification ou un délai n'engage que s'il est confirmé dans l'application, même s'il a d'abord été échangé sur WeChat ou par e-mail.
- Aucun fil ne réunit client et fournisseur ; l'équipe reformule dans chaque fil l'information à transmettre.

**Proposition de valeur**

- Un fournisseur n'est agréé qu'après avoir signé l'engagement de ne verser aucune commission à Gulf Bridge Sourcing ni à ses collaborateurs.
- Une offre sans données de coût global ne peut pas être recommandée au client, sauf dérogation motivée de l'administratrice.
- Les données de coût global déclarées par le fournisseur retenu sont reprises dans son contrat.
- La facture du fabricant et les honoraires de Gulf Bridge Sourcing sont toujours présentés séparément au client.

**Protection contre le contournement**

- **Registre des fournisseurs présentés** : l'application enregistre automatiquement, pour chaque client, chaque fournisseur qui lui a été présenté, avec la date et le dossier concerné. Ce registre est la preuve de la clause de non-contournement ; il n'est ni modifiable ni supprimable.
- **Clause de non-contournement** : le mandat d'achat prévoit que la commission reste due si le client commande, dans les 24 mois suivant sa présentation, à un fournisseur présenté par Gulf Bridge Sourcing sans passer par elle. Durée paramétrable ; validité à confirmer par un juriste OHADA.
- **Tarif de réassort** : quand une demande porte sur un produit déjà acheté par le client chez le même fournisseur, l'application le signale et propose automatiquement le tarif de réassort.
- **Suivi des clients inactifs** : un client sans commande depuis une durée paramétrable, alors qu'il a déjà acheté auprès d'un fournisseur présenté, déclenche une tâche de relance commerciale et la proposition de l'inspection seule.
- **Aucune commission de fournisseur** : Gulf Bridge Sourcing ne demande jamais aux fournisseurs de lui reverser une commission sur les commandes directes de ses clients, conformément à son engagement de non-commission.

## 5 bis. Flux financiers : deux modes distincts

Chaque affaire qui comporte un achat de marchandises relève d'un seul des deux modes ci-dessous, choisi à l'ouverture du dossier et non modifiable ensuite ; aucun mode intermédiaire n'est autorisé. Les dossiers de service sans achat (due diligence seule, consultation seule, inspection seule, visite d'usines, logistique seule, installation seule) relèvent d'un troisième cas, « service seul » : Gulf Bridge Sourcing ne facture que sa prestation, et seules s'appliquent les règles des éléments présents dans le dossier.

|  | Mode 1 : achat accompagné | Mode 2 : négoce (projet clé en main) |
| --- | --- | --- |
| Qui achète au fournisseur | Le client, en son nom | Gulf Bridge Sourcing, en son nom |
| Contrat fournisseur | Tripartite : client, fournisseur, et Gulf Bridge Sourcing en qualité d'intermédiaire | Fournisseur et Gulf Bridge Sourcing |
| Qui paie le fournisseur | Le client, par virement depuis sa banque ou par lettre de crédit | Gulf Bridge Sourcing, avec ses propres fonds |
| Ce que facture Gulf Bridge Sourcing | Uniquement ses honoraires : forfait, commission, inspection, frais de gestion logistique | Le prix de vente du projet, rendu port |
| Verrou 1 (contrat signé) | Bloque l'émission de l'instruction d'acompte au client et le passage en production | Bloque l'acompte fournisseur et le passage en production |
| Verrou 2 (inspection validée) | Bloque l'émission du bon à payer le solde et du certificat d'inspection ; le client confirme ensuite son paiement avec un justificatif | Bloque réellement le paiement du solde fournisseur |
| Nature du verrou 2 | Contractuelle : le contrat fournisseur rend le solde exigible sur présentation du certificat d'inspection | Technique : l'application refuse le paiement |

**Règle absolue du mode 1** : Gulf Bridge Sourcing n'encaisse jamais, même temporairement, les fonds destinés au fournisseur. Dans la zone UEMOA, les virements et transferts de fonds sont réservés aux prestataires agréés par la BCEAO depuis l'instruction n°001-01-2024, et la BCEAO a ordonné l'arrêt des acteurs non agréés dès mai 2025 ([Droit Médias Finance](https://droitmediasfinance.com/index.php/1014-bceao-la-date-exigee-pour-la-mise-en-conformite-des-acteurs-de-services-de-paiement-dans-lumoa-encore-reportee-a-fin-aout-2025) ; [BCEAO](https://www.bceao.int/index.php/fr/communique-presse/liste-des-etablissements-de-paiement-agrees-dans-lumoa-au-28-fevrier-2026)).

**Statut d'intermédiaire** : le droit OHADA, applicable en Côte d'Ivoire, au Gabon et au Cameroun, distingue le commissionnaire (qui contracte en son propre nom), le courtier et l'agent commercial, aux articles 169 à 233 de l'Acte uniforme portant sur le droit commercial général ([GTAI](https://www.gtai.de/de/trade/kamerun/recht/kamerun-vertriebsrecht-2003838)). En mode 1, Gulf Bridge Sourcing ne signe jamais le contrat fournisseur en son nom propre, pour ne pas devenir commissionnaire et partie au contrat.

**Lettre de crédit (mode 1, grosses commandes)**

- L'application enregistre les références de la lettre de crédit et la liste des documents exigés.
- Le crédit doit désigner Gulf Bridge Sourcing comme émettrice du certificat d'inspection et imposer une formulation explicite de conformité : un certificat n'est recevable que s'il vient de l'entité désignée dans le crédit ([ICC Allemagne](https://www.iccgermany.de/wp-content/uploads/2023/12/20231128_TA_Briefing_No_8_Certificates.pdf)), et sans précision, la banque accepte tout document qui semble remplir sa fonction ([ICC](https://library.iccwbo.org/content/tfb/dcinsight/DCI_Vol17n4_QueriesAndResponses.htm)).
- L'application génère le certificat avec exactement la formulation exigée et contrôle qu'aucune donnée (quantités, références, dates) ne contredit la facture ou les documents de transport.

**Dossier de domiciliation et d'apurement du client**

- En zone UEMOA, le règlement 06/2024 impose désormais la domiciliation des importations de services, avec un seuil relevé à 20 millions de FCFA pour les biens et services ([Financial Afrik](https://www.financialafrik.com/2026/03/24/reglement-06-2024-uemoa-ce-qui-change-vraiment-pour-les-banques-et-les-entreprises/)). En zone CEMAC, l'instruction n°001/GR/2022 de la BEAC encadre la déclaration, la domiciliation, le règlement et l'apurement des importations de biens et services ([BEAC](https://www.beac.int/wp-content/uploads/2022/05/Instruction-N%C2%B0001-GR-2022.pdf)).
- Les commissions de Gulf Bridge Sourcing sont des importations de services pour le client : elles entrent dans ces obligations.
- L'application enregistre la référence de domiciliation du client pour chaque affaire et produit, dès qu'ils existent, les documents dont sa banque a besoin : contrat, facture du fournisseur, facture de commission, certificat d'inspection, documents de transport.

**Points à faire valider par un juriste avant les contrats types**

- Règles CEMAC sur les services de paiement et seuil de domiciliation en zone CEMAC (non vérifiés).
- Applicabilité du droit OHADA à GBS Chine, société établie en Chine (GBS Côte d'Ivoire y étant soumise), et loi applicable à choisir dans les contrats.
- Opposabilité en droit chinois de la clause « solde exigible sur certificat d'inspection », et mode de règlement des litiges.
- Traitement fiscal des commissions et des retenues à la source dans chaque pays.

## 5 ter. Flux entre GBS Chine et GBS Côte d'Ivoire

L'application calcule chaque mois, dossier par dossier, ce que chaque société doit à l'autre, génère les factures intragroupe et conserve les justificatifs exigés par les prix de transfert. Aucun flux n'est saisi à la main.

| Flux | Sens | Base de calcul | Traitement fiscal par défaut (à confirmer) |
| --- | --- | --- | --- |
| Part de GBS Chine sur les forfaits et commissions encaissés par GBS Côte d'Ivoire | GBS Côte d'Ivoire vers GBS Chine | 60% des forfaits de consultation, des forfaits au projet et des forfaits d'accords-cadres, 70% des commissions, sur les montants encaissés par GBS Côte d'Ivoire à partir du mois 4 | Retenue de 20% en Côte d'Ivoire sur les services payés à un non-résident ; convention fiscale avec la Chine non vérifiée |
| Part de GBS Côte d'Ivoire sur les ventes de GBS Chine aux clients ivoiriens | GBS Chine vers GBS Côte d'Ivoire | 5% de frais de gestion sur les services réalisés en Chine et facturés par GBS Chine aux clients ivoiriens ; 30% de la marge du négoce des clients ivoiriens | Services rendus entièrement en Afrique : en principe hors impôt chinois ; TVA chinoise à vérifier ; déclaration préalable au-delà de 50 000 USD |

**Règles**

- Le relevé mensuel liste, par dossier, l'encaissement d'origine, la règle de partage appliquée et sa date d'effet ; il est validé par l'administratrice avant émission des factures intragroupe.
- Chaque facture intragroupe porte la référence des dossiers qu'elle couvre ; la retenue à la source est calculée et son attestation rattachée.
- Le dossier prix de transfert regroupe la convention signée entre les deux sociétés, l'analyse des fonctions de chacune, les relevés et les factures de l'exercice, pour le dépôt avec les états financiers ivoiriens.
- Le pilotage consolidé (M38) élimine ces flux : le chiffre d'affaires du dispositif est celui facturé aux clients, pas la somme des factures des deux sociétés.

## 6. Modèle de données

Le dossier (section 4 bis) englobe l'ensemble ; à l'intérieur, la commande est l'entité centrale : les paiements fournisseurs, les inspections, les expéditions et les factures s'y rattachent, ce qui permet d'appliquer les verrous à un seul endroit.

&#91;embedded content: modèle de données, 9 domaines autour du dossier\]

Chaque entité porte une devise, des dates de création et de modification, et l'utilisateur qui l'a créée ; chaque montant est conservé dans sa devise d'origine avec le taux de change du jour.

Entités non dessinées sur le schéma : consultation fournisseurs et grille d'analyse (mise en concurrence), connaissement, étape de suivi d'expédition, appel d'offres client, garantie bancaire, approbation technique, non-conformité, réception sur site, prévision de trésorerie, déclaration éthique ; et, pour l'organisation à deux sociétés : société, service du catalogue, segment, règle de partage datée, relevé et facture intragroupe, agent pays, intervention sur site, article de stock.

**Dictionnaire des entités**

Le schéma ci-dessus regroupe les entités par domaine ; le dictionnaire ci-dessous fait foi. Il fixe pour chaque entité ses attributs clés et ses liens ; le détail des champs, types et contraintes est tenu dans la documentation technique (section 10 bis).

| Domaine | Entité | Attributs clés | Liée à |
| --- | --- | --- | --- |
| Organisation | Société | Raison sociale, pays, devise de tenue, numérotation des factures, identifiants fiscaux | Toutes les entités métier |
| Organisation | Utilisateur | Nom, e-mail, téléphone, langue, fuseau horaire, rôle, sous-rôle, statut | Société, client ou fournisseur |
| Organisation | Agent pays | Pays, taux, contrat, dates de validité | Clients, commissions |
| Tiers | Client | Raison sociale, pays, identifiants, bénéficiaires effectifs, résultat de vérification et date, conditions de paiement | Contacts, dossiers, registre des fournisseurs présentés |
| Tiers | Fournisseur | Raison sociale chinoise et anglaise, numéro de crédit social unifié, statut d'agrément, note, bénéficiaires effectifs | Contacts, comptes de paiement, due diligences, offres, commandes |
| Tiers | Compte de paiement | Type (banque, WeChat Pay, Alipay), titulaire, devise, statut vérifié, auteur et validateur de la vérification | Fournisseur ou société |
| Tiers | Contact | Nom, fonction, e-mail, téléphone, identifiant WeChat, langue | Client ou fournisseur |
| Référentiels | Article | Référence, catégorie, unité, code SH, poids, volume, marchandise dangereuse et classe, certificats exigés | Lignes d'offre, de commande, de colisage |
| Référentiels | Paramètre daté | Nature (barème, partage, taux, délai), valeur, date d'effet, auteur | Calculs des devis, partages, retenues |
| Dossier | Dossier | Référence, société contractante, client, mode financier, chef de dossier, date d'ouverture du site, statut | Toutes les entités du dossier |
| Dossier | Phase, tâche, pièce exigée | Type, statut, dates prévue et réelle, responsable | Dossier |
| Dossier | Point bloquant, avenant | Catégorie, impact, échéance, décision, signature | Dossier, commande |
| Achat | Besoin (cahier des charges client) | Catégorie, réponses, version, statut de validation | Dossier, consultation fournisseurs |
| Achat | Consultation fournisseurs, offre, ligne d'offre | Date limite avec fuseau, Incoterm et lieu, devise, prix, délai, données de coût global, version | Fournisseur, article, grille d'analyse |
| Achat | Devis client, mandat | Version, montants, Incoterm, statut de signature | Dossier, offre retenue |
| Achat | Commande fournisseur, ligne de commande | Prix, quantités, Incoterm, échéancier, jalons, pénalités, statut | Dossier, fournisseur, article |
| Qualité | Approbation technique, échantillon | Pièces, version, décision, signataire, envoi et coût de l'échantillon | Commande |
| Qualité | Inspection, constat | Type, plan d'échantillonnage ISO 2859-1, niveaux de qualité acceptables, mesures, photos, décision | Commande, inspecteur |
| Qualité | Non-conformité, réclamation | Gravité, correction, délai, clôture, garantie | Commande, inspection, client |
| Logistique | Expédition, étape, connaissement | Mode, conteneurs, plombs, ports, dates, bordereau de suivi des cargaisons, marchandises dangereuses | Commandes, documents |
| Logistique | Liste de colisage, réception, stock | Colis, poids, volumes, écarts, emplacements | Expédition, article |
| Finance | Facture, ligne de facture | Société émettrice, numéro, devise ISO, taxes, retenue, numéro FNE ou fapiao, statut | Dossier, client ou société sœur |
| Finance | Paiement, encaissement | Devise ISO, montant, taux du jour, compte, référence, préparateur, validateur, justificatif | Facture, commande, compte de paiement |
| Finance | Règle de partage, relevé et facture intragroupe | Taux, date d'effet, base, montants par dossier | Sociétés, encaissements |
| Finance | Garantie bancaire, lettre de crédit | Banque, montant, échéance, documents exigés | Dossier |
| Interventions | Intervention sur site | Type, techniciens, habilitations, analyse de risques, permis, temps, coût réel | Dossier, stock |
| Communication | Fil, message, traduction | Langue d'origine, texte d'origine, traductions, auteur, lu par | Dossier, utilisateurs |
| Transverse | Document | Type, version, langue, auteur, date, publié ou non, empreinte numérique | Toute entité |
| Transverse | Journal d'audit | Horodatage, utilisateur, action, avant et après | Toute entité |
| Dossier | Dossier-cadre (accord-cadre) | Dates, renouvellement, forfait mensuel, remise, engagement annuel, articles et prix de réassort | Client, dossiers de commande, factures récurrentes |
| Qualité | Lot à inspecter (commande externe) | Fournisseur apporté par le client, produit, quantités, référentiel d'inspection | Dossier d'inspection seule, inspection |
| Tiers | Inspecteur partenaire | Qualifications, catégories maîtrisées, tarif journalier, déclaration de conflit d'intérêts, note de qualité des rapports | Inspections, factures de l'inspecteur, paiements |
| Tiers | Transitaire | Pays, ports couverts, agréments, tarifs, note de service | Expéditions, offres de fret |
| Finance | Coût engagé | Nature, montant, devise ISO, taux du jour, montant en FCFA hors taxes, justificatif, auteur, date, statut d'affectation | Dossier ou mission, note de frais, paiement |
| Finance | Taux de coût interne, temps passé | Personne, coût horaire, date d'effet ; durée saisie par dossier et par date | Utilisateur, dossier |
| Finance | Règle de répartition | Coût partagé, dossiers concernés, clé de répartition, parts, auteur | Coût engagé, dossiers |
| Finance | Budget de dossier | Coûts estimés par poste, coûts standards utilisés, marge prévue, seuil appliqué, confirmation en cas d'alerte, version | Devis client, dossier |
| Finance | Clôture analytique | Date, statut provisoire ou définitif, marge directe, marge complète, marge facturée et encaissée, cause principale en cas de perte, réouvertures | Dossier, mission |

**Règles communes à toutes les entités**

- Identifiant technique unique et non signifiant, plus une référence lisible pour les entités affichées (exemple : GBS-2026-014).
- Rattachement à une société sur chaque ligne métier, qui porte le cloisonnement des données.
- Horodatage enregistré en temps universel coordonné (UTC) et affiché dans le fuseau de l'utilisateur ; date d'échéance toujours accompagnée de son fuseau.
- Montant toujours accompagné de son code de devise ISO 4217.
- Champs d'audit : créé par, créé le, modifié par, modifié le.
- Aucune suppression physique des données métier : archivage logique, avec la durée de conservation de la section 10 bis.
- Pays au format ISO 3166, langues au format ISO 639, dates au format ISO 8601 dans les échanges entre systèmes.

## 7. Application trilingue : français, anglais, mandarin

Chaque écran, document généré et notification existe dans les trois langues ; chaque utilisateur choisit sa langue, et chaque document part dans la langue de son destinataire.

Déploiement progressif : au lot 0, interface en français et en anglais, documents fournisseurs en anglais et en mandarin ; interface complète en mandarin au lot 1 (section 12).

**Exigences**

- **Interface** : tous les libellés sont externalisés dans des fichiers de traduction (aucun texte écrit en dur dans le code). La langue est choisie dans le profil de l'utilisateur et modifiable à tout moment.
- **Mandarin** : caractères simplifiés, avec des polices qui les affichent correctement à l'écran et dans les PDF générés.
- **Documents générés** : chaque modèle (devis, mandat, contrat fournisseur, rapport d'inspection, facture) existe en français, anglais et mandarin. Le contrat fournisseur peut être édité en version bilingue mandarin et anglais sur le même document.
- **Données saisies** : les champs libres (spécifications, remarques d'inspection) sont conservés dans la langue de saisie. Une traduction automatique peut être proposée à côté du texte d'origine, clairement signalée comme telle, sans jamais remplacer l'original.
- **Spécifications techniques** : le référentiel des catégories de produits et des critères d'inspection est traduit et validé une fois pour toutes, pour que l'usine, l'inspecteur et le client lisent la même exigence.
- **Formats** : dates, nombres et devises s'affichent selon la langue (par exemple 1 000 000 XOF en français, XOF 1,000,000 en anglais, 1,000,000 XOF en mandarin ; le code de devise ISO figure toujours avec le montant).

**Langue par défaut des destinataires**

| Destinataire | Langue par défaut |
| --- | --- |
| Clients de Côte d'Ivoire, du Gabon, du Cameroun | Français (anglais possible, notamment au Cameroun) |
| Fournisseurs et inspecteurs en Chine | Mandarin |
| Groupes pétroliers et miniers | Anglais |

## 8. WeChat, WeChat Pay et Alipay

WeChat est le canal de travail avec les fournisseurs, et WeChat Pay et Alipay servent aux seuls paiements propres de Gulf Bridge Sourcing en CNY : négoce, échantillons, frais engagés sur place. L'intégration se fait en deux temps : saisie tracée dès le lot 0, connexion automatique une fois la WFOE et ses comptes ouverts.

**Pourquoi la WFOE conditionne l'intégration**

Une société étrangère sans entité en Chine n'accède à WeChat Pay qu'en mode transfrontalier, avec des frais plus élevés et des fonctions limitées ; une WFOE permet l'intégration domestique complète, les transactions locales en CNY et l'émission de fapiao ([FDI China](https://fdichina.com/glossary/wechat-pay/)). Les conditions exactes pour Alipay et pour les paiements entre entreprises sont à confirmer avec la banque et le cabinet de la WFOE.

| Usage | Lots 0 à 2 : sans connexion directe | Lot 3 : avec connexion directe |
| --- | --- | --- |
| Messagerie WeChat avec fournisseurs et inspecteurs | Identifiant WeChat dans chaque fiche contact ; ajout des échanges importants (captures, fichiers) au dossier de la commande | Envoi automatique des notifications (jalons de production, inspection programmée, paiement effectué) aux contacts fournisseurs via un compte WeChat professionnel ; voie technique à choisir entre compte de service et messagerie d'entreprise |
| Paiement d'un fournisseur par WeChat Pay ou Alipay (négoce et paiements propres uniquement) | Paiement fait dans l'application de paiement, puis enregistré dans l'outil : montant en CNY, référence de transaction, justificatif, compte destinataire vérifié | Ordre de paiement préparé dans l'outil, validation par l'administratrice, puis statut retourné automatiquement par l'interface de paiement |
| Rapprochement | Import des relevés exportables (format à vérifier) et pointage avec les paiements enregistrés | Rapprochement automatique par référence de transaction |
| Encaissement en CNY (cas ponctuels, par exemple un client ou un partenaire en Chine) | Code de paiement statique de la WFOE, encaissement enregistré à la main | Demande de paiement générée par l'outil, encaissement confirmé automatiquement |

**Règles de sécurité propres à ces paiements**

- Un compte WeChat Pay ou Alipay de fournisseur n'est utilisable qu'après vérification : il doit correspondre à l'entreprise figurant sur la licence commerciale, et non à un particulier.
- Un plafond paramétrable s'applique par paiement : au-delà, le virement bancaire est obligatoire.
- Les mêmes verrous que pour les virements s'appliquent : pas d'acompte sans contrat signé, pas de solde sans inspection validée.
- Les clients africains paient par virement en FCFA ou en USD, y compris pour régler leurs fournisseurs en achat accompagné : WeChat Pay et Alipay ne sont pas prévus pour eux.

## 9. Signature électronique

La signature électronique déclenche les verrous de l'application : un mandat ou un contrat n'est considéré comme signé qu'une fois la signature confirmée par le prestataire de signature.

**Documents à signer**

| Document | Signataires | Langue | Effet dans l'application |
| --- | --- | --- | --- |
| Devis et mandat d'achat | Client, puis Gulf Bridge Sourcing | Français ou anglais | Ouvre la commande ; la commission n'est pas encore facturée. Contient la clause de non-contournement de 24 mois |
| Proposition de projet d'équipement d'un site | Client, puis Gulf Bridge Sourcing | Français ou anglais | Ouvre le dossier d'équipement d'un site ; déclenche la facture du premier versement du forfait au projet |
| Contrat de mission ponctuelle | Client, puis Gulf Bridge Sourcing | Français ou anglais | Ouvre une vérification de fournisseur, une inspection seule ou une visite d'usines ; déclenche la facture payée d'avance |
| Engagement du fournisseur | Fournisseur | Mandarin et anglais | Condition de l'agrément (M16) : un fournisseur qui ne l'a pas signé ne peut pas être consulté |
| Contrat d'agent commercial | Agent pays, puis Gulf Bridge Sourcing | Français | Ouvre l'accès de l'agent à l'application et le calcul de ses commissions (M21) |
| Contrat fournisseur | Mode 1 : client et fournisseur, avec Gulf Bridge Sourcing comme intermédiaire (contrat tripartite). Mode 2 : fournisseur et Gulf Bridge Sourcing | Mandarin et anglais | Lève le verrou 1 : acompte fournisseur et production autorisés ; déclenche la facturation de la première moitié de la commission |
| Proposition de projet clé en main | Client, puis Gulf Bridge Sourcing | Français ou anglais | Ouvre le projet de négoce |
| Accord-cadre annuel | Client, puis Gulf Bridge Sourcing | Français ou anglais | Active la remise contractuelle |
| Validation d'un rapport d'inspection | Client (optionnel) | Français, anglais ou mandarin | Trace l'accord du client avant le paiement du solde |

**Exigences fonctionnelles**

- Envoi depuis la fiche du document, avec ordre des signataires paramétrable.
- Signature sur ordinateur et sur mobile, avec vérification d'identité par code à usage unique (e-mail ou SMS).
- Relances automatiques et date limite de signature.
- Retour automatique du statut dans l'application (envoyé, consulté, signé, refusé), puis archivage du document signé et de son dossier de preuve (horodatage, adresses, historique).
- Aucun document signé ne peut être modifié : toute correction crée une nouvelle version à signer.

**Le cas des fournisseurs chinois**

En Chine, beaucoup d'entreprises valident leurs contrats avec leur cachet officiel. L'application doit donc accepter deux modes pour le contrat fournisseur :

1. la signature électronique via un prestataire utilisable en Chine ;
2. le contrat imprimé, revêtu du cachet de l'entreprise, puis numérisé et contrôlé par l'assistant(e) achats (nom de l'entreprise sur le cachet identique à la licence commerciale). Dans ce cas, la levée du verrou exige la validation de l'administratrice.

**Choix du prestataire (point ouvert)**

Un prestataire unique pour l'Afrique et la Chine n'est pas garanti. Les candidats à comparer sont les prestataires internationaux pour les clients africains et des prestataires chinois pour les fournisseurs. Les critères de choix sont : disponibilité depuis la Chine, valeur juridique dans les quatre pays concernés (à confirmer par un juriste), interface de programmation avec retour de statut, prise en charge du mandarin, coût par enveloppe. La conformité de ces prestataires n'a pas encore été vérifiée pays par pays.

## 10. Exigences non fonctionnelles

L'exigence la plus structurante est de fonctionner correctement à la fois depuis Guangzhou et depuis Abidjan, Libreville et Douala.

**Fonctionnement depuis la Chine**

- **Aucune dépendance à des services bloqués ou instables en Chine continentale** : pas de polices, cartes, connexion, anti-robot ou analyse d'audience hébergés chez Google, et pas de ressources chargées depuis des réseaux de diffusion inaccessibles. Les polices et les bibliothèques sont servies par l'application elle-même.
- **Hébergement** : l'hébergement en Chine continentale exige une licence ICP. À défaut, une région proche (Hong Kong ou Singapour) sera testée. Le choix se fera après des tests de vitesse réels depuis Guangzhou et depuis Abidjan, avant tout développement important.
- **Communication** : l'e-mail n'est pas le seul canal. Les notifications critiques sont aussi envoyées par WeChat aux contacts chinois (lot 3).

**Mobilité et inspections**

- Application mobile installable depuis le navigateur, utilisable sur Android et iPhone.
- **Mode hors ligne pour l'inspecteur** : liste de contrôle, photos et mesures saisies sans réseau en usine, puis synchronisées au retour du réseau, sans perte ni doublon.
- Photos compressées automatiquement, avec date, heure et position quand l'appareil l'autorise.

**Sécurité**

- Authentification forte (double facteur) obligatoire pour tous les comptes internes (administratrice, assistant(e) achats, Hub Afrique, agents pays, comptable) et pour les inspecteurs partenaires ; les règles des comptes clients et fournisseurs sont fixées dans le cahier des charges des portails.
- Droits appliqués dans la base de données, ligne par ligne, selon le rôle et le client.
- Chiffrement des échanges et des fichiers stockés ; coordonnées bancaires et de paiement visibles par l'administratrice et par l'assistant(e) achats, qui prépare les paiements et les vérifications, et masquées pour les autres rôles ; toute modification passe par le contrôle à quatre yeux ; en achat accompagné, elles ne sont communiquées au client que sur l'instruction de paiement validée.
- Journal d'audit en ajout seul, à altération détectable, des validations, paiements, dérogations et changements de paramètres.

**Référentiels de sécurité**

- Niveau visé : standard de vérification de la sécurité applicative OWASP ASVS niveau 2, et mesures de sécurité alignées sur l'ISO 27001 (gestion des accès, des sauvegardes, des fournisseurs, des incidents), sans viser la certification au démarrage.
- Test d'intrusion par un prestataire indépendant avant l'ouverture de tout portail à des utilisateurs externes, puis une fois par an et après chaque changement majeur.
- Revue des droits d'accès chaque trimestre ; désactivation d'un compte interne le jour du départ de la personne.
- Secrets (clés d'interface, mots de passe de service) conservés hors du code, dans un coffre dédié, renouvelés au moins une fois par an.
- Plan de réponse aux incidents : détection, confinement, analyse, information de l'administratrice sous 4 heures, notification des violations de données personnelles aux autorités et aux personnes concernées dans les délais légaux de chaque pays (à confirmer par le juriste).
- Mises à jour de sécurité des bibliothèques et du socle appliquées sous 30 jours, sous 7 jours pour une faille critique.

**Données personnelles**

- Les contacts clients, fournisseurs et inspecteurs sont des données personnelles. Les règles applicables en Côte d'Ivoire, au Gabon, au Cameroun et en Chine (loi sur la protection des informations personnelles) sont à vérifier avec un juriste, notamment pour le transfert de données entre l'Afrique et la Chine.

**Disponibilité et continuité**

| Exigence | Cible |
| --- | --- |
| Disponibilité | 99,5% du temps hors maintenance planifiée |
| Sauvegarde | Quotidienne, conservée 30 jours, restauration testée chaque trimestre |
| Perte de données maximale acceptée | 24 heures |
| Temps de remise en service | 1 jour ouvré |
| Temps d'affichage d'un écran courant | Moins de 3 secondes depuis Guangzhou et depuis Abidjan |
| Export complet des données | Disponible à tout moment pour l'administratrice, dans un format ouvert |

Ces cibles sont des propositions, à ajuster selon le budget d'hébergement.

## 10 bis. Ingénierie, qualité logicielle et exploitation

L'application est construite et exploitée selon des pratiques professionnelles dès le lot 0 : sans elles, les verrous et les calculs d'argent ne peuvent pas être garantis dans la durée.

**Environnements et mises en production**

- Trois environnements séparés : développement, recette avec des données fictives, production. Aucune donnée réelle de client ou de fournisseur hors de la production.
- Code et schéma de base de données versionnés dans un dépôt ; toute modification du schéma passe par une migration enregistrée et réversible.
- Mise en production seulement après passage de tous les tests automatisés et validation en recette ; chaque mise en production est datée, décrite dans une note de version et peut être annulée.
- Relecture de chaque modification touchant l'argent, les droits d'accès ou les verrous par une seconde personne compétente, interne ou prestataire.

**Tests automatisés**

- Règles d'argent couvertes à 100 % par des tests : barème de commission, majorations, minimum, réassort, ramenée à la base FOB, partage entre sociétés, retenues, conversions de devises.
- Verrous et droits d'accès testés par rôle et par sous-rôle, directement sur la base de données.
- Parcours complets testés de bout en bout pour chaque mode financier, à chaque mise en production.
- Les tests de recette de la section 13 sont automatisés dès qu'ils peuvent l'être.

**Supervision**

- Surveillance de la disponibilité depuis Guangzhou et depuis Abidjan, avec alerte.
- Collecte des erreurs de l'interface et du serveur, avec alerte sur toute erreur dans un calcul d'argent, une signature ou un paiement.
- Journaux techniques conservés 12 mois ; journal d'audit métier conservé aussi longtemps que les dossiers.

**Documentation**

- Dictionnaire des données à jour (section 6), description des interfaces de programmation, procédures de sauvegarde, de restauration et de mise en production, guide d'utilisation par rôle.
- La documentation doit permettre à un développeur extérieur de reprendre l'application sans la fondatrice.

**Volumétrie de référence pour le dimensionnement**

| Hypothèse | Année 1 | Année 3 |
| --- | --- | --- |
| Utilisateurs internes et partenaires | 5 | 15 |
| Utilisateurs externes actifs (clients et fournisseurs) | 50 | 300 |
| Dossiers ouverts par an | 40 | 150 |
| Photos par inspection | 200 | 500 |
| Stockage de fichiers cumulé | 50 Go | 500 Go |

Ces hypothèses servent à dimensionner l'hébergement et ses coûts ; elles sont à recaler sur les volumes du modèle financier avant le choix de l'hébergement.

**Fuseaux horaires**

Guangzhou (UTC+8), Abidjan (UTC+0), Libreville et Douala (UTC+1) travaillent sur des heures différentes. Toute date limite (cotation, signature, paiement, réponse) est enregistrée avec son heure et son fuseau, et affichée à chacun dans le sien ; les délais en jours ouvrés suivent le calendrier du pays de la personne qui doit agir.

**Accessibilité**

Niveau visé : règles internationales d'accessibilité des contenus web WCAG 2.2, niveau AA, pour tous les écrans clients et fournisseurs, et pour les écrans internes courants.

**Archivage à valeur probante**

- Contrats, mandats, factures, rapports d'inspection et journaux de signature archivés sous forme non modifiable, avec empreinte numérique et horodatage, selon les principes de la norme ISO 14641 sur l'archivage électronique.
- Durée de conservation par défaut : 10 ans pour les pièces comptables et contractuelles, à confirmer par le comptable pour chaque pays.

**Conditions d'utilisation**

Avant l'ouverture d'un accès à un tiers (client, fournisseur, inspecteur, transitaire), l'application affiche et fait accepter des conditions générales d'utilisation et une politique de confidentialité dans la langue de l'utilisateur ; l'acceptation est datée et conservée. Les textes sont à rédiger avec le juriste.

## 11. Architecture technique et intégrations

L'application repose sur une base Supabase, avec une interface web installée aussi sur mobile, et des fonctions serveur pour les calculs et les connexions externes.

**Socle**

| Brique | Choix | Rôle |
| --- | --- | --- |
| Base de données | PostgreSQL (Supabase) | Toutes les données métier, avec règles d'accès ligne par ligne |
| Authentification | Supabase Auth, double facteur | Comptes internes, inspecteurs et clients |
| Stockage de fichiers | Supabase Storage | Photos d'inspection, contrats, factures, rapports |
| Fonctions serveur | Fonctions Supabase | Calcul des devis, génération des PDF, réception des retours de signature et de paiement, envoi des notifications |
| Interface | Application web réactive, installable sur mobile, trilingue | Tous les rôles, avec le mode hors ligne pour les inspections |
| Documents PDF | Génération côté serveur, polices intégrant les caractères chinois | Devis, contrats, rapports, factures |

**Règle de conception** : les règles de gestion (barème, verrous, échéanciers) sont exécutées côté serveur et en base, jamais seulement dans l'interface, pour qu'aucun contournement ne soit possible.

**Intégrations externes**

| Intégration | Usage | Lot | Point à vérifier |
| --- | --- | --- | --- |
| Signature électronique | Mandats, contrats, accords-cadres | 1 | Prestataire(s) utilisable(s) en Chine et en Afrique |
| E-mail transactionnel | Devis, factures, relances, notifications | 1 | Délivrabilité vers les messageries chinoises |
| Taux de change | XOF, XAF, USD et CNY mis à jour chaque jour (XOF et XAF à parité fixe avec l'euro) | 1 | Source fiable et accessible depuis la Chine |
| Export comptable | Factures, paiements, encaissements vers le cabinet | 1 | Plan comptable SYSCOHADA révisé pour GBS Côte d'Ivoire, normes comptables chinoises pour GBS Chine ; format attendu par chaque cabinet |
| WeChat (messagerie) | Notifications aux fournisseurs et inspecteurs | 3 | Compte de service ou messagerie d'entreprise de la WFOE |
| WeChat Pay et Alipay | Ordres de paiement, statuts, rapprochement | 3 | Comptes d'entreprise de la WFOE et accès aux interfaces de programmation |
| WhatsApp | Notifications aux clients africains | 3 | Offre professionnelle et coûts |
| Assistance par IA | Traduction des spécifications, aide à la comparaison des offres, lecture des rapports | 3 | Modèle utilisable depuis la Chine, ou IA locale |

## 12. Découpage en lots

Quatre lots, calés sur le plan d'action en lancement léger : premières commandes au mois 4, création de la WFOE Gulf Bridge Sourcing au mois 4 (GBS Côte d'Ivoire, créée au mois 1, facture seule les mois 1 à 3), négoce à partir du mois 13. Le lot 0 ne contient que ce qui protège l'argent et la méthode dès la première commande ; le reste se fait provisoirement hors de l'outil, selon les mêmes règles.

| Lot | Échéance cible | Contenu | Hors outil pendant ce lot | Condition de passage au lot suivant |
| --- | --- | --- | --- | --- |
| Lot 0 | Mois 4 | Lot 0 réduit à ce qui protège l'argent et la méthode : deux sociétés aux données cloisonnées ; clients, fournisseurs et contacts ; agrément des fournisseurs par due diligence (grille et rapport PDF) ; dossier simplifié (modèles, phases, statuts, pièces exigées dont bordereau de suivi des cargaisons, points bloquants, journal) ; offres saisies après la date limite et comparatif simple ; devis calculé par le barème avec Incoterms, mandat signé hors outil ; commande avec les deux verrous ; inspection avec échantillonnage ISO 2859-1 et rapport PDF en français et en anglais ; facturation (FNE pour GBS Côte d'Ivoire) et suivi des paiements avec contrôle à quatre yeux ; quatre devises ISO ; partage de la valeur et relevé mensuel des flux entre sociétés ; suivi manuel des expéditions ; tableau de bord simple par société ; double authentification, trois environnements et tests automatisés des règles d'argent | Signature électronique (document signé déposé, puis validé par l'administratrice) ; échanges avec les fournisseurs par WeChat ; formulaires fournisseurs ; messagerie ; page de suivi client (rapports, documents et factures envoyés en PDF) ; rapport des 3 offres et cahier des charges du client sur modèles de documents | 3 commandes réelles menées dans l'outil sans contournement des verrous |
| Lot 1 | Mois 8 | Éléments reportés du lot 0 : page de suivi client en lecture seule, mise en concurrence complète avec rapport automatique des 3 offres et coût global, guide d'expression du besoin, pack documentaire, dossier qualité en PDF, pièces de rechange au devis, lettres de crédit ; interface en mandarin ; guide d'expression du besoin ouvert au client ; formulaires fournisseurs par lien ; signature électronique intégrée ; inspection mobile hors ligne ; messagerie interne, client et fournisseur avec traduction automatique ; vérification des clients ; approbation technique et essais ; non-conformités ; réception sur site ; commissions des agents pays ; formulaire du transitaire par lien ; interventions d'installation et de mise en service ; délais en jours ouvrés avec alertes, avenants, « mes tâches » ; planning à rebours depuis la date d'ouverture ; demandes du site web créées en prospects dans M1 ; dossier qualité au format du client final ; notes de frais et saisie des coûts par dossier, marge directe par mission et liste des missions à perte | Portails avec compte ; négoce | L'équipe de Guangzhou travaille entièrement dans l'outil ; signatures et inspections hors ligne utilisées en réel |
| Lot 2 | Mois 13, avant le négoce | Négoce ; entrepôt de consolidation ; conformité à l'import ; garanties bancaires ; appels d'offres clients ; trésorerie et risque de change ; clé en main avec équipes venues de Chine ; portails client et fournisseur complets ; garantie et service après-vente ; rapport périodique client ; diagramme de Gantt et productivité ; marge complète avec temps interne, budget au devis et alertes, tableaux de bord de rentabilité ; registres éthiques ; fiches de référence clients ; stock de pièces à Abidjan ; matrice segments x services et vue consolidée ; dossier prix de transfert | Connexions automatiques | Premier projet de négoce suivi dans l'outil ; premiers clients et fournisseurs actifs sur leurs portails |
| Lot 3 | Après le lot 2, une fois les comptes de paiement d'entreprise de la WFOE ouverts | Suivi automatique des conteneurs ; WeChat, WeChat Pay et Alipay connectés ; WhatsApp ; assistance par IA, dont l'aide à la rédaction du besoin ; enchère inversée en option | Aucun | WFOE et comptes de paiement d'entreprise opérationnels |

**Arbitrages retenus**

- **Langues** : au lot 0, interface en français et en anglais, documents fournisseurs en anglais et en mandarin à partir de modèles ; interface complète en mandarin au lot 1. Ce choix suppose que l'assistant(e) achats lise l'anglais.
- **Page de suivi client** au lot 1 et non au lot 0 : elle expose des données à l'extérieur et n'ouvre qu'après un premier contrôle de sécurité ; au lot 0, la transparence passe par l'envoi au client des rapports et de la facture du fabricant en PDF.
- **Signature électronique hors outil au lot 0** : l'administratrice valide le document signé déposé ; les deux verrous restent respectés, sans retour automatique de statut.

**Plan de repli** : si le lot 0 n'est pas prêt au mois 4, les premières commandes sont suivies avec le modèle Excel et des PDF, ce qui reste faisable pour 1 à 2 commandes par mois.

Les échéances sont des dates cibles calées sur le plan d'action, pas des estimations de charge : les durées de développement dépendent de l'outil de construction retenu et du temps que la fondatrice y consacre.

**Ajouts de l'audit du 19 octobre 2026, répartis par lot**

| Lot | Ajouts |
| --- | --- |
| Lot 0 | Devises XOF, XAF, USD et CNY avec leur code ISO ; bordereau de suivi des cargaisons et documents des marchandises dangereuses dans les pièces exigées ; échantillonnage ISO 2859-1 dans l'inspection ; référentiel articles avec code SH ; double authentification pour tous les comptes internes ; contrôle à quatre yeux sur les paiements ; trois environnements, tests automatisés des règles d'argent, supervision ; dictionnaire des données ; dates avec fuseau horaire ; TVA paramétrée par pays |
| Lot 1 | Bénéficiaires effectifs et contrôle des sanctions refait chaque année ; hygiène, sécurité et environnement des interventions ; pénalités de retard calculées ; suivi des échantillons ; import des relevés bancaires ; exports comptables SYSCOHADA et normes chinoises |
| Lot 2 | Barème des droits et taxes à l'import ; indicateurs de performance des fournisseurs ; retours et remplacements ; archivage à valeur probante ; test d'intrusion, conditions d'utilisation et politique de confidentialité avant l'ouverture des portails avec compte ; accessibilité WCAG 2.2 niveau AA des portails |

Pour absorber ces ajouts, le lot 0 a été réduit le 24 octobre 2026 (tableau des lots ci-dessus).

## 13. Critères de recette et indicateurs

Un lot n'est accepté que si tous ses tests passent sur des données réalistes, dans les langues prévues pour ce lot, depuis Guangzhou et depuis Abidjan.

**Tests de recette, chacun applicable au lot qui livre la fonction testée (section 12)**

- [ ] Un devis recalculé par l'application donne exactement le même montant que le modèle financier Excel, pour 5 commandes de valeurs différentes couvrant toutes les tranches du barème.
- [ ] Une offre EXW et une offre CFR pour le même produit sont ramenées à une base FOB cohérente, et la commission est calculée sur cette base.
- [ ] Une demande de cotation ne peut pas être envoyée à un fournisseur non agréé ; une commande est refusée si la due diligence du fournisseur est expirée.
- [ ] Une affaire en négoce ou avec lettre de crédit ne peut pas être ouverte sans vérification du client.
- [ ] Une vérification de fournisseur facturée 500 000 FCFA, suivie d'un contrat d'achat signé 60 jours plus tard, réduit la première facture de commission de 250 000 FCFA ; signé 100 jours plus tard, elle ne la réduit pas.
- [ ] Un dossier d'équipement d'un site ne s'ouvre pas sans date d'ouverture ; la facture du deuxième versement affiche le premier versement déduit et le reste dû exact.
- [ ] Une demande envoyée depuis le site web, une fois l'application en service, crée un prospect dans M1 avec sa source, sa spécialité et son pays ; sans premier contact sous 1 jour ouvré, une alerte part.
- [ ] Un dossier de trois commandes de 2 M FCFA chacune (6 M FCFA au total, commission calculée de 720 000 FCFA au taux de 12%) est facturé au minimum de 1 000 000 FCFA une seule fois, et non trois fois.
- [ ] Une commande sans mandat et contrat signés ne peut ni passer en production ni déclencher d'acompte fournisseur.
- [ ] Un solde fournisseur ne peut pas être payé, ni un bon à payer émis, tant que l'inspection n'est pas validée ; une dérogation exige un motif et apparaît au journal d'audit.
- [ ] Un paiement vers un compte non vérifié est refusé ; la modification d'un compte vérifié le repasse à « non vérifié ».
- [ ] Une inspection saisie hors ligne avec 50 photos se synchronise sans perte ni doublon.
- [ ] Un rapport d'inspection, un rapport de due diligence et une facture se génèrent correctement en français, en anglais et en mandarin, caractères chinois compris.
- [ ] Le hub Afrique ne voit ni les prix fournisseurs détaillés (hors valeur FOB et instruction de paiement des dossiers de ses clients ivoiriens en achat accompagné) ni les comptes de GBS Chine ; les agents pays ne voient ni les prix fournisseurs détaillés ni les comptes des deux sociétés ; un agent pays ne voit pas les clients d'un autre pays ; un inspecteur ne voit que ses missions ; un fournisseur ne voit que ses propres cotations et commandes, sans les prix de vente au client.
- [ ] Un client ne voit, sur sa page de suivi, que ses propres dossiers ; le lien expire et peut être révoqué.
- [ ] Un message envoyé ne peut pas être supprimé ; une correction reste visible comme telle ; un fil interne n'est jamais visible d'un client ou d'un fournisseur.
- [ ] La part de GBS Côte d'Ivoire, les frais de gestion et les commissions des agents pays calculés par l'application sont identiques à un calcul manuel sur 5 affaires encaissées.
- [ ] Le retour de statut de la signature électronique lève bien le verrou correspondant.
- [ ] Les écrans courants s'affichent en moins de 3 secondes depuis Guangzhou et depuis Abidjan.

* [ ] Le passage à la phase suivante est refusé tant qu'une pièce obligatoire manque ; une dérogation exige un motif et apparaît au journal d'audit.
* [ ] Un dossier de due diligence seule n'exige aucune pièce d'expédition.
* [ ] Pendant l'attente d'un tiers, l'horloge interne s'arrête ; les délais sont comptés en jours ouvrés, jours fériés du pays exclus.
* [ ] Un point bloquant non résolu à son échéance est escaladé à l'administratrice ; une pièce manquante au-delà du délai devient un point bloquant.
* [ ] Un avenant signé met à jour le prix et recalcule le planning du dossier.

- [ ] Aucune offre reçue par le formulaire n'est consultable dans l'application avant la date limite, même par l'administratrice, et tout accès technique pendant cette période apparaît au journal ; un fournisseur ne voit jamais les offres des autres.
- [ ] Le rapport des 3 offres présente des offres ramenées à la même base et des fournisseurs anonymes tant que le mandat n'est pas signé.
- [ ] Une commande sur mesure ne passe pas en production sans approbation technique signée par le client.
- [ ] Une non-conformité ouverte empêche de valider l'inspection jusqu'à sa clôture.
- [ ] Un projet de connaissement incohérent avec la facture ou la liste de colisage est signalé avant validation.
- [ ] Le client voit sur sa page de suivi l'étape actuelle, la date d'arrivée prévue et les documents de son expédition dès leur saisie ; une alerte part avant la fin des jours de franchise au port.

* [ ] Le guide d'expression du besoin refuse l'envoi tant qu'un champ critique de la catégorie manque, et signale une tension électrique incohérente avec le pays de livraison.
* [ ] Le cahier des charges validé génère sans ressaisie le dossier de consultation des fournisseurs en mandarin.

- [ ] Une réponse fournisseur sans données de coût global est signalée incomplète et ne peut pas être recommandée sans dérogation ; le coût global calculé est identique à un calcul manuel sur 3 offres.
- [ ] Les données de coût global du fournisseur retenu apparaissent dans son contrat.
- [ ] Un fournisseur sans engagement de non-commission signé ne peut pas être agréé.
- [ ] La page de suivi du client affiche séparément la facture du fabricant et les honoraires.
- [ ] Un retard qui rend la date d'ouverture intenable déclenche une alerte et réduit la marge affichée au client.

* [ ] Chaque fournisseur présenté à un client apparaît dans son registre avec la date et le dossier, sans possibilité de modification.
* [ ] Une demande portant sur un produit déjà acheté chez le même fournisseur déclenche la proposition du tarif de réassort ; la commission calculée est réduite de 50%.
* [ ] La retenue à la source n'est appliquée qu'aux factures de GBS Chine, au taux du pays du client (Côte d'Ivoire 20%, Cameroun 15%, Gabon 25% par défaut), jamais aux factures de GBS Côte d'Ivoire à un client ivoirien.

- [ ] Une facture de GBS Côte d'Ivoire ne peut pas partir au client sans numéro et QR code FNE.
- [ ] Sur un mois test de 10 dossiers répartis entre les deux sociétés, le relevé des flux est identique à un calcul manuel, et les retenues à la source sont calculées.
- [ ] La vue consolidée est égale à la somme des deux sociétés moins les flux internes, au franc près.
- [ ] Un changement de règle de partage daté ne modifie pas les dossiers ouverts avant sa date d'effet.

* [ ] Une facture de GBS Côte d'Ivoire est émise en XOF et une facture de GBS Chine à un client africain en USD ; un paiement reçu en XAF d'un client gabonais ou camerounais est enregistré en XAF ; aucun montant n'est enregistré sans code de devise ISO 4217.
* [ ] Une expédition vers la Côte d'Ivoire, le Gabon ou le Cameroun ne peut pas passer au statut « expédiée » sans le bordereau de suivi des cargaisons du pays ; une expédition contenant un article marqué dangereux est bloquée sans fiche de données de sécurité ni déclaration au transporteur.
* [ ] Pour un lot de 1 200 pièces, l'application propose la taille d'échantillon et les seuils d'acceptation de la norme ISO 2859-1 pour les niveaux de qualité paramétrés, et la décision proposée est conforme à un calcul manuel.
* [ ] Un ordre de paiement préparé par une personne ne peut pas être validé par cette même personne.
* [ ] Une date limite de cotation fixée à 18 h à Abidjan s'affiche à 2 h le lendemain à Guangzhou.
* [ ] Un compte interne sans double authentification ne peut pas se connecter.
* [ ] Les tests automatisés des règles d'argent passent tous avant chaque mise en production ; une mise en production peut être annulée sans perte de données.
* [ ] Le droit estimé à l'import d'un article est calculé à partir de son code SH et du barème de la zone de destination.
* [ ] Une mission avec une contre-inspection non facturée apparaît dans la liste des missions à perte avec la cause « contre-inspection non facturée ».
* [ ] Une note de frais sans code dossier ne peut pas être validée pour remboursement tant qu'elle n'est pas affectée à un dossier ou classée en frais généraux.
* [ ] Un devis dont la marge directe prévue est sous le seuil paramétré affiche une alerte et ne peut être envoyé qu'après une confirmation tracée au journal.
* [ ] Un déplacement de 300 000 FCFA partagé entre deux dossiers, avec 6 h et 2 h de temps passé, est réparti en 225 000 et 75 000 FCFA.
* [ ] En vue par société, la marge d'un dossier intègre la part reversée entre sociétés ; en vue groupe consolidée, cette part s'annule et la marge du groupe égale la somme des marges des deux sociétés.
* [ ] Une facture impayée réduit la marge encaissée du dossier, pas sa marge facturée ; un coût saisi après la clôture analytique rouvre la marge avec trace au journal.

**Indicateurs suivis par l'application**

| Domaine | Indicateur |
| --- | --- |
| Commercial | Prospects contactés, consultations payées, due diligences vendues, taux de conversion consultation vers commande, délai moyen de conversion |
| Activité | Commandes signées et expédiées, valeur FOB, chiffre d'affaires par service et par segment |
| Qualité | Taux de refus en inspection, réclamations après livraison, délai de traitement des réclamations |
| Délais | Respect des dates de fabrication et d'expédition promises |
| Finances | Encaissements à venir, retards de paiement clients, marge du négoce, rentabilité par affaire, part de GBS Côte d'Ivoire et commissions des agents pays, flux entre sociétés, résultat par société, point mort atteint ou non |
| Fournisseurs | Fournisseurs agréés, due diligences expirant dans les 60 jours, note moyenne, taux de réponse aux cotations, taux de défaut par fournisseur en parties par million, livraison complète et à l'heure, non-conformités ouvertes |
| Expression du besoin | Allers-retours par besoin, délai entre la première demande et le cahier des charges validé |
| Proposition de valeur | Écart de coût global entre l'offre retenue et l'offre la moins chère à l'achat, part des dates d'ouverture tenues, part des dossiers acceptés à l'audit du client final |
| Fidélité et contournement | Part des commandes en réassort, clients inactifs ayant déjà acheté auprès d'un fournisseur présenté, clients reconquis par l'inspection seule |

Les définitions et les modes de calcul des indicateurs financiers sont ceux du modèle Excel, pour que les deux outils donnent les mêmes chiffres.

## 14. Risques et points ouverts

Sept points doivent être tranchés avant le développement du lot 0, un huitième, déjà décidé, est à vérifier après un mois de développement, et trois points avant le lot 3.

**À trancher avant le lot 0**

| Point | Question | Qui tranche |
| --- | --- | --- |
| Hébergement | Vitesse et stabilité réelles depuis Guangzhou d'une base hébergée à Hong Kong ou Singapour ; besoin ou non d'une licence ICP | Test technique sur place |
| Signature électronique | Prestataire(s) utilisable(s) en Chine et en Afrique, valeur juridique dans les quatre pays | Juriste, puis test |
| Facturation par société | GBS Côte d'Ivoire facture dès le mois 1 (FNE) et GBS Chine à partir du mois 4 (fapiao et factures export) : quelles mentions, numérotation et taxes l'application doit-elle gérer pour chaque société, y compris pour les clients gabonais et camerounais facturés par GBS Chine ? | Fiscaliste |
| Obligations de facturation | Mentions obligatoires et numérotation en Côte d'Ivoire, au Gabon et au Cameroun ; facturation électronique éventuellement imposée | Fiscaliste, cabinet comptable |
| Données personnelles | Règles applicables et transfert de données entre l'Afrique et la Chine | Juriste |
| Accords-cadres au Gabon et au Cameroun | La mensualité est facturée en USD par GBS Chine, avec une retenue à la source de 25% au Gabon et de 15% au Cameroun, alors que l'accord-cadre est la spécialité prioritaire de ces deux pays : faut-il facturer en XAF, par quelle société, et avec quel traitement de la retenue (prix exprimé après retenue, convention fiscale) ? | Fiscaliste, en priorité |
| Annulation d'un forfait au projet | Sort des versements déjà encaissés et des sommes dues selon l'étape atteinte, à fixer dans le contrat de projet (lot 2 des contrats) puis à reprendre dans l'application | Fondatrice, puis avocat |
| Capacité de développement | Décidé le 24 octobre 2026 : lot 0 réduit (section 12). Après un mois de développement, vérifier que le lot 0 réduit tient le mois 4 ; à défaut, faire appel à un développeur confirmé pour la sécurité, les tests et la mise en production | Fondatrice |

**À trancher avant le lot 3**

| Point | Question | Qui tranche |
| --- | --- | --- |
| Paiements chinois | Comptes d'entreprise WeChat Pay et Alipay de la WFOE, et accès à leurs interfaces de programmation pour des paiements entre entreprises | Banque et cabinet de la WFOE |
| Messagerie WeChat | Compte de service ou messagerie d'entreprise pour les notifications aux fournisseurs | Cabinet de la WFOE |
| Assistance par IA | Modèle accessible depuis la Chine, ou IA locale, et confidentialité des données clients | Choix technique de la fondatrice |

**Risques**

| Risque | Effet | Parade |
| --- | --- | --- |
| Lot 0 trop large pour être prêt au mois 4 | Premières commandes gérées hors outil, verrous non garantis | Tenir strictement le périmètre du lot 0 ; démarrer avec des modèles de documents simples ; plan de repli avec le modèle Excel et des PDF (section 12) |
| Lenteur ou blocage depuis la Chine | Outil inutilisable par l'équipe de Guangzhou | Tests de vitesse avant développement ; aucune dépendance à des services bloqués |
| Fournisseurs qui refusent la signature électronique | Verrou 1 bloqué | Mode alternatif avec contrat au cachet, validé par l'administratrice |
| Fraude au changement de coordonnées de paiement | Paiement détourné | Comptes vérifiés, retour automatique à « non vérifié » en cas de modification, double validation |
| Traductions approximatives des spécifications | Produit non conforme | Référentiel des critères traduit et validé une fois ; texte original toujours conservé |
| Dépendance à une seule personne pour faire évoluer l'outil | Outil figé si la fondatrice n'a plus le temps | Code et paramètres documentés ; règles de gestion paramétrables sans développement |
| Contournement : le client commande ensuite directement au fournisseur | Perte des commissions sur les commandes répétées | Projets multi-fournisseurs en priorité, tarif de réassort, accords-cadres, clause de non-contournement et registre des fournisseurs présentés, offre d'inspection seule |
| Prix de transfert contesté entre les deux sociétés | Redressement fiscal en Côte d'Ivoire, l'impôt chinois effectif étant très inférieur | Convention signée, analyse des fonctions, relevés et factures générés par l'application (section 5 ter), revue par un fiscaliste avant la première clôture |
| Données clients partagées entre deux pays | Non-conformité à la loi ivoirienne 2013-450 sur les transferts de données hors de Côte d'Ivoire | Consentement recueilli à l'ouverture du dossier, registre des transferts, autorisation de l'ARTCI à vérifier |
| Blocage au port d'arrivée | Frais de stationnement, amende ou marchandise retenue faute de bordereau de suivi des cargaisons ou de documents de marchandises dangereuses | Pièces obligatoires de la phase Expédition, blocage du statut « expédiée », procédure validée avec le transitaire de chaque pays |
| Faille de sécurité sur un portail | Fuite de prix, de noms de clients ou de coordonnées bancaires | Niveau OWASP ASVS 2, test d'intrusion avant ouverture, droits dans la base, plan de réponse aux incidents (section 10) |
