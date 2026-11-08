// Lot 1, M9 : pack documentaire par expédition et contrôle du projet de connaissement.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, commande, dossier, expectError, monde, one, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

const fichier = (d: string, n: number) => `${d}/${String(n).padStart(8, '0')}-cccc-4ddd-8eee-ffffffffffff.pdf`;

async function preparer(db: Db, m: Monde) {
  const d = await dossier(db, m);
  const c = await commande(db, m, d, [{ qte: 100, pu: 40 }]);
  await asRoot(db);
  await db.query(`update gbs.articles set poids_kg = 22 where id = $1`, [m.article]);   // 100 × 22 = 2 200 kg net
  await as(db, m.achats);
  const e = (await one(db, `insert into gbs.expeditions (dossier_id, mode, pays_destination, port_depart, port_arrivee, conteneurs, plombs)
    values ($1, 'conteneur_complet', 'CI', 'Nansha', 'Abidjan', '{MSCU1234567}', '{PL998877}') returning id`, [d])).id as string;
  await db.query(`insert into gbs.expedition_commandes values ($1, $2)`, [e, c]);
  return { d, c, e };
}
const deposer = async (db: Db, d: string, code: string, n: number) => {
  await asRoot(db);
  await db.query(`select set_config('gbs.rpc', 'systeme', true)`);
  await db.query(`update gbs.pieces set statut = 'recue', document_chemin = $3 where dossier_id = $1 and code = $2`, [d, code, fichier(d, n)]);
  await db.query(`select set_config('gbs.rpc', '', true)`);
};
const projet = (extra: Record<string, unknown> = {}) => JSON.stringify({ expediteur: 'Foshan Ceramics Co.', destinataire: 'To order of SGCI',
  port_chargement: 'Nansha', port_dechargement: 'Abidjan', conteneurs: ['mscu1234567'], plombs: ['PL998877'], nombre_colis: 40, poids_brut_kg: 2400,
  date_chargement: '2026-11-05', ...extra });

describe('Pack documentaire (M9)', () => {
  it('liste les pièces attendues par la banque et le transitaire ; complet quand les obligatoires sont là', () => withTx(async (db) => {
    const m = await monde(db);
    const { d, e } = await preparer(db, m);
    await as(db, m.hub);
    let p = (await one(db, `select gbs.pack_documentaire($1) p`, [e])).p;
    expect(p.complet).toBe(false);
    expect(p.elements.map((x: { code: string }) => x.code)).toEqual(['facture_commerciale', 'liste_colisage', 'connaissement', 'certificat_inspection',
      'certificat_origine', 'conformite_pays', 'bordereau_suivi', 'client_domiciliation', 'marchandises_dangereuses', 'attestation_assurance']);
    let n = 0;
    for (const k of ['facture_commerciale', 'liste_colisage', 'connaissement', 'certificat_inspection', 'certificat_origine', 'conformite_pays', 'bordereau_suivi']) {
      await deposer(db, d, k, ++n);
    }
    await asRoot(db);
    await db.query(`update gbs.dossiers set reference_domiciliation = 'DOM-SGCI-2026-0457' where id = $1`, [d]);
    await as(db, m.hub);
    p = (await one(db, `select gbs.pack_documentaire($1) p`, [e])).p;
    expect(p.complet).toBe(true);
    expect(p.elements.find((x: { code: string }) => x.code === 'client_domiciliation').reference).toBe('DOM-SGCI-2026-0457');
    expect(p.elements.find((x: { code: string }) => x.code === 'marchandises_dangereuses').obligatoire).toBe(false);
    for (const u of [m.agentGA, m.inspecteur]) {
      await as(db, u);
      await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.pack_documentaire($1)`, [e]);
    }
  }));
});

describe('Projet de connaissement (M9)', () => {
  it('rapproché de l’expédition et des commandes ; conforme : pièce validée ; contrôle conservé', () => withTx(async (db) => {
    const m = await monde(db);
    const { d, e } = await preparer(db, m);
    await as(db, m.achats);
    const r1 = await one(db, `select * from gbs.controler_projet_connaissement($1, $2, $3)`,
      [e, projet({ port_chargement: 'Shekou', plombs: ['PL000000'], poids_brut_kg: 1800 }), fichier(d, 9)]);
    expect(r1.conforme).toBe(false);
    expect(r1.ecarts.map((x: { code: string }) => x.code)).toEqual(['port_chargement', 'plombs', 'poids_inferieur_net']);
    const r2 = await one(db, `select * from gbs.controler_projet_connaissement($1, $2, $3)`, [e, projet(), fichier(d, 9)]);
    expect(r2.conforme).toBe(true);
    await asRoot(db);
    expect((await one(db, `select statut from gbs.pieces where dossier_id = $1 and code = 'projet_connaissement'`, [d])).statut).toBe('validee');
    await expectError(db, 'P0001', `update gbs.controles_connaissement set conforme = true where id = $1`, [r1.id]);
    await as(db, m.achats);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.controler_projet_connaissement($1, $2, $3)`, [e, projet({ inconnu: 1 }), fichier(d, 9)]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.controler_projet_connaissement($1, $2, $3)`, [e, projet({ poids_brut_kg: -5 }), fichier(d, 9)]);
    await expectError(db, 'GBS_DOCUMENTS_INVALIDES', `select gbs.controler_projet_connaissement($1, $2, $3)`, [e, projet(), '../x.pdf']);
    await as(db, m.hub);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.controler_projet_connaissement($1, $2, $3)`, [e, projet(), fichier(d, 9)]);
  }));

  it('avec lettre de crédit : expéditeur, ports et date de chargement rapprochés du crédit ; certificat selon le crédit dans le pack', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m, { extra: { lettre_credit: true } });
    const c = await commande(db, m, d, [{ qte: 100, pu: 40 }]);
    await as(db, m.achats);
    await db.query(`insert into gbs.lettres_credit (dossier_id, commande_id, numero, banque_emettrice, beneficiaire, montant, devise, emise_le, expire_le,
      derniere_date_expedition, port_chargement, port_dechargement, emetteur_certificat, formulation_certificat, documents_exiges)
      values ($1, $2, 'LC/ABJ/2026/0458', 'SGCI', 'Foshan Ceramics Co.', 4000, 'USD', '2026-10-01', '2027-03-31', '2026-11-30', 'Nansha', 'Abidjan',
      'Gulf Bridge Sourcing', 'We certify the goods have been inspected and found conform.', '[{"document":"Inspection certificate"}]')`, [d, c]);
    const e = (await one(db, `insert into gbs.expeditions (dossier_id, mode, pays_destination, port_depart, port_arrivee) values ($1, 'conteneur_complet', 'CI', 'Nansha', 'Abidjan') returning id`, [d])).id;
    await db.query(`insert into gbs.expedition_commandes values ($1, $2)`, [e, c]);
    const r = await one(db, `select * from gbs.controler_projet_connaissement($1, $2, $3)`,
      [e, projet({ expediteur: 'Another Trading Ltd', date_chargement: '2026-12-15', conteneurs: [], plombs: [] }), fichier(d, 9)]);
    expect(r.ecarts.map((x: { code: string }) => x.code)).toEqual(['expediteur_lc', 'date_chargement_lc']);
    const p = (await one(db, `select gbs.pack_documentaire($1) p`, [e])).p;
    expect(p.lettre_credit).toMatch(/^LC-/);
    expect(p.elements.find((x: { code: string }) => x.code === 'certificat_inspection')).toMatchObject({ selon_lc: true, present: false });
  }));
});
