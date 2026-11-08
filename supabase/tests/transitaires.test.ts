// Lot 1, M9 : formulaire du transitaire par lien sécurisé.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

const H = 'b'.repeat(64);
const service = async (db: Db) => {
  await asRoot(db);
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  await db.query(`set local role service_role`);
};
async function preparer(db: Db, m: Monde) {
  const d = await dossier(db, m);
  await as(db, m.achats);
  const e = (await one(db, `insert into gbs.expeditions (dossier_id, mode, pays_destination, port_depart, port_arrivee, eta)
    values ($1, 'conteneur_complet', 'CI', 'Nansha', 'Abidjan', current_date + 30) returning id`, [d])).id as string;
  const l = (await one(db, `select gbs.creer_lien_transitaire($1, 'Bolloré Logistics Guangzhou') l`, [e])).l as { id: string; jeton: string };
  return { d, e, l };
}
const chemin = (d: string, n: number) => `${d}/${String(n).padStart(8, '0')}-1111-4222-8333-444444444444.pdf`;

describe('Formulaire du transitaire (M9)', () => {
  it('le transitaire ne voit que son expédition, saisit étapes et transport ; ses étapes attendent la publication', () => withTx(async (db) => {
    const m = await monde(db);
    const { d, e, l } = await preparer(db, m);
    await service(db);
    const vue = (await one(db, `select gbs.formulaire_transitaire($1) v`, [l.jeton])).v;
    expect(vue.expedition).toMatchObject({ port_depart: 'Nansha', port_arrivee: 'Abidjan' });
    expect(JSON.stringify(vue)).not.toMatch(/Hôtel|Lagune|montant|prix|dossier_id|client/);
    await db.query(`select gbs.ajouter_etape_transitaire($1, 'depart_port', 'Nansha', now() - interval '2 hours', 'Navire parti à l''heure')`, [l.jeton]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.ajouter_etape_transitaire($1, 'depart_port', 'Nansha', now() + interval '3 days', null)`, [l.jeton]);
    await expectError(db, '23514', `select gbs.ajouter_etape_transitaire($1, 'teleportation', null, now(), null)`, [l.jeton]);
    await db.query(`select gbs.maj_expedition_transitaire($1, $2)`, [l.jeton, JSON.stringify({ navire: 'MSC ADRIANA', eta: '2026-12-20', conteneurs: ['MSCU1234567'], numero_connaissement: 'MEDU12345678' })]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.maj_expedition_transitaire($1, $2)`, [l.jeton, JSON.stringify({ statut: 'livree' })]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.maj_expedition_transitaire($1, $2)`, [l.jeton, JSON.stringify({ conteneurs: ['pas-un-conteneur'] })]);
    await db.query(`select gbs.enregistrer_document_transitaire($1, 'connaissement', 'B/L original scanné', $2, $3, 2048)`, [l.jeton, chemin(d, 1), H]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.enregistrer_document_transitaire($1, 'connaissement', null, $2, $3, 10)`,
      [l.jeton, chemin('00000000-0000-4000-8000-000000000000', 2), H]);
    await asRoot(db);
    const exp = await one(db, `select navire, eta::text, conteneurs, eta_initiale::text <> eta::text as eta_change from gbs.expeditions where id = $1`, [e]);
    expect([exp.navire, exp.eta, exp.conteneurs, exp.eta_change]).toEqual(['MSC ADRIANA', '2026-12-20', ['MSCU1234567'], true]);
    // L'étape du transitaire est masquée au client jusqu'à sa publication par l'équipe.
    const et = await one(db, `select id, visible_client, source from gbs.expedition_etapes where expedition_id = $1`, [e]);
    expect([et.visible_client, et.source]).toEqual([false, 'transitaire']);
    await as(db, m.inspecteur);
    await expectError(db, '42501', `select gbs.publier_etape_transitaire($1)`, [et.id]);
    await as(db, m.achats);
    await db.query(`select gbs.publier_etape_transitaire($1)`, [et.id]);
    expect((await one(db, `select visible_client from gbs.expedition_etapes where id = $1`, [et.id])).visible_client).toBe(true);
    // L'équipe ne peut pas se faire passer pour le transitaire.
    await expectError(db, '42501', `insert into gbs.expedition_etapes (expedition_id, etape, survenue_le, source) values ($1, 'autre', now(), 'transitaire')`, [e]);
    expect((await rows(db, `select type from gbs.documents_transitaires where expedition_id = $1`, [e])).map((x) => x.type)).toEqual(['connaissement']);
  }));

  it('lien remplacé ou expédition livrée : lien inutilisable ; fonctions du lien fermées aux utilisateurs', () => withTx(async (db) => {
    const m = await monde(db);
    const { e, l } = await preparer(db, m);
    await as(db, m.achats);
    const l2 = (await one(db, `select gbs.creer_lien_transitaire($1, 'Autre transitaire') l`, [e])).l as { jeton: string };
    await service(db);
    await expectError(db, 'GBS_LIEN_INVALIDE', `select gbs.formulaire_transitaire($1)`, [l.jeton]);
    await db.query(`select gbs.formulaire_transitaire($1)`, [l2.jeton]);
    await asRoot(db);
    await db.query(`select set_config('gbs.rpc', 'changer_statut_expedition', true)`);
    await db.query(`update gbs.expeditions set statut = 'livree' where id = $1`, [e]);
    await service(db);
    await expectError(db, 'GBS_LIEN_INVALIDE', `select gbs.formulaire_transitaire($1)`, [l2.jeton]);
    await as(db, m.achats);
    await expectError(db, '42501', `select gbs.formulaire_transitaire($1)`, [l2.jeton]);
    await as(db, m.comptable);
    await expectError(db, '42501', `select gbs.creer_lien_transitaire($1, 'X')`, [e]);
  }));
});
