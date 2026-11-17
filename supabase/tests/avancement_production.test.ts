// Avancement de fabrication déclaré par le fournisseur ; publié au client par l'équipe seulement.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, commande, contratSigne, dossier, expectError, fournisseurAgree, mandatSigne, monde, one, withTx, type Db } from './helpers';

afterAll(closePool);

const E = 'b'.repeat(64);
async function compte(db: Db, nom: string, domaine: string) {
  await asRoot(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${nom}@${domaine}`, { nom, app: 'gbs' }]);
  return id;
}
const service = async (db: Db) => {
  await asRoot(db);
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  await db.query(`set local role service_role`);
};

describe('Avancement de production', () => {
  it('fournisseur de la commande seulement ; photos par le service ; jamais de recul ; client après publication', () => withTx(async (db) => {
    const m = await monde(db);
    const autre = await fournisseurAgree(db, m, 'Ningbo Brightlux');
    const d = await dossier(db, m);
    const c = await commande(db, m, d, [{ qte: 6, pu: 23000 }]);
    const c2 = await commande(db, m, d, [{ qte: 2, pu: 99 }], { fournisseur: autre });
    await mandatSigne(db, m, d);
    await contratSigne(db, m, c);
    await contratSigne(db, m, c2);
    const brouillon = await commande(db, m, d, [{ qte: 1, pu: 1 }]);
    const frn = await compte(db, 'liu', 'usine.test');
    const cli = await compte(db, 'kone', 'client.test');
    await as(db, m.achats);
    await db.query(`select gbs.admin_compte_fournisseur($1, $2, 'qualite')`, [frn, m.fournisseur]);
    await as(db, m.admin);
    await db.query(`select gbs.admin_compte_client($1, $2, 'technique')`, [cli, m.clientCI]);

    await as(db, frn, 'aal1');
    await expectError(db, '42501', `select gbs.verifier_depot_photo_production($1)`, [c]);
    await as(db, frn);
    expect((await one(db, `select gbs.verifier_depot_photo_production($1) d`, [c])).d).toBe(d);
    await expectError(db, '42501', `select gbs.verifier_depot_photo_production($1)`, [c2]);
    await expectError(db, '42501', `select gbs.verifier_depot_photo_production($1)`, [brouillon]);
    await expectError(db, '42501', `select gbs.enregistrer_photo_production($1, $2, $3, $4)`, [frn, c, `${d}/${randomUUID()}.jpg`, E]);

    await service(db);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.enregistrer_photo_production($1, $2, $3, $4)`, [frn, c, `${d}/${randomUUID()}.pdf`, E]);
    await expectError(db, '42501', `select gbs.enregistrer_photo_production($1, $2, $3, $4)`, [frn, c2, `${d}/${randomUUID()}.jpg`, E]);
    const p1 = `${d}/${randomUUID()}.jpg`;
    await db.query(`select gbs.enregistrer_photo_production($1, $2, $3, $4)`, [frn, c, p1, E]);

    await as(db, frn);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.declarer_avancement($1, 120)`, [c]);
    const a1 = (await one(db, `select gbs.declarer_avancement($1, 40, 'Tambours assemblés') a`, [c])).a;
    await expectError(db, 'GBS_TROP_DE_DEPOTS', `select gbs.declarer_avancement($1, 50)`, [c]);
    expect((await one(db, `select gbs.espace_fournisseur() e`)).e.commandes.find((x: any) => x.id === c)).toMatchObject({ avancement: 40, photos: 1, photos_en_attente: 0 });
    expect((await one(db, `select gbs_private.document_visible('gbs-documents', $1) v`, [p1])).v).toBe(true);
    await asRoot(db);
    // Mise en place du test : la déclaration date de deux heures (le déclencheur l'interdirait).
    await db.query(`alter table gbs.avancements_production disable trigger avancements_production_rpc`);
    await db.query(`update gbs.avancements_production set cree_le = cree_le - interval '2 hours' where id = $1`, [a1]);
    await db.query(`alter table gbs.avancements_production enable trigger avancements_production_rpc`);
    await as(db, frn);
    await expectError(db, 'GBS_AVANCEMENT_RECUL', `select gbs.declarer_avancement($1, 30)`, [c]);

    // Client : rien avant publication ; publication par l'équipe seulement.
    await as(db, cli);
    let p = (await one(db, `select gbs.espace_client_dossier($1) c`, [d])).c.production;
    expect(p.commandes.find((x: any) => x.avancement)).toBeUndefined();
    expect((await one(db, `select gbs_private.document_visible('gbs-documents', $1) v`, [p1])).v).toBe(false);
    await expectError(db, '42501', `select gbs.publier_avancement_client($1, true)`, [a1]);
    await as(db, frn);
    await expectError(db, '42501', `select gbs.publier_avancement_client($1, true)`, [a1]);
    await as(db, m.achats);
    await db.query(`select gbs.publier_avancement_client($1, true)`, [a1]);
    await as(db, cli);
    p = (await one(db, `select gbs.espace_client_dossier($1) c`, [d])).c.production;
    const k = p.commandes.find((x: any) => x.avancement);
    expect(k.avancement.pct).toBe(40);
    expect(k.photos.map((x: any) => x.chemin)).toEqual([p1]);
    expect((await one(db, `select gbs_private.document_visible('gbs-documents', $1) v`, [p1])).v).toBe(true);
    // Une déclaration ne se modifie pas.
    await as(db, m.admin);
    await expectError(db, '42501', `update gbs.avancements_production set pct = 90 where id = $1`, [a1]);
  }));
});
