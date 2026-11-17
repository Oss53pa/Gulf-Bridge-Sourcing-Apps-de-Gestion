# Mise en production des migrations 69 à 81 et des fonctions serveur

Projet Supabase : `vgtmljfayiysuvrcmunt`.

**État : fait.** Migrations 69 à 81 appliquées le 13 novembre 2026 après 20 h GMT (vérification : aucune
anomalie) ; fonctions redéployées le 14 novembre 2026 : `gbs-suivi` v5, `gbs-depot` v9, `gbs-demande` v6,
`gbs-transitaire` v3, `gbs-fournisseur` v7. Reste à faire par l'équipe : les essais 1, 3 et 4 de la section 5
(dépôt réel, demande du site, photo sans position GPS), qui exigent une session ou le site.

Migration 82 (`performance_fournisseurs`) appliquée le 15 novembre 2026 vers 2 h 55 GMT : voir la section 8.

## 1. Avant de commencer

- Fenêtre : en dehors de 7 h – 20 h GMT, jours ouvrés (règle de modification de la base).
- Code poussé : la branche contient les migrations 69 à 81 et les fonctions serveur modifiées ; les tests de la
  base et de l'application web passent dans l'intégration continue.
- Prévenir avant d'appliquer :
  - **Achats** (migration 77) : une due diligence ne se valide plus sans bénéficiaire effectif déclaré ni contrôle
    des sanctions de moins de 30 jours ; une correspondance confirmée suspend l'agrément et bloque consultations,
    offres et commandes du fournisseur.
  - **Comptable** (migration 78) : vérifier que le montant d'un paiement fournisseur est saisi avant la pénalité
    retenue (l'export comptable en déduit la pénalité) ; faire confirmer les comptes par chaque cabinet.
  - **Administratrice** (migration 74) : le tronc commun du guide d'expression du besoin est livré en brouillon ;
    à activer dans Paramétrage · Expression du besoin après validation de la fondatrice.

## 2. Appliquer les migrations, dans l'ordre

Une migration à la fois, de `20261107000069_colisage_fournisseur.sql` à `20261107000081_revue_portails.sql`.
Aucune ne contient d'instruction `drop`. Arrêter à la première erreur et ne pas continuer.

## 3. Vérifier la base

Exécuter `supabase/verifications/apres_69_81.sql` (lecture seule). **Aucune ligne = tout est en place.**
Avant application, le même script renvoie 61 anomalies : c'est attendu.

## 4. Redéployer les fonctions serveur

Fonctions modifiées : `gbs-depot`, `gbs-demande`, `gbs-suivi`, `gbs-fournisseur`, `gbs-transitaire`
(module partagé `_shared/fichiers.ts` : taille annoncée du corps exigée, métadonnées des images retirées).

Point de vigilance : les fonctions refusent une requête **sans en-tête `Content-Length`** (411).
Constaté en production le 14 novembre 2026 : la passerelle Supabase reçoit le corps en entier et ajoute elle-même
l'en-tête, y compris pour un envoi par morceaux ; aucune requête légitime n'est donc refusée en 411, et la borne
de taille propre à chaque fonction répond bien 413. Le contrôle des envois par morceaux reste en place pour le cas
où la passerelle changerait de comportement.

## 5. Essais juste après le redéploiement

1. Dans l'application, déposer une pièce PDF dans un dossier, puis une photo JPEG prise au téléphone :
   les deux dépôts réussissent.
2. Ouvrir une page de suivi client par lien : elle s'affiche.
3. Envoyer une demande de test depuis le formulaire du site : elle arrive dans Prospection.
4. Télécharger la photo déposée et vérifier qu'elle ne porte plus de position GPS (propriétés du fichier).

Si l'essai 1, 2 ou 3 échoue avec une erreur 411 : **redéployer immédiatement la version précédente** de la
fonction concernée (historique des versions dans le tableau de bord Supabase, Edge Functions), puis signaler.

## 6. Retour en arrière

- Fonctions serveur : version précédente, comme ci-dessus.
- Base : les migrations 69 à 81 ajoutent des tables, fonctions et paramètres et redéfinissent des fonctions ;
  pas de retour automatique. En cas d'anomalie bloquante, corriger par une nouvelle migration plutôt que de
  supprimer des objets. Les paramètres datés (seuils, comptes, taux) se corrigent sans migration, dans Paramétrage.

## 7. Après la mise en production

- Activer le tronc commun du guide (administratrice), saisir les questionnaires par catégorie.
- Confirmer le réseau électrique des pays (Paramétrage), les taux d'assurance et les capacités des conteneurs.
- Les portails client et fournisseur restent fermés jusqu'au test d'intrusion indépendant.

## 8. Migration 82 · performance des fournisseurs

**État : fait** le 15 novembre 2026 (dimanche, vers 2 h 55 GMT), par l'éditeur SQL du tableau de bord.

- Méthode : un script unique, en une transaction, qui reprend sans modification
  `20261107000082_performance_fournisseurs.sql`, précédé de garde-fous (arrêt si la 81 n'est pas inscrite dans
  l'historique, si la 82 l'est déjà ou si ses paramètres existent) et suivi de l'inscription dans
  `supabase_migrations.schema_migrations`. Testé en local sur une base à l'état 81 : refus sans la 81, application,
  refus d'une deuxième application.
- L'historique des migrations est partagé avec les autres applications du projet : les dernières lignes ne sont
  pas celles de GBS. Chercher les versions `20261107000081` et `20261107000082` par leur numéro.
- Premier essai depuis un téléphone : texte tronqué au collage, « Success. No rows returned », rien d'écrit
  (transaction abandonnée). Coller depuis un ordinateur, ou vérifier que la ligne de contrôle finale s'affiche.
- Vérification : `supabase/verifications/apres_82.sql` (lecture seule). Contrôlée après validation : historique,
  3 paramètres, droits (connectés oui, anonymes non), droits du propriétaire, chemin de recherche vide. Le code de
  la fonction est identique à celui du dépôt aux blancs près (le collage a ajouté de l'indentation).
- Reste à faire par l'équipe : ouvrir l'onglet « Performance » d'une fiche fournisseur et le registre des
  fournisseurs avec un compte administratrice ou achats. Une fonction PL/pgSQL ne signale une colonne mal nommée
  qu'à son premier appel ; des chiffres affichés, même à zéro, confirment qu'elle fonctionne.
- Retour en arrière : aucun prévu. Les seuils et la fenêtre de calcul se corrigent dans Paramétrage, sans migration.
