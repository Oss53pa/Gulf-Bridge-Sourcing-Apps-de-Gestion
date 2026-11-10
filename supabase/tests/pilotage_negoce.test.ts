// Pilotage du négoce : conditions, marge, acomptes, couverture du risque, droits.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, commande, dossier, expectError, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

async function negoce(db: Db, m: Monde) {
  await asRoot(db);
  await db.query(`select set_config('gbs.rpc', 'systeme', true)`);
  await db.query(`update gbs.clients set verification_statut = 'verifie', verification_date = current_date where id = $1`, [m.clientCI]);
  await db.query(`select set_config('gbs.rpc', '', true)`);
  // Taux USD (600) et CNY (84) posés par monde().
  return dossier(db, m, { societe: m.cn, modele: 'negoce', extra: { ouvert_le: new Date().toISOString().slice(0, 10) } });
}

describe('Pilotage du négoce', () => {
  it('marge sur prix convenu ; choc de change ; taux manquant → pas de marge ; couverture du risque', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await negoce(db, m);
    await commande(db, m, d, [{ qte: 100, pu: 1000 }]);
    const fob = Number((await one(db, `select fob_montant from gbs.commandes where dossier_id = $1`, [d])).fob_montant);
    await as(db, m.admin);
    let r = (await rows(db, `select prix_vente_xof, marge_xof from gbs.pilotage_negoce() where dossier_id = $1`, [d]))[0];
    expect(r).toEqual({ prix_vente_xof: null, marge_xof: null });
    await db.query(`select gbs.definir_conditions_negoce($1, $2)`, [d, JSON.stringify({ prix_vente_ht: fob * 600 * 1.25, clause_revision: true, seuil_revision: 0.03 })]);
    r = (await rows(db, `select prix_vente_xof::numeric p, achats_xof::numeric a, marge_xof::numeric mg, taux_marge::numeric t, marge_min::numeric mm, clause_revision c, garantie_restitution g
      from gbs.pilotage_negoce() where dossier_id = $1`, [d]))[0];
    expect(Number(r.a)).toBe(fob * 600);
    expect(Number(r.t)).toBeCloseTo(0.2, 4);
    expect(r).toMatchObject({ c: true, g: false });
    expect(Number(r.mm)).toBe(0.15);
    // Les commandes sont en USD : un choc sur le CNY ne change rien.
    expect(Number((await one(db, `select achats_xof from gbs.pilotage_negoce(0.1) where dossier_id = $1`, [d])).achats_xof)).toBe(fob * 600);
    expect((await one(db, `select taux_manquant from gbs.pilotage_negoce() where dossier_id = $1`, [d])).taux_manquant).toBe(false);
  }));


  it('entrées strictes ; dossier en négoce seulement ; droits ; aucune écriture directe ni suppression', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await negoce(db, m);
    const autre = await dossier(db, m);
    await as(db, m.admin);
    for (const [dos, p] of [[d, { prix_vente_ht: -1 }], [d, { prix_vente_ht: 10, devise: 'CNY' }], [d, { prix_vente_ht: 10, clause_revision: true }],
      [d, { prix_vente_ht: '10' }], [d, { prix_vente_ht: 10, marge: 1 }], [autre, { prix_vente_ht: 10 }]] as [string, Record<string, unknown>][]) {
      await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.definir_conditions_negoce($1, $2)`, [dos, JSON.stringify(p)]);
    }
    await db.query(`select gbs.definir_conditions_negoce($1, '{"prix_vente_ht": 1000000}')`, [d]);
    for (const u of [m.hub, m.inspecteur, m.agentGA]) {
      await as(db, u);
      await expectError(db, '42501', `select * from gbs.pilotage_negoce()`);
      expect(await rows(db, `select dossier_id from gbs.negoce_conditions`)).toEqual([]);
    }
    await as(db, m.achats);
    expect((await rows(db, `select dossier_id from gbs.pilotage_negoce()`)).map((x) => x.dossier_id)).toContain(d);
    await expectError(db, '42501', `select gbs.definir_conditions_negoce($1, '{"prix_vente_ht": 1}')`, [d]);
    await asRoot(db);
    await expectError(db, 'GBS_VALIDATION_RPC', `update gbs.negoce_conditions set prix_vente_ht = 1 where dossier_id = $1`, [d]);
    await expectError(db, 'GBS_SUPPRESSION_INTERDITE', `delete from gbs.negoce_conditions where dossier_id = $1`, [d]);
  }));
});
