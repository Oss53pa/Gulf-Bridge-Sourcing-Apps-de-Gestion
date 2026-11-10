// M34 : fiches de référence clients, générées d'un dossier clos, publiées avec l'accord écrit du client.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

async function dossierClos(db: Db, m: Monde, opts: Parameters<typeof dossier>[2] = {}) {
  const d = await dossier(db, m, { ...opts, extra: { besoin: 'Équiper 60 chambres en 14 semaines', ...(opts.extra ?? {}) } });
  await asRoot(db);
  await db.query(`select set_config('gbs.rpc', 'systeme', true)`);
  await db.query(`update gbs.pieces set statut = 'validee' where dossier_id = $1 and obligatoire`, [d]);
  await db.query(`select set_config('gbs.rpc', '', true)`);
  await as(db, m.admin);
  await db.query(`update gbs.dossiers set statut = 'clos', clos_le = now() where id = $1`, [d]);
  await asRoot(db);
  return d;
}

describe('Fiches de référence clients (M34)', () => {
  it('générée d’un dossier clos ; besoin repris ; publication anonymisée possible, nominative seulement avec accord écrit', () => withTx(async (db) => {
    const m = await monde(db);
    const ouvert = await dossier(db, m);
    await as(db, m.hub);
    await expectError(db, 'GBS_DOSSIER_NON_CLOS', `select gbs.generer_fiche_reference($1)`, [ouvert]);
    const d = await dossierClos(db, m);
    await as(db, m.hub);
    const f = (await one(db, `select gbs.generer_fiche_reference($1) id`, [d])).id;
    await expectError(db, 'GBS_FICHE_EXISTANTE', `select gbs.generer_fiche_reference($1)`, [d]);
    const x = await one(db, `select reference, besoin, delais_tenus, anonymisee, accord from gbs.fiches_reference where id = $1`, [f]);
    expect(x).toMatchObject({ besoin: 'Équiper 60 chambres en 14 semaines', delais_tenus: null, anonymisee: true, accord: 'non_demande' });
    expect(x.reference).toMatch(/^REF-\d+$/);
    await expectError(db, 'GBS_FICHE_INCOMPLETE', `select gbs.publier_fiche_reference($1)`, [f]);
    await db.query(`select gbs.modifier_fiche_reference($1, $2)`, [f, JSON.stringify({ solution: 'Mise en concurrence de 4 fabricants, 2 inspections', ecart_cout_global: -18, anonymisee: false })]);
    await expectError(db, 'GBS_ACCORD_ECRIT_REQUIS', `select gbs.publier_fiche_reference($1)`, [f]);
    await expectError(db, 'GBS_ACCORD_ECRIT_REQUIS', `select gbs.accord_fiche_reference($1, 'accorde')`, [f]);
    await db.query(`select gbs.accord_fiche_reference($1, 'accorde', 'Courriel du directeur général du 12.10.2026')`, [f]);
    await db.query(`select gbs.publier_fiche_reference($1)`, [f]);
    // Publiée : figée.
    await expectError(db, 'GBS_FICHE_PUBLIEE', `select gbs.modifier_fiche_reference($1, '{"ecart_cout_global": -30}')`, [f]);
    await expectError(db, 'GBS_FICHE_PUBLIEE', `select gbs.accord_fiche_reference($1, 'refuse')`, [f]);
  }));

  it('refus du client : seule la version anonymisée se publie ; entrées strictes', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossierClos(db, m);
    await as(db, m.admin);
    const f = (await one(db, `select gbs.generer_fiche_reference($1) id`, [d])).id;
    for (const p of [{ ecart_cout_global: 150 }, { anonymisee: 'oui' }, { publiee_le: '2026-01-01' }, { solution: 'x'.repeat(2001) }]) {
      await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.modifier_fiche_reference($1, $2)`, [f, JSON.stringify(p)]);
    }
    await db.query(`select gbs.accord_fiche_reference($1, 'refuse')`, [f]);
    await db.query(`select gbs.modifier_fiche_reference($1, $2)`, [f, JSON.stringify({ solution: 'Lits médicalisés', anonymisee: false })]);
    await expectError(db, 'GBS_ACCORD_ECRIT_REQUIS', `select gbs.publier_fiche_reference($1)`, [f]);
    await db.query(`select gbs.modifier_fiche_reference($1, '{"anonymisee": true}')`, [f]);
    await db.query(`select gbs.publier_fiche_reference($1)`, [f]);
    expect((await one(db, `select publiee_le is not null p from gbs.fiches_reference where id = $1`, [f])).p).toBe(true);
  }));

  it('droits : admin et Hub Afrique ; aucune écriture directe ; journalisée', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossierClos(db, m);
    for (const u of [m.achats, m.agentGA, m.comptable, m.inspecteur]) {
      await as(db, u);
      await expectError(db, '42501', `select gbs.generer_fiche_reference($1)`, [d]);
    }
    await as(db, m.hub);
    const f = (await one(db, `select gbs.generer_fiche_reference($1) id`, [d])).id;
    await as(db, m.comptable);
    expect(await rows(db, `select id from gbs.fiches_reference`)).toEqual([]);
    await as(db, m.hub);
    await expectError(db, '42501', `update gbs.fiches_reference set publiee_le = now() where id = $1`, [f]);
    await asRoot(db);
    await expectError(db, 'GBS_VALIDATION_RPC', `update gbs.fiches_reference set anonymisee = false where id = $1`, [f]);
    await expectError(db, 'GBS_SUPPRESSION_INTERDITE', `delete from gbs.fiches_reference where id = $1`, [f]);
    expect(Number((await one(db, `select count(*) n from gbs.journal_audit where table_nom = 'fiches_reference'`)).n)).toBeGreaterThan(0);
  }));
});
