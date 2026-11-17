// Non-régression des constats de la relecture indépendante des migrations 69 à 80.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, commande, dossier, expectError, monde, one, withTx } from './helpers';

afterAll(closePool);
const jj = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const CONTROLE = { listes: ['onu', 'ue', 'ofac'], source: 'Listes consolidées', realise_le: jj(0) };

describe('Revue des migrations 69 à 80', () => {
  it('sanctions : une correspondance confirmée bloque consultation, commande, agrément et sortie de suspension', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.achats);
    await db.query(`select gbs.enregistrer_controle_sanctions($1, $2)`, [m.fournisseur, { ...CONTROLE, resultat: 'correspondance_confirmee', justification: 'Actionnaire inscrit sur la liste OFAC' }]);
    await expectError(db, 'GBS_SANCTION_CONFIRMEE', `update gbs.fournisseurs set statut_agrement = 'sous_surveillance' where id = $1`, [m.fournisseur]);
    await as(db, m.admin);
    await expectError(db, 'GBS_SANCTION_CONFIRMEE', `select gbs.agreer_fournisseur($1)`, [m.fournisseur]);
    expect(await one(db, `select gbs_private.fournisseur_commandable($1) k, gbs_private.fournisseur_consultable($1) c`, [m.fournisseur])).toEqual({ k: false, c: false });
    // Un nouveau contrôle (correspondance écartée) périme le précédent et permet de réagréer.
    await as(db, m.achats);
    await db.query(`select gbs.enregistrer_controle_sanctions($1, $2)`, [m.fournisseur, { ...CONTROLE, resultat: 'correspondance_ecartee', justification: 'Homonyme : date de naissance différente' }]);
    await as(db, m.admin);
    await db.query(`select gbs.agreer_fournisseur($1)`, [m.fournisseur]);
    expect((await one(db, `select gbs_private.fournisseur_commandable($1) k`, [m.fournisseur])).k).toBe(true);
  }));

  it('assurance : constat dans la couverture, indemnités plafonnées en cumul, police figée après indemnité', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.achats);
    const e = (await one(db, `insert into gbs.expeditions (dossier_id, mode, pays_destination, port_arrivee) values ($1, 'conteneur_complet', 'CI', 'Abidjan') returning id`, [d])).id;
    const POL = { assureur: 'AXA', numero: 'POL-1', garantie: 'icc_a', devise: 'USD', valeur_cif: 1000, du: jj(-30), au: jj(-2) };
    await db.query(`select gbs.enregistrer_police($1, $2)`, [e, POL]);
    const SIN = { nature: 'avarie', description: 'Caisse enfoncée au déchargement', montant_reclame: 900 };
    await expectError(db, 'GBS_HORS_COUVERTURE', `select gbs.declarer_sinistre($1, $2)`, [e, { ...SIN, constate_le: jj(-1) }]);
    const s1 = (await one(db, `select gbs.declarer_sinistre($1, $2) id`, [e, { ...SIN, constate_le: jj(-3) }])).id;
    const s2 = (await one(db, `select gbs.declarer_sinistre($1, $2) id`, [e, { ...SIN, constate_le: jj(-4) }])).id;
    for (const s of [s1, s2]) await db.query(`select gbs.traiter_sinistre($1, 'expertise', '{"reference_assureur":"AXA-1"}')`, [s]);
    await db.query(`select gbs.traiter_sinistre($1, 'indemniser', $2)`, [s1, { indemnite: 900, indemnise_le: jj(0) }]);
    // Valeur assurée 1 100 : il ne reste que 200.
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.traiter_sinistre($1, 'indemniser', $2)`, [s2, { indemnite: 300, indemnise_le: jj(0) }]);
    await db.query(`select gbs.traiter_sinistre($1, 'indemniser', $2)`, [s2, { indemnite: 200, indemnise_le: jj(0) }]);
    await expectError(db, 'GBS_POLICE_FIGEE', `select gbs.enregistrer_police($1, $2)`, [e, { ...POL, valeur_cif: 5000 }]);
  }));

  it('questionnaires : activation refusée si une clé est partagée entre tronc commun et catégorie actifs', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.admin);
    // Catégorie enregistrée avant l'activation du tronc : la clé « usage » n'est pas détectée à l'enregistrement…
    const cat = (await one(db, `select gbs.enregistrer_questionnaire_besoin('froid', 'Froid', $1) id`,
      [JSON.stringify([{ code: 'froid', libelle: 'Froid', champs: [{ cle: 'usage', libelle: 'Usage', type: 'texte' }] }])])).id;
    await db.query(`select gbs.activer_questionnaire_besoin($1)`, [cat]);
    // … mais l'activation du tronc commun la refuse.
    await expectError(db, 'GBS_CLES_EN_DOUBLE', `select gbs.activer_questionnaire_besoin(id) from gbs.questionnaires_besoin where categorie = 'tronc_commun'`);
  }));

  it('réception sur site : points en texte seulement, sans doublon', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.achats);
    const e = (await one(db, `insert into gbs.expeditions (dossier_id, mode, pays_destination, port_arrivee) values ($1, 'conteneur_complet', 'CI', 'Abidjan') returning id`, [d])).id;
    const base = { creneaux: [{ date: jj(5), moment: 'matin' }] };
    for (const points of [[12345, 'Accès camion'], ['Accès camion', 'accès camion'], [{ a: 'bcdef' }]]) {
      await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.preparer_reception_site($1, $2)`, [e, { ...base, points }]);
    }
    await db.query(`select gbs.preparer_reception_site($1, $2)`, [e, { ...base, points: ['Accès camion', 'Arrivée électrique 380 V'] }]);
  }));

  it('colisage : un volume arrondi à zéro est refusé proprement', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const k = await commande(db, m, d, [{ qte: 1, pu: 1 }]);
    // 0,0004 m³ s'arrondit à 0,000 : la règle de densité diviserait par zéro ; la fonction répond « paramètres invalides ».
    await asRoot(db);
    const u = randomUUID();
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [u, `${u}@f.test`, { nom: 'Fournisseur', app: 'gbs' }]);
    await as(db, m.admin);
    await db.query(`select gbs.admin_compte_fournisseur($1, $2, 'logistique')`, [u, m.fournisseur]);
    await asRoot(db);
    await db.query(`select set_config('gbs.rpc', 'changer_statut_commande', true)`);
    await db.query(`update gbs.commandes set statut = 'en_production' where id = $1`, [k]);
    await db.query(`select set_config('gbs.rpc', '', true)`);
    await as(db, u);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.declarer_colisage($1, $2)`, [k, { caisses: 1, poids_brut_kg: 1, volume_m3: 0.0004 }]);
  }));

  it('compte d’encaissement : désignation par la fonction seule, même à la création', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.admin);
    await expectError(db, 'GBS_VALIDATION_RPC', `insert into gbs.comptes_bancaires (societe_id, libelle, banque, numero, devise, encaissement_clients)
      values ($1, 'Compte test', 'SGCI', 'CI0010010000000099', 'XOF', true)`, [m.ci]);
    const c = (await one(db, `insert into gbs.comptes_bancaires (societe_id, libelle, banque, numero, devise) values ($1, 'Compte test', 'SGCI', 'CI0010010000000099', 'XOF') returning id`, [m.ci])).id;
    await db.query(`select gbs.designer_compte_encaissement($1, true)`, [c]);
    expect((await one(db, `select encaissement_clients e from gbs.comptes_bancaires where id = $1`, [c])).e).toBe(true);
  }));
});
