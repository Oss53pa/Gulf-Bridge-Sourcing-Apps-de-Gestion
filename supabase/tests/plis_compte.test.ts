// Portail fournisseur : réponse à une consultation depuis le compte (lecture, questions, dépôt par la fonction serveur).
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, fournisseurAgree, monde, one, rows, withTx, type Db } from './helpers';

afterAll(closePool);

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const CHIFFRE = Buffer.from('pli chiffré factice pour le test').toString('base64');
const IV = Buffer.from('123456789012').toString('base64');

async function compte(db: Db, nom: string) {
  await asRoot(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${nom}@usine.test`, { nom, app: 'gbs' }]);
  return id;
}
const service = async (db: Db) => {
  await asRoot(db);
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  await db.query(`set local role service_role`);
};

describe('Plis depuis le compte fournisseur', () => {
  it('invité seulement ; lecture sans client ; dépôt par le service pour le commercial ; jamais directement', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const autre = await fournisseurAgree(db, m, 'Ningbo Brightlux');
    await as(db, m.achats);
    const rfq = (await one(db, `insert into gbs.consultations_fournisseurs (dossier_id, objet, quantite, date_limite)
      values ($1, 'Chambre froide 60 m3', 1, now() + interval '1 hour') returning id`, [d])).id as string;
    const rfq2 = (await one(db, `insert into gbs.consultations_fournisseurs (dossier_id, objet, quantite, date_limite)
      values ($1, 'Vitrines réfrigérées', 4, now() + interval '1 hour') returning id`, [d])).id as string;
    await db.query(`insert into gbs.consultation_invites (consultation_id, fournisseur_id) values ($1, $2), ($3, $4)`, [rfq, m.fournisseur, rfq2, autre]);
    const com = await compte(db, 'chen');
    const qual = await compte(db, 'li');
    await as(db, m.achats);
    await db.query(`select gbs.admin_compte_fournisseur($1, $2, 'commercial')`, [com, m.fournisseur]);
    await db.query(`select gbs.admin_compte_fournisseur($1, $2, 'qualite')`, [qual, m.fournisseur]);

    await as(db, com);
    const e = (await one(db, `select gbs.espace_fournisseur() e`)).e;
    expect(e.consultations.map((c: any) => c.id)).toEqual([rfq]);
    const v = (await one(db, `select gbs.formulaire_fournisseur_compte($1) v`, [rfq])).v;
    expect(v).toMatchObject({ fournisseur: 'Foshan Ceramics Co.', peut_deposer: true, pli: null });
    expect(JSON.stringify(v)).not.toMatch(/Hôtel|Lagune|dossier/);
    await expectError(db, '42501', `select gbs.formulaire_fournisseur_compte($1)`, [rfq2]);
    // Le dépôt direct par le compte est impossible (le pli doit être chiffré par la fonction serveur).
    await expectError(db, '42501', `select gbs.deposer_pli_compte($1, $2, $3, $4, $5, true)`, [com, rfq, CHIFFRE, IV, sha('x')]);
    await db.query(`select gbs.poser_question_compte($1, 'Marque du compresseur imposée ?')`, [rfq]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.poser_question_compte($1, 'ok')`, [rfq]);
    await as(db, com, 'aal1');
    await expectError(db, '42501', `select gbs.formulaire_fournisseur_compte($1)`, [rfq]);
    await as(db, qual);
    expect((await one(db, `select gbs.formulaire_fournisseur_compte($1) v`, [rfq])).v.peut_deposer).toBe(false);

    await service(db);
    await expectError(db, '42501', `select gbs.deposer_pli_compte($1, $2, $3, $4, $5, true)`, [qual, rfq, CHIFFRE, IV, sha('a')]);
    await expectError(db, '42501', `select gbs.deposer_pli_compte($1, $2, $3, $4, $5, true)`, [com, rfq2, CHIFFRE, IV, sha('a')]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.deposer_pli_compte($1, $2, $3, $4, 'pas-une-empreinte', true)`, [com, rfq, CHIFFRE, IV]);
    await db.query(`select gbs.deposer_pli_compte($1, $2, $3, $4, $5, false)`, [com, rfq, CHIFFRE, IV, sha('v1')]);
    const a = (await one(db, `select gbs.deposer_pli_compte($1, $2, $3, $4, $5, true) a`, [com, rfq, CHIFFRE, IV, sha('v2')])).a;
    expect(a).toMatchObject({ empreinte: sha('v2'), complet: true });

    await as(db, m.admin);
    expect(await rows(db, `select statut, depose_par = $2 par from gbs.plis where consultation_id = $1 order by depose_le`, [rfq, com]))
      .toEqual([{ statut: 'remplace', par: true }, { statut: 'depose', par: true }]);
    await as(db, com);
    expect((await one(db, `select gbs.formulaire_fournisseur_compte($1) v`, [rfq])).v.pli).toMatchObject({ empreinte: sha('v2'), complet: true });
    expect((await one(db, `select gbs.espace_fournisseur() e`)).e.consultations[0].pli_depose_le).not.toBeNull();
  }));
});
