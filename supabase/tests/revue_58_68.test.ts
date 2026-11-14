// Non-régression des constats de la relecture des portails en production (migration 81).
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, commande, dossier, expectError, monde, one, withTx, type Db } from './helpers';

afterAll(closePool);
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const CHIFFRE = Buffer.from('pli chiffré factice').toString('base64');
const IV = Buffer.from('123456789012').toString('base64');
async function compte(db: Db) {
  await asRoot(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${id}@x.test`, { nom: 'Compte', app: 'gbs' }]);
  return id;
}
const service = async (db: Db) => {
  await asRoot(db);
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  await db.query(`set local role service_role`);
};

describe('Revue des portails (58 à 68)', () => {
  it('un fournisseur sous correspondance confirmée ne lit plus la consultation et ne dépose plus d’offre', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.achats);
    const rfq = (await one(db, `insert into gbs.consultations_fournisseurs (dossier_id, objet, quantite, date_limite)
      values ($1, 'Chambre froide', 1, now() + interval '1 hour') returning id`, [d])).id;
    await db.query(`insert into gbs.consultation_invites (consultation_id, fournisseur_id) values ($1, $2)`, [rfq, m.fournisseur]);
    const com = await compte(db);
    await as(db, m.achats);
    await db.query(`select gbs.admin_compte_fournisseur($1, $2, 'commercial')`, [com, m.fournisseur]);
    await as(db, com);
    expect((await one(db, `select gbs.formulaire_fournisseur_compte($1) v`, [rfq])).v.peut_deposer).toBe(true);
    await as(db, m.achats);
    await db.query(`select gbs.enregistrer_controle_sanctions($1, $2)`, [m.fournisseur, { listes: ['ofac'], source: 'OFAC', realise_le: new Date().toISOString().slice(0, 10),
      resultat: 'correspondance_confirmee', justification: 'Actionnaire inscrit sur la liste OFAC' }]);
    await as(db, com);
    await expectError(db, '42501', `select gbs.formulaire_fournisseur_compte($1)`, [rfq]);
    await service(db);
    await expectError(db, '42501', `select gbs.deposer_pli_compte($1, $2, $3, $4, $5, true)`, [com, rfq, CHIFFRE, IV, sha('a')]);
  }));

  it('un compte client ne lit un fichier que sous son propre dossier', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const autre = await dossier(db, m, { client: m.clientGA, societe: m.ci });
    const cli = await compte(db);
    await as(db, m.admin);
    await db.query(`select gbs.admin_compte_client($1, $2, 'valideur')`, [cli, m.clientCI]);
    // Une pièce visible du client pointe (par erreur) vers un fichier d'un autre dossier, puis une autre vers le sien.
    const pieces = (await db.query(`select id, code from gbs.pieces where dossier_id = $1 and gbs_private.piece_visible_client(code, 'accompagne') limit 2`, [d])).rows;
    expect(pieces.length).toBeGreaterThan(1);
    const ailleurs = `${autre}/${randomUUID()}.pdf`, chezLui = `${d}/${randomUUID()}.pdf`;
    await asRoot(db);
    for (const [p, chemin] of [[pieces[0].id, ailleurs], [pieces[1].id, chezLui]]) {
      await db.query(`select set_config('gbs.rpc', 'statuer_piece', true)`);
      await db.query(`update gbs.pieces set document_chemin = $2, statut = 'validee' where id = $1`, [p, chemin]);
    }
    await db.query(`select set_config('gbs.rpc', '', true)`);
    await as(db, cli);
    expect((await one(db, `select gbs_private.document_visible('gbs-documents', $1) v`, [ailleurs])).v).toBe(false);
    expect((await one(db, `select gbs_private.document_visible('gbs-documents', $1) v`, [chezLui])).v).toBe(true);
  }));

  it('photos de production : plafond total par commande ; demande de compte : erreur générique', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const k = await commande(db, m, d, [{ qte: 1, pu: 1 }]);
    const f = await compte(db);
    await as(db, m.achats);
    await db.query(`select gbs.admin_compte_fournisseur($1, $2, 'finance')`, [f, m.fournisseur]);
    await as(db, m.admin);
    await db.query(`insert into gbs.parametres (cle, valeur, date_effet, commentaire) values ('production.photos_max_commande', '12', current_date, 'Essai')`);
    await asRoot(db);
    await db.query(`select set_config('gbs.rpc', 'changer_statut_commande', true)`);
    await db.query(`update gbs.commandes set statut = 'en_production' where id = $1`, [k]);
    await db.query(`select set_config('gbs.rpc', 'avancement', true)`);
    // 12 photos déjà rattachées à des avancements : le plafond total est atteint, même sans photo en attente.
    const av = (await one(db, `insert into gbs.avancements_production (commande_id, dossier_id, pct, auteur_id) values ($1, $2, 10, $3) returning id`, [k, d, f])).id;
    for (let i = 0; i < 12; i++) {
      await db.query(`insert into gbs.photos_production (commande_id, dossier_id, chemin, empreinte, auteur_id, avancement_id) values ($1, $2, $3, $4, $5, $6)`,
        [k, d, `${d}/${randomUUID()}.jpg`, sha(String(i)), f, av]);
    }
    await db.query(`select set_config('gbs.rpc', '', true)`);
    await as(db, f);
    await expectError(db, 'GBS_TROP_DE_DEPOTS', `select gbs.verifier_depot_photo_production($1)`, [k]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.demander_compte_fournisseur($1)`, [{ type: 'banque', titulaire: 'Foshan Ceramics Co. Ltd', devise: 'USDX',
      banque: 'Bank of China', numero: '6217000000009999', motif: 'Changement de banque principal' }]);
  }));

  it('liens publics : fournisseur bloqué sans lecture ni dépôt par lien ; mises à jour du transitaire plafonnées', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.achats);
    const rfq = (await one(db, `insert into gbs.consultations_fournisseurs (dossier_id, objet, quantite, date_limite)
      values ($1, 'Chambre froide', 1, now() + interval '1 hour') returning id`, [d])).id;
    await db.query(`insert into gbs.consultation_invites (consultation_id, fournisseur_id) values ($1, $2)`, [rfq, m.fournisseur]);
    const lf = (await one(db, `select gbs.creer_lien_fournisseur($1, $2) l`, [rfq, m.fournisseur])).l as { jeton: string };
    const e = (await one(db, `insert into gbs.expeditions (dossier_id, mode, pays_destination, port_arrivee) values ($1, 'conteneur_complet', 'CI', 'Abidjan') returning id`, [d])).id;
    const lt = (await one(db, `select gbs.creer_lien_transitaire($1, 'Transitaire') l`, [e])).l as { jeton: string };
    await as(db, m.admin);
    await db.query(`insert into gbs.parametres (cle, valeur, date_effet, commentaire) values ('fournisseur.consultations_max_heure', '3', current_date, 'Essai')`);
    await service(db);
    await db.query(`select gbs.formulaire_fournisseur($1)`, [lf.jeton]);
    for (let i = 0; i < 3; i++) await db.query(`select gbs.maj_expedition_transitaire($1, $2)`, [lt.jeton, JSON.stringify({ eta: '2027-01-0' + (i + 1) })]);
    await expectError(db, 'GBS_TROP_DE_CONSULTATIONS', `select gbs.maj_expedition_transitaire($1, $2)`, [lt.jeton, JSON.stringify({ eta: '2027-06-01' })]);
    await as(db, m.achats);
    await db.query(`select gbs.enregistrer_controle_sanctions($1, $2)`, [m.fournisseur, { listes: ['ofac'], source: 'OFAC', realise_le: new Date().toISOString().slice(0, 10),
      resultat: 'correspondance_confirmee', justification: 'Actionnaire inscrit sur la liste OFAC' }]);
    await service(db);
    await expectError(db, 'GBS_LIEN_INVALIDE', `select gbs.formulaire_fournisseur($1)`, [lf.jeton]);
    await expectError(db, 'GBS_LIEN_INVALIDE', `select gbs.deposer_pli($1, $2, $3, $4, true)`, [lf.jeton, CHIFFRE, IV, sha('b')]);
  }));
});
