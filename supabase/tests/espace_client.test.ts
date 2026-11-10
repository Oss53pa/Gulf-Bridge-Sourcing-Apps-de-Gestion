// Portail client avec compte : rattachement, cloisonnement entre clients, documents visibles seulement.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, commande, dossier, expectError, inspectionValidee, monde, one, withTx, type Db } from './helpers';

afterAll(closePool);

async function compte(db: Db, nom: string) {
  await asRoot(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${nom}@client.test`, { nom, app: 'gbs' }]);
  return id;
}

describe('Espace client', () => {
  it('le client ne voit que ses dossiers ; contenu identique au suivi ; documents filtrés', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const autre = await dossier(db, m, { client: m.clientGA, societe: m.ci });
    await asRoot(db);
    await db.query(`select set_config('gbs.rpc', 'systeme', true)`);
    await db.query(`update gbs.pieces set statut = 'validee', document_chemin = $1 || '/11111111-1111-4111-8111-111111111111.pdf'
                     where dossier_id = $1 and code in ('certificat_inspection', 'grille_analyse')`, [d]);
    await db.query(`select set_config('gbs.rpc', '', true)`);
    const u = await compte(db, 'kouassi');
    await as(db, m.admin);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.admin_compte_client($1, $2, 'directeur')`, [u, m.clientCI]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.admin_definir_profil($1, 'client', '{}')`, [u]);
    await db.query(`select gbs.admin_compte_client($1, $2, 'valideur')`, [u, m.clientCI]);
    // Sans double facteur : aucun accès au portail.
    await as(db, u, 'aal1');
    await expectError(db, '42501', `select gbs.espace_client()`);
    await as(db, u);
    const e = (await one(db, `select gbs.espace_client() e`)).e;
    expect(e.dossiers.map((x: any) => x.id)).toEqual([d]);
    const c = (await one(db, `select gbs.espace_client_dossier($1) c`, [d])).c;
    expect(c.documents.map((x: any) => x.libelle)).toEqual(["Certificat d'inspection"]);
    await expectError(db, '42501', `select gbs.espace_client_dossier($1)`, [autre]);
    // Stockage : document visible lisible, document non visible refusé.
    const chemin = `${d}/11111111-1111-4111-8111-111111111111.pdf`;
    expect((await one(db, `select gbs_private.document_visible('gbs-documents', $1) v`, [chemin])).v).toBe(true);
    expect((await one(db, `select gbs_private.document_visible('gbs-documents', $1) v`, [`${autre}/11111111-1111-4111-8111-111111111111.pdf`])).v).toBe(false);
    // Aucune lecture directe des tables internes.
    expect((await db.query(`select id from gbs.dossiers`)).rows).toEqual([]);
    expect((await db.query(`select id from gbs.factures`)).rows).toEqual([]);
  }));

  it('un client ne change jamais lui-même son rattachement ni son sous-rôle ; un interne n’a pas d’espace client', () => withTx(async (db) => {
    const m = await monde(db);
    const u = await compte(db, 'yao');
    await as(db, m.admin);
    await db.query(`select gbs.admin_compte_client($1, $2, 'demandeur')`, [u, m.clientCI]);
    await as(db, u);
    await expectError(db, '42501', `update gbs.profils set client_id = $2 where id = $1`, [u, m.clientGA]);
    await expectError(db, '42501', `update gbs.profils set sous_role = 'valideur' where id = $1`, [u]);
    await as(db, m.hub);
    await expectError(db, '42501', `select gbs.espace_client()`);
    // Retour à un rôle interne : rattachement effacé.
    await as(db, m.admin);
    await db.query(`select gbs.admin_definir_profil($1, 'comptable', $2)`, [u, [m.ci]]);
    expect(await one(db, `select role, client_id, sous_role from gbs.profils where id = $1`, [u])).toEqual({ role: 'comptable', client_id: null, sous_role: null });
  }));
  it('production et qualité : sans prix, fabricant seulement en achat accompagné, résultats après validation', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const n = await dossier(db, m, { modele: 'negoce', societe: m.cn });
    const c = await commande(db, m, d, [{ qte: 1200, pu: 40 }]);
    const cn = await commande(db, m, n, [{ qte: 50, pu: 9 }]);
    await commande(db, m, d, [{ qte: 3, pu: 1 }]); // brouillon : jamais montré
    await asRoot(db);
    await db.query(`select set_config('gbs.rpc', 'changer_statut_commande', true)`);
    await db.query(`update gbs.commandes set statut = 'en_production' where id = any($1)`, [[c, cn]]);
    await db.query(`select set_config('gbs.rpc', '', true)`);
    await inspectionValidee(db, m, c, { maj: 2, min: 1 });
    await as(db, m.achats);
    const i2 = (await one(db, `insert into gbs.inspections (commande_id, type, inspecteur_id, taille_lot) values ($1, 'en_production', $2, 1200) returning id`, [c, m.inspecteur])).id;
    await as(db, m.inspecteur);
    await db.query(`update gbs.inspections set statut = 'realisee', date_realisee = current_date, defauts_critiques = 1 where id = $1`, [i2]);
    const nc = (await one(db, `insert into gbs.non_conformites (inspection_id, gravite, description) values ($1, 'majeur', 'Fournisseur négligent, émail écaillé') returning id`, [i2])).id;
    const u = await compte(db, 'ama');
    await as(db, m.admin);
    await db.query(`select gbs.admin_compte_client($1, $2, 'technique')`, [u, m.clientCI]);
    await as(db, u);
    expect((await one(db, `select gbs.espace_client_dossier($1) c`, [d])).c.production.non_conformites).toEqual([]);
    // Libellé client : publié par la qualité seulement, jamais écrit directement.
    await as(db, m.achats);
    await expectError(db, 'GBS_VALIDATION_RPC', `update gbs.non_conformites set libelle_client = 'Joint de hublot à reprendre' where id = $1`, [nc]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.publier_nc_client($1, 'court')`, [nc]);
    await as(db, m.hub);
    await expectError(db, '42501', `select gbs.publier_nc_client($1, 'Émail à reprendre sur une unité')`, [nc]);
    await as(db, m.achats);
    await db.query(`select gbs.publier_nc_client($1, 'Émail à reprendre sur une unité')`, [nc]);
    await as(db, u);
    const p = (await one(db, `select gbs.espace_client_dossier($1) c`, [d])).c.production;
    expect(p.commandes).toHaveLength(1);
    expect(p.commandes[0].fabricant).toBeTruthy();
    expect(p.commandes[0].produits).toEqual([expect.objectContaining({ quantite: 1200 })]);
    expect(JSON.stringify(p)).not.toMatch(/prix|montant|"40"/);
    const valide = p.inspections.find((x: any) => x.statut === 'validee');
    expect(valide).toMatchObject({ decision: 'liberation', defauts: { critiques: 0, majeurs: 2, mineurs: 1 } });
    expect(p.inspections.find((x: any) => x.statut === 'realisee')).toMatchObject({ decision: null, defauts: null });
    expect(p.non_conformites).toEqual([expect.objectContaining({ gravite: 'majeur', statut: 'ouverte', libelle: 'Émail à reprendre sur une unité' })]);
    expect(JSON.stringify(p)).not.toMatch(/négligent/);
    const pn = (await one(db, `select gbs.espace_client_dossier($1) c`, [n])).c.production;
    expect(pn.commandes[0].fabricant).toBeNull();
  }));
});
