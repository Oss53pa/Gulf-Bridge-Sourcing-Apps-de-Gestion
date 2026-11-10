// Section Planning du module Dossiers : Gantt du portefeuille, échéances en jours ouvrés, calcul d'échéance.
import { afterAll, describe, expect, it } from 'vitest';
import { as, closePool, dossier, expectError, monde, one, rows, withTx } from './helpers';

afterAll(closePool);

describe('Planning du portefeuille', () => {
  it('Gantt : une ligne par phase, dates réelles ; échéance en jours ouvrés avec fériés décomptés', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const autre = await dossier(db, m, { societe: m.cn, client: m.clientGA });
    await as(db, m.admin);
    await db.query(`insert into gbs.delais_cibles (modele, phase, jours_ouvres) values ('achat_accompagne', 'consultation', 10)`);
    await db.query(`update gbs.dossier_phases set reelle_debut = '2026-10-28' where dossier_id = $1 and phase = 'consultation'`, [d]);
    const g = await rows(db, `select * from gbs.gantt_portefeuille() where dossier_id = $1 order by ordre`, [d]);
    expect(g).toHaveLength(11);
    expect(g[0].debut.toISOString().slice(0, 10)).toBe('2026-10-28');
    expect(g[0].fin).not.toBeNull();            // échéance de la phase en cours faute de fin réelle
    const e = (await rows(db, `select * from gbs.echeances_en_cours() where dossier_id = $1`, [d]))[0];
    // 10 jours ouvrés en Côte d'Ivoire après le 28.10.2026 : Toussaint (01.11) tombe un dimanche, donc sans effet.
    expect(e.echeance.toISOString().slice(0, 10)).toBe('2026-11-11');
    expect(e.cible).toBe(10);
    // Calculateur : mêmes règles, bornes contrôlées.
    expect((await one(db, `select gbs.calculer_echeance('CI', '2026-10-28', 10)::text r`)).r).toBe('2026-11-11');
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.calculer_echeance('FR', '2026-10-28', 10)`);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.calculer_echeance('CI', '2026-10-28', 5000)`);
    // Le Hub (Côte d'Ivoire) ne voit pas le dossier de GBS Chine.
    await as(db, m.hub);
    expect((await rows(db, `select distinct dossier_id from gbs.gantt_portefeuille()`)).map((x) => x.dossier_id)).not.toContain(autre);
  }));
});
