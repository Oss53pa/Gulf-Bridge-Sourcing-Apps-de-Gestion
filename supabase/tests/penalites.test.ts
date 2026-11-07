// Lot 1, M7 : pénalités de retard (taux par jour, plafond) proposées en retenue sur le solde.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, commande, contratSigne, dossier, expectError, inspectionValidee, mandatSigne, monde, one, withTx,
  type Db } from './helpers';

afterAll(closePool);

/** Commande de 50 000 USD, 0,1 % par jour de retard, plafond 5 %, livraison promise le 1er septembre 2026. */
async function preparer(db: Db, plafond: number | null = 0.05) {
  const m = await monde(db);
  const d = await dossier(db, m);
  const c = await commande(db, m, d, [{ qte: 1, pu: 50_000 }]);
  await as(db, m.achats);
  await db.query(`update gbs.commandes set date_livraison_promise = '2026-09-01', penalite_taux_jour = 0.001, penalite_plafond = $2
                   where id = $1`, [c, plafond]);
  await mandatSigne(db, m, d);
  await contratSigne(db, m, c);
  return { m, d, c };
}
const livrer = async (db: Db, m: any, c: string, le: string) => { await as(db, m.achats); await db.query(`update gbs.commandes set livraison_reelle_le = $2 where id = $1`, [c, le]); };
const penalite = async (db: Db, m: any, c: string) => { await as(db, m.achats); return (await one(db, `select gbs.penalite_commande($1) p`, [c])).p; };

describe('Pénalités de retard (M7)', () => {
  it('12 jours de retard à 0,1 % par jour sur 50 000 USD : 600 USD, définitive une fois la livraison datée', () => withTx(async (db) => {
    const { m, c } = await preparer(db);
    await livrer(db, m, c, '2026-09-13');
    expect(await penalite(db, m, c)).toMatchObject({ applicable: true, jours_retard: 12, montant: 600, provisoire: false, plafonnee: false });
  }));

  it('plafonnée au taux contractuel ; sans plafond, jamais au-delà du montant de la commande', () => withTx(async (db) => {
    const { m, c } = await preparer(db);
    await livrer(db, m, c, '2026-11-01');   // 61 jours : 3 050 USD bruts, plafond 5 % = 2 500 USD
    expect(await penalite(db, m, c)).toMatchObject({ jours_retard: 61, montant_brut: 3050, montant: 2500, plafonnee: true });
  }));

  it('sans plafond au contrat : 1 200 jours de retard ne dépassent pas le montant de la commande', () => withTx(async (db) => {
    const { m, c } = await preparer(db, null);
    await asRoot(db);
    await db.query(`update gbs.commandes set date_livraison_promise = current_date - 1200 where id = $1`, [c]);
    expect(await penalite(db, m, c)).toMatchObject({ jours_retard: 1200, provisoire: true, montant_brut: 60000, montant: 50000, plafonnee: true });
  }));

  it('livrée à temps ou sans clause : aucune pénalité ; date future refusée', () => withTx(async (db) => {
    const { m, c } = await preparer(db);
    await livrer(db, m, c, '2026-08-30');
    expect((await penalite(db, m, c)).montant).toBe(0);
    await as(db, m.achats);
    await expectError(db, 'GBS_DATE_LIVRAISON_INVALIDE', `update gbs.commandes set livraison_reelle_le = current_date + 1 where id = $1`, [c]);
    await asRoot(db);
    await db.query(`update gbs.commandes set penalite_taux_jour = null where id = $1`, [c]);
    expect(await penalite(db, m, c)).toEqual({ applicable: false });
  }));

  it('proposée en retenue sur le solde ; renoncer exige un motif ; jamais au-delà ; jamais sur un acompte', () => withTx(async (db) => {
    const { m, c } = await preparer(db);
    await livrer(db, m, c, '2026-09-13');
    await inspectionValidee(db, m, c);
    await as(db, m.achats);
    const base = `insert into gbs.paiements_fournisseurs (commande_id, nature, flux, canal, compte_id, montant, devise, penalite_retenue, penalite_motif)
      values ($1, $3, 'instruction_client', 'virement', $2, $4, 'USD', $5, $6) returning penalite_proposee, penalite_retenue`;
    await expectError(db, 'GBS_RETENUE_SUPERIEURE', base, [c, m.compte, 'solde', 34400, 700, null]);
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', base, [c, m.compte, 'solde', 35000, 0, null]);
    const p = await one(db, base, [c, m.compte, 'solde', 34400, 600, null]);
    expect(p).toEqual({ penalite_proposee: '600.00', penalite_retenue: '600.00' });
    await expectError(db, 'GBS_PENALITE_SUR_SOLDE', base, [c, m.compte, 'acompte', 1000, 100, null]);
  }));

  it('renonciation motivée tracée ; la pénalité d’un ordre préparé ne se modifie plus', () => withTx(async (db) => {
    const { m, c } = await preparer(db);
    await livrer(db, m, c, '2026-09-13');
    await inspectionValidee(db, m, c);
    await as(db, m.achats);
    const p = (await one(db, `insert into gbs.paiements_fournisseurs (commande_id, nature, flux, canal, compte_id, montant, devise, penalite_retenue, penalite_motif)
      values ($1, 'solde', 'instruction_client', 'virement', $2, 34700, 'USD', 300, 'Retard dû pour moitié au client (plans validés tard)') returning id`,
      [c, m.compte])).id;
    await asRoot(db);
    await expectError(db, 'GBS_PAIEMENT_FIGE', `update gbs.paiements_fournisseurs set penalite_retenue = 0 where id = $1`, [p]);
    expect((await one(db, `select apres ->> 'penalite_motif' m from gbs.journal_audit where table_nom = 'paiements_fournisseurs' and ligne_id = $1::text`, [p])).m)
      .toBe('Retard dû pour moitié au client (plans validés tard)');
  }));
});
