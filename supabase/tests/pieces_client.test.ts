// Portail client : transmission des pièces attendues (droit vérifié avec la session, enregistrement par le service).
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, withTx, type Db } from './helpers';

afterAll(closePool);

const E = 'a'.repeat(64);
async function compte(db: Db, nom: string) {
  await asRoot(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${nom}@client.test`, { nom, app: 'gbs' }]);
  return id;
}
const service = async (db: Db) => {
  await asRoot(db);
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  await db.query(`set local role service_role`);
};

describe('Pièces transmises par le client', () => {
  it('pièce attendue de lui seulement ; enregistrement par le service ; reçue puis non redéposable', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const autre = await dossier(db, m, { client: m.clientGA, societe: m.ci });
    await asRoot(db);
    const piece = (await one(db, `select id from gbs.pieces where dossier_id = $1 and fournie_par = 'client' and statut = 'manquante' order by phase, code limit 1`, [d])).id;
    const interne = (await one(db, `select id from gbs.pieces where dossier_id = $1 and fournie_par is distinct from 'client' limit 1`, [d])).id;
    const etrangere = (await one(db, `select id from gbs.pieces where dossier_id = $1 and fournie_par = 'client' limit 1`, [autre])).id;
    const u = await compte(db, 'kouame');
    await as(db, m.admin);
    await db.query(`select gbs.admin_compte_client($1, $2, 'technique')`, [u, m.clientCI]);

    await as(db, u, 'aal1');
    await expectError(db, '42501', `select gbs.verifier_depot_piece_client($1)`, [piece]);
    await as(db, u);
    expect((await one(db, `select gbs.verifier_depot_piece_client($1) d`, [piece])).d).toBe(d);
    await expectError(db, '42501', `select gbs.verifier_depot_piece_client($1)`, [interne]);
    await expectError(db, '42501', `select gbs.verifier_depot_piece_client($1)`, [etrangere]);
    const depots = (await one(db, `select gbs.espace_client_dossier($1) c`, [d])).c.depots;
    expect(depots.map((x: any) => x.id)).toContain(piece);
    expect(JSON.stringify(depots)).not.toContain(interne);
    // Le compte ne rattache jamais lui-même un fichier à une pièce.
    await expectError(db, '42501', `select gbs.enregistrer_piece_client($1, $2, $3, $4)`, [u, piece, `${d}/${randomUUID()}.pdf`, E]);
    await expectError(db, '42501', `select gbs.deposer_piece($1, $2, $3)`, [piece, `${d}/${randomUUID()}.pdf`, E]);

    await service(db);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.enregistrer_piece_client($1, $2, $3, $4)`, [u, piece, `${autre}/${randomUUID()}.pdf`, E]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.enregistrer_piece_client($1, $2, $3, $4)`, [u, piece, `${d}/../x.pdf`, E]);
    await expectError(db, '42501', `select gbs.enregistrer_piece_client($1, $2, $3, $4)`, [m.hub, piece, `${d}/${randomUUID()}.pdf`, E]);
    await expectError(db, '42501', `select gbs.enregistrer_piece_client($1, $2, $3, $4)`, [u, etrangere, `${autre}/${randomUUID()}.pdf`, E]);
    const chemin = `${d}/${randomUUID()}.pdf`;
    await db.query(`select gbs.enregistrer_piece_client($1, $2, $3, $4)`, [u, piece, chemin, E]);
    await asRoot(db);
    expect(await one(db, `select statut, document_chemin, statut_par from gbs.pieces where id = $1`, [piece])).toEqual({ statut: 'recue', document_chemin: chemin, statut_par: u });
    // Reçue : plus déposable tant que l'équipe ne l'a pas refusée.
    await as(db, u);
    await expectError(db, '42501', `select gbs.verifier_depot_piece_client($1)`, [piece]);
    await as(db, m.hub);
    await db.query(`select gbs.statuer_piece($1, 'refusee', 'Scan illisible')`, [piece]);
    await as(db, u);
    expect((await one(db, `select gbs.verifier_depot_piece_client($1) d`, [piece])).d).toBe(d);
    expect(JSON.stringify((await one(db, `select gbs.espace_client_dossier($1) c`, [d])).c.depots)).not.toContain('illisible');
  }));
});
