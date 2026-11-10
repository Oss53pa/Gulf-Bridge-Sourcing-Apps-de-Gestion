// Clôture, enquête de satisfaction, archivage et productivité (M23, lot 2).
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, rows, withTx, type Db } from './helpers';

afterAll(closePool);

/** Valide toutes les pièces obligatoires d'un dossier (raccourci de test, comme le ferait statuer_piece). */
async function piecesValidees(db: Db, d: string) {
  await asRoot(db);
  await db.query(`select set_config('gbs.rpc', 'systeme', true)`);
  await db.query(`update gbs.pieces set statut = 'validee' where dossier_id = $1 and obligatoire`, [d]);
  await db.query(`select set_config('gbs.rpc', '', true)`);
}

describe('Clôture et archivage', () => {
  it('conditions vérifiées en base ; satisfaction saisie une fois ; archivage par l\'administratrice, puis lecture seule', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.admin);
    let c = await rows(db, `select code, ok, bloquante from gbs.conditions_cloture($1)`, [d]);
    expect(c.find((x) => x.code === 'pieces').ok).toBe(false);
    // Clôture directe refusée tant qu'une condition bloquante manque, même pour l'administratrice.
    await expectError(db, 'GBS_CLOTURE_CONDITIONS', `update gbs.dossiers set statut = 'clos', clos_le = now() where id = $1`, [d]);
    await piecesValidees(db, d);
    await as(db, m.admin);
    await db.query(`insert into gbs.points_bloquants (dossier_id, description, categorie, echeance) values ($1, 'Accusé de réception manquant', 'client', current_date + 3)`, [d]);
    await expectError(db, 'GBS_CLOTURE_CONDITIONS', `update gbs.dossiers set statut = 'clos', clos_le = now() where id = $1`, [d]);
    await db.query(`update gbs.points_bloquants set resolution = 'Reçu', resolu_le = now() where dossier_id = $1`, [d]);
    // Satisfaction : rôles autorisés, note bornée, une seule saisie, non bloquante.
    await as(db, m.achats);
    await expectError(db, '42501', `select gbs.enregistrer_satisfaction($1, 5)`, [d]);
    await as(db, m.hub);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.enregistrer_satisfaction($1, 6)`, [d]);
    await db.query(`select gbs.enregistrer_satisfaction($1, 4, 'Livraison soignée')`, [d]);
    await expectError(db, 'GBS_SATISFACTION_DEJA_SAISIE', `select gbs.enregistrer_satisfaction($1, 5)`, [d]);
    await expectError(db, '42501', `insert into gbs.satisfactions (dossier_id, note) values ($1, 5)`, [d]);
    await as(db, m.admin);
    c = await rows(db, `select code, ok from gbs.conditions_cloture($1)`, [d]);
    expect(c.every((x) => x.ok)).toBe(true);
    await db.query(`update gbs.dossiers set statut = 'clos', clos_le = now() where id = $1`, [d]);
    const l = (await rows(db, `select * from gbs.dossiers_cloture() where dossier_id = $1`, [d]))[0];
    expect([l.statut, l.satisfaction, l.conditions_ok, l.conditions_total, l.bloquantes_manquantes]).toEqual(['clos', 4, 6, 6, 0]);
    // Archivage : administratrice seule, dossier clos ; ensuite plus aucune modification.
    await as(db, m.hub);
    await expectError(db, '42501', `select gbs.archiver_dossier($1)`, [d]);
    await as(db, m.admin);
    await expectError(db, 'GBS_VALIDATION_RPC', `update gbs.dossiers set archive_le = now() where id = $1`, [d]);
    const a = (await one(db, `select gbs.archiver_dossier($1) as r`, [d])).r;
    expect(Number(a.conserve_jusqu_au.slice(0, 4)) - new Date().getFullYear()).toBe(10);
    await expectError(db, 'GBS_DOSSIER_ARCHIVE', `update gbs.dossiers set intitule = 'Modifié' where id = $1`, [d]);
    await expectError(db, 'GBS_ARCHIVAGE_IMPOSSIBLE', `select gbs.archiver_dossier($1)`, [d]);
  }));

  it('productivité : réservée aux profils de pilotage ; année contrôlée', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.admin);
    await db.query(`update gbs.dossiers set chef_id = $2 where id = $1`, [d, m.admin]);
    const r = await rows(db, `select * from gbs.productivite_chefs()`);
    expect(r.find((x) => x.chef_id === m.admin).actifs).toBe(1);
    expect(await rows(db, `select * from gbs.productivite_phases()`)).toEqual([]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select * from gbs.productivite_chefs(1990)`);
    await as(db, m.inspecteur);
    await expectError(db, '42501', `select * from gbs.productivite_chefs()`);
  }));
});
