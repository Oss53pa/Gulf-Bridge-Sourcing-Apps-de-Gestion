// Stock de pièces et réclamations de garantie (après-vente).
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

async function article(db: Db, m: Monde, ref = 'PR-CF-CMP') {
  await as(db, m.hub);
  return (await one(db, `select gbs.creer_article_stock($1) id`, [JSON.stringify({ reference: ref, designation: 'Compresseur groupe froid 3 kW', seuil: 1 })])).id as string;
}

describe('Stock de pièces', () => {
  it('quantité par mouvements seulement ; coût moyen pondéré ; sortie au-delà du stock refusée', () => withTx(async (db) => {
    const m = await monde(db);
    const a = await article(db, m);
    await db.query(`select gbs.mouvement_stock($1, 'entree', 2, 'Réassort usine', 600000)`, [a]);
    await db.query(`select gbs.mouvement_stock($1, 'entree', 1, 'Réassort express', 720000)`, [a]);
    expect(await one(db, `select quantite::int q, cout_unitaire_xof::int c from gbs.stock_articles where id = $1`, [a])).toEqual({ q: 3, c: 640000 });
    await expectError(db, 'GBS_STOCK_INSUFFISANT', `select gbs.mouvement_stock($1, 'sortie', 4, 'Intervention')`, [a]);
    await db.query(`select gbs.mouvement_stock($1, 'sortie', 2, 'Intervention INT-1')`, [a]);
    expect((await one(db, `select quantite::int q from gbs.stock_articles where id = $1`, [a])).q).toBe(1);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.mouvement_stock($1, 'entree', 1, 'Sans coût')`, [a]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.mouvement_stock($1, 'sortie', 0, 'Zéro')`, [a]);
    await expectError(db, 'GBS_REFERENCE_EXISTANTE', `select gbs.creer_article_stock($1)`, [JSON.stringify({ reference: 'PR-CF-CMP', designation: 'Doublon' })]);
    for (const p of [{ reference: 'pr cf', designation: 'X1' }, { designation: 'Sans référence' }, { reference: 'PR-OK', designation: 'Y', prix: 3 }]) {
      await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.creer_article_stock($1)`, [JSON.stringify(p)]);
    }
  }));

  it('droits : écriture admin et Hub Afrique ; aucune écriture directe ni suppression ; journalisé', () => withTx(async (db) => {
    const m = await monde(db);
    const a = await article(db, m);
    for (const u of [m.achats, m.comptable, m.inspecteur, m.agentGA]) {
      await as(db, u);
      await expectError(db, '42501', `select gbs.mouvement_stock($1, 'entree', 1, 'Essai', 10)`, [a]);
    }
    await as(db, m.comptable);
    expect(await rows(db, `select id from gbs.stock_articles`)).toEqual([]);
    await as(db, m.hub);
    await expectError(db, '42501', `update gbs.stock_articles set quantite = 99 where id = $1`, [a]);
    await asRoot(db);
    await expectError(db, 'GBS_VALIDATION_RPC', `update gbs.stock_articles set quantite = 99 where id = $1`, [a]);
    await expectError(db, 'GBS_SUPPRESSION_INTERDITE', `delete from gbs.stock_articles where id = $1`, [a]);
    expect(Number((await one(db, `select count(*) n from gbs.journal_audit where table_nom = 'stock_articles'`)).n)).toBeGreaterThan(0);
  }));
});

describe('Réclamations de garantie', () => {
  it('déclaration numérotée ; recours ; pièce réservée par sortie de stock ; clôture signée puis figée', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const a = await article(db, m);
    await db.query(`select gbs.mouvement_stock($1, 'entree', 1, 'Stock initial', 640000)`, [a]);
    await as(db, m.hub);
    const r = (await one(db, `select gbs.declarer_reclamation($1) id`, [JSON.stringify({ dossier_id: d, equipement: 'Chambre froide n° 2',
      defaut: 'Compresseur à l’arrêt', urgent: true, fin_garantie: '2027-09-30' })])).id;
    expect((await one(db, `select reference from gbs.reclamations_sav where id = $1`, [r])).reference).toMatch(/^SAV-\d{4}-001$/);
    // Recours : ouvert par les achats, refus motivé.
    await as(db, m.achats);
    await db.query(`select gbs.recours_reclamation($1, 'ouvert')`, [r]);
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', `select gbs.recours_reclamation($1, 'refuse')`, [r]);
    await as(db, m.hub);
    await expectError(db, 'GBS_RECOURS_OUVERT', `select gbs.cloturer_reclamation($1, 'M. Nzé', $2)`, [r, `${d}/00000000-0000-4000-8000-000000000001.pdf`]);
    await as(db, m.achats);
    await db.query(`select gbs.recours_reclamation($1, 'accepte')`, [r]);
    await expectError(db, '42501', `select gbs.reserver_piece_reclamation($1, $2)`, [r, a]);
    await as(db, m.hub);
    await db.query(`select gbs.reserver_piece_reclamation($1, $2)`, [r, a]);
    await expectError(db, 'GBS_PIECE_DEJA_RESERVEE', `select gbs.reserver_piece_reclamation($1, $2)`, [r, a]);
    expect((await one(db, `select quantite::int q from gbs.stock_articles where id = $1`, [a])).q).toBe(0);
    expect((await one(db, `select reclamation_id from gbs.stock_mouvements where article_id = $1 and sens = 'sortie'`, [a])).reclamation_id).toBe(r);
    // Deuxième réclamation : plus de stock.
    const r2 = (await one(db, `select gbs.declarer_reclamation($1) id`, [JSON.stringify({ dossier_id: d, equipement: 'Chambre froide n° 3', defaut: 'Même panne' })])).id;
    await expectError(db, 'GBS_STOCK_INSUFFISANT', `select gbs.reserver_piece_reclamation($1, $2)`, [r2, a]);
    // Clôture : document du dossier exigé.
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.cloturer_reclamation($1, 'M. Nzé', 'autre/chemin.pdf')`, [r]);
    const doc = `${d}/${'00000000-0000-4000-8000-000000000001'}.pdf`;
    await db.query(`select gbs.cloturer_reclamation($1, 'M. Nzé', $2)`, [r, doc]);
    await expectError(db, 'GBS_RECLAMATION_CLOSE', `select gbs.lier_intervention_reclamation($1, $2)`, [r, r2]);
  }));

  it('entrées strictes ; lecture limitée aux rôles et dossiers ; aucune écriture directe', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.hub);
    for (const p of [{ dossier_id: d, equipement: 'X', defaut: 'Panne' }, { dossier_id: d, equipement: 'Lit', defaut: 'Panne', urgent: 'oui' },
      { dossier_id: d, equipement: 'Lit', defaut: 'Panne', admin: true }, { dossier_id: d, equipement: 'Lit', defaut: 'Panne', fin_garantie: 'bientôt' },
      { equipement: 'Lit', defaut: 'Panne' }]) {
      await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.declarer_reclamation($1)`, [JSON.stringify(p)]);
    }
    const r = (await one(db, `select gbs.declarer_reclamation($1) id`, [JSON.stringify({ dossier_id: d, equipement: 'Lit médicalisé n° 18', defaut: 'Vérin bloqué' })])).id;
    for (const u of [m.comptable, m.inspecteur]) {
      await as(db, u);
      expect(await rows(db, `select id from gbs.reclamations_sav`)).toEqual([]);
      await expectError(db, '42501', `select gbs.declarer_reclamation($1)`, [JSON.stringify({ dossier_id: d, equipement: 'Lit', defaut: 'Panne' })]);
    }
    await as(db, m.hub);
    await expectError(db, '42501', `update gbs.reclamations_sav set statut = 'cloturee' where id = $1`, [r]);
    await asRoot(db);
    await expectError(db, 'GBS_VALIDATION_RPC', `update gbs.reclamations_sav set urgent = true where id = $1`, [r]);
    await expectError(db, 'GBS_SUPPRESSION_INTERDITE', `delete from gbs.reclamations_sav where id = $1`, [r]);
  }));
});
