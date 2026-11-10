// Guide d'expression du besoin relié au dossier (migration 76) : la validation renseigne la pièce
// « Cahier des charges du client validé et signé » ; un besoin soumis devient une tâche à relire.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, monde, one, rows, withTx, type Db } from './helpers';

afterAll(closePool);

const COMPLET = { usage: 'Lingerie de 120 chambres', quantites: '6 lave-linge 40 kg', tension: '230 V', normes: 'CE',
  budget: '60 M FCFA', delai: '2027-03-01', lieu_livraison: 'Port d’Abidjan' };

async function preparer(db: Db) {
  const m = await monde(db);
  const d = await dossier(db, m, { extra: { pays: 'CI', chef_id: null } });
  await asRoot(db);
  await db.query(`update gbs.dossiers set chef_id = $2 where id = $1`, [d, m.hub]);
  await as(db, m.admin);
  await db.query(`select gbs.activer_questionnaire_besoin(id) from gbs.questionnaires_besoin where categorie = 'tronc_commun'`);
  await as(db, m.hub);
  const b = (await one(db, `select gbs.creer_besoin($1, 'tronc_commun') id`, [d])).id as string;
  await db.query(`select gbs.enregistrer_besoin($1, $2)`, [b, COMPLET]);
  return { m, d, b };
}
const taches = (db: Db) => rows(db, `select nature, libelle, urgence from gbs.mes_taches() where nature = 'besoin'`);

describe('Besoin relié au dossier', () => {
  it('un besoin soumis est une tâche du chef de dossier, jusqu’à sa validation', () => withTx(async (db) => {
    const { m, b } = await preparer(db);
    expect(await taches(db)).toEqual([]);
    await db.query(`select gbs.soumettre_besoin($1)`, [b]);
    expect(await taches(db)).toEqual([{ nature: 'besoin', libelle: 'tronc_commun', urgence: 2 }]);
    await as(db, m.achats);
    expect(await taches(db)).toEqual([]);
    await as(db, m.admin);
    expect((await rows(db, `select responsable from gbs.taches_equipe() where nature = 'besoin'`)).map((x) => x.responsable)).toEqual(['Awa Toure']);
    await as(db, m.hub);
    await db.query(`select gbs.valider_besoin($1, 'besoins/cdc-signe.pdf', current_date)`, [b]);
    expect(await taches(db)).toEqual([]);
  }));

  it('la validation renseigne la pièce exigée de la consultation, sans écraser une pièce déjà validée', () => withTx(async (db) => {
    const { m, d, b } = await preparer(db);
    await db.query(`select gbs.soumettre_besoin($1)`, [b]);
    await db.query(`select gbs.valider_besoin($1, 'besoins/cdc-signe.pdf', current_date)`, [b]);
    expect(await one(db, `select statut, document_chemin, statut_par = $2 par from gbs.pieces where dossier_id = $1 and code = 'client_cdc_signe'`, [d, m.hub]))
      .toEqual({ statut: 'validee', document_chemin: 'besoins/cdc-signe.pdf', par: true });
  }));

  it('pièce déjà validée : conservée', () => withTx(async (db) => {
    const { m, d, b } = await preparer(db);
    const p = (await one(db, `select id from gbs.pieces where dossier_id = $1 and code = 'client_cdc_signe'`, [d])).id;
    await db.query(`select gbs.deposer_piece($1, 'x/ancien.pdf', null)`, [p]);
    await db.query(`select gbs.statuer_piece($1, 'validee')`, [p]);
    await db.query(`select gbs.soumettre_besoin($1)`, [b]);
    await db.query(`select gbs.valider_besoin($1, 'besoins/cdc-signe.pdf', current_date)`, [b]);
    expect((await one(db, `select document_chemin from gbs.pieces where id = $1`, [p])).document_chemin).toBe('x/ancien.pdf');
    expect(m).toBeTruthy();
  }));
});
