// Lot 1, M17 niveau 1 et M5 : formulaire fournisseur par lien, plis fermés, questions partagées.
import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, fournisseurAgree, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const CHIFFRE = Buffer.from('pli chiffré factice pour le test').toString('base64');
const IV = Buffer.from('123456789012').toString('base64');
const contenu = (montant: number) => JSON.stringify({ sel: 'f3b1c2d4e5f60718', incoterm: 'FOB', lieu: 'Shenzhen', devise: 'USD', montant, delai_jours: 45,
  garantie_mois: 24, cout_global: { puissance_kw: 5, heures_an: 2000, duree_vie_ans: 12, entretien_heures_an: 10, pieces_cout_an: 300,
  pieces_disponibles_ans: 10, sav_afrique: 'Partenaire à Abidjan', delai_pieces_jours: 30 } });

/** Consultation ouverte (date limite dans une heure) avec deux fournisseurs invités. */
async function preparer(db: Db, m: Monde) {
  const d = await dossier(db, m);
  const f2 = await fournisseurAgree(db, m, 'Guangzhou Tiles Ltd');
  await as(db, m.achats);
  const rfq = (await one(db, `insert into gbs.consultations_fournisseurs (dossier_id, objet, quantite, date_limite)
    values ($1, 'Chambre froide 60 m3', 1, now() + interval '1 hour') returning id`, [d])).id as string;
  for (const f of [m.fournisseur, f2]) await db.query(`insert into gbs.consultation_invites (consultation_id, fournisseur_id) values ($1, $2)`, [rfq, f]);
  const lien = async (f: string) => (await one(db, `select gbs.creer_lien_fournisseur($1, $2) l`, [rfq, f])).l as { id: string; jeton: string };
  const l1 = await lien(m.fournisseur);
  const l2 = await lien(f2);
  return { d, rfq, f2, l1, l2 };
}
const service = async (db: Db) => {
  await asRoot(db);
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  await db.query(`set local role service_role`);
};
const echeance = async (db: Db, rfq: string) => {
  await asRoot(db);
  await db.query(`alter table gbs.consultations_fournisseurs disable trigger consultations_limite`);
  await db.query(`update gbs.consultations_fournisseurs set date_limite = now() - interval '1 minute' where id = $1`, [rfq]);
  await db.query(`alter table gbs.consultations_fournisseurs enable trigger consultations_limite`);
};

describe('Plis fermés et formulaire fournisseur (M17, M5)', () => {
  it('dépôt par lien avant la date limite ; personne ne lit le pli ; ouverture vérifiée après', () => withTx(async (db) => {
    const m = await monde(db);
    const { rfq, f2, l1, l2 } = await preparer(db, m);
    await service(db);
    const vue = (await one(db, `select gbs.formulaire_fournisseur($1) v`, [l1.jeton])).v;
    expect(vue.consultation.objet).toBe('Chambre froide 60 m3');
    expect(vue.fournisseur).toBe('Foshan Ceramics Co.');
    expect(JSON.stringify(vue)).not.toMatch(/Hôtel|Lagune|clientCI|dossier_id/);
    // Deux versions : seule la dernière compte.
    await db.query(`select gbs.deposer_pli($1, $2, $3, $4, true)`, [l1.jeton, CHIFFRE, IV, sha(contenu(9999))]);
    const accuse = (await one(db, `select gbs.deposer_pli($1, $2, $3, $4, true) a`, [l1.jeton, CHIFFRE, IV, sha(contenu(10000))])).a;
    expect(accuse.empreinte).toBe(sha(contenu(10000)));
    await db.query(`select gbs.deposer_pli($1, $2, $3, $4, false)`, [l2.jeton, CHIFFRE, IV, sha(contenu(11000))]);
    await expectError(db, 'GBS_LIEN_INVALIDE', `select gbs.formulaire_fournisseur($1)`, ['x'.repeat(43)]);
    // L'équipe voit qu'un pli est déposé, jamais son contenu ; aucune ouverture avant la date limite.
    await as(db, m.admin);
    expect((await rows(db, `select statut from gbs.plis where consultation_id = $1 order by depose_le`, [rfq])).map((x) => x.statut))
      .toEqual(['remplace', 'depose', 'depose']);
    await expectError(db, '42501', `select chiffre from gbs.plis`);
    await expectError(db, '42501', `select empreinte from gbs.liens_fournisseurs`);
    expect(await rows(db, `select * from gbs.plis_a_ouvrir($1)`, [rfq])).toEqual([]);
    await expectError(db, 'GBS_DATE_LIMITE_AVANCEE', `update gbs.consultations_fournisseurs set date_limite = now() - interval '1 minute' where id = $1`, [rfq]);
    await expectError(db, '42501', `update gbs.plis set statut = 'ouvert' where consultation_id = $1`, [rfq]);
    await expectError(db, '42501', `insert into gbs.offres (consultation_id, fournisseur_id, recu_le, canal, incoterm, lieu, devise, montant)
      values ($1, $2, now(), 'formulaire', 'FOB', 'Shenzhen', 'USD', 1)`, [rfq, m.fournisseur]);
    expect((await one(db, `select count(*)::int n from gbs.journal_audit where action = 'tentative_ouverture_anticipee'`)).n).toBe(1);
    await expectError(db, 'GBS_PLI_FERME', `select gbs.ouvrir_plis($1, '[]')`, [rfq]);
    // Date limite passée : plis chiffrés livrés, contenu vérifié contre l'empreinte.
    await echeance(db, rfq);
    await service(db);
    await expectError(db, 'GBS_CONSULTATION_CLOSE', `select gbs.deposer_pli($1, $2, $3, $4, true)`, [l1.jeton, CHIFFRE, IV, sha(contenu(1))]);
    await as(db, m.achats);
    const plis = await rows(db, `select pli_id, fournisseur_id, chiffre from gbs.plis_a_ouvrir($1)`, [rfq]);
    expect(plis).toHaveLength(2);
    const p1 = plis.find((x) => x.fournisseur_id === m.fournisseur)!.pli_id;
    const p2 = plis.find((x) => x.fournisseur_id === f2)!.pli_id;
    await expectError(db, 'GBS_PLI_ALTERE', `select gbs.ouvrir_plis($1, $2)`, [rfq, JSON.stringify([{ pli_id: p1, contenu: contenu(5000) }])]);
    expect((await one(db, `select gbs.ouvrir_plis($1, $2) n`, [rfq, JSON.stringify([{ pli_id: p1, contenu: contenu(10000) }, { pli_id: p2, contenu: contenu(11000) }])])).n).toBe(2);
    const o = await rows(db, `select fournisseur_id, canal, montant, cout_global from gbs.offres where consultation_id = $1 order by montant`, [rfq]);
    expect(o.map((x) => [x.canal, Number(x.montant)])).toEqual([['formulaire', 10000], ['formulaire', 11000]]);
    expect(o[0].cout_global.sav_afrique).toBe('Partenaire à Abidjan');
    await expectError(db, 'GBS_OFFRE_PLI_FIGEE', `update gbs.offres set montant = 9000 where consultation_id = $1 and fournisseur_id = $2`, [rfq, m.fournisseur]);
    await db.query(`update gbs.offres set note_technique = 4 where consultation_id = $1 and fournisseur_id = $2`, [rfq, m.fournisseur]);
    await expectError(db, 'GBS_PLI_INCONNU', `select gbs.ouvrir_plis($1, $2)`, [rfq, JSON.stringify([{ pli_id: p1, contenu: contenu(10000) }])]);
  }));

  it('questions : réponse publiée à tous sans l’auteur ; lien révoqué ou remplacé inutilisable', () => withTx(async (db) => {
    const m = await monde(db);
    const { l1, l2, rfq } = await preparer(db, m);
    await service(db);
    await db.query(`select gbs.poser_question_fournisseur($1, 'Le compresseur doit-il être de marque européenne ?')`, [l1.jeton]);
    expect((await one(db, `select gbs.formulaire_fournisseur($1) v`, [l2.jeton])).v.questions).toEqual([]);
    await as(db, m.achats);
    const q = (await one(db, `select id from gbs.questions_consultation where consultation_id = $1`, [rfq])).id;
    await db.query(`select gbs.repondre_question_consultation($1, 'Non, toute marque certifiée CE est acceptée.')`, [q]);
    await service(db);
    const vue2 = (await one(db, `select gbs.formulaire_fournisseur($1) v`, [l2.jeton])).v;
    expect(vue2.questions).toEqual([expect.objectContaining({ reponse: 'Non, toute marque certifiée CE est acceptée.', mienne: false })]);
    expect(JSON.stringify(vue2)).not.toContain('Foshan');
    await as(db, m.achats);
    await db.query(`select gbs.creer_lien_fournisseur($1, $2)`, [rfq, m.fournisseur]);   // nouveau lien : l'ancien est révoqué
    await db.query(`select gbs.revoquer_lien_fournisseur($1)`, [l2.id]);
    await service(db);
    for (const l of [l1, l2]) await expectError(db, 'GBS_LIEN_INVALIDE', `select gbs.formulaire_fournisseur($1)`, [l.jeton]);
    // Les fonctions du formulaire ne sont pas ouvertes aux utilisateurs connectés.
    await as(db, m.achats);
    await expectError(db, '42501', `select gbs.formulaire_fournisseur($1)`, [l1.jeton]);
    await as(db, m.hub);
    await expectError(db, '42501', `select gbs.creer_lien_fournisseur($1, $2)`, [rfq, m.fournisseur]);
  }));

  it('plafond de consultations par lien et par heure', () => withTx(async (db) => {
    const m = await monde(db);
    const { l1 } = await preparer(db, m);
    await as(db, m.admin);
    await db.query(`insert into gbs.parametres (cle, valeur, date_effet) values ('fournisseur.consultations_max_heure', '2', current_date)`);
    await service(db);
    await db.query(`select gbs.formulaire_fournisseur($1)`, [l1.jeton]);
    await db.query(`select gbs.formulaire_fournisseur($1)`, [l1.jeton]);
    await expectError(db, 'GBS_TROP_DE_CONSULTATIONS', `select gbs.formulaire_fournisseur($1)`, [l1.jeton]);
  }));
});
