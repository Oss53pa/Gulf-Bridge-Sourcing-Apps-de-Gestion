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
| Tests | Vitest + PostgreSQL | 83 tests de recette en base, 8 tests d'interface |

Principe : l'interface masque ce qui est interdit, mais c'est la base qui refuse. Chaque action sensible passe par une fonction `gbs.*` qui contrôle les droits. Ces actions sont : agrément, vérification de compte, validation de paiement, mandat, contrat, inspection, dérogation, facture et FNE. Les tables refusent les écritures directes sur les champs protégés.

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
- **Accord-cadre.** Forfait mensuel facturé automatiquement par la société qui contracte, sans doublon ; alerte 60 jours avant l'échéance.
- **Annulation par le client.** Montants dus selon la phase atteinte : rien avant le contrat, la première moitié avant la production, la totalité après ; avoirs et factures émis automatiquement.
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

Le script recrée la base `gbs_test`. Il applique `supabase/tests/supabase_stub.sql`, qui simule les rôles et `auth.uid()` de Supabase, puis toutes les migrations, et lance les 83 tests de recette. Variables reconnues : `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`.

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

### Hébergement sur Cloudflare Pages

L'application web est un site statique. Dans le tableau de bord Cloudflare : **Workers & Pages → Create → Pages → Connect to Git**, dépôt `Gulf-Bridge-Sourcing-Apps-de-Gestion`, branche de production `main`, puis :

| Réglage | Valeur |
|---|---|
| Framework preset | None |
| Build command | `pnpm --filter web build` |
| Build output directory | `apps/web/dist` |
| Root directory | *(vide : racine du dépôt)* |

Variables d'environnement (Production et Preview) :

| Variable | Valeur |
|---|---|
| `NODE_VERSION` | `22` |
| `VITE_SUPABASE_URL` | `https://<reference-du-projet>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | la clé publique `anon` du projet (Project Settings → API Keys → Legacy) |

Aucune autre clé ne doit y figurer : tout ce qui est préfixé `VITE_` part dans le navigateur. La politique de sécurité du contenu est générée au build à partir de `VITE_SUPABASE_URL` ; les autres en-têtes de sécurité sont dans `apps/web/public/_headers`. Sans fichier `404.html`, Cloudflare Pages renvoie `index.html` pour toute adresse inconnue, ce qui permet la navigation de l'application.

Une fois l'adresse connue, déclarez-la à la fonction de dépôt (sinon les navigateurs refusent les dépôts) :

```bash
supabase secrets set GBS_ORIGINE=https://adresse-de-l-application --project-ref <reference-du-projet>
```

Ajoutez aussi cette adresse dans **Authentication → URL Configuration** (Site URL et Redirect URLs) pour que les liens d'invitation ramènent vers l'application.

### Projet Supabase (développement, recette, production)

Trois projets distincts sont prévus (section 10 bis), et la recette n'utilise que des données fictives (`supabase/seed.sql`). Pour chaque projet :

```bash
supabase link --project-ref <reference-du-projet>
```

```bash
supabase db push
```

Le seed ne s'applique qu'en local et en recette. Ne l'exécutez jamais en production.

**Projet partagé avec d'autres applications.** Tout GBS vit dans les schémas `gbs` (tables, vues, fonctions appelables) et `gbs_private` (fonctions internes), plus le bucket privé `gbs-documents`. Les migrations ne touchent à aucun objet existant : aucun `drop`, aucune modification du schéma `public`. Une seule étape manuelle est indispensable : dans le tableau de bord Supabase, **Project Settings → Data API → Exposed schemas**, ajoutez `gbs`. N'y ajoutez jamais `gbs_private`. Sans cette étape, l'application reçoit une erreur à chaque appel.

**Piège du projet partagé `vgtmljfayiysuvrcmunt`.** Une autre application y a fixé la liste des schémas exposés directement sur le rôle `authenticator` (`pgrst.db_schemas`). Ce réglage en base l'emporte sur le tableau de bord : cocher un schéma dans Data API ne suffit pas. Il faut aussi mettre à jour le rôle, en conservant tous les schémas déjà présents, puis recharger l'API :

```sql
select setconfig from pg_db_role_setting s join pg_roles r on r.oid = s.setrole where r.rolname = 'authenticator';
```

```sql
alter role authenticator set pgrst.db_schemas = 'public, atlas_people, atlasbanx, folio, dgs, gbs';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
```

Le même rôle exécute `atlas_people.mfa_pre_request` avant chaque requête ; cette fonction ignore les requêtes qui ne visent pas `atlas_people` et n'affecte donc pas GBS.

### Premier compte administrateur

L'inscription libre est désactivée (`supabase/config.toml`).

1. Créez ou invitez l'administratrice avec la métadonnée utilisateur `{"app": "gbs", "nom": "…"}`. Seuls les comptes portant `app = gbs` reçoivent un profil GBS : les utilisateurs des autres applications du projet n'en ont pas et n'accèdent à rien. Le profil est créé sans aucun rôle.
2. Attribuez-lui le rôle une seule fois, dans l'éditeur SQL du projet :

```sql
update gbs.profils
   set role = 'admin', societes = (select array_agg(id) from gbs.societes)
 where email = 'adresse-de-l-administratrice';
```

Si la personne a déjà un compte dans une autre application du projet partagé, aucun profil GBS n'est créé (sa métadonnée `app` appartient à l'autre application et ne doit pas être modifiée). Créez alors le profil vous-même avant l'étape 2 :

```sql
insert into gbs.profils (id, nom, email)
select id, 'Nom Prénom', email from auth.users where lower(email) = lower('adresse')
on conflict (id) do nothing;
```

Le compte, le mot de passe et le second facteur restent communs à toutes les applications du projet.

3. À la première connexion, l'application impose l'inscription du double facteur (QR code TOTP).

Ensuite, l'administratrice attribue les rôles depuis **Paramétrage → Utilisateurs et rôles**.

### Fonction serveur de dépôt des fichiers

Tous les fichiers passent par la fonction `gbs-depot` (préfixée pour ne pas entrer en collision avec les fonctions des autres applications du projet partagé). Elle vérifie les droits de l'utilisateur en base, la taille, puis le type réel du fichier sur ses octets ; elle régénère le nom et calcule l'empreinte SHA-256. Aucun utilisateur n'écrit directement dans le stockage.

```bash
supabase functions deploy gbs-depot
```

```bash
supabase secrets set GBS_ORIGINE=https://adresse-de-l-application
```

### Page de suivi du client (lien sécurisé)

L'équipe crée un lien depuis l'onglet **Suivi client** de la fiche dossier. Le lien a la forme `https://adresse-de-l-application/suivi#<jeton>` : le jeton, placé après `#`, n'est envoyé ni au serveur web ni dans l'en-tête Referer.

- Jeton aléatoire de 256 bits, affiché une seule fois ; la base n'en garde que l'empreinte SHA-256. Durée de vie de 90 jours au plus (`suivi.duree_max_jours`), révocable.
- Lecture uniquement par la fonction `gbs-suivi` (publique, `verify_jwt = false`), qui limite les appels par adresse (`GBS_SUIVI_LIMITE_MINUTE`, 30 par minute par défaut) et appelle `gbs.suivi_client()` avec le rôle de service ; la base plafonne aussi les consultations par lien et par heure (`suivi.consultations_max_heure`).
- Réponse en liste blanche : jalons, pièces attendues du client, documents validés autorisés (URL signées de 5 minutes), points bloquants marqués visibles, étapes d'expédition visibles, factures de GBS, avance sur la date d'ouverture. Jamais de prix fournisseur, de marge ni de calcul de commission ; en négoce, ni facture du fabricant ni fournisseur.

```bash
supabase functions deploy gbs-suivi --no-verify-jwt
```

### Tâches planifiées

L'escalade des points bloquants échus et la facturation mensuelle des accords-cadres (idempotente : un mois déjà facturé ne l'est jamais deux fois) se planifient avec `pg_cron`. Une tâche `pg_cron` n'a pas de jeton : elle doit se déclarer `service_role`, sinon les fonctions refusent l'appel (`GBS_ACCES_REFUSE`).

```sql
select cron.schedule('gbs-escalade', '0 6 * * *',
  $c$do $$ begin perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform gbs.escalader_points_bloquants(); end $$$c$);
```

```sql
select cron.schedule('gbs-mensualites-cadre', '0 7 1 * *',
  $c$do $$ begin perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform gbs.facturer_mensualites_cadre(current_date); end $$$c$);
```

### Taux de change automatiques (BCE)

Les taux USD et CNY sont importés chaque jour ouvré depuis les taux de référence de la Banque centrale européenne. Le XOF ayant une parité fixe avec l'euro (655,957), 1 USD = 655,957 ÷ (USD pour 1 EUR publié par la BCE), et de même pour le CNY. L'import passe par `pg_net`, sans clé ni service tiers, et contrôle chaque réponse avant toute écriture :

- statut HTTP 200, taille inférieure à 64 Ko, XML valide sans `DOCTYPE` ni `ENTITY` ;
- date de publication dans les 7 derniers jours ;
- taux dans des bornes de plausibilité (`taux.borne.USD`, `taux.borne.CNY`) ;
- variation inférieure à 10 % (`taux.variation_max`) par rapport au dernier taux connu.

Une publication refusée n'écrit rien, n'est pas redemandée le même jour et reste tracée dans `gbs.imports_taux` (lisible par l'administratrice et la comptabilité) : le taux se saisit alors à la main. Les erreurs réseau sont retentées, au plus 6 requêtes par jour (`taux.requetes_max_jour`).

```sql
select cron.schedule('gbs-relances-pieces', '0 7 * * 1-5',
  $c$do $$ begin perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform gbs.relancer_pieces(); end $$$c$);
```

```sql
select cron.schedule('gbs-taux-bce', '*/15 15-17 * * 1-5',
  $c$do $$ begin perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform gbs.importer_taux_bce(); end $$$c$);
```

Les taux de la BCE sont des taux de référence, pas les taux appliqués par une banque : pour un paiement fournisseur, le taux réellement obtenu reste à saisir sur le paiement.

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
| Annulation d'un dossier : refacturation des frais engagés au coût, recalcul des partages déjà versés | Montants dus selon la phase, avoirs et factures émis automatiquement ; les frais engagés relèvent des coûts par dossier | 1 |
| Relances automatiques des factures, import des relevés bancaires | Non commencé | 1 |
| Signature électronique intégrée, formulaires fournisseurs et transitaires par lien | Non commencé (lot 0 : document signé déposé et validé par l'administratrice) | 1 |
| Page de suivi client en lecture seule par lien sécurisé (M14 niveau 1) | **Fait** (migration 17, fonction `gbs-suivi`). Fil de messagerie : à venir avec la messagerie | 1 |
| Notes de frais (M22), coûts par dossier, coûts partagés au prorata du temps, marge directe facturée et encaissée, missions à perte avec cause (M15) | **Fait** (migration 18). Marge complète, vue par société et consolidée, clôture analytique et budget au devis : lot 2 | 1 |
| Coût global des offres, grille pondérée, rapport automatique des 3 offres anonymes (A, B, C), recommandation argumentée, choix signé du client (M5) | **Fait** (migration 19). Coût de l'énergie et de l'entretien par pays à saisir ; grille et horizon proposés « à confirmer » ; données saisies par l'équipe tant que le formulaire fournisseur n'existe pas | 1 |
| Vérification des clients (M2) : identité, immatriculation, bénéficiaires effectifs, solvabilité, sanctions ; annuelle, caduque à tout changement d'actionnaire ; décision de l'administratrice à quatre yeux | **Fait** (migration 20). Contrôles saisis à la main (sources consultées) ; aucune interrogation automatique de registre ou de liste de sanctions | 1 |
| Pénalités de retard (M7) : taux par jour et plafond du contrat, jours calendaires, proposées en retenue sur le solde, renonciation motivée | **Fait** (migration 21) | 1 |
| Messagerie, guide d'expression du besoin, formulaire fournisseur par lien (plis chiffrés), négociation par tours | Non commencé | 1 |
| Application inspecteur hors ligne, interface mandarin validée | Le chinois est traduit mais **non validé** par un locuteur natif | 1 |
| Jours ouvrés et fériés, délais cibles avec voyants, attente d'un tiers, mes tâches, délégation en cas d'absence | **Fait** (migration 14). Délais cibles à saisir par la fondatrice ; calendrier chinois officiel et fêtes musulmanes à saisir chaque année ; jours fériés proposés « à confirmer » | 1 |
| Avenants (prix et planning recalculés à la signature), demande et relance des pièces manquantes, passage en point bloquant | **Fait** (migration 15). Relance sous forme de tâche interne tant que la page de suivi client, les formulaires fournisseurs et l'e-mail n'existent pas ; délais de relance (3 j) et de blocage (10 j) à confirmer | 1 |
| Planning à rebours depuis la date d'ouverture du site (M33) : dates au plus tard, fin projetée, avance ou retard, alerte « ouverture intenable » | **Fait** (migration 16). Exige les délais cibles de toutes les phases ; l'avance sera affichée au client avec la page de suivi | 1 |
| Signature électronique intégrée (mandats, contrats, avenants) | Non commencé (document signé déposé et validé par l'administratrice) | 1 |
| Négoce complet, entrepôt, conformité à l'import, garanties, appels d'offres, trésorerie, SAV, portails avec compte, rentabilité | Non commencé | 2 |
| WeChat, WeChat Pay et Alipay connectés, suivi automatique des conteneurs, IA | Non commencé | 3 |
| Écrans de la maquette hors lot 0 (Prospection, Gantt, Productivité, etc.) | Affichés dans le Sommaire avec leur lot, non ouvrables | 1 à 3 |

## Organisation du code

```
supabase/
  migrations/   11 migrations : socle, tiers, dossiers, achats et qualité, logistique,
                finance, règles, droits, configuration, accords-cadres et annulation, dépôt serveur
  functions/    depot (seul point d'écriture des fichiers)
  tests/        recette.test.ts, complements.test.ts, fichiers.test.ts (83 tests), helpers.ts, supabase_stub.sql, reset_db.sh
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
