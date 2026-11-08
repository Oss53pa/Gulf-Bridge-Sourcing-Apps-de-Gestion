// Lot 1, M32 : dossier qualité de fin de fabrication au format du client final.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, commande, dossier, expectError, inspectionValidee, monde, one, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

async function preparer(db: Db, m: Monde) {
  const d = await dossier(db, m);
  const c = await commande(db, m, d, [{ qte: 3, pu: 5000 }]);
  const l = (await one(db, `select id from gbs.lignes_commande where commande_id = $1`, [c])).id as string;
  return { d, c, l };
}
const section = (q: { sections: { code: string }[] }, code: string) => q.sections.find((s) => s.code === code) as
  { code: string; obligatoire: boolean; present: boolean; elements: Record<string, unknown>[] };

describe('Dossier qualité (M32)', () => {
  it('liste standard : sections présentes ou manquantes ; incomplet sans inspection ni due diligence', () => withTx(async (db) => {
    const m = await monde(db);
    const { d, c } = await preparer(db, m);
    await as(db, m.achats);
    let q = (await one(db, `select gbs.dossier_qualite($1) q`, [d])).q;
    expect(q.referentiel).toBe('Standard Gulf Bridge Sourcing');
    expect(q.complet).toBe(false);
    expect(section(q, 'rapports_inspection').present).toBe(false);
    await inspectionValidee(db, m, c);
    await as(db, m.achats);
    q = (await one(db, `select gbs.dossier_qualite($1) q`, [d])).q;
    expect(section(q, 'rapports_inspection').elements).toHaveLength(1);
    expect(section(q, 'due_diligence').elements.map((x) => x.fournisseur)).toEqual(['Foshan Ceramics Co.']);
    await expectError(db, 'GBS_DOSSIER_QUALITE_INCOMPLET', `select gbs.emettre_dossier_qualite($1)`, [d]);
    for (const u of [m.agentGA, m.comptable, m.inspecteur]) {
      await as(db, u);
      await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.dossier_qualite($1)`, [d]);
    }
  }));

  it('référentiel du client : sections et ordre propres ; liste stricte', () => withTx(async (db) => {
    const m = await monde(db);
    const { d } = await preparer(db, m);
    await as(db, m.hub);
    await expectError(db, 'GBS_SECTIONS_INVALIDES', `insert into gbs.listes_qualite_client (client_id, intitule, sections) values ($1, 'Référentiel', $2)`,
      [m.clientCI, JSON.stringify([{ code: 'macros', obligatoire: true }])]);
    await expectError(db, 'GBS_SECTIONS_INVALIDES', `insert into gbs.listes_qualite_client (client_id, intitule, sections) values ($1, 'Référentiel', $2)`,
      [m.clientCI, JSON.stringify([{ code: 'essais', obligatoire: true }, { code: 'essais', obligatoire: false }])]);
    await db.query(`insert into gbs.listes_qualite_client (client_id, intitule, reference, sections) values ($1, 'Exigences fournisseurs du groupe hôtelier', 'QHSE-07', $2)`,
      [m.clientCI, JSON.stringify([{ code: 'tracabilite', obligatoire: true, libelle: 'Traçabilité des lots' }, { code: 'engagement_ethique', obligatoire: true }])]);
    await as(db, m.achats);
    const q = (await one(db, `select gbs.dossier_qualite($1) q`, [d])).q;
    expect([q.referentiel, q.reference_client]).toEqual(['Exigences fournisseurs du groupe hôtelier', 'QHSE-07']);
    expect(q.sections.map((s: { code: string }) => s.code)).toEqual(['tracabilite', 'engagement_ethique']);
    expect(section(q, 'tracabilite').present).toBe(false);
    expect(section(q, 'engagement_ethique').present).toBe(true);
  }));

  it('numéros de série par ligne, jamais plus que d’unités ; émission tracée, pièce de clôture reçue', () => withTx(async (db) => {
    const m = await monde(db);
    const { d, l } = await preparer(db, m);
    await as(db, m.hub);
    await db.query(`insert into gbs.listes_qualite_client (client_id, intitule, sections) values ($1, 'Traçabilité seule', $2)`,
      [m.clientCI, JSON.stringify([{ code: 'tracabilite', obligatoire: true }])]);
    await as(db, m.achats);
    await expectError(db, '23514', `insert into gbs.numeros_serie (ligne_commande_id, numero) values ($1, '<script>')`, [l]);
    for (const n of ['SN-2026-0001', 'SN-2026-0002', 'SN-2026-0003']) await db.query(`insert into gbs.numeros_serie (ligne_commande_id, numero) values ($1, $2)`, [l, n]);
    await expectError(db, 'GBS_NUMEROS_EN_TROP', `insert into gbs.numeros_serie (ligne_commande_id, numero) values ($1, 'SN-2026-0004')`, [l]);
    const q = (await one(db, `select gbs.dossier_qualite($1) q`, [d])).q;
    expect(q.complet).toBe(true);
    expect(section(q, 'tracabilite').elements.map((x) => x.numero)).toEqual(['SN-2026-0001', 'SN-2026-0002', 'SN-2026-0003']);
    const e = await one(db, `select version, complet from gbs.emettre_dossier_qualite($1)`, [d]);
    expect(e).toEqual({ version: 1, complet: true });
    await asRoot(db);
    expect((await one(db, `select statut from gbs.pieces where dossier_id = $1 and code = 'dossier_qualite_remis'`, [d])).statut).toBe('recue');
    await expectError(db, '42501', `insert into gbs.dossiers_qualite_emis (dossier_id, version, sections, complet, emis_par) values ($1, 9, '[]', true, $2)`, [d, m.admin]);
  }));
});
