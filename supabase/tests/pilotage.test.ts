// M15 : chiffre d'affaires mensuel, budget paramétrable, prévision et point mort.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

/** Facture de GBS Côte d'Ivoire émise et certifiée aujourd'hui, montant HT donné. */
async function facture(db: Db, m: Monde, ht: number) {
  const d = await dossier(db, m);
  await as(db, m.hub);
  const f = (await one(db, `insert into gbs.factures (societe_id, client_id, dossier_id, type, objet, devise)
    values ($1, $2, $3, 'forfait_consultation', 'Forfait de consultation', 'XOF') returning id`, [m.ci, m.clientCI, d])).id;
  await db.query(`insert into gbs.lignes_facture (facture_id, libelle, service, prix_unitaire) values ($1, 'Consultation', 'S2', $2)`, [f, ht]);
  await db.query(`select gbs.emettre_facture($1)`, [f]);
  await db.query(`select gbs.certifier_fne($1, 'DGI-2026-000901', 'https://fne.dgi.gouv.ci/qr/000901')`, [f]);
  await asRoot(db);
}

describe('Pilotage du chiffre d\'affaires (M15)', () => {
  it('série mensuelle, budget par société, prévision et point mort ; montants masqués hors profils autorisés', () => withTx(async (db) => {
    const m = await monde(db);
    await facture(db, m, 1200000);
    await as(db, m.admin);
    const avant = (await one(db, `select gbs.pilotage_ca($1) as r`, [m.ci])).r;
    expect(avant.mois).toHaveLength(8);
    const courant = avant.mois.find((x: any) => x.en_cours);
    expect(Number(courant.ca_xof)).toBe(1200000);
    expect(courant.budget_xof).toBeNull();                 // aucun budget saisi : rien d'inventé
    expect(avant.point_mort.taux).toBeNull();
    expect(avant.mois.slice(-2).every((x: any) => x.ca_xof === null && x.prevision_xof !== null)).toBe(true);

    // Budget et charges fixes saisis en début de mois : pris en compte pour le mois courant.
    const debut = `date_trunc('month', current_date)::date`;
    await db.query(`insert into gbs.parametres (cle, valeur, date_effet) values
      ('pilotage.budget_ca_mensuel_xof.GBS_CI', '1000000', ${debut}),
      ('pilotage.charges_fixes_annuelles_xof.GBS_CI', '4800000', ${debut})`);
    await expectError(db, 'GBS_PARAMETRE_INVALIDE', `insert into gbs.parametres (cle, valeur, date_effet) values ('pilotage.budget_ca_mensuel_xof.GBS_CN', '-5', current_date)`);
    const r = (await one(db, `select gbs.pilotage_ca($1) as r`, [m.ci])).r;
    expect(Number(r.mois.find((x: any) => x.en_cours).budget_xof)).toBe(1000000);
    expect(Number(r.point_mort.taux)).toBe(0.25);
    // Vue consolidée : GBS Chine n'a pas de budget, le total n'est donc pas affiché.
    const conso = (await one(db, `select gbs.pilotage_ca(null) as r`)).r;
    expect(conso.mois.find((x: any) => x.en_cours).budget_xof).toBeNull();
    expect(conso.par_societe.map((x: any) => x.code)).toEqual(['GBS_CI', 'GBS_CN']);

    // Achats Chine : pas de montants ; Hub : pas d'accès à une société hors de son périmètre.
    await as(db, m.achats);
    expect((await one(db, `select gbs.pilotage_ca(null) as r`)).r).toEqual({ montants_visibles: false });
    await as(db, m.hub);
    await expectError(db, '42501', `select gbs.pilotage_ca($1)`, [m.cn]);
    await as(db, m.inspecteur);
    expect((await one(db, `select gbs.pilotage_ca(null) as r`)).r).toEqual({ montants_visibles: false });
  }));
});
