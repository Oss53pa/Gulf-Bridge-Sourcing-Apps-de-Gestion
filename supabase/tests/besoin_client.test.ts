// Guide d'expression du besoin ouvert au client (migration 75) : le client remplit, soumet et répond
// aux questions sur ses dossiers ; sous-rôle finance et autres clients exclus ; validation interne.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

async function compte(db: Db, m: Monde, client: string, sousRole: string) {
  await asRoot(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${id}@client.test`, { nom: `Client ${sousRole}`, app: 'gbs' }]);
  await as(db, m.admin);
  await db.query(`select gbs.admin_compte_client($1, $2, $3)`, [id, client, sousRole]);
  return id;
}

async function preparer(db: Db) {
  const m = await monde(db);
  const d = await dossier(db, m, { extra: { pays: 'CI' } });
  await as(db, m.admin);
  await db.query(`select gbs.activer_questionnaire_besoin(id) from gbs.questionnaires_besoin where categorie = 'tronc_commun'`);
  await as(db, m.hub);
  const b = (await one(db, `select gbs.creer_besoin($1, 'tronc_commun') id`, [d])).id as string;
  const demandeur = await compte(db, m, m.clientCI, 'demandeur');
  return { m, d, b, demandeur };
}
const COMPLET = { usage: 'Lingerie de 120 chambres', quantites: '6 lave-linge 40 kg', tension: '230 V', normes: 'CE',
  budget: '60 M FCFA', delai: '2027-03-01', lieu_livraison: 'Port d’Abidjan' };

describe('Besoin ouvert au client', () => {
  it('le client remplit, voit l’état, répond aux questions et soumet ; la validation reste interne', () => withTx(async (db) => {
    const { m, d, b, demandeur } = await preparer(db);
    await as(db, demandeur);
    expect((await one(db, `select gbs.besoins_client($1) l`, [d])).l).toEqual([{ id: b, categorie: 'tronc_commun', statut: 'brouillon', version: 0, completude: 0, questions_ouvertes: 0 }]);
    const e = (await one(db, `select gbs.enregistrer_besoin($1, $2) e`, [b, { ...COMPLET, tension: '110 V' }])).e;
    expect(e.alertes.map((x: { code: string }) => x.code)).toEqual(['tension_pays']);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.enregistrer_besoin($1, '{"inconnu":"x"}')`, [b]);
    await as(db, m.hub);
    const q = (await one(db, `select gbs.poser_question_besoin($1, 'tension', 'Avez-vous du triphasé au local technique ?') id`, [b])).id;
    await as(db, demandeur);
    const det = (await one(db, `select gbs.besoin_detail($1) x`, [b])).x;
    expect(det.questions).toMatchObject([{ id: q, champ: 'tension', auteur: 'Awa Toure', reponse: null }]);
    expect(det.besoin.categorie_libelle).toBe('Tronc commun');
    await db.query(`select gbs.repondre_question_besoin($1, 'Oui, 400 V au local technique')`, [q]);
    await db.query(`select gbs.enregistrer_besoin($1, '{"tension":"400 V triphasé"}')`, [b]);
    expect((await one(db, `select gbs.soumettre_besoin($1) v`, [b])).v).toBe(1);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.valider_besoin($1, 'besoins/c.pdf', current_date)`, [b]);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.poser_question_besoin($1, 'usage', 'Question du client ?')`, [b]);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.creer_besoin($1, 'tronc_commun')`, [d]);
    // Aucune lecture directe des tables.
    expect((await one(db, `select count(*)::int n from gbs.besoins`)).n).toBe(0);
  }));

  it('sous-rôle finance, autre client, double facteur absent : refusés', () => withTx(async (db) => {
    const { m, d, b } = await preparer(db);
    const finance = await compte(db, m, m.clientCI, 'finance');
    const autre = await compte(db, m, m.clientGA, 'demandeur');
    for (const u of [finance, autre]) {
      await as(db, u);
      await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.besoin_detail($1)`, [b]);
      await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.besoins_client($1)`, [d]);
      await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.enregistrer_besoin($1, '{"usage":"Essai de saisie"}')`, [b]);
    }
    const technique = await compte(db, m, m.clientCI, 'technique');
    await as(db, technique, 'aal1');
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.enregistrer_besoin($1, '{"usage":"Essai de saisie"}')`, [b]);
    await as(db, technique);
    await db.query(`select gbs.enregistrer_besoin($1, '{"usage":"Essai de saisie"}')`, [b]);
  }));

  it('dossier annulé : le client n’y accède plus', () => withTx(async (db) => {
    const { d, b, demandeur } = await preparer(db);
    await asRoot(db);
    await db.query(`alter table gbs.dossiers disable trigger user`);
    await db.query(`update gbs.dossiers set statut = 'annule' where id = $1`, [d]);
    await db.query(`alter table gbs.dossiers enable trigger user`);
    await as(db, demandeur);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.besoin_detail($1)`, [b]);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.enregistrer_besoin($1, '{"usage":"Essai de saisie"}')`, [b]);
  }));
});
