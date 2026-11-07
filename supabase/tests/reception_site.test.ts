// Lot 1, M28 : réception sur site — procès-verbal, réserves, levée, réception définitive.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, commande, dossier, expectError, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

const fichier = (d: string, n: number) => `${d}/${String(n).padStart(8, '0')}-aaaa-4bbb-8ccc-dddddddddddd.pdf`;
const piece = async (db: Db, d: string) => {
  await asRoot(db);
  return (await one(db, `select statut, document_chemin from gbs.pieces where dossier_id = $1 and code = 'client_pv_reception'`, [d]));
};
async function reception(db: Db, m: Monde, d: string) {
  await as(db, m.hub);
  return (await one(db, `insert into gbs.receptions (dossier_id, date_reception, lieu, constat) values ($1, current_date, 'Hôtel Lagune, Assinie', 'Livraison de 40 lits et 40 armoires') returning id`, [d])).id as string;
}
const reserve = async (db: Db, r: string, gravite = 'mineure', description = 'Deux portes d’armoire rayées') =>
  (await one(db, `insert into gbs.reserves_reception (reception_id, description, gravite, responsable, delai) values ($1, $2, $3, 'fournisseur', current_date + 15) returning id, numero`,
    [r, description, gravite]));
const signer = (db: Db, r: string, d: string, decision = 'acceptee') =>
  db.query(`select gbs.signer_reception($1, $2, 'Mme Kouassi, directrice', $3, current_date)`, [r, decision, fichier(d, 1)]);

describe('Réception sur site (M28)', () => {
  it('sans réserve : définitive à la signature ; la pièce de la phase livraison est validée', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const r = await reception(db, m, d);
    await expectError(db, '42501', `update gbs.receptions set statut = 'definitive' where id = $1`, [r]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.signer_reception($1, 'acceptee', 'Mme Kouassi', '../pv.pdf', current_date)`, [r]);
    await signer(db, r, d);
    expect((await one(db, `select statut, definitive_le is not null d from gbs.receptions where id = $1`, [r]))).toEqual({ statut: 'definitive', d: true });
    expect(await piece(db, d)).toEqual({ statut: 'validee', document_chemin: fichier(d, 1) });
    await as(db, m.hub);
    await expectError(db, 'GBS_DOCUMENT_VALIDE', `update gbs.receptions set constat = 'Autre' where id = $1`, [r]);
  }));

  it('avec réserves : levée une à une avec preuve, puis réception définitive sur procès-verbal de levée', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const r = await reception(db, m, d);
    const x1 = await reserve(db, r);
    const x2 = await reserve(db, r, 'majeure', 'Sommier cassé sur un lit');
    expect([x1.numero, x2.numero]).toEqual([1, 2]);
    await signer(db, r, d);
    expect((await one(db, `select statut from gbs.receptions where id = $1`, [r])).statut).toBe('signee');
    expect((await piece(db, d)).statut).toBe('recue');
    await as(db, m.hub);
    await expectError(db, 'GBS_DOCUMENT_VALIDE', `insert into gbs.reserves_reception (reception_id, description, gravite, responsable) values ($1, 'Ajout tardif', 'mineure', 'gbs')`, [r]);
    await expectError(db, '42501', `update gbs.reserves_reception set statut = 'levee' where id = $1`, [x1.id]);
    await db.query(`select gbs.lever_reserve($1, 'Portes remplacées par le fournisseur')`, [x1.id]);
    await expectError(db, 'GBS_RESERVES_OUVERTES', `select gbs.prononcer_reception_definitive($1, $2, current_date)`, [r, fichier(d, 2)]);
    expect((await rows(db, `select numero from gbs.reserves_ouvertes()`)).map((x) => x.numero)).toEqual([2]);
    await expectError(db, 'GBS_PREUVE_INVALIDE', `select gbs.lever_reserve($1, 'ok')`, [x2.id]);
    await db.query(`select gbs.lever_reserve($1, 'Sommier remplacé, constaté le jour même')`, [x2.id]);
    await db.query(`select gbs.prononcer_reception_definitive($1, $2, current_date)`, [r, fichier(d, 2)]);
    expect(await piece(db, d)).toEqual({ statut: 'validee', document_chemin: fichier(d, 2) });
  }));

  it('réserve bloquante : acceptation interdite, refus motivé ; une nouvelle réception reste possible', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const r = await reception(db, m, d);
    await expectError(db, 'GBS_REFUS_SANS_RESERVE', `select gbs.signer_reception($1, 'refusee', 'Mme Kouassi', $2, current_date)`, [r, fichier(d, 1)]);
    await reserve(db, r, 'bloquante', 'Groupe froid hors service à la mise sous tension');
    await expectError(db, 'GBS_RESERVE_BLOQUANTE', `select gbs.signer_reception($1, 'acceptee', 'Mme Kouassi', $2, current_date)`, [r, fichier(d, 1)]);
    await signer(db, r, d, 'refusee');
    expect((await one(db, `select statut from gbs.receptions where id = $1`, [r])).statut).toBe('refusee');
    expect((await piece(db, d)).statut).toBe('manquante');
    await reception(db, m, d);
  }));

  it('droits : Hub Afrique et administratrice ; achats en lecture ; agent et comptable rien', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const r = await reception(db, m, d);
    await as(db, m.achats);
    await expectError(db, '42501', `insert into gbs.receptions (dossier_id, date_reception, lieu) values ($1, current_date, 'Assinie')`, [d]);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.signer_reception($1, 'acceptee', 'Mme Kouassi', $2, current_date)`, [r, fichier(d, 1)]);
    for (const u of [m.agentGA, m.comptable]) {
      await as(db, u);
      expect(await rows(db, `select id from gbs.receptions`)).toEqual([]);
    }
    await as(db, m.hub);
    await expectError(db, 'GBS_DATE_INVALIDE', `insert into gbs.receptions (dossier_id, date_reception, lieu) values ($1, current_date + 1, 'Assinie')`, [d]);
    await expectError(db, 'GBS_PHOTOS_INVALIDES', `update gbs.receptions set photos = $2 where id = $1`, [r, ['http://x/y.jpg']]);
  }));
  it('réserve majeure ou bloquante du fournisseur : non-conformité ouverte sur sa commande à la signature', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const c = await commande(db, m, d, [{ qte: 40, pu: 300 }]);
    const r = await reception(db, m, d);
    await reserve(db, r, 'majeure', 'Sommiers fendus sur 6 lits');
    await reserve(db, r, 'mineure', 'Étiquettes manquantes');
    await as(db, m.hub);
    await db.query(`insert into gbs.reserves_reception (reception_id, description, gravite, responsable) values ($1, 'Carton écrasé au déchargement', 'majeure', 'transitaire')`, [r]);
    await signer(db, r, d);
    await asRoot(db);
    const nc = await rows(db, `select n.gravite, n.commande_id, n.fournisseur_id, x.numero from gbs.reserves_reception x
      join gbs.non_conformites n on n.id = x.non_conformite_id where x.reception_id = $1`, [r]);
    expect(nc).toEqual([{ gravite: 'majeur', commande_id: c, fournisseur_id: m.fournisseur, numero: 1 }]);
    await as(db, m.achats);
    expect(Number((await one(db, `select note_qualite from gbs.qualite_fournisseurs() where fournisseur_id = $1`, [m.fournisseur])).note_qualite)).toBe(92);
  }));

  it('plusieurs commandes : la commande de la réserve du fournisseur doit être précisée', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const c1 = await commande(db, m, d, [{ qte: 40, pu: 300 }]);
    await commande(db, m, d, [{ qte: 10, pu: 100 }]);
    const r = await reception(db, m, d);
    const x = await reserve(db, r, 'bloquante', 'Armoires livrées sans portes');
    await expectError(db, 'GBS_COMMANDE_REQUISE', `select gbs.signer_reception($1, 'refusee', 'Mme Kouassi', $2, current_date)`, [r, fichier(d, 1)]);
    await as(db, m.hub);
    await db.query(`update gbs.reserves_reception set commande_id = $2 where id = $1`, [x.id, c1]);
    await signer(db, r, d, 'refusee');
    await asRoot(db);
    expect((await one(db, `select n.gravite from gbs.reserves_reception x join gbs.non_conformites n on n.id = x.non_conformite_id where x.id = $1`, [x.id])).gravite).toBe('critique');
  }));
});
