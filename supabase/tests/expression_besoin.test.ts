// Guide d'expression du besoin (migration 74) : référentiel versionné, réponses validées en base,
// complétude et champs critiques, cohérence avec le réseau électrique du pays, versions, questions, validation.
import { afterAll, describe, expect, it } from 'vitest';
import { as, closePool, dossier, expectError, monde, one, rows, withTx, type Db } from './helpers';

afterAll(closePool);

const BUANDERIE = [{ code: 'quantites', libelle: 'Quantités et dimensions', champs: [
  { cle: 'capacite_kg', libelle: 'Capacité par machine', type: 'nombre', unite: 'kg', min: 5, max: 300, critique: true }] },
  { code: 'eau', libelle: 'Eau et vapeur', champs: [{ cle: 'eau_chaude', libelle: 'Eau chaude disponible', type: 'oui_non' }] }];

async function preparer(db: Db) {
  const m = await monde(db);
  const d = await dossier(db, m, { extra: { pays: 'CI' } });
  await as(db, m.admin);
  const tronc = (await one(db, `select id from gbs.questionnaires_besoin where categorie = 'tronc_commun'`)).id;
  await db.query(`select gbs.activer_questionnaire_besoin($1)`, [tronc]);
  const q = (await one(db, `select gbs.enregistrer_questionnaire_besoin('buanderie', 'Buanderie hôtelière', $1) id`, [JSON.stringify(BUANDERIE)])).id;
  await db.query(`select gbs.activer_questionnaire_besoin($1)`, [q]);
  await as(db, m.hub);
  const b = (await one(db, `select gbs.creer_besoin($1, 'buanderie') id`, [d])).id as string;
  return { m, d, b };
}
const enregistrer = (db: Db, b: string, r: unknown) => one(db, `select gbs.enregistrer_besoin($1, $2) e`, [b, r]).then((x) => x.e);
const COMPLET = { usage: 'Lingerie d’un hôtel de 120 chambres', quantites: '6 lave-linge 40 kg', normes: 'CE, IEC 60335',
  budget: '60 à 80 M FCFA', delai: '2027-03-01', lieu_livraison: 'Port d’Abidjan', capacite_kg: 40 };

describe('Guide d’expression du besoin', () => {
  it('fusionne tronc commun et catégorie ; complétude et champs critiques calculés en base', () => withTx(async (db) => {
    const { b } = await preparer(db);
    const e0 = await one(db, `select gbs.etat_besoin($1) e`, [b]).then((x) => x.e);
    expect(e0.etapes_definition.map((x: { code: string }) => x.code)).toEqual(['usage', 'quantites', 'contraintes', 'normes', 'budget', 'garantie', 'pieces_jointes', 'eau']);
    expect(e0.critiques_manquants).toEqual(['usage', 'quantites', 'capacite_kg', 'tension', 'normes', 'budget', 'delai', 'lieu_livraison']);
    const e1 = await enregistrer(db, b, { usage: 'Lingerie', capacite_kg: 40 });
    expect(e1.completude).toBe(Math.round((100 * 2) / 21));
    expect(e1.etapes.find((x: { code: string }) => x.code === 'quantites')).toEqual({ code: 'quantites', total: 4, remplis: 1 });
    // null efface une réponse
    expect((await enregistrer(db, b, { usage: null })).critiques_manquants).toContain('usage');
  }));

  it('refuse les réponses mal typées, hors options ou inconnues', () => withTx(async (db) => {
    const { b } = await preparer(db);
    for (const r of [{ capacite_kg: 400 }, { capacite_kg: '40' }, { tension: '240 V' }, { prises: ['C', 'C'] }, { inconnu: 'x' },
      { delai: '01/03/2027' }, { zone_cotiere: 'oui' }, { usage: 'x'.repeat(4001) }, { usage: '' }, {}]) {
      await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.enregistrer_besoin($1, $2)`, [b, r]);
    }
    await expectError(db, '42501', `update gbs.besoins set reponses = '{}' where id = $1`, [b]);
  }));

  it('soumission refusée tant qu’un champ critique manque ; tension incohérente signalée, pas bloquante', () => withTx(async (db) => {
    const { b } = await preparer(db);
    await enregistrer(db, b, COMPLET);
    await expectError(db, 'GBS_BESOIN_INCOMPLET', `select gbs.soumettre_besoin($1)`, [b]);
    const e = await enregistrer(db, b, { tension: '110 V', prises: ['C', 'G'], frequence: '60 Hz' });
    expect(e.critiques_manquants).toEqual([]);
    expect(e.alertes.map((a: { code: string }) => a.code)).toEqual(['tension_pays', 'frequence_pays', 'prises_pays']);
    expect(e.alertes[0]).toMatchObject({ champ: 'tension', pays: 'CI', attendu: [230, 400], confirme: false });
    expect((await enregistrer(db, b, { tension: '400 V triphasé', prises: ['E'], frequence: '50 Hz' })).alertes).toEqual([]);
    expect((await one(db, `select gbs.soumettre_besoin($1) v`, [b])).v).toBe(1);
    // Une modification ramène en brouillon ; la soumission suivante crée la version 2.
    await enregistrer(db, b, { garantie: '24 mois' });
    expect((await one(db, `select statut from gbs.besoins where id = $1`, [b])).statut).toBe('brouillon');
    expect((await one(db, `select gbs.soumettre_besoin($1) v`, [b])).v).toBe(2);
    expect(await rows(db, `select version, reponses ? 'garantie' g from gbs.besoins_versions where besoin_id = $1 order by version`, [b]))
      .toEqual([{ version: 1, g: false }, { version: 2, g: true }]);
  }));

  it('questions par champ, puis validation sur cahier des charges signé : le besoin est figé', () => withTx(async (db) => {
    const { m, b } = await preparer(db);
    await enregistrer(db, b, { ...COMPLET, tension: '230 V' });
    await db.query(`select gbs.soumettre_besoin($1)`, [b]);
    await as(db, m.achats);
    const q = (await one(db, `select gbs.poser_question_besoin($1, 'tension', 'Le groupe électrogène alimente-t-il la lingerie ?') id`, [b])).id;
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.poser_question_besoin($1, 'inconnu', 'Question ?')`, [b]);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.repondre_question_besoin($1, 'Oui')`, [q]);
    await as(db, m.hub);
    await expectError(db, 'GBS_QUESTIONS_OUVERTES', `select gbs.valider_besoin($1, 'besoins/cdc-signe.pdf', current_date)`, [b]);
    await db.query(`select gbs.repondre_question_besoin($1, 'Oui, 60 kVA')`, [q]);
    await expectError(db, 'GBS_DEMANDE_TRAITEE', `select gbs.repondre_question_besoin($1, 'Encore')`, [q]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.valider_besoin($1, '../x.pdf', current_date)`, [b]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.valider_besoin($1, 'besoins/c.pdf', current_date + 1)`, [b]);
    await db.query(`select gbs.valider_besoin($1, 'besoins/cdc-signe.pdf', current_date)`, [b]);
    await expectError(db, 'GBS_BESOIN_VALIDE', `select gbs.enregistrer_besoin($1, '{"garantie":"12 mois"}')`, [b]);
    await expectError(db, 'GBS_BESOIN_VALIDE', `select gbs.poser_question_besoin($1, 'tension', 'Encore une ?')`, [b]);
    await as(db, m.admin);
    expect((await one(db, `select count(*)::int n from gbs.journal_audit where action = 'besoin_valide'`)).n).toBe(1);
  }));

  it('référentiel réservé à l’administratrice, structure stricte, versions et besoin attaché à sa version', () => withTx(async (db) => {
    const { m, b } = await preparer(db);
    await as(db, m.hub);
    await expectError(db, 'GBS_VALIDATION_ADMIN', `select gbs.enregistrer_questionnaire_besoin('froid', 'Froid', $1)`, [JSON.stringify(BUANDERIE)]);
    await expectError(db, 'GBS_VALIDATION_ADMIN', `select gbs.enregistrer_pays_electricite('CI', '{"tensions":[230],"frequence":50,"prises":["C"],"confirme":true}')`);
    await as(db, m.admin);
    for (const e of [[], [{ code: 'x', libelle: 'Étape', champs: [] }],
      [{ code: 'ok', libelle: 'Étape', champs: [{ cle: 'a1', libelle: 'Champ', type: 'choix' }] }],               // choix sans options
      [{ code: 'ok', libelle: 'Étape', champs: [{ cle: 'a1', libelle: 'Champ', type: 'texte', script: '<b>' }] }],  // clé inconnue
      [{ code: 'ok', libelle: 'Étape', champs: [{ cle: 'usage', libelle: 'Champ', type: 'texte' }] }]]) {           // redéfinit le tronc
      await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.enregistrer_questionnaire_besoin('froid', 'Froid', $1)`, [JSON.stringify(e)]);
    }
    const v2 = (await one(db, `select gbs.enregistrer_questionnaire_besoin('buanderie', 'Buanderie hôtelière', $1) id`,
      [JSON.stringify([{ code: 'eau', libelle: 'Eau', champs: [{ cle: 'eau_dure', libelle: 'Eau calcaire', type: 'oui_non' }] }])])).id;
    await db.query(`select gbs.activer_questionnaire_besoin($1)`, [v2]);
    expect(await rows(db, `select version, statut from gbs.questionnaires_besoin where categorie = 'buanderie' order by version`))
      .toEqual([{ version: 1, statut: 'retire' }, { version: 2, statut: 'actif' }]);
    // Le besoin existant garde sa version : capacite_kg reste un champ connu.
    await as(db, m.hub);
    await enregistrer(db, b, { capacite_kg: 40 });
    await as(db, m.admin);
    await db.query(`select gbs.enregistrer_pays_electricite('CI', '{"tensions":[220,230,400],"frequence":50,"prises":["C","E"],"confirme":true,"source":"CIE"}')`);
    expect(await one(db, `select tensions, confirme from gbs.pays_electricite where pays = 'CI'`)).toEqual({ tensions: [220, 230, 400], confirme: true });
  }));

  it('droits : rédaction par le commercial du dossier ; un agent d’un autre pays ne voit rien', () => withTx(async (db) => {
    const { m, d, b } = await preparer(db);
    await expectError(db, 'GBS_BESOIN_EXISTANT', `select gbs.creer_besoin($1, 'buanderie')`, [d]);
    for (const u of [m.agentCM, m.inspecteur, m.comptable, m.achats]) {
      await as(db, u);
      await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.enregistrer_besoin($1, '{"usage":"x y z"}')`, [b]);
    }
    await as(db, m.agentCM);
    expect(await rows(db, `select id from gbs.besoins`)).toEqual([]);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.etat_besoin($1)`, [b]);
    await as(db, null);
    await expectError(db, '42501', `select gbs.etat_besoin($1)`, [b]);
  }));
});
