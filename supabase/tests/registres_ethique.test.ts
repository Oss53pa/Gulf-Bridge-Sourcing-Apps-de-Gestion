// Registres éthiques : déclarations, seuil des cadeaux, décision de l'administratrice, droits.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, expectError, monde, one, rows, withTx } from './helpers';

afterAll(closePool);
const hier = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

describe('Registres éthiques', () => {
  it('cadeau sous le seuil accepté d’office ; au-delà à décider par l’administratrice, motivé, puis figé', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.achats);
    const declarer = async (p: Record<string, unknown>) => (await one(db, `select gbs.declarer_ethique($1) id`, [JSON.stringify({ date_fait: hier(), tiers: 'Foshan Hengtai', description: 'Coffret de thé remis en visite', ...p })])).id as string;
    const a = await declarer({ type: 'cadeau', valeur: 380, devise: 'CNY' });
    const b = await declarer({ type: 'cadeau', valeur: 2400, devise: 'CNY' });
    const c = await declarer({ type: 'conflit_interets', description: 'Parent employé chez le fournisseur' });
    const x = await rows(db, `select reference, decision, declarant_id from gbs.declarations_ethique order by reference`);
    expect(x.map((y) => y.decision)).toEqual(['accepte', 'a_decider', 'a_decider']);
    expect(x[0].reference).toMatch(/^ETH-\d{4}-001$/);
    expect(x.every((y) => y.declarant_id === m.achats)).toBe(true);
    // 50 USD × 600 / 84 ≈ 357 CNY : sous le seuil de 500 CNY, accepté d'office.
    const dUsd = await declarer({ type: 'invitation', valeur: 50, devise: 'USD' });
    expect((await one(db, `select decision from gbs.declarations_ethique where id = $1`, [dUsd])).decision).toBe('accepte');
    await expectError(db, '42501', `select gbs.decider_ethique($1, 'refuse_restitue', 'Au-delà du seuil')`, [b]);
    await as(db, m.admin);
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', `select gbs.decider_ethique($1, 'refuse_restitue', '')`, [b]);
    await db.query(`select gbs.decider_ethique($1, 'refuse_restitue', 'Au-delà du seuil : restitué au fournisseur')`, [b]);
    await expectError(db, 'GBS_DECISION_RENDUE', `select gbs.decider_ethique($1, 'accepte', 'Changement d''avis')`, [b]);
    await expectError(db, 'GBS_DECISION_RENDUE', `select gbs.decider_ethique($1, 'refuse_restitue', 'Déjà accepté d''office')`, [a]);
    await db.query(`select gbs.decider_ethique($1, 'mise_a_ecart', 'Retiré du dossier concerné')`, [c]);
  }));

  it('l’administratrice ne tranche pas sa propre déclaration ; chacun voit les siennes ; entrées strictes ; aucune écriture directe', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.admin);
    const p = (await one(db, `select gbs.declarer_ethique($1) id`, [JSON.stringify({ date_fait: hier(), type: 'cadeau', tiers: 'Client', valeur: 9000, devise: 'CNY', description: 'Montre offerte' })])).id;
    await expectError(db, 'GBS_AUTO_VALIDATION', `select gbs.decider_ethique($1, 'accepte', 'Validation par moi-même')`, [p]);
    await as(db, m.hub);
    for (const x of [{ date_fait: '2099-01-01', type: 'cadeau', tiers: 'X1', description: 'Futur' }, { date_fait: hier(), type: 'pot-de-vin', tiers: 'X1', description: 'Type inconnu' },
      { date_fait: hier(), type: 'cadeau', tiers: 'X1', valeur: 10, description: 'Valeur sans devise' }, { date_fait: hier(), type: 'cadeau', tiers: 'X1', description: 'Champ en trop', declarant_id: m.admin },
      { type: 'cadeau', tiers: 'X1', description: 'Sans date' }]) {
      await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.declarer_ethique($1)`, [JSON.stringify(x)]);
    }
    const h = (await one(db, `select gbs.declarer_ethique($1) id`, [JSON.stringify({ date_fait: hier(), type: 'sollicitation', tiers: 'Usine', description: 'Proposition de commission refusée' })])).id;
    expect((await rows(db, `select id from gbs.declarations_ethique`)).map((x) => x.id)).toEqual([h]);
    await as(db, m.comptable);
    expect(await rows(db, `select id from gbs.declarations_ethique`)).toEqual([]);
    await as(db, m.admin);
    expect((await rows(db, `select id from gbs.declarations_ethique`)).length).toBe(2);
    await expectError(db, '42501', `update gbs.declarations_ethique set decision = 'accepte' where id = $1`, [h]);
    await asRoot(db);
    await expectError(db, 'GBS_VALIDATION_RPC', `update gbs.declarations_ethique set decision = 'accepte' where id = $1`, [h]);
    await expectError(db, 'GBS_SUPPRESSION_INTERDITE', `delete from gbs.declarations_ethique where id = $1`, [h]);
  }));
});
