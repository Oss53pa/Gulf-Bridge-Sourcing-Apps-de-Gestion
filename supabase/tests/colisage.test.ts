// Liste de colisage déclarée par le fournisseur, validée par les achats.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, commande, contratSigne, dossier, expectError, fournisseurAgree, mandatSigne, monde, one, rows, withTx, type Db } from './helpers';

afterAll(closePool);

async function compte(db: Db, nom: string) {
  await asRoot(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${nom}@usine.test`, { nom, app: 'gbs' }]);
  return id;
}
const enProduction = async (db: Db, ids: string[]) => {
  await asRoot(db);
  await db.query(`select set_config('gbs.rpc', 'changer_statut_commande', true)`);
  await db.query(`update gbs.commandes set statut = 'en_production' where id = any($1)`, [ids]);
  await db.query(`select set_config('gbs.rpc', '', true)`);
};
const ok = { caisses: 11, poids_brut_kg: 9840, volume_m3: 58.4, remarque: '6 caisses machines, 5 caisses accessoires' };

describe('Colisage fournisseur', () => {
  it('fournisseur de la commande en production ; vraisemblance ; remplacement ; validation figée', () => withTx(async (db) => {
    const m = await monde(db);
    const autre = await fournisseurAgree(db, m, 'Ningbo Brightlux');
    const d = await dossier(db, m);
    const c = await commande(db, m, d, [{ qte: 6, pu: 23000 }]);
    const c2 = await commande(db, m, d, [{ qte: 2, pu: 99 }], { fournisseur: autre });
    const c3 = await commande(db, m, d, [{ qte: 1, pu: 50 }]);
    await mandatSigne(db, m, d);
    for (const x of [c, c2, c3]) await contratSigne(db, m, x);
    await enProduction(db, [c, c2]);
    const u = await compte(db, 'sun');
    await as(db, m.achats);
    await db.query(`select gbs.admin_compte_fournisseur($1, $2, 'logistique')`, [u, m.fournisseur]);

    await as(db, u, 'aal1');
    await expectError(db, '42501', `select gbs.declarer_colisage($1, $2)`, [c, ok]);
    await as(db, u);
    await expectError(db, '42501', `select gbs.declarer_colisage($1, $2)`, [c2, ok]);
    await expectError(db, '42501', `select gbs.declarer_colisage($1, $2)`, [c3, ok]); // contrat signé, pas encore en production
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.declarer_colisage($1, $2)`, [c, { ...ok, poids_brut_kg: 98400000 }]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.declarer_colisage($1, $2)`, [c, { ...ok, volume_m3: 5840 }]); // 1,7 kg/m3
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.declarer_colisage($1, $2)`, [c, { ...ok, caisses: '11' }]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.declarer_colisage($1, $2)`, [c, { ...ok, statut: 'validee' }]);
    await db.query(`select gbs.declarer_colisage($1, $2)`, [c, { ...ok, caisses: 10 }]);
    const v2 = (await one(db, `select gbs.declarer_colisage($1, $2) r`, [c, ok])).r;
    expect((await one(db, `select gbs.mes_colisages() v`)).v).toEqual([expect.objectContaining({ caisses: 11, statut: 'declaree' })]);
    await expectError(db, '42501', `select gbs.traiter_colisage($1, true)`, [v2]);

    await as(db, m.achats);
    expect((await rows(db, `select statut from gbs.colisages where commande_id = $1 order by cree_le`, [c])).map((x) => x.statut)).toEqual(['remplacee', 'declaree']);
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', `select gbs.traiter_colisage($1, false)`, [v2]);
    await db.query(`select gbs.traiter_colisage($1, true)`, [v2]);
    await expectError(db, 'GBS_DEMANDE_TRAITEE', `select gbs.traiter_colisage($1, false, 'Trop tard pour refuser')`, [v2]);
    await as(db, u);
    await expectError(db, 'GBS_COLISAGE_VALIDE', `select gbs.declarer_colisage($1, $2)`, [c, ok]);
  }));
});
