// Lot 1, M17 niveau 1 et M16 : pièces de due diligence déposées par le fournisseur, par lien.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, expectError, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

const H = 'a'.repeat(64);
const service = async (db: Db) => {
  await asRoot(db);
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  await db.query(`set local role service_role`);
};
async function preparer(db: Db, m: Monde) {
  await as(db, m.achats);
  const f = (await one(db, `insert into gbs.fournisseurs (raison_sociale_en, categories) values ('Shunde Cold Chain Co.', '{Froid}') returning id`)).id;
  const dd = (await one(db, `insert into gbs.due_diligences (fournisseur_id) values ($1) returning id`, [f])).id as string;
  const l = (await one(db, `select gbs.creer_lien_due_diligence($1) l`, [dd])).l as { id: string; jeton: string };
  return { f, dd, l };
}
const chemin = (dd: string, n: number) => `dd/${dd}/${String(n).padStart(8, '0')}-1111-4222-8333-444444444444.pdf`;

describe('Pièces de due diligence par lien (M17, M16)', () => {
  it('dépôt par lien, chemin contrôlé ; acceptation ou refus motivé ; lien caduc une fois la due diligence statuée', () => withTx(async (db) => {
    const m = await monde(db);
    const { dd, l } = await preparer(db, m);
    await service(db);
    const vue = (await one(db, `select gbs.formulaire_due_diligence($1) v`, [l.jeton])).v;
    expect(vue.fournisseur).toBe('Shunde Cold Chain Co.');
    expect(JSON.stringify(vue)).not.toMatch(/grille|note|conclusion/);
    await db.query(`select gbs.enregistrer_piece_due_diligence($1, 'licence_commerciale', 'Licence 营业执照', $2, $3, 1200)`, [l.jeton, chemin(dd, 1), H]);
    await db.query(`select gbs.enregistrer_piece_due_diligence($1, 'licence_export', null, $2, $3, 900)`, [l.jeton, chemin(dd, 2), H]);
    // Chemin d'une autre due diligence ou hors du dossier : refusé.
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.enregistrer_piece_due_diligence($1, 'autre', null, $2, $3, 10)`,
      [l.jeton, chemin('00000000-0000-4000-8000-000000000000', 3), H]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.enregistrer_piece_due_diligence($1, 'autre', null, $2, $3, 10)`,
      [l.jeton, `dd/${dd}/../../secret.pdf`, H]);
    await expectError(db, '23514', `select gbs.enregistrer_piece_due_diligence($1, 'inconnu', null, $2, $3, 10)`, [l.jeton, chemin(dd, 4), H]);
    // L'équipe statue ; le fournisseur voit le motif d'un refus.
    await as(db, m.achats);
    const p = await rows(db, `select id, type, canal from gbs.pieces_due_diligence where due_diligence_id = $1 order by type`, [dd]);
    expect(p.map((x) => [x.type, x.canal])).toEqual([['licence_commerciale', 'lien'], ['licence_export', 'lien']]);
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', `select gbs.statuer_piece_due_diligence($1, 'refusee')`, [p[1].id]);
    await db.query(`select gbs.statuer_piece_due_diligence($1, 'refusee', 'Licence expirée en 2025')`, [p[1].id]);
    await db.query(`select gbs.statuer_piece_due_diligence($1, 'acceptee')`, [p[0].id]);
    await expectError(db, '42501', `update gbs.pieces_due_diligence set chemin = $2 where id = $1`, [p[0].id, chemin(dd, 9)]);
    await service(db);
    const v2 = (await one(db, `select gbs.formulaire_due_diligence($1) v`, [l.jeton])).v;
    expect(v2.pieces.map((x: any) => [x.type, x.statut, x.motif_refus])).toEqual([
      ['licence_commerciale', 'acceptee', null], ['licence_export', 'refusee', 'Licence expirée en 2025']]);
    // Due diligence statuée : le lien ne sert plus.
    await as(db, m.achats);
    await db.query(`update gbs.due_diligences set grille = '[{"critere":"Existence légale","poids":100,"note":4}]' where id = $1`, [dd]);
    await as(db, m.admin);
    await db.query(`select gbs.valider_due_diligence($1, 'validee', 'Conforme')`, [dd]);
    await service(db);
    await expectError(db, 'GBS_LIEN_INVALIDE', `select gbs.formulaire_due_diligence($1)`, [l.jeton]);
  }));

  it('cloisonnement : lien remplacé révoqué ; ni le Hub ni la comptable ne voient les pièces ; fonctions du lien fermées aux utilisateurs', () => withTx(async (db) => {
    const m = await monde(db);
    const { dd, l } = await preparer(db, m);
    await as(db, m.achats);
    await db.query(`select gbs.creer_lien_due_diligence($1)`, [dd]);
    await service(db);
    await expectError(db, 'GBS_LIEN_INVALIDE', `select gbs.formulaire_due_diligence($1)`, [l.jeton]);
    for (const u of [m.hub, m.comptable, m.inspecteur]) {
      await as(db, u);
      expect(await rows(db, `select id from gbs.pieces_due_diligence`)).toEqual([]);
      expect((await one(db, `select gbs_private.document_visible('gbs-documents', $1) v`, [chemin(dd, 1)])).v).toBe(false);
      await expectError(db, '42501', `select gbs.creer_lien_due_diligence($1)`, [dd]);
    }
    await as(db, m.achats);
    expect((await one(db, `select gbs_private.document_visible('gbs-documents', $1) v`, [chemin(dd, 1)])).v).toBe(true);
    await expectError(db, '42501', `select gbs.formulaire_due_diligence($1)`, [l.jeton]);
    await expectError(db, '42501', `insert into gbs.pieces_due_diligence (due_diligence_id, type, chemin, empreinte, taille, canal, lien_id)
      values ($1, 'autre', $2, $3, 10, 'lien', $4)`, [dd, chemin(dd, 5), H, l.id]);
  }));
});
