// Portail client avec compte : rattachement, cloisonnement entre clients, documents visibles seulement.
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
    // Le client se connecte (sans double facteur, comme les autres comptes externes aujourd'hui).
    await as(db, u, 'aal1');
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
    await as(db, u, 'aal1');
    await expectError(db, '42501', `update gbs.profils set client_id = $2 where id = $1`, [u, m.clientGA]);
    await expectError(db, '42501', `update gbs.profils set sous_role = 'valideur' where id = $1`, [u]);
    await as(db, m.hub);
    await expectError(db, '42501', `select gbs.espace_client()`);
    // Retour à un rôle interne : rattachement effacé.
    await as(db, m.admin);
    await db.query(`select gbs.admin_definir_profil($1, 'comptable', $2)`, [u, [m.ci]]);
    expect(await one(db, `select role, client_id, sous_role from gbs.profils where id = $1`, [u])).toEqual({ role: 'comptable', client_id: null, sous_role: null });
  }));
});
