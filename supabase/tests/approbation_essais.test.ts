// Lot 1, M26 : approbation technique et essais en usine.
import { afterAll, describe, expect, it } from 'vitest';
import { as, closePool, commande, contratSigne, dossier, expectError, mandatSigne, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

const fichier = (d: string, n: number, ext = 'pdf') => `${d}/${String(n).padStart(8, '0')}-1111-4222-8333-444455556666.${ext}`;

async function preparer(db: Db, m: Monde) {
  const d = await dossier(db, m);
  const c = await commande(db, m, d, [{ qte: 1, pu: 50_000, sur_mesure: true }]);
  await mandatSigne(db, m, d);
  await contratSigne(db, m, c);
  return { d, c };
}
const version = async (db: Db, m: Monde, c: string, d: string, extra: { essais?: boolean; echantillon?: boolean } = {}) => {
  await as(db, m.achats);
  return (await one(db, `insert into gbs.approbations_techniques (commande_id, objet, documents, essais_requis, echantillon, echantillon_description)
    values ($1, 'Plans et fiche technique du groupe froid', $2, $3, $4, $5) returning id`,
    [c, [fichier(d, 1)], extra.essais ?? false, extra.echantillon ?? false, extra.echantillon ? 'Panneau isolant 100 mm' : null])).id as string;
};
const decider = (db: Db, id: string, d: string, decision = 'approuvee', commentaire: string | null = null) =>
  db.query(`select gbs.enregistrer_decision_approbation($1, $2, 'M. Ndong, directeur technique', $3, current_date, $4)`, [id, decision, fichier(d, 9), commentaire]);
const approuvee = async (db: Db, c: string) => (await one(db, `select approbation_valide_le is not null a from gbs.commandes where id = $1`, [c])).a;

describe('Approbation technique (M26)', () => {
  it('soumise puis approuvée avec le document signé : la commande sur mesure est approuvée ; saisie directe fermée', () => withTx(async (db) => {
    const m = await monde(db);
    const { d, c } = await preparer(db, m);
    await as(db, m.achats);
    await expectError(db, 'GBS_APPROBATION_CIRCUIT', `select gbs.valider_approbation($1, 'accord.pdf')`, [c]);
    const v1 = await version(db, m, c, d);
    await expectError(db, 'GBS_APPROBATION_EN_COURS', `insert into gbs.approbations_techniques (commande_id, objet) values ($1, 'Doublon')`, [c]);
    await expectError(db, 'GBS_APPROBATION_STATUT', `select gbs.enregistrer_decision_approbation($1, 'approuvee', 'M. Ndong', $2, current_date)`, [v1, fichier(d, 9)]);
    await db.query(`select gbs.soumettre_approbation($1)`, [v1]);
    await expectError(db, 'GBS_APPROBATION_FIGEE', `update gbs.approbations_techniques set objet = 'Autre' where id = $1`, [v1]);
    await expectError(db, '42501', `update gbs.approbations_techniques set statut = 'approuvee' where id = $1`, [v1]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.enregistrer_decision_approbation($1, 'approuvee', 'M. Ndong', '../x.pdf', current_date)`, [v1]);
    await decider(db, v1, d);
    expect(await approuvee(db, c)).toBe(true);
  }));

  it('refus motivé, nouvelle version ; une nouvelle version avant la production annule l’approbation acquise', () => withTx(async (db) => {
    const m = await monde(db);
    const { d, c } = await preparer(db, m);
    const v1 = await version(db, m, c, d);
    await db.query(`select gbs.soumettre_approbation($1)`, [v1]);
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', `select gbs.enregistrer_decision_approbation($1, 'refusee', 'M. Ndong', $2, current_date)`, [v1, fichier(d, 9)]);
    await decider(db, v1, d, 'refusee', 'Puissance frigorifique insuffisante');
    expect(await approuvee(db, c)).toBe(false);
    const v2 = await version(db, m, c, d);
    await db.query(`select gbs.soumettre_approbation($1)`, [v2]);
    await decider(db, v2, d);
    expect(await approuvee(db, c)).toBe(true);
    const v3 = await version(db, m, c, d);
    expect((await one(db, `select version from gbs.approbations_techniques where id = $1`, [v3])).version).toBe(3);
    await db.query(`select gbs.soumettre_approbation($1)`, [v3]);
    expect(await approuvee(db, c)).toBe(false);
    await decider(db, v3, d);
    const s = await rows(db, `select version, statut from gbs.approbations_techniques where commande_id = $1 order by version`, [c]);
    expect(s.map((x) => x.statut)).toEqual(['refusee', 'remplacee', 'approuvee']);
  }));

  it('l’échantillon de référence approuvé devient la base de l’inspection ; l’inspecteur le consulte', () => withTx(async (db) => {
    const m = await monde(db);
    const { d, c } = await preparer(db, m);
    const v = await version(db, m, c, d, { echantillon: true });
    await db.query(`select gbs.soumettre_approbation($1)`, [v]);
    await decider(db, v, d);
    await as(db, m.achats);
    const i = (await one(db, `insert into gbs.inspections (commande_id, type, inspecteur_id, taille_lot) values ($1, 'en_production', $2, 10) returning approbation_id`,
      [c, m.inspecteur])).approbation_id;
    expect(i).toBe(v);
    await as(db, m.inspecteur);
    expect((await rows(db, `select echantillon_description from gbs.approbations_techniques`)).map((x) => x.echantillon_description)).toEqual(['Panneau isolant 100 mm']);
    await as(db, m.hub);
    expect(await rows(db, `select id from gbs.approbations_techniques`)).toEqual([]);
  }));
});

describe('Essais en usine (M26)', () => {
  it('essais exigés : pas de libération du lot sans procès-verbal conforme et validé', () => withTx(async (db) => {
    const m = await monde(db);
    const { d, c } = await preparer(db, m);
    const v = await version(db, m, c, d, { essais: true });
    await db.query(`select gbs.soumettre_approbation($1)`, [v]);
    await decider(db, v, d);
    await as(db, m.achats);
    const i = (await one(db, `insert into gbs.inspections (commande_id, type, inspecteur_id, taille_lot) values ($1, 'avant_expedition', $2, 10) returning id`,
      [c, m.inspecteur])).id;
    await db.query(`update gbs.inspections set statut = 'realisee', date_realisee = current_date where id = $1`, [i]);
    await as(db, m.admin);
    await expectError(db, 'GBS_ESSAIS_MANQUANTS', `select gbs.valider_inspection($1, 'liberation')`, [i]);
    await as(db, m.achats);
    await expectError(db, 'GBS_RESULTATS_INVALIDES', `insert into gbs.essais_usine (commande_id, date_essai, protocole, resultats) values ($1, current_date, 'Essai en charge 4 h', $2)`,
      [c, JSON.stringify([{ critere: 'Température', conforme: 'oui' }])]);
    const e = (await one(db, `insert into gbs.essais_usine (commande_id, date_essai, protocole, resultats) values ($1, current_date, 'Essai en charge 4 h', $2) returning id, conforme`,
      [c, JSON.stringify([{ critere: 'Température à -18 °C en 2 h', attendu: '≤ 2 h', mesure: '2 h 20', conforme: false },
                           { critere: 'Consommation', attendu: '≤ 3,2 kW', mesure: '3,1 kW', conforme: true }])]));
    expect(e.conforme).toBe(false);
    await as(db, m.admin);
    await expectError(db, 'GBS_PV_INCOMPLET', `select gbs.valider_essai($1)`, [e.id]);
    await as(db, m.achats);
    await db.query(`update gbs.essais_usine set pv_document = $2 where id = $1`, [e.id, fichier(d, 5)]);
    await as(db, m.admin);
    await db.query(`select gbs.valider_essai($1)`, [e.id]);
    await expectError(db, 'GBS_ESSAIS_MANQUANTS', `select gbs.valider_inspection($1, 'liberation')`, [i]);
    // Second essai après réglage : conforme.
    await as(db, m.achats);
    const e2 = (await one(db, `insert into gbs.essais_usine (commande_id, date_essai, protocole, resultats, pv_document) values ($1, current_date, 'Essai en charge 4 h après réglage', $2, $3) returning id`,
      [c, JSON.stringify([{ critere: 'Température à -18 °C en 2 h', attendu: '≤ 2 h', mesure: '1 h 50', conforme: true }]), fichier(d, 6)])).id;
    await as(db, m.admin);
    await db.query(`select gbs.valider_essai($1)`, [e2]);
    await expectError(db, 'GBS_DOCUMENT_VALIDE', `update gbs.essais_usine set lieu = 'Foshan' where id = $1`, [e2]);
    await db.query(`select gbs.valider_inspection($1, 'liberation')`, [i]);
  }));
});
