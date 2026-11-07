// Lot 1, M23 : avenants (prix et planning recalculés) et relance des pièces manquantes.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, commande, contratSigne, dossier, expectError, mandatSigne, monde, one, rows, withTx,
  type Db, type Monde } from './helpers';

afterAll(closePool);

/** Dossier avec commande signée : 1 000 carreaux à 10 USD. */
async function commandeSignee(db: Db) {
  const m = await monde(db);
  const d = await dossier(db, m);
  const c = await commande(db, m, d, [{ qte: 1000, pu: 10 }]);
  await mandatSigne(db, m, d);
  await contratSigne(db, m, c);
  await asRoot(db);
  const ligne = (await one(db, `select id from gbs.lignes_commande where commande_id = $1`, [c])).id as string;
  return { m, d, c, ligne };
}

async function rediger(db: Db, m: Monde, d: string, c: string | null, lignes: unknown[], objets: string[], jours = 0) {
  await as(db, m.achats);
  return (await one(db, `insert into gbs.avenants (dossier_id, commande_id, objets, description, lignes, impact_jours)
    values ($1, $2, $3, 'Quantité portée à 1 200 carreaux à la demande du client', $4, $5) returning id, reference, impact_prix`,
    [d, c, objets, JSON.stringify(lignes), jours]));
}

describe('Avenants', () => {
  it('signé, il met à jour le prix de la commande et décale le planning en jours ouvrés', () => withTx(async (db) => {
    const { m, d, c, ligne } = await commandeSignee(db);
    // Sans avenant, la commande signée est figée.
    await as(db, m.achats);
    await expectError(db, 'GBS_DOCUMENT_SIGNE', `update gbs.lignes_commande set quantite = 1200 where id = $1`, [ligne]);

    await asRoot(db);
    await db.query(`update gbs.dossier_phases set prevue_fin = '2026-07-31' where dossier_id = $1 and phase = 'production'`, [d]);
    const v = await rediger(db, m, d, c, [{ ligne_id: ligne, article_id: m.article, quantite: 1200, prix_unitaire: 10 }],
      ['quantite', 'delai'], 5);
    expect(v.reference).toMatch(/^AVN-2026-\d{3}-01$/);
    expect(Number(v.impact_prix)).toBe(2000);

    // Quatre yeux : l'auteur ne valide pas ; la signature exige la validation.
    await expectError(db, 'GBS_VALIDATION_ADMIN', `select gbs.valider_avenant($1, 'valide')`, [v.id]);
    await as(db, m.admin);
    await expectError(db, 'GBS_AVENANT_NON_VALIDE', `select gbs.signer_avenant($1, $2, current_date)`, [v.id, `${d}/00000000-0000-4000-8000-000000000001.pdf`]);
    await db.query(`select gbs.valider_avenant($1, 'valide')`, [v.id]);
    // Le document signé doit être rangé dans le dossier.
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.signer_avenant($1, 'ailleurs/x.pdf', current_date)`, [v.id]);
    await db.query(`select gbs.signer_avenant($1, $2, current_date)`, [v.id, `${d}/00000000-0000-4000-8000-000000000001.pdf`]);

    await asRoot(db);
    expect(await one(db, `select montant_marchandise::text m, fob_montant::text f from gbs.commandes where id = $1`, [c]))
      .toEqual({ m: '12000.00', f: '12000.00' });
    // 31 juillet 2026 (vendredi) + 5 jours ouvrés en Côte d'Ivoire = vendredi 7 août, férié : lundi 10 août.
    expect((await one(db, `select prevue_fin::text p from gbs.dossier_phases where dossier_id = $1 and phase = 'production'`, [d])).p)
      .toBe('2026-08-10');
    expect((await one(db, `select statut from gbs.avenants where id = $1`, [v.id])).statut).toBe('signe');
    // La commission recalculée suit la nouvelle valeur FOB : 12 000 USD × 600 = 7,2 M FCFA.
    await as(db, m.admin);
    expect(Number((await one(db, `select (gbs.calcul_commission($1) ->> 'base_fob_xof') b`, [d])).b)).toBe(7_200_000);
    // Un avenant signé est figé.
    await expectError(db, 'GBS_AVENANT_FIGE', `update gbs.avenants set description = 'Autre texte modifié' where id = $1`, [v.id]);
  }));

  it('refuse les lignes invalides, les montants sans objet « prix » et les statuts forcés', () => withTx(async (db) => {
    const { m, d, c, ligne } = await commandeSignee(db);
    await as(db, m.achats);
    const base = `insert into gbs.avenants (dossier_id, commande_id, objets, description, lignes) values ($1, $2, $3, 'Modification de test', $4)`;
    await expectError(db, 'GBS_AVENANT_LIGNE_INVALIDE', base, [d, c, ['prix'], JSON.stringify([{ ligne_id: ligne, article_id: m.article, quantite: -5, prix_unitaire: 10 }])]);
    await expectError(db, 'GBS_AVENANT_LIGNE_INVALIDE', base, [d, c, ['prix'], JSON.stringify([{ ligne_id: ligne, article_id: m.article, quantite: 5, prix_unitaire: 10, pirate: 1 }])]);
    await expectError(db, 'GBS_AVENANT_LIGNE_INVALIDE', base, [d, c, ['prix'], JSON.stringify([{ ligne_id: '00000000-0000-4000-8000-000000000009', article_id: m.article, quantite: 5, prix_unitaire: 10 }])]);
    await expectError(db, 'GBS_AVENANT_OBJET', base, [d, c, ['specification'], JSON.stringify([{ ligne_id: ligne, article_id: m.article, quantite: 1000, prix_unitaire: 11 }])]);
    const v = await rediger(db, m, d, c, [{ article_id: m.article, quantite: 10, prix_unitaire: 5 }], ['quantite']);
    await expectError(db, 'GBS_VALIDATION_RPC', `update gbs.avenants set statut = 'signe' where id = $1`, [v.id]);
    // Refus motivé par une autre personne.
    await as(db, m.delegue);
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', `select gbs.valider_avenant($1, 'refuse', '')`, [v.id]);
    await db.query(`select gbs.valider_avenant($1, 'refuse', 'Prix non négocié avec le client')`, [v.id]);
    expect((await one(db, `select statut from gbs.avenants where id = $1`, [v.id])).statut).toBe('refuse');
    // L'agent pays ne voit pas les avenants.
    await as(db, m.agentGA);
    expect(await rows(db, `select id from gbs.avenants`)).toEqual([]);
  }));

  it('un avenant périmé (commande changée entre-temps) n’est pas appliqué', () => withTx(async (db) => {
    const { m, d, c, ligne } = await commandeSignee(db);
    const v1 = await rediger(db, m, d, c, [{ ligne_id: ligne, article_id: m.article, quantite: 1100, prix_unitaire: 10 }], ['quantite']);
    const v2 = await rediger(db, m, d, c, [{ ligne_id: ligne, article_id: m.article, quantite: 1000, prix_unitaire: 9 }], ['prix']);
    await as(db, m.admin);
    for (const v of [v1, v2]) await db.query(`select gbs.valider_avenant($1, 'valide')`, [v.id]);
    await db.query(`select gbs.signer_avenant($1, $2, current_date)`, [v1.id, `${d}/00000000-0000-4000-8000-000000000002.pdf`]);
    await expectError(db, 'GBS_AVENANT_PERIME', `select gbs.signer_avenant($1, $2, current_date)`, [v2.id, `${d}/00000000-0000-4000-8000-000000000003.pdf`]);
  }));
});

describe('Pièces manquantes : demande, relance, point bloquant', () => {
  async function demander(db: Db, a: string) {
    const m = await monde(db);
    const d = await dossier(db, m);
    await asRoot(db);
    await db.query(`update gbs.dossiers set chef_id = $2 where id = $1`, [d, m.hub]);
    const p = (await one(db, `select id from gbs.pieces where dossier_id = $1 and code = 'client_cdc_signe'`, [d])).id as string;
    await as(db, m.hub);
    await db.query(`select gbs.demander_piece($1, $2, $3)`, [p, a, a === 'equipe' ? m.achats : null]);
    return { m, d, p };
  }
  async function vieillir(db: Db, p: string, jours: number) {
    await asRoot(db);
    await db.query(`update gbs.pieces set demandee_le = current_date - $2::int where id = $1`, [p, jours]);
  }
  async function relancer(db: Db) {
    await asRoot(db);
    await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    return (await one(db, `select gbs.relancer_pieces() r`)).r;
  }

  it('relance par une tâche, puis point bloquant au-delà du délai, sans doublon', () => withTx(async (db) => {
    const { m, p } = await demander(db, 'client');
    expect(await relancer(db)).toEqual({ relances: 0, points_bloquants: 0 });
    await vieillir(db, p, 7); // au moins 3 jours ouvrés
    expect(await relancer(db)).toEqual({ relances: 1, points_bloquants: 0 });
    await as(db, m.hub);
    expect((await rows(db, `select libelle from gbs.mes_taches() where nature = 'tache'`)).map((x) => x.libelle))
      .toEqual(['Relancer le client : Cahier des charges du client validé et signé']);
    await vieillir(db, p, 21); // au moins 10 jours ouvrés
    const r = await relancer(db);
    expect(r.points_bloquants).toBe(1);
    expect((await relancer(db)).points_bloquants).toBe(0); // pas de doublon
    await asRoot(db);
    expect(await rows(db, `select categorie, responsable_id = $2 resp from gbs.points_bloquants where piece_id = $1`, [p, m.hub]))
      .toEqual([{ categorie: 'client', resp: true }]);
    expect((await one(db, `select count(*)::int n from gbs.taches where piece_id = $1`, [p])).n).toBe(1);
  }));

  it('une pièce de l’équipe devient une tâche, close dès réception', () => withTx(async (db) => {
    const { m, p } = await demander(db, 'equipe');
    await as(db, m.achats);
    expect((await rows(db, `select libelle from gbs.mes_taches() where nature = 'tache'`)).map((x) => x.libelle))
      .toEqual(['Fournir la pièce : Cahier des charges du client validé et signé']);
    await as(db, m.hub);
    await db.query(`select gbs.deposer_piece($1, $2, $3)`, [p, 'x/y.pdf', 'a'.repeat(64)]);
    await asRoot(db);
    expect((await one(db, `select statut from gbs.taches where piece_id = $1`, [p])).statut).toBe('faite');
  }));

  it('droits : demande réservée à l’équipe du dossier, relance au service', () => withTx(async (db) => {
    const { m, p } = await demander(db, 'client');
    await as(db, m.agentCM);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.demander_piece($1, 'client')`, [p]);
    await as(db, m.hub);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.relancer_pieces()`);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.demander_piece($1, 'equipe')`, [p]);
  }));
});
