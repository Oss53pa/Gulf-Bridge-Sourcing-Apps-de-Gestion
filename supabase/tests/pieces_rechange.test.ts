// Lot 1, M6 : pièces de rechange proposées au client dans le devis.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, commande, dossier, expectError, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

async function catalogue(db: Db, m: Monde, d: string) {
  await as(db, m.achats);
  await db.query(`insert into gbs.pieces_rechange (dossier_id, fournisseur_id, designation, reference_fabricant, criticite, prix_fournisseur, devise, quantite_recommandee, disponibilite_ans, delai_jours)
    values ($1, $2, 'Joint de porte de chambre froide', 'FC-JP-60', 'usure', 40, 'USD', 4, 10, 30),
           ($1, $2, 'Compresseur 5 kW', 'FC-CP-5K', 'strategique', 900, 'USD', 1, 8, 45)`, [d, m.fournisseur]);
}
const nouveauDevis = async (db: Db, m: Monde, d: string) => {
  await as(db, m.hub);
  return (await one(db, `insert into gbs.devis (dossier_id) values ($1) returning id`, [d])).id as string;
};

describe('Pièces de rechange au devis (M6)', () => {
  it('achat accompagné : proposées au prix fournisseur ; le Hub ne voit pas le catalogue ; quantité et choix du client ajustables', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await commande(db, m, d, [{ qte: 1, pu: 5000 }]);
    await catalogue(db, m, d);
    const v = await nouveauDevis(db, m, d);
    await as(db, m.hub);
    expect(await rows(db, `select id from gbs.pieces_rechange`)).toEqual([]);
    await expectError(db, '42501', `insert into gbs.devis_pieces (devis_id, dossier_id, piece_id, designation, criticite, quantite, prix_unitaire_client, devise)
      select $1, $2, gen_random_uuid(), 'x', 'usure', 1, 1, 'USD'`, [v, d]);
    const l = await rows(db, `select designation, quantite, prix_unitaire_client, devise from gbs.proposer_pieces_devis($1)`, [v]);
    expect(l.map((x) => [x.designation, Number(x.quantite), Number(x.prix_unitaire_client)])).toEqual([
      ['Compresseur 5 kW', 1, 900], ['Joint de porte de chambre froide', 4, 40]]);
    await db.query(`update gbs.devis_pieces set quantite = 8, retenue_client = true where devis_id = $1 and designation like 'Joint%'`, [v]);
    await expectError(db, '42501', `update gbs.devis_pieces set prix_unitaire_client = 1 where devis_id = $1`, [v]);
    // Nouvelle proposition : les lignes existantes ne bougent pas.
    await db.query(`select gbs.proposer_pieces_devis($1)`, [v]);
    expect(Number((await one(db, `select quantite from gbs.devis_pieces where devis_id = $1 and designation like 'Joint%'`, [v])).quantite)).toBe(8);
    for (const u of [m.achats, m.inspecteur]) {
      await as(db, u);
      expect(await rows(db, `select id from gbs.devis_pieces`)).toEqual([]);
    }
  }));

  it('négoce : prix majoré de la marge paramétrée ; devis signé : liste figée ; engagements pour le contrat', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m, { modele: 'negoce', societe: m.cn });
    expect((await one(db, `select mode_financier from gbs.dossiers where id = $1`, [d])).mode_financier).toBe('negoce');
    await commande(db, m, d, [{ qte: 1, pu: 5000 }]);
    await catalogue(db, m, d);
    await as(db, m.admin);
    const v = (await one(db, `insert into gbs.devis (dossier_id) values ($1) returning id`, [d])).id;
    const l = await rows(db, `select prix_unitaire_client from gbs.proposer_pieces_devis($1) order by prix_unitaire_client`, [v]);
    expect(l.map((x) => Number(x.prix_unitaire_client))).toEqual([50, 1125]);
    await db.query(`update gbs.devis_pieces set retenue_client = true where devis_id = $1`, [v]);
    await db.query(`update gbs.devis set statut = 'envoye' where id = $1`, [v]);
    await db.query(`select gbs.valider_mandat($1, 'mandats/m.pdf', '2026-06-10')`, [v]);
    await expectError(db, 'GBS_DOCUMENT_SIGNE', `update gbs.devis_pieces set quantite = 2 where devis_id = $1`, [v]);
    await expectError(db, 'GBS_DOCUMENT_SIGNE', `delete from gbs.devis_pieces where devis_id = $1`, [v]);
    const e = await rows(db, `select designation, prix_fournisseur from gbs.engagements_pieces($1) order by designation`, [d]);
    expect(e.map((x) => [x.designation, Number(x.prix_fournisseur)])).toEqual([['Compresseur 5 kW', 900], ['Joint de porte de chambre froide', 40]]);
  }));

  it('catalogue réservé aux achats et aux fournisseurs du dossier', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const d2 = await dossier(db, m);
    await commande(db, m, d2, [{ qte: 1, pu: 10 }]);
    await as(db, m.achats);
    await expectError(db, 'GBS_FOURNISSEUR_HORS_DOSSIER', `insert into gbs.pieces_rechange (dossier_id, fournisseur_id, designation, prix_fournisseur, devise)
      values ($1, $2, 'Courroie', 12, 'USD')`, [d, m.fournisseur]);
    await as(db, m.hub);
    await expectError(db, '42501', `insert into gbs.pieces_rechange (dossier_id, fournisseur_id, designation, prix_fournisseur, devise)
      values ($1, $2, 'Courroie', 12, 'USD')`, [d2, m.fournisseur]);
  }));
});
