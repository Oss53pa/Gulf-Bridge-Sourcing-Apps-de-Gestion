// Trésorerie prévisionnelle : flux prévus, scénario de change, exposition, droits.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, expectError, monde, rows, withTx } from './helpers';

afterAll(closePool);
const lundi = () => { const d = new Date(); const j = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - j); return d.toISOString().slice(0, 10); };
const plus = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

describe('Trésorerie prévisionnelle', () => {
  it('flux prévus ponctuels et mensuels répartis par semaine ; solde cumulé ; choc de change ; exposition', () => withTx(async (db) => {
    const m = await monde(db);
    await asRoot(db);
    await db.query(`insert into gbs.taux_change (devise, date_taux, taux_xof) values ('CNY', current_date - 1, 80)`).catch(() => undefined);
    await as(db, m.comptable);
    const l = lundi();
    const creer = (p: Record<string, unknown>) => db.query(`select gbs.creer_flux_prevu($1)`, [JSON.stringify({ societe_id: m.ci, ...p })]);
    await creer({ sens: 'sortie', categorie: 'salaires', libelle: 'Salaires et loyers', montant: 1000000, date_prevue: plus(l, 9), mensuel: true, jusqu_au: plus(l, 80) });
    await creer({ sens: 'entree', categorie: 'client', libelle: 'Commission attendue', montant: 3000000, date_prevue: plus(l, 16) });
    await creer({ sens: 'sortie', categorie: 'fournisseur', libelle: 'Acompte fournisseur CNY', montant: 10000, devise: 'CNY', date_prevue: plus(l, 2) });
    const p = await rows(db, `select semaine::text s, entrees::int e, sorties::int o, solde::int solde, principal from gbs.prevision_tresorerie($1, 4)`, [m.ci]);
    expect(p.map((x) => x.s)).toEqual([l, plus(l, 7), plus(l, 14), plus(l, 21)]);
    expect(p[0]).toMatchObject({ e: 0, o: 800000, solde: -800000, principal: 'Acompte fournisseur CNY' });
    expect(p[1]).toMatchObject({ o: 1000000, solde: -1800000 });
    expect(p[2]).toMatchObject({ e: 3000000, solde: 1200000 });
    // Choc de +10 % sur le CNY.
    expect((await rows(db, `select sorties::int o from gbs.prevision_tresorerie($1, 1, 0, 'CNY', 0.1)`, [m.ci]))[0].o).toBe(880000);
    expect((await rows(db, `select devise, montant::int m from gbs.exposition_change($1)`, [m.ci]))).toEqual([{ devise: 'CNY', m: 10000 }]);
    for (const [s, j, d, c] of [[m.ci, 30, 0, null], [m.ci, 4, 500, null], [m.ci, 4, 0, 'GBP']] as [string, number, number, string | null][]) {
      await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select * from gbs.prevision_tresorerie($1, $2, $3, $4, 0.1)`, [s, j, d, c]);
    }
  }));

  it('entrées strictes ; finance seulement ; flux figé, désactivable ; aucune suppression', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.comptable);
    for (const p of [{ sens: 'sortie', categorie: 'salaires', libelle: 'Salaires', montant: -1, date_prevue: '2026-12-01' },
      { sens: 'sortie', categorie: 'cadeaux', libelle: 'Salaires', montant: 1, date_prevue: '2026-12-01' },
      { sens: 'sortie', categorie: 'salaires', libelle: 'Salaires', montant: 1, date_prevue: '2026-12-01', mensuel: true },
      { sens: 'sortie', categorie: 'salaires', libelle: 'Salaires', montant: 1, date_prevue: 'bientôt' },
      { sens: 'sortie', categorie: 'salaires', libelle: 'Salaires', montant: 1, date_prevue: '2026-12-01', admin: true }]) {
      await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.creer_flux_prevu($1)`, [JSON.stringify({ societe_id: m.ci, ...p })]);
    }
    const f = (await rows(db, `select gbs.creer_flux_prevu($1) id`, [JSON.stringify({ societe_id: m.ci, sens: 'sortie', categorie: 'loyers', libelle: 'Loyer bureau', montant: 500000, date_prevue: '2026-12-05' })]))[0].id;
    for (const u of [m.hub, m.achats, m.agentGA]) {
      await as(db, u);
      await expectError(db, '42501', `select * from gbs.prevision_tresorerie()`);
      expect(await rows(db, `select id from gbs.flux_prevus`)).toEqual([]);
    }
    await as(db, m.comptable);
    await expectError(db, '42501', `update gbs.flux_prevus set montant = 1 where id = $1`, [f]);
    await db.query(`select gbs.desactiver_flux_prevu($1)`, [f]);
    await asRoot(db);
    await db.query(`select set_config('gbs.rpc', 'tresorerie', true)`);
    await expectError(db, 'GBS_REGLE_FIGEE', `update gbs.flux_prevus set montant = 1 where id = $1`, [f]);
    await db.query(`select set_config('gbs.rpc', '', true)`);
    await expectError(db, 'GBS_SUPPRESSION_INTERDITE', `delete from gbs.flux_prevus where id = $1`, [f]);
  }));
});
