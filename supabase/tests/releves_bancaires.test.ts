// Lot 1, M11 : import des relevés bancaires et rapprochement des encaissements et paiements.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, commande, contratSigne, dossier, expectError, mandatSigne, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

const H = (c: string) => c.repeat(64).slice(0, 64);
const ligne = (date: string, montant: number, libelle: string, reference: string | null = null) => ({ date_operation: date, montant, libelle, reference });

async function compte(db: Db, m: Monde, societe: string, devise: string, numero: string) {
  await as(db, m.admin);
  return (await one(db, `insert into gbs.comptes_bancaires (societe_id, libelle, banque, numero, devise) values ($1, 'Compte courant', 'Banque test', $2, $3) returning id`,
    [societe, numero, devise])).id as string;
}
async function importer(db: Db, c: string, empreinte: string, ouverture: number, cloture: number, lignes: unknown[], debut = '2026-10-01', fin = '2026-10-31') {
  return one(db, `select * from gbs.importer_releve($1, 'camt053', $2, $3, $4, $5, $6, $7)`, [c, empreinte, debut, fin, ouverture, cloture, JSON.stringify(lignes)]);
}
/** Facture de 1 200 000 FCFA HT de GBS Côte d'Ivoire, encaissée par virement avec la référence donnée. */
async function encaissement(db: Db, m: Monde, reference: string | null, recuLe = '2026-10-10') {
  const d = await dossier(db, m);
  await as(db, m.hub);
  const f = (await one(db, `insert into gbs.factures (societe_id, client_id, dossier_id, type, objet, devise)
    values ($1, $2, $3, 'forfait_consultation', 'Forfait de consultation', 'XOF') returning id`, [m.ci, m.clientCI, d])).id;
  await db.query(`insert into gbs.lignes_facture (facture_id, libelle, service, prix_unitaire) values ($1, 'Consultation', 'S2', 1200000)`, [f]);
  await db.query(`select gbs.emettre_facture($1)`, [f]);
  await db.query(`select gbs.certifier_fne($1, 'DGI-2026-000778', 'https://fne.dgi.gouv.ci/qr/000778')`, [f]);
  const net = Number((await one(db, `select net_a_payer from gbs.factures where id = $1`, [f])).net_a_payer);
  const e = (await one(db, `insert into gbs.encaissements (facture_id, montant, devise, recu_le, mode, reference) values ($1, $2, 'XOF', $3, 'virement', $4) returning id`,
    [f, net, recuLe, reference])).id as string;
  await asRoot(db);
  return { d, f, e, net };
}

describe('Relevés bancaires (M11)', () => {
  it('import contrôlé : équilibre, lignes validées, aucun double import ; rapprochement automatique sur la référence', () => withTx(async (db) => {
    const m = await monde(db);
    const c = await compte(db, m, m.ci, 'XOF', 'CI0010010000000001');
    const { e, net } = await encaissement(db, m, 'VIR-HLA-2026-41');
    await as(db, m.comptable);
    const lignes = [ligne('2026-10-12', net, 'VIR RECU HOTEL LAGUNE VIR-HLA-2026-41', 'BQ-0001'), ligne('2026-10-15', -2500, 'COMMISSION TENUE DE COMPTE', 'BQ-0002')];
    await expectError(db, 'GBS_RELEVE_DESEQUILIBRE', `select * from gbs.importer_releve($1, 'camt053', $2, '2026-10-01', '2026-10-31', 1000000, 1000000, $3)`,
      [c, H('a'), JSON.stringify(lignes)]);
    await expectError(db, 'GBS_RELEVE_INVALIDE', `select * from gbs.importer_releve($1, 'camt053', $2, '2026-10-01', '2026-10-31', 0, 10, $3)`,
      [c, H('a'), JSON.stringify([{ ...ligne('2026-10-12', 10, 'x'), iban: 'champ inconnu' }])]);
    await expectError(db, 'GBS_RELEVE_INVALIDE', `select * from gbs.importer_releve($1, 'camt053', $2, '2026-10-01', '2026-10-31', 0, 10, $3)`,
      [c, H('a'), JSON.stringify([ligne('2026-11-12', 10, 'Hors période')])]);
    await expectError(db, 'GBS_RELEVE_INVALIDE', `select * from gbs.importer_releve($1, 'camt053', $2, '2026-10-01', '2026-10-31', 0, 10, $3)`,
      [c, H('a'), JSON.stringify([{ ...ligne('2026-10-12', 10, 'Autre devise'), devise: 'USD' }])]);
    const r = await importer(db, c, H('a'), 1000000, 1000000 + net - 2500, lignes);
    expect([r.importees, r.doublons, r.rapprochees]).toEqual([2, 0, 1]);
    expect((await one(db, `select encaissement_id, automatique from gbs.lignes_releve where reference = 'BQ-0001'`))).toMatchObject({ encaissement_id: e, automatique: true });
    await expectError(db, 'GBS_RELEVE_DEJA_IMPORTE', `select * from gbs.importer_releve($1, 'camt053', $2, '2026-10-01', '2026-10-31', 0, 0, '[]')`, [c, H('a')]);
    // Relevé suivant qui reprend une opération déjà importée : elle n'est pas dupliquée.
    const r2 = await importer(db, c, H('b'), 1000000 + net, 1000000 + net - 2500 - 1000,
      [lignes[1], ligne('2026-10-20', -1000, 'FRAIS SMS'), ligne('2026-10-20', 0.5, 'AGIOS'), ligne('2026-10-20', -0.5, 'AGIOS')], '2026-10-15', '2026-10-31');
    expect([r2.importees, r2.doublons]).toEqual([3, 1]);
    // Contenu bancaire figé, écriture directe impossible.
    await expectError(db, '42501', `update gbs.lignes_releve set montant = 1 where reference = 'BQ-0002'`);
    await expectError(db, '42501', `insert into gbs.lignes_releve (releve_id, compte_id, cle, date_operation, montant, devise, libelle)
      select releve_id, compte_id, 'x', date_operation, 1, devise, 'x' from gbs.lignes_releve limit 1`);
    // Cloisonnement : ni le Hub ni les achats ne voient les comptes de la société.
    for (const u of [m.hub, m.achats]) {
      await as(db, u);
      expect(await rows(db, `select id from gbs.lignes_releve`)).toEqual([]);
      await expectError(db, '42501', `select * from gbs.importer_releve($1, 'camt053', $2, '2026-10-01', '2026-10-31', 0, 0, '[]')`, [c, H('c')]);
    }
  }));

  it('pointage manuel : écart limité enregistré en frais bancaires ; classement motivé ; annulation par l’administratrice', () => withTx(async (db) => {
    const m = await monde(db);
    const c = await compte(db, m, m.ci, 'XOF', 'CI0010010000000002');
    const { d, e, net } = await encaissement(db, m, null);
    const recu = net - 5000;   // la banque du client a retenu 5 000 FCFA de frais
    await as(db, m.comptable);
    await importer(db, c, H('d'), 0, recu - 3000, [ligne('2026-10-11', recu, 'VIR RECU HLA', 'BQ-1'), ligne('2026-10-12', -3000, 'FRAIS VIREMENT', 'BQ-2'),
      ligne('2026-10-13', 1, 'TEST', 'BQ-3'), ligne('2026-10-13', -1, 'TEST', 'BQ-4')]);
    const l = (await one(db, `select id from gbs.lignes_releve where reference = 'BQ-1'`)).id;
    const p = await rows(db, `select type, id, ecart from gbs.propositions_rapprochement($1)`, [l]);
    expect(p.map((x) => [x.type, x.id, Number(x.ecart)])).toEqual([['encaissement', e, 5000]]);
    const debit = (await one(db, `select id from gbs.lignes_releve where reference = 'BQ-2'`)).id;
    await expectError(db, 'GBS_RAPPROCHEMENT_SENS', `select gbs.pointer_ligne_releve($1, $2)`, [debit, e]);
    await db.query(`select gbs.pointer_ligne_releve($1, $2)`, [l, e]);
    const frais = await one(db, `select c.categorie, c.dossier_id, c.montant_ht, c.statut from gbs.lignes_releve l join gbs.couts c on c.id = l.cout_id where l.id = $1`, [l]);
    expect([frais.categorie, frais.dossier_id, Number(frais.montant_ht), frais.statut]).toEqual(['frais_bancaires', d, 5000, 'validee']);
    await expectError(db, 'GBS_LIGNE_DEJA_TRAITEE', `select gbs.pointer_ligne_releve($1, $2)`, [l, e]);
    // Écart hors tolérance (1 %) : refusé.
    const t3 = (await one(db, `select id from gbs.lignes_releve where reference = 'BQ-3'`)).id;
    const autre = await encaissement(db, m, null);
    await as(db, m.comptable);
    await expectError(db, 'GBS_RAPPROCHEMENT_MONTANT', `select gbs.pointer_ligne_releve($1, $2)`, [t3, autre.e]);
    // Frais du relevé : classés en frais généraux, motif obligatoire.
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', `select gbs.classer_ligne_releve($1, 'frais_bancaires', '')`, [debit]);
    await db.query(`select gbs.classer_ligne_releve($1, 'frais_bancaires', 'Frais du virement reçu')`, [debit]);
    expect((await one(db, `select c.frais_generaux from gbs.lignes_releve l join gbs.couts c on c.id = l.cout_id where l.id = $1`, [debit])).frais_generaux).toBe(true);
    const t4 = (await one(db, `select id from gbs.lignes_releve where reference = 'BQ-4'`)).id;
    await db.query(`select gbs.classer_ligne_releve($1, 'autre', 'Virement d’essai de la banque')`, [t4]);
    await expectError(db, '42501', `select gbs.annuler_rapprochement($1, 'Erreur de pointage')`, [t4]);
    await as(db, m.admin);
    await expectError(db, 'GBS_RAPPROCHEMENT_AVEC_FRAIS', `select gbs.annuler_rapprochement($1, 'Erreur de pointage')`, [l]);
    expect((await one(db, `select (gbs.annuler_rapprochement($1, 'Erreur de pointage')).statut s`, [t4])).s).toBe('a_rapprocher');
  }));

  it('encaissement déclaré que la banque ne confirme pas : signalé', () => withTx(async (db) => {
    const m = await monde(db);
    const c = await compte(db, m, m.ci, 'XOF', 'CI0010010000000003');
    const confirme = await encaissement(db, m, 'VIR-OK-0001', '2026-10-05');
    const fantome = await encaissement(db, m, 'VIR-KO-0002', '2026-10-06');
    await as(db, m.comptable);
    await importer(db, c, H('e'), 0, confirme.net, [ligne('2026-10-06', confirme.net, 'VIR VIR-OK-0001', 'BQ-9')]);
    const n = await rows(db, `select encaissement_id from gbs.encaissements_non_confirmes()`);
    expect(n.map((x) => x.encaissement_id)).toEqual([fantome.e]);
  }));

  it('négoce : le débit bancaire confirme le paiement fournisseur exécuté', () => withTx(async (db) => {
    const m = await monde(db);
    const c = await compte(db, m, m.cn, 'USD', 'CN6217000012345678');
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
    const r = await importer(db, c, H('f'), 20000, 5000, [ligne(new Date().toISOString().slice(0, 10), -15000, 'TT PAYMENT FOSHAN SWIFT-77881')],
      new Date(Date.now() - 86400000 * 3).toISOString().slice(0, 10), new Date().toISOString().slice(0, 10));
    expect(r.rapprochees).toBe(1);
    expect((await one(db, `select paiement_id from gbs.lignes_releve where compte_id = $1`, [c])).paiement_id).toBe(p);
    // La comptable de GBS Côte d'Ivoire ne voit pas le compte chinois.
    await as(db, m.comptable);
    expect(await rows(db, `select id from gbs.comptes_bancaires`)).toEqual([]);
  }));
});
