// Garanties bancaires : cycle, commission courue calculée par la base, droits.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, rows, withTx } from './helpers';

afterAll(closePool);
const jour = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

describe('Garanties bancaires', () => {
  it('demandée → émise → mainlevée demandée → levée ; commission courue ; figée ensuite', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.comptable);
    const g = (await one(db, `select gbs.demander_garantie($1) id`, [JSON.stringify({ societe_id: m.ci, type: 'bonne_execution', beneficiaire: 'Opérateur pétrolier',
      banque: 'SGBCI', montant: 36500000, taux_commission: 0.015, dossier_id: d })])).id;
    expect((await one(db, `select reference from gbs.garanties_bancaires where id = $1`, [g])).reference).toMatch(/^GAR-\d{4}-001$/);
    await expectError(db, 'GBS_TRANSITION_INVALIDE', `select gbs.suivre_garantie($1, 'levee', current_date)`, [g]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.emettre_garantie($1, $2, $3)`, [g, jour(-100), jour(-200)]);
    await db.query(`select gbs.emettre_garantie($1, $2, $3)`, [g, jour(-100), jour(20)]);
    // 36 500 000 × 1,5 % × 100 / 365 = 150 000.
    expect(await one(db, `select jours_restants, echue_sans_mainlevee, commission_courue::int c from gbs.garanties_suivi() where id = $1`, [g]))
      .toEqual({ jours_restants: 20, echue_sans_mainlevee: false, c: 150000 });
    await db.query(`select gbs.suivre_garantie($1, 'mainlevee_demandee')`, [g]);
    await db.query(`select gbs.suivre_garantie($1, 'levee', $2)`, [g, jour(-10)]);
    expect((await one(db, `select commission_courue::int c from gbs.garanties_suivi() where id = $1`, [g])).c).toBe(135000);
    await expectError(db, 'GBS_GARANTIE_CLOSE', `select gbs.suivre_garantie($1, 'appelee', null, 'Appel du bénéficiaire')`, [g]);
  }));

  it('échue sans mainlevée signalée ; refus et appel motivés ; entrées strictes', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.admin);
    const g = (await one(db, `select gbs.demander_garantie($1) id`, [JSON.stringify({ societe_id: m.ci, type: 'restitution_acompte', beneficiaire: 'Hôtel', banque: 'Ecobank', montant: 1000000 })])).id;
    await db.query(`select gbs.emettre_garantie($1, $2, $3)`, [g, jour(-60), jour(-5)]);
    expect((await one(db, `select echue_sans_mainlevee e from gbs.garanties_suivi() where id = $1`, [g])).e).toBe(true);
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', `select gbs.suivre_garantie($1, 'appelee')`, [g]);
    await db.query(`select gbs.suivre_garantie($1, 'appelee', null, 'Retard de livraison constaté')`, [g]);
    const h = (await one(db, `select gbs.demander_garantie($1) id`, [JSON.stringify({ societe_id: m.ci, type: 'soumission', beneficiaire: 'Port', banque: 'SGBCI', montant: 2000000 })])).id;
    await db.query(`select gbs.suivre_garantie($1, 'refusee', null, 'Plafond de la banque atteint')`, [h]);
    for (const p of [{ societe_id: m.ci, type: 'caution', beneficiaire: 'X1', banque: 'B1', montant: 10 }, { societe_id: m.ci, type: 'soumission', beneficiaire: 'X1', banque: 'B1', montant: -5 },
      { societe_id: m.ci, type: 'soumission', beneficiaire: 'X1', banque: 'B1', montant: 10, taux_commission: 0.5 }, { societe_id: m.ci, type: 'soumission', beneficiaire: 'X1', banque: 'B1', montant: '10' },
      { societe_id: m.ci, type: 'soumission', beneficiaire: 'X1', banque: 'B1', montant: 10, admin: true }, { type: 'soumission', beneficiaire: 'X1', banque: 'B1', montant: 10 }]) {
      await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.demander_garantie($1)`, [JSON.stringify(p)]);
    }
  }));

  it('droits : finance écrit, Hub lit, autres rien ; aucune écriture directe ni suppression', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.comptable);
    const g = (await one(db, `select gbs.demander_garantie($1) id`, [JSON.stringify({ societe_id: m.ci, type: 'soumission', beneficiaire: 'Port', banque: 'SGBCI', montant: 2000000 })])).id;
    await as(db, m.hub);
    expect((await rows(db, `select id from gbs.garanties_bancaires`)).length).toBe(1);
    await expectError(db, '42501', `select gbs.emettre_garantie($1, current_date, current_date + 30)`, [g]);
    for (const u of [m.achats, m.inspecteur, m.agentGA]) {
      await as(db, u);
      expect(await rows(db, `select id from gbs.garanties_bancaires`)).toEqual([]);
      expect(await rows(db, `select id from gbs.garanties_suivi()`)).toEqual([]);
      await expectError(db, '42501', `select gbs.demander_garantie($1)`, [JSON.stringify({ societe_id: m.ci, type: 'soumission', beneficiaire: 'Port', banque: 'SGBCI', montant: 1 })]);
    }
    await as(db, m.comptable);
    await expectError(db, '42501', `update gbs.garanties_bancaires set montant = 1 where id = $1`, [g]);
    await asRoot(db);
    await expectError(db, 'GBS_VALIDATION_RPC', `update gbs.garanties_bancaires set montant = 1 where id = $1`, [g]);
    await expectError(db, 'GBS_SUPPRESSION_INTERDITE', `delete from gbs.garanties_bancaires where id = $1`, [g]);
  }));
});
