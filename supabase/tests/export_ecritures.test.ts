// Export comptable des ventes, encaissements et règlements fournisseurs (migration 78).
import { afterAll, describe, expect, it } from 'vitest';
import { as, closePool, commande, contratSigne, dossier, expectError, mandatSigne, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

const auj = () => new Date().toISOString().slice(0, 10);
type Ligne = { piece: string; compte: string; compte_tiers: string | null; debit_xof: string; credit_xof: string; debit_devise: string; credit_devise: string; journal: string };

async function facture(db: Db, m: Monde, ht: number, avoirDe: string | null = null) {
  await as(db, m.admin);
  const f = (await one(db, `insert into gbs.factures (societe_id, client_id, type, objet, devise, avoir_de)
    values ($1, $2, $3, 'Inspection avant expédition', 'USD', $4) returning id`, [m.cn, m.clientGA, avoirDe ? 'avoir' : 'inspection', avoirDe])).id as string;
  await db.query(`insert into gbs.lignes_facture (facture_id, libelle, prix_unitaire) values ($1, 'Inspection', $2)`, [f, ht]);
  await db.query(`select gbs.emettre_facture($1)`, [f]);
  return one(db, `select id, numero, montant_ht, tva, retenue, net_a_payer from gbs.factures where id = $1`, [f]);
}
const exporter = (db: Db, m: Monde) => rows<Ligne>(db, `select * from gbs.export_ecritures($1, current_date - 30, current_date)`, [m.cn]);
const solde = (ls: Ligne[], col: 'xof' | 'devise') => ls.reduce((s, l) => s + Number(l[`debit_${col}`]) - Number(l[`credit_${col}`]), 0);

describe('Export comptable des ventes et règlements', () => {
  it('facture : client et retenue au débit, produit et TVA au crédit ; pièce équilibrée ; encaissement', () => withTx(async (db) => {
    const m = await monde(db);
    const f = await facture(db, m, 1000);
    await db.query(`insert into gbs.encaissements (facture_id, montant, devise, recu_le, mode, reference) values ($1, $2, 'USD', current_date, 'virement', 'VIR-1')`, [f.id, f.net_a_payer]);
    const ls = await exporter(db, m);
    const v = ls.filter((l) => l.journal === 'JZ');
    expect(v.map((l) => l.compte)).toEqual(Number(f.retenue) > 0 ? ['1122', '2221', '6001', '2221'] : ['1122', '6001', '2221']);
    expect(v[0].compte_tiers).toBe(`CLI-${m.clientGA.slice(0, 8)}`);
    expect(Number(f.retenue)).toBeGreaterThan(0);   // retenue à la source au Gabon : la ligne 2221 de retenue est bien produite
    expect(Number(f.tva)).toBeGreaterThan(0);
    expect(Number(v.find((l) => l.compte === '6001')!.credit_xof)).toBe(Number(f.montant_ht) * 600);
    expect(solde(v, 'xof')).toBe(0);
    expect(Math.abs(solde(v, 'devise'))).toBeLessThan(0.000001);
    const b = ls.filter((l) => l.journal === 'YH');
    expect(b.map((l) => [l.compte, Number(l.debit_xof), Number(l.credit_xof)])).toEqual([
      ['1002', Number(f.net_a_payer) * 600, 0], ['1122', 0, Number(f.net_a_payer) * 600]]);
    // Devise de tenue de GBS Chine : CNY à 84 FCFA.
    expect(Number(b[0].debit_devise)).toBeCloseTo((Number(f.net_a_payer) * 600) / 84, 2);
  }));

  it('un avoir inverse les sens et reste équilibré', () => withTx(async (db) => {
    const m = await monde(db);
    const f = await facture(db, m, 1000);
    const a = await facture(db, m, -400, f.id);
    const ls = (await exporter(db, m)).filter((l) => l.piece === a.numero);
    expect(Number(ls.find((l) => l.compte === '1122')!.credit_xof)).toBeGreaterThan(0);
    expect(Number(ls.find((l) => l.compte === '6001')!.debit_xof)).toBe(400 * 600);
    expect(solde(ls, 'xof')).toBe(0);
  }));

  it('règlement fournisseur exécuté par GBS : fournisseur au débit, banque au crédit, net de la pénalité', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m, { modele: 'negoce', societe: m.cn });
    const cmd = await commande(db, m, d, [{ qte: 1, pu: 50_000 }]);
    await mandatSigne(db, m, d);
    await contratSigne(db, m, cmd);
    await as(db, m.achats);
    const p = (await one(db, `insert into gbs.paiements_fournisseurs (commande_id, nature, flux, canal, compte_id, montant, devise)
      values ($1, 'acompte', 'gbs', 'virement', $2, 15000, 'USD') returning id`, [cmd, m.compte])).id;
    await as(db, m.admin);
    await db.query(`select gbs.valider_paiement($1)`, [p]);
    await as(db, m.achats);
    await db.query(`select gbs.executer_paiement($1, 'SWIFT-77881', 'justificatifs/acompte.pdf')`, [p]);
    await as(db, m.admin);
    const ls = (await exporter(db, m)).filter((l) => l.compte === '2202' || (l.compte === '1002' && Number(l.credit_xof) > 0));
    expect(ls.map((l) => [l.compte, l.compte_tiers, Number(l.debit_xof), Number(l.credit_xof)])).toEqual([
      ['2202', `FOU-${m.fournisseur.slice(0, 8)}`, 15000 * 600, 0], ['1002', null, 0, 15000 * 600]]);
  }));

  it('réservé à la finance de la société ; période bornée ; brouillons exclus', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.admin);
    const br = (await one(db, `insert into gbs.factures (societe_id, client_id, type, objet, devise) values ($1, $2, 'inspection', 'Brouillon', 'USD') returning id`, [m.cn, m.clientGA])).id;
    await db.query(`insert into gbs.lignes_facture (facture_id, libelle, prix_unitaire) values ($1, 'x', 10)`, [br]);
    expect(await exporter(db, m)).toEqual([]);
    await expectError(db, 'GBS_PERIODE_INVALIDE', `select * from gbs.export_ecritures($1, current_date, current_date - 1)`, [m.cn]);
    await expectError(db, 'GBS_PERIODE_INVALIDE', `select * from gbs.export_ecritures($1, current_date - 400, current_date)`, [m.cn]);
    for (const u of [m.achats, m.hub, m.agentGA]) {
      await as(db, u);
      await expectError(db, 'GBS_ACCES_REFUSE', `select * from gbs.export_ecritures($1, current_date - 30, current_date)`, [m.cn]);
    }
    await as(db, m.comptable); // comptable de GBS Côte d'Ivoire : pas de GBS Chine
    await expectError(db, 'GBS_ACCES_REFUSE', `select * from gbs.export_ecritures($1, current_date - 30, current_date)`, [m.cn]);
    expect(auj()).toBeTruthy();
  }));

  it('le plan de comptes est un paramètre daté validé strictement', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.admin);
    await expectError(db, 'GBS_PARAMETRE_INVALIDE', `insert into gbs.parametres (cle, valeur, date_effet, commentaire) values ('export.ventes.GBS_CN', '{"clients":"1122"}', current_date, 'Incomplet')`);
    await expectError(db, 'GBS_PARAMETRE_INVALIDE', `insert into gbs.parametres (cle, valeur, date_effet, commentaire) values ('export.ventes.GBS_CN',
      '{"clients":"=CMD","produits":"6001","produits_negoce":"6001","tva_collectee":"2221","retenue":"2221","fournisseurs":"2202","banque":"1002","journal_ventes":"JZ","journal_banque":"YH"}', current_date, 'Formule')`);
    await db.query(`insert into gbs.parametres (cle, valeur, date_effet, commentaire) values ('export.ventes.GBS_CN',
      '{"clients":"112201","produits":"6001","produits_negoce":"6001","tva_collectee":"2221","retenue":"2221","fournisseurs":"2202","banque":"1002","journal_ventes":"JZ","journal_banque":"YH"}', current_date, 'Sous-compte du cabinet')`);
    await facture(db, m, 100);
    expect((await exporter(db, m))[0].compte).toBe('112201');
  }));
});
