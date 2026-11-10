// Portail fournisseur : demande de changement de compte de paiement (jamais de compte créé par le portail).
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, expectError, monde, one, rows, withTx, type Db } from './helpers';

afterAll(closePool);

async function compte(db: Db, nom: string) {
  await asRoot(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${nom}@usine.test`, { nom, app: 'gbs' }]);
  return id;
}
const demande = { type: 'banque', titulaire: 'Foshan Ceramics Co.', devise: 'USD', banque: 'Bank of China Foshan', numero: '6217 0000 1234 5678',
  swift: 'bkchcnbj', motif: 'Changement de banque principale au 1er décembre' };

describe('Demandes de compte fournisseur', () => {
  it('finance seulement ; une en attente ; acceptée = compte non vérifié puis quatre yeux ; refus motivé', () => withTx(async (db) => {
    const m = await monde(db);
    const fin = await compte(db, 'wang');
    const com = await compte(db, 'zhao');
    await as(db, m.achats);
    await db.query(`select gbs.admin_compte_fournisseur($1, $2, 'finance')`, [fin, m.fournisseur]);
    await db.query(`select gbs.admin_compte_fournisseur($1, $2, 'commercial')`, [com, m.fournisseur]);

    await as(db, com);
    await expectError(db, '42501', `select gbs.demander_compte_fournisseur($1)`, [demande]);
    await as(db, fin, 'aal1');
    await expectError(db, '42501', `select gbs.demander_compte_fournisseur($1)`, [demande]);
    await as(db, fin);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.demander_compte_fournisseur($1)`, [{ ...demande, verifie: true }]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.demander_compte_fournisseur($1)`, [{ ...demande, numero: "1234'; drop" }]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.demander_compte_fournisseur($1)`, [{ ...demande, type: 'wechat_pay', titulaire_est_entreprise: false }]);
    const d1 = (await one(db, `select gbs.demander_compte_fournisseur($1) r`, [demande])).r;
    await expectError(db, 'GBS_DEMANDE_EN_COURS', `select gbs.demander_compte_fournisseur($1)`, [demande]);
    await expectError(db, '42501', `select gbs.traiter_demande_compte($1, true)`, [d1]);
    expect((await rows(db, `select * from gbs.demandes_comptes_fournisseurs`)).length).toBe(0);
    const vues = (await one(db, `select gbs.mes_demandes_compte() v`)).v;
    expect(vues).toEqual([expect.objectContaining({ fin_numero: '5678', statut: 'nouvelle' })]);
    expect(JSON.stringify(vues)).not.toContain('6217');

    // Acceptation : compte créé non vérifié ; la vérification exige deux personnes.
    await as(db, m.achats);
    const c = (await one(db, `select gbs.traiter_demande_compte($1, true) c`, [d1])).c;
    expect(await one(db, `select verifie, swift from gbs.comptes_paiement where id = $1`, [c])).toEqual({ verifie: false, swift: 'BKCHCNBJ' });
    await expectError(db, 'GBS_DEMANDE_TRAITEE', `select gbs.traiter_demande_compte($1, false, 'Trop tard pour refuser')`, [d1]);
    await db.query(`select gbs.demander_verification_compte($1)`, [c]);
    await as(db, m.delegue);
    await db.query(`select gbs.verifier_compte($1)`, [c]);

    // Refus motivé ; motif interne jamais montré au fournisseur ; plafond sur 30 jours.
    await as(db, fin);
    const d2 = (await one(db, `select gbs.demander_compte_fournisseur($1) r`, [{ ...demande, numero: '9999 8888' }])).r;
    await as(db, m.achats);
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', `select gbs.traiter_demande_compte($1, false)`, [d2]);
    await db.query(`select gbs.traiter_demande_compte($1, false, 'Titulaire différent de la raison sociale, rappel fait')`, [d2]);
    await as(db, fin);
    expect(JSON.stringify((await one(db, `select gbs.mes_demandes_compte() v`)).v)).not.toContain('rappel');
    await db.query(`select gbs.demander_compte_fournisseur($1)`, [{ ...demande, numero: '7777 6666' }]);
    await asRoot(db);
    await db.query(`select set_config('gbs.rpc', 'demande_compte', true)`);
    await db.query(`update gbs.demandes_comptes_fournisseurs set statut = 'refusee', motif_refus = 'test' where statut = 'nouvelle'`);
    await db.query(`select set_config('gbs.rpc', '', true)`);
    await as(db, fin);
    await expectError(db, 'GBS_TROP_DE_DEMANDES', `select gbs.demander_compte_fournisseur($1)`, [{ ...demande, numero: '5555 4444' }]);
  }));
});
