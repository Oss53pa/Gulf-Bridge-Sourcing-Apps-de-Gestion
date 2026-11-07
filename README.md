# Gulf Bridge Sourcing — application de gestion

Application de gestion de Gulf Bridge Sourcing : sourcing Chine → Côte d'Ivoire, Gabon, Cameroun. Elle est trilingue (français, anglais, chinois simplifié) et gère deux sociétés : GBS Chine et GBS Côte d'Ivoire.

Ce dépôt livre le **lot 0** du cahier des charges (`docs/cahier-des-charges.md`, section 12). Le lot 0 couvre ce qui protège l'argent et la méthode dès la première commande. Les lots 1 à 3 ne sont pas encore développés : voir « Ce qui reste à faire ».

## Architecture

| Brique | Choix | Rôle |
| --- | --- | --- |
| Base de données | PostgreSQL 16 (Supabase), `supabase/migrations` | Données, **règles d'argent, verrous et droits exécutés en base** (section 11) |
| Authentification | Supabase Auth + TOTP | Double facteur obligatoire : sans session AAL2, un compte interne n'a **aucun** droit, même via l'API |
| Fichiers | Supabase Storage, bucket privé `documents` | URL signées de 5 minutes, types et taille bornés |
| Interface | React 18 + TypeScript + Vite, `apps/web` | Écrans du lot 0, polices servies par l'application (aucune ressource Google, section 10) |
| Tests | Vitest + PostgreSQL | 74 tests de recette en base, 8 tests d'interface |

Principe : l'interface masque ce qui est interdit, mais c'est la base qui refuse. Chaque action sensible passe par une fonction `public.*` qui contrôle les droits. Ces actions sont : agrément, vérification de compte, validation de paiement, mandat, contrat, inspection, dérogation, facture et FNE. Les tables refusent les écritures directes sur les champs protégés.

### Ce que la base garantit (lot 0)

- **Deux sociétés cloisonnées.** Chaque dossier, facture et partage porte sa société. La comptable d'une société ne voit pas l'autre.
- **Neuf rôles et droits ligne par ligne.**
  - Le Hub Afrique ne voit ni les prix fournisseurs détaillés ni les comptes de paiement. Il voit seulement la valeur FOB de ses dossiers ivoiriens.
  - L'agent pays voit son pays et ses commissions, sans aucun montant fournisseur.
  - L'inspecteur ne voit que ses missions.
  - Les portails client, fournisseur et transitaire n'ont encore accès à rien (lots 1 et 2).
- **Commission calculée dans l'ordre de la section 5.**
  - Base FOB du dossier au cours du jour de signature du devis ; la tranche se lit sur le total.
  - Majoration de +2 points sur mesure, remise d'accord-cadre de −1 ou −2 points, réassort à −50 %.
  - Minimum appliqué une seule fois par dossier.
  - Déduction du forfait de consultation payé et de 50 % d'une vérification fournisseur commandée dans les 90 jours, sans remboursement.
  - Facturation à 50/50, le solde recalculé sur la FOB réelle.
  - Alerte si l'écart de change dépasse 5 %.
- **Ramenée à la base FOB.** EXW et FCA sont majorés des frais jusqu'à bord. CFR, CPT, CIF et CIP sont diminués du fret et de l'assurance. EXW et DDP sont bloqués sans dérogation de l'administratrice.
- **Verrou 1.** Ni production ni acompte sans mandat et contrat validés. La production exige en plus le justificatif d'acompte, et l'approbation technique pour le sur-mesure.
- **Verrou 2.**
  - Ni solde ni expédition sans inspection avant expédition validée.
  - L'expédition exige aussi la commission réglée et le bordereau BSC, BESC ou BIETC du pays de destination.
  - Pour les marchandises dangereuses : la fiche de données de sécurité, la déclaration IMDG et le rapport UN38.3 pour les batteries.
  - Une dérogation de l'administratrice, motivée et journalisée, peut lever ces blocages.
- **Mode 1, achat accompagné.** GBS ne paie jamais l'usine. L'ordre est une instruction au client.
- **Paiements.**
  - Uniquement vers un compte vérifié. Toute modification du compte le repasse à « non vérifié ».
  - Contrôle à quatre yeux, avec un second validateur désigné quand l'administratrice prépare l'ordre.
  - WeChat Pay et Alipay : en CNY seulement, plafond paramétré.
- **Fournisseurs.** Agrément impossible sans engagement de non-commission et sans due diligence valide. Pas de demande de cotation à un fournisseur non agréé. Pas de commande si la due diligence a expiré. Le registre des fournisseurs présentés est inaltérable.
- **Inspection ISO 2859-1.** Échantillonnage simple, contrôle normal, niveaux I à III, flèches du tableau 2-A. Décision proposée automatiquement. Une non-conformité ouverte bloque la validation.
- **Facturation.**
  - La société facturante suit la règle du modèle financier.
  - Devises imposées : XOF pour GBS CI, USD ou CNY pour GBS Chine.
  - Retenue à la source seulement pour une société non résidente du pays du client.
  - TVA datée par société et par type.
  - Facture GBS CI bloquée sans numéro et QR code FNE.
  - Numérotation propre à chaque société.
  - Encaissement enregistré dans la devise exacte de la facture.
- **Partage de la valeur et flux entre sociétés.** Calcul à l'encaissement selon la règle datée en vigueur à l'ouverture du dossier : 60 % ou 70 % pour GBS Chine, 5 % ou 30 % pour GBS CI, 15 % pour l'agent pays. Relevé mensuel validé, puis factures intragroupe générées.
- **Dossiers en mode projet.**
  - Dix modèles, phases et pièces exigées.
  - Passage de phase refusé si une pièce obligatoire manque, sauf dérogation.
  - Points bloquants avec escalade.
  - Mode financier figé, négoce porté par GBS Chine, vérification du client exigée en négoce ou avec lettre de crédit.
  - Équipement d'un site : date d'ouverture obligatoire, échéancier du forfait au projet avec le reste dû sur chaque facture.
- **Journal d'audit.** Ajout seul, chaque ligne porte l'empreinte SHA-256 de la précédente, et `audit_verifier()` détecte toute altération faite directement en base. Aucune suppression physique des données métier.
- **Paramètres datés.** Barème, taux, parts, retenues, TVA, plafonds : rien n'est écrit en dur. Une nouvelle valeur ne touche pas les dossiers déjà ouverts.

## Démarrer en local

Prérequis : Node 22, pnpm 10, PostgreSQL 16 (pour les tests) et le CLI Supabase (pour un projet complet).

```bash
pnpm install
```

### Tests des règles d'argent, verrous et droits (PostgreSQL nu)

```bash
pnpm test:db
```

Le script recrée la base `gbs_test`. Il applique `supabase/tests/supabase_stub.sql`, qui simule les rôles et `auth.uid()` de Supabase, puis toutes les migrations, et lance les 74 tests de recette. Variables reconnues : `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`.

### Application web

```bash
cp apps/web/.env.example apps/web/.env.local
```

Renseignez `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` (clé publique par conception ; **aucune autre clé côté client**), puis :

```bash
pnpm dev
```

```bash
pnpm --filter web test
```

```bash
pnpm --filter web build
```

### Projet Supabase (développement, recette, production)

Trois projets distincts sont prévus (section 10 bis), et la recette n'utilise que des données fictives (`supabase/seed.sql`). Pour chaque projet :

```bash
supabase link --project-ref <reference-du-projet>
```

```bash
supabase db push
```

Le seed ne s'applique qu'en local et en recette. Ne l'exécutez jamais en production.

### Premier compte administrateur

L'inscription libre est désactivée (`supabase/config.toml`).

1. Invitez l'administratrice depuis le tableau de bord Supabase (Authentication → Users → Invite). Son profil est créé automatiquement, sans aucun rôle.
2. Attribuez-lui le rôle une seule fois, dans l'éditeur SQL du projet :

```sql
update public.profils
   set role = 'admin', societes = (select array_agg(id) from public.societes)
 where email = 'adresse-de-l-administratrice';
```

3. À la première connexion, l'application impose l'inscription du double facteur (QR code TOTP).

Ensuite, l'administratrice attribue les rôles depuis **Paramétrage → Utilisateurs et rôles**.

### Tâche quotidienne

L'escalade des points bloquants échus se planifie avec `pg_cron` :

```sql
select cron.schedule('escalade', '0 6 * * *', $$select public.escalader_points_bloquants()$$);
```

## Avant la mise en production

Ces points sont à vérifier ou à trancher. Ils ne sont pas couverts par le code.

- **Valeurs à confirmer**, saisies comme paramètres datés et marquées « à confirmer » dans `20261107000009_configuration.sql` :
  - dates de création réelles des deux sociétés ;
  - retenues à la source, TVA des services de GBS Chine et des flux intragroupe (fiscaliste) ;
  - majoration EXW/FCA par défaut (transitaire) ;
  - plafond WeChat Pay et Alipay ;
  - seuil d'engagement de l'accord-cadre.
- **En-têtes HTTP de l'hébergeur** : `frame-ancestors 'none'`, HSTS, `X-Content-Type-Options`. Ils ne peuvent pas être posés par une balise `<meta>`.
- **Limitation de débit** des points d'entrée Auth et API, à régler dans le projet Supabase.
- **Hébergement** testé depuis Guangzhou et Abidjan (section 14).

## Ce qui reste à faire

| Sujet | État | Lot |
| --- | --- | --- |
| Génération PDF **côté serveur** avec polices chinoises intégrées | Les documents sont des pages A4 imprimables (facture, rapport d'inspection, rapport de due diligence), générées dans le navigateur | 0 (à compléter) |
| Vérification du type de fichier **côté serveur** | Contrôle des octets côté client, types MIME et taille bornés par le bucket ; une fonction serveur doit encore vérifier les octets | 0 (à compléter) |
| Accord-cadre : facturation mensuelle automatique, alerte 60 jours avant l'échéance | Le dossier-cadre et la remise sont gérés ; la facturation récurrente n'est pas planifiée | 0/1 |
| Annulation d'un dossier : montants dus selon la phase, avoir FNE, recalcul des partages | Annulation de commande par l'administratrice, avec motif ; calcul des montants dus absent | 1 |
| Relances automatiques des factures, import des relevés bancaires | Non commencé | 1 |
| Signature électronique intégrée, formulaires fournisseurs et transitaires par lien | Non commencé (lot 0 : document signé déposé et validé par l'administratrice) | 1 |
| Messagerie, page de suivi client, guide d'expression du besoin, rapport des 3 offres automatique et coût global | Non commencé (l'offre porte déjà un champ « coût global » et l'alerte « coût global manquant ») | 1 |
| Application inspecteur hors ligne, interface mandarin validée | Le chinois est traduit mais **non validé** par un locuteur natif | 1 |
| Jours ouvrés et fériés, mes tâches, avenants, rétroplanning | Non commencé | 1 |
| Négoce complet, entrepôt, conformité à l'import, garanties, appels d'offres, trésorerie, SAV, portails avec compte, rentabilité | Non commencé | 2 |
| WeChat, WeChat Pay et Alipay connectés, suivi automatique des conteneurs, IA | Non commencé | 3 |
| Écrans de la maquette hors lot 0 (Prospection, Gantt, Productivité, etc.) | Affichés dans le Sommaire avec leur lot, non ouvrables | 1 à 3 |

## Organisation du code

```
supabase/
  migrations/   9 migrations : socle, tiers, dossiers, achats et qualité, logistique,
                finance, règles, droits, configuration par défaut
  tests/        recette.test.ts (74 tests), helpers.ts, supabase_stub.sql, reset_db.sh
  seed.sql      données fictives de recette
apps/web/
  src/lib/      client Supabase, droits d'affichage, formats trilingues, erreurs, fichiers
  src/screens/  écrans du lot 0
  src/i18n/     fr.json (fait foi), en.json, zh.json, générés par scripts/traductions.py
docs/           cahier des charges
```

Pour modifier un libellé, éditez `apps/web/scripts/traductions.py` puis lancez :

```bash
python3 apps/web/scripts/traductions.py
```

Un test vérifie que les trois langues ont les mêmes clés. Il vérifie aussi que chaque libellé utilisé par le code et chaque code d'erreur levé par la base ont leur traduction.
