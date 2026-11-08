// Lot 1, M12 : lettres de crédit et certificat d'inspection rédigé selon le crédit.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, commande, dossier, expectError, inspectionValidee, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

const FORMULATION = 'We hereby certify that the goods have been inspected by Gulf Bridge Sourcing before shipment and found in conformity with the order.';
const DOCS = JSON.stringify([{ document: 'Commercial invoice', originaux: 3, copies: 2 }, { document: 'Inspection certificate issued by Gulf Bridge Sourcing', originaux: 1, mentions: 'Exact wording required' }]);

async function preparer(db: Db, m: Monde, extra: Record<string, unknown> = {}) {
  const d = await dossier(db, m, { extra: { lettre_credit: true } });
  const c = await commande(db, m, d, [{ qte: 1200, pu: 40 }]);   // 48 000 USD
  await as(db, m.achats);
  const vals: Record<string, unknown> = { numero: 'LC/ABJ/2026/0457', banque_emettrice: 'Société Générale Côte d’Ivoire', beneficiaire: 'Foshan Ceramics Co.', montant: 48000,
    devise: 'USD', tolerance_quantite: 0.05, emise_le: '2026-10-01', expire_le: '2027-03-31', derniere_date_expedition: '2027-02-28',
    port_chargement: 'Nansha', port_dechargement: 'Abidjan', emetteur_certificat: 'Gulf Bridge Sourcing (Guangzhou) Co., Ltd',
    formulation_certificat: FORMULATION, documents_exiges: DOCS, ...extra };
  const cols = Object.keys(vals);
  const lc = (await one(db, `insert into gbs.lettres_credit (dossier_id, commande_id, ${cols.join(',')}) values ($1, $2, ${cols.map((_, k) => `$${k + 3}`).join(',')}) returning id`,
    [d, c, ...Object.values(vals)])).id as string;
  return { d, c, lc };
}

describe('Lettres de crédit (M12)', () => {
  it('dossier sans lettre de crédit refusé ; crédit conforme après analyse ; amendement : nouvelle analyse', () => withTx(async (db) => {
    const m = await monde(db);
    const d0 = await dossier(db, m);
    const c0 = await commande(db, m, d0, [{ qte: 1, pu: 10 }]);
    await as(db, m.achats);
    await expectError(db, 'GBS_DOSSIER_SANS_LC', `insert into gbs.lettres_credit (dossier_id, commande_id, numero, banque_emettrice, beneficiaire, montant, devise,
      emise_le, expire_le, derniere_date_expedition, emetteur_certificat) values ($1, $2, 'LC-1', 'Banque', 'Fournisseur', 10, 'USD', current_date, current_date + 60, current_date + 30, 'Gulf Bridge Sourcing')`, [d0, c0]);
    const { lc } = await preparer(db, m);
    await as(db, m.achats);
    expect((await one(db, `select statut, anomalies from gbs.analyser_lc($1)`, [lc]))).toEqual({ statut: 'conforme', anomalies: [] });
    await expectError(db, '42501', `update gbs.lettres_credit set statut = 'conforme' where id = $1`, [lc]);
    await db.query(`update gbs.lettres_credit set montant = 40000 where id = $1`, [lc]);
    expect((await one(db, `select statut from gbs.lettres_credit where id = $1`, [lc])).statut).toBe('saisie');
    const r = await one(db, `select statut, anomalies from gbs.analyser_lc($1)`, [lc]);
    expect(r.statut).toBe('a_amender');
    expect(r.anomalies.map((x: { code: string }) => x.code)).toEqual(['montant_insuffisant']);
  }));

  it('crédit qui ne désigne pas GBS, sans formulation ni certificat exigé : à amender, aucun certificat', () => withTx(async (db) => {
    const m = await monde(db);
    const { c, lc } = await preparer(db, m, { emetteur_certificat: 'Any independent inspection company', formulation_certificat: '',
      documents_exiges: JSON.stringify([{ document: 'Commercial invoice' }]) });
    await as(db, m.achats);
    const r = await one(db, `select anomalies from gbs.analyser_lc($1)`, [lc]);
    expect(r.anomalies.map((x: { code: string }) => x.code)).toEqual(['emetteur_non_gbs', 'formulation_absente', 'certificat_non_exige']);
    const i = await inspectionValidee(db, m, c);
    await as(db, m.admin);
    await expectError(db, 'GBS_LC_NON_CONFORME', `select gbs.emettre_certificat_lc($1, $2)`, [lc, i]);
    await as(db, m.achats);
    await expectError(db, 'GBS_DOCUMENTS_LC_INVALIDES', `update gbs.lettres_credit set documents_exiges = $2 where id = $1`, [lc, JSON.stringify([{ document: 'xx', piege: 1 }])]);
  }));

  it('certificat : formulation exacte, données de la commande et de l’expédition ; incohérences refusées ; figé', () => withTx(async (db) => {
    const m = await monde(db);
    const { d, c, lc } = await preparer(db, m);
    await as(db, m.achats);
    await db.query(`select gbs.analyser_lc($1)`, [lc]);
    const i = await inspectionValidee(db, m, c);
    await as(db, m.achats);
    const e = (await one(db, `insert into gbs.expeditions (dossier_id, mode, pays_destination, port_depart, port_arrivee, etd, numero_connaissement, navire)
      values ($1, 'conteneur_complet', 'CI', 'Shekou', 'Abidjan', current_date + 5, 'COSU6234567890', 'CMA CGM Africa') returning id`, [d])).id;
    await db.query(`insert into gbs.expedition_commandes values ($1, $2)`, [e, c]);
    await expectError(db, 'GBS_VALIDATION_ADMIN', `select gbs.emettre_certificat_lc($1, $2, $3)`, [lc, i, e]);
    await as(db, m.admin);
    const err = await expectError(db, 'GBS_CERTIFICAT_INCOHERENT', `select gbs.emettre_certificat_lc($1, $2, $3)`, [lc, i, e]);
    expect(String(err.message)).toContain('port_chargement');
    await as(db, m.achats);
    await db.query(`update gbs.expeditions set port_depart = 'Nansha' where id = $1`, [e]);
    await as(db, m.admin);
    const cert = await one(db, `select * from gbs.emettre_certificat_lc($1, $2, $3)`, [lc, i, e]);
    expect(cert.formulation).toBe(FORMULATION);
    expect(cert.donnees).toMatchObject({ lc_numero: 'LC/ABJ/2026/0457', connaissement: 'COSU6234567890', taille_lot: 1200, port_chargement: 'Nansha' });
    expect(cert.donnees.articles).toHaveLength(1);
    await asRoot(db);
    await expectError(db, 'P0001', `update gbs.certificats_lc set formulation = 'Autre' where id = $1`, [cert.id]);
    await as(db, m.achats);
    await expectError(db, 'GBS_LC_FIGEE', `update gbs.lettres_credit set montant = 50000 where id = $1`, [lc]);
    await expectError(db, '42501', `insert into gbs.certificats_lc (lettre_credit_id, dossier_id, inspection_id, formulation, donnees, emis_le, emis_par)
      values ($1, $2, $3, 'x', '{}', current_date, $4)`, [lc, d, i, m.achats]);
    // Cloisonnement : agent et inspecteur ne voient rien.
    for (const u of [m.agentGA, m.inspecteur]) {
      await as(db, u);
      expect(await rows(db, `select id from gbs.lettres_credit`)).toEqual([]);
    }
  }));
});
