// Portail client : coordonnées d'encaissement désignées par l'administratrice, virement annoncé, rapprochement.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, withTx, type Db } from './helpers';

afterAll(closePool);

async function compte(db: Db, nom: string) {
  await asRoot(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${nom}@client.test`, { nom, app: 'gbs' }]);
  return id;
}

describe('Virements annoncés', () => {
  it('coordonnées de la base ; annonce du client de la facture ; une en attente ; rapprochement par la finance', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const autre = await dossier(db, m, { client: m.clientGA, societe: m.ci });
    await as(db, m.hub);
    const facture = async (dos: string, cli: string, soc: string, devise: string) => {
      const f = (await one(db, `insert into gbs.factures (societe_id, client_id, dossier_id, type, objet, devise) values ($1, $2, $3, 'forfait_consultation', 'Forfait', $4) returning id`, [soc, cli, dos, devise])).id;
      await db.query(`insert into gbs.lignes_facture (facture_id, libelle, prix_unitaire) values ($1, 'Forfait', 500000)`, [f]);
      const e = await one(db, `select statut from gbs.emettre_facture($1)`, [f]);
      if (e.statut === 'en_attente_fne') await db.query(`select gbs.certifier_fne($1, $2, 'https://fne.dgi.gouv.ci/qr/1')`, [f, `DGI-${randomUUID().slice(0, 8)}`]);
      return f as string;
    };
    const f1 = await facture(d, m.clientCI, m.ci, 'XOF');
    await as(db, m.admin);
    const f2 = await facture(autre, m.clientGA, m.cn, 'USD');
    await as(db, m.admin);
    const b1 = (await one(db, `insert into gbs.comptes_bancaires (societe_id, libelle, banque, numero, devise) values ($1, 'Principal', 'SGBCI', 'CI008011110123456789012', 'XOF') returning id`, [m.ci])).id;
    const b2 = (await one(db, `insert into gbs.comptes_bancaires (societe_id, libelle, banque, numero, devise) values ($1, 'Secondaire', 'NSIA', 'CI042011110987654321098', 'XOF') returning id`, [m.ci])).id;
    await as(db, m.comptable);
    await expectError(db, '42501', `select gbs.designer_compte_encaissement($1, true)`, [b1]);
    await expectError(db, '42501', `update gbs.comptes_bancaires set encaissement_clients = true where id = $1`, [b1]);
    await as(db, m.admin);
    await db.query(`select gbs.designer_compte_encaissement($1, true)`, [b1]);
    await db.query(`select gbs.designer_compte_encaissement($1, true)`, [b2]); // un seul compte désigné par société et devise
    expect((await one(db, `select count(*)::int n from gbs.comptes_bancaires where encaissement_clients`)).n).toBe(1);

    const u = await compte(db, 'diallo');
    await as(db, m.admin);
    await db.query(`select gbs.admin_compte_client($1, $2, 'finance')`, [u, m.clientCI]);
    await as(db, u);
    const r = (await one(db, `select gbs.espace_client_dossier($1) c`, [d])).c.reglements;
    expect(r).toEqual([expect.objectContaining({ facture_id: f1, coordonnees: { titulaire: expect.any(String), banque: 'NSIA', numero: 'CI042011110987654321098' } })]);
    await expectError(db, '42501', `select gbs.annoncer_virement($1, $2)`, [f2, { reference: 'VIR 091026 8812' }]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.annoncer_virement($1, $2)`, [f1, { reference: "x'; drop table" }]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.annoncer_virement($1, $2)`, [f1, { reference: 'VIR 1', montant: 5 }]);
    const a = (await one(db, `select gbs.annoncer_virement($1, $2) a`, [f1, { reference: 'VIR 091026 8812', date_virement: null }])).a;
    await expectError(db, 'GBS_DEMANDE_EN_COURS', `select gbs.annoncer_virement($1, $2)`, [f1, { reference: 'VIR 2' }]);
    await expectError(db, '42501', `select gbs.traiter_annonce_virement($1, 'rapprochee')`, [a]);
    // Une annonce n'enregistre aucun encaissement.
    await as(db, m.comptable);
    expect(Number((await one(db, `select encaisse from gbs.factures where id = $1`, [f1])).encaisse)).toBe(0);
    await db.query(`select gbs.traiter_annonce_virement($1, 'rapprochee')`, [a]);
    await expectError(db, 'GBS_DEMANDE_TRAITEE', `select gbs.traiter_annonce_virement($1, 'sans_suite')`, [a]);
    await as(db, u);
    expect((await one(db, `select gbs.espace_client_dossier($1) c`, [d])).c.reglements[0].annonce).toMatchObject({ statut: 'rapprochee' });
  }));
});
