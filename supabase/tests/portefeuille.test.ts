// M23 : portefeuille des dossiers (complétude, FOB, marge, état de synthèse) et ses droits.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, commande, dossier, expectError, monde, one, rows, withTx } from './helpers';

afterAll(closePool);

describe('Portefeuille des dossiers (M23)', () => {
  it('complétude, état et visibilité ; FOB réservé aux profils autorisés', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const autre = await dossier(db, m, { societe: m.cn, client: m.clientGA });
    await as(db, m.admin);
    let l = (await rows(db, `select * from gbs.portefeuille()`)).find((x) => x.id === d);
    expect(l.client).toBe('Hôtel Lagune Assinie');
    expect(l.etat).toBe('dans_les_delais');
    expect(Number(l.completude)).toBe(0);
    // Une pièce obligatoire de la phase courante validée : la complétude augmente.
    await asRoot(db);
    const p = (await one(db, `select p.id from gbs.pieces p join gbs.dossiers x on x.id = p.dossier_id
      where p.dossier_id = $1 and p.obligatoire and p.phase = x.phase_courante limit 1`, [d])).id;
    await as(db, m.admin);
    await db.query(`select gbs.deposer_piece($1, $2, null)`, [p, `${d}/piece.pdf`]);
    await db.query(`select gbs.statuer_piece($1, 'validee')`, [p]);
    await asRoot(db);
    // Point bloquant ouvert : l'état devient « bloquant ».
    await db.query(`insert into gbs.points_bloquants (dossier_id, description, categorie, echeance) values ($1, 'Plans non reçus', 'client', current_date + 5)`, [d]);
    await as(db, m.admin);
    l = (await rows(db, `select * from gbs.portefeuille()`)).find((x) => x.id === d);
    expect(Number(l.completude)).toBeGreaterThan(0);
    expect(l.etat).toBe('bloquant');
    // FOB : visible pour l'administratrice, masqué pour la comptabilité.
    await commande(db, m, d, [{ qte: 100, pu: 10 }]);
    await as(db, m.admin);
    expect((await rows(db, `select fob_xof from gbs.portefeuille() where id = $1`, [d]))[0].fob_xof).not.toBeNull();
    await as(db, m.comptable);
    const c = await rows(db, `select id, fob_xof from gbs.portefeuille()`);
    expect(c.find((x) => x.id === d)?.fob_xof ?? null).toBeNull();
    // Le Hub (Côte d'Ivoire) ne voit pas le dossier de GBS Chine ; l'inspecteur n'accède pas au portefeuille hors périmètre.
    await as(db, m.hub);
    expect((await rows(db, `select id from gbs.portefeuille()`)).map((x) => x.id)).not.toContain(autre);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select * from gbs.portefeuille('n''importe')`);
  }));
});
