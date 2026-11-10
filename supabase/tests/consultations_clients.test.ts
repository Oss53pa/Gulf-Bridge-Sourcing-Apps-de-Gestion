// M3 : consultations des clients (section Affaires), étape déduite des faits enregistrés.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

async function forfait(db: Db, m: Monde, d: string) {
  await as(db, m.hub);
  const f = (await one(db, `insert into gbs.factures (societe_id, client_id, dossier_id, type, objet, devise)
    values ($1, $2, $3, 'forfait_consultation', 'Forfait de consultation', 'XOF') returning id`, [m.ci, m.clientCI, d])).id;
  await db.query(`insert into gbs.lignes_facture (facture_id, libelle, service, prix_unitaire) values ($1, 'Consultation', 'S2', 500000)`, [f]);
  await db.query(`select gbs.emettre_facture($1)`, [f]);
  await db.query(`select gbs.certifier_fne($1, 'DGI-2026-000777', 'https://fne.dgi.gouv.ci/qr/000777')`, [f]);
  await asRoot(db);
  return f as string;
}
const etape = async (db: Db, u: string, d: string) => {
  await as(db, u);
  return (await one(db, `select etape, rang, cdc_statut, facture_statut from gbs.consultations_clients() where dossier_id = $1`, [d]));
};
const cdc = async (db: Db, d: string, statut: string) => {
  await asRoot(db);
  await db.query(`select set_config('gbs.rpc', 'systeme', true)`);
  await db.query(`update gbs.pieces set statut = $2, document_chemin = $1 || '/' || gen_random_uuid() || '.pdf'
    where dossier_id = $1 and code = 'client_cdc_signe'`, [d, statut]);
  await db.query(`select set_config('gbs.rpc', '', true)`);
};

describe('Consultations des clients (M3)', () => {
  it('étapes : demande reçue → forfait facturé → réglé → cahier des charges en rédaction → validé', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m, { extra: { forfait_consultation_ht: 500000 } });
    expect(await etape(db, m.hub, d)).toMatchObject({ etape: 'demande_recue', rang: 1, cdc_statut: 'manquante', facture_statut: null });
    const f = await forfait(db, m, d);
    expect((await etape(db, m.hub, d)).etape).toBe('forfait_facture');
    await as(db, m.hub);
    const net = Number((await one(db, `select net_a_payer from gbs.factures where id = $1`, [f])).net_a_payer);
    await db.query(`insert into gbs.encaissements (facture_id, montant, devise, recu_le, mode) values ($1, $2, 'XOF', current_date, 'virement')`, [f, net]);
    expect((await etape(db, m.hub, d)).etape).toBe('forfait_regle');
    await cdc(db, d, 'recue');
    expect((await etape(db, m.hub, d)).etape).toBe('cdc_redaction');
    await cdc(db, d, 'validee');
    const e = await etape(db, m.hub, d);
    expect([e.etape, e.rang]).toEqual(['cdc_valide', 5]);
  }));

  it('forfait au projet : l’étape forfait est acquise sans facture de consultation', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m, { modele: 'equipement_site', extra: { date_ouverture_site: '2027-06-01', forfait_projet_ht: 6000000, taux_commission_projet: 0.04 } });
    expect((await etape(db, m.hub, d)).etape).toBe('forfait_regle');
  }));

  it('réservée aux rôles commerciaux et à la comptabilité ; cloisonnement par pays ; dossiers sans consultation exclus', () => withTx(async (db) => {
    const m = await monde(db);
    const ci = await dossier(db, m);
    const ga = await dossier(db, m, { client: m.clientGA, societe: m.cn });
    const dd = await dossier(db, m, { modele: 'due_diligence' });
    for (const u of [m.achats, m.inspecteur]) {
      await as(db, u);
      await expectError(db, '42501', `select * from gbs.consultations_clients()`);
    }
    await as(db, m.agentGA);
    expect((await rows(db, `select dossier_id from gbs.consultations_clients()`)).map((x) => x.dossier_id)).toEqual([ga]);
    await as(db, m.admin);
    const ids = (await rows(db, `select dossier_id from gbs.consultations_clients()`)).map((x) => x.dossier_id);
    expect(ids).toEqual(expect.arrayContaining([ci, ga]));
    expect(ids).not.toContain(dd);
  }));
});

describe('Formulaire de demande', () => {
  it('besoin et quantité enregistrés sur le dossier, bornés', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m, { by: m.hub, extra: { besoin: 'Mobilier de 40 chambres, normes anti-feu M1', quantite_besoin: '40 chambres' } });
    await as(db, m.hub);
    expect(await one(db, `select besoin, quantite_besoin from gbs.dossiers where id = $1`, [d])).toEqual({ besoin: 'Mobilier de 40 chambres, normes anti-feu M1', quantite_besoin: '40 chambres' });
    await expectError(db, '23514', `update gbs.dossiers set besoin = repeat('x', 4001) where id = $1`, [d]);
  }));
});
