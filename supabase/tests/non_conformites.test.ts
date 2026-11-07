// Lot 1, M27 : non-conformités et actions correctives.
import { afterAll, describe, expect, it } from 'vitest';
import { as, closePool, commande, dossier, expectError, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

async function preparer(db: Db, m: Monde) {
  const d = await dossier(db, m);
  const c = await commande(db, m, d, [{ qte: 1200, pu: 40 }]);
  await as(db, m.achats);
  const i = (await one(db, `insert into gbs.inspections (commande_id, type, inspecteur_id, taille_lot) values ($1, 'avant_expedition', $2, 1200) returning id`,
    [c, m.inspecteur])).id as string;
  await as(db, m.inspecteur);
  await db.query(`update gbs.inspections set statut = 'realisee', date_realisee = current_date, defauts_majeurs = 2 where id = $1`, [i]);
  return { d, c, i };
}
const ouvrir = async (db: Db, m: Monde, i: string, gravite: string) => {
  await as(db, m.inspecteur);
  return (await one(db, `insert into gbs.non_conformites (inspection_id, gravite, description) values ($1, $2, 'Émail écaillé sur les bords') returning id`,
    [i, gravite])).id as string;
};
const contreInspection = async (db: Db, m: Monde, c: string, majeurs = 0) => {
  await as(db, m.achats);
  const ci = (await one(db, `insert into gbs.inspections (commande_id, type, inspecteur_id, taille_lot) values ($1, 'contre_inspection', $2, 1200) returning id`,
    [c, m.inspecteur])).id;
  await db.query(`update gbs.inspections set statut = 'realisee', date_realisee = current_date, defauts_majeurs = $2 where id = $1`, [ci, majeurs]);
  return ci as string;
};

describe('Non-conformités (M27)', () => {
  it('cycle complet : correction exigée, déclarée, contre-inspection acceptée, clôture ; jamais par modification directe', () => withTx(async (db) => {
    const m = await monde(db);
    const { c, i } = await preparer(db, m);
    const nc = await ouvrir(db, m, i, 'majeur');
    await as(db, m.achats);
    expect((await one(db, `select fournisseur_id from gbs.non_conformites where id = $1`, [nc])).fournisseur_id).toBe(m.fournisseur);
    await expectError(db, 'GBS_VALIDATION_RPC', `update gbs.non_conformites set statut = 'close' where id = $1`, [nc]);
    await expectError(db, 'GBS_NC_FIGEE', `update gbs.non_conformites set gravite = 'mineur' where id = $1`, [nc]);
    await expectError(db, 'GBS_NC_STATUT', `select gbs.declarer_correction_nc($1, 'Pièces reprises au four')`, [nc]);
    await expectError(db, 'GBS_DELAI_INVALIDE', `select gbs.exiger_correction_nc($1, 'Reprise de l''émaillage', current_date - 1)`, [nc]);
    await db.query(`select gbs.exiger_correction_nc($1, 'Reprise de l''émaillage sur tout le lot', current_date + 10)`, [nc]);
    await db.query(`select gbs.declarer_correction_nc($1, 'Lot repassé au four, tri à 100 %')`, [nc]);
    await expectError(db, 'GBS_CONTRE_INSPECTION_REQUISE', `select gbs.clore_nc($1)`, [nc]);
    const refusee = await contreInspection(db, m, c, 9);
    await expectError(db, 'GBS_CONTRE_INSPECTION_REFUSEE', `select gbs.clore_nc($1, $2)`, [nc, refusee]);
    await expectError(db, 'GBS_CONTRE_INSPECTION_INVALIDE', `select gbs.clore_nc($1, $2)`, [nc, i]);
    const ok = await contreInspection(db, m, c, 0);
    const r = await one(db, `select statut, hors_delai, close_par from gbs.clore_nc($1, $2)`, [nc, ok]);
    expect(r).toEqual({ statut: 'close', hors_delai: false, close_par: m.achats });
    await expectError(db, 'GBS_DOCUMENT_VALIDE', `update gbs.non_conformites set description = 'Autre' where id = $1`, [nc]);
    // L'inspection d'origine se valide désormais.
    await as(db, m.admin);
    await db.query(`select gbs.valider_inspection($1, 'refus')`, [i]);
  }));

  it('mineure : clôture sans contre-inspection ; photos limitées aux fichiers du dossier', () => withTx(async (db) => {
    const m = await monde(db);
    const { d, i } = await preparer(db, m);
    await as(db, m.inspecteur);
    await expectError(db, 'GBS_PHOTOS_INVALIDES', `insert into gbs.non_conformites (inspection_id, gravite, description, photos) values ($1, 'mineur', 'Rayure', $2)`,
      [i, ['../autre/x.jpg']]);
    await expectError(db, 'GBS_VALIDATION_RPC', `insert into gbs.non_conformites (inspection_id, gravite, description, statut) values ($1, 'mineur', 'Rayure', 'close')`, [i]);
    const photo = `${d}/0b3c7a6e-1f2d-4c5b-9a8e-7d6c5b4a3f21.jpg`;
    const nc = (await one(db, `insert into gbs.non_conformites (inspection_id, gravite, description, photos) values ($1, 'mineur', 'Rayure', $2) returning id`,
      [i, [photo]])).id;
    await as(db, m.achats);
    await db.query(`select gbs.exiger_correction_nc($1, 'Polir la face visible', current_date + 3)`, [nc]);
    await expectError(db, 'GBS_PHOTOS_INVALIDES', `select gbs.declarer_correction_nc($1, 'Face polie sur 50 pièces', $2)`, [nc, ['http://exemple/x.jpg']]);
    await db.query(`select gbs.declarer_correction_nc($1, 'Face polie sur 50 pièces', $2)`, [nc, [photo]]);
    expect((await one(db, `select statut from gbs.clore_nc($1)`, [nc])).statut).toBe('close');
  }));

  it('note qualité du fournisseur : pénalités par gravité, majorées en cas de retard ; réservée aux achats', () => withTx(async (db) => {
    const m = await monde(db);
    const { i } = await preparer(db, m);
    await ouvrir(db, m, i, 'critique');
    const nc = await ouvrir(db, m, i, 'majeur');
    await as(db, m.achats);
    expect(Number((await one(db, `select note_qualite from gbs.qualite_fournisseurs() where fournisseur_id = $1`, [m.fournisseur])).note_qualite)).toBe(72);
    await db.query(`select gbs.exiger_correction_nc($1, 'Reprise de l''émaillage sur tout le lot', current_date)`, [nc]);
    await db.query(`select set_config('gbs.rpc', 'nc', true)`);
    await db.query(`update gbs.non_conformites set delai = current_date - 2 where id = $1`, [nc]);
    await db.query(`select set_config('gbs.rpc', '', true)`);
    const q = await one(db, `select note_qualite, nc_ouvertes, nc_en_retard from gbs.qualite_fournisseurs() where fournisseur_id = $1`, [m.fournisseur]);
    expect([Number(q.note_qualite), Number(q.nc_ouvertes), Number(q.nc_en_retard)]).toEqual([68, 2, 1]);
    for (const u of [m.inspecteur, m.comptable]) {
      await as(db, u);
      await expectError(db, 'GBS_ACCES_REFUSE', `select * from gbs.qualite_fournisseurs()`);
    }
    // L'inspecteur ne fait pas avancer le cycle.
    await as(db, m.inspecteur);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.declarer_correction_nc($1, 'Pièces reprises au four')`, [nc]);
    expect(await rows(db, `select id from gbs.non_conformites`)).toHaveLength(2);
  }));

  it('la commission d’agent ne se saisit plus en coût manuel (calculée à l’encaissement)', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.achats);
    await expectError(db, 'GBS_CATEGORIE_AUTOMATIQUE', `insert into gbs.couts (nature, dossier_id, categorie, libelle, date_cout, devise, montant_ht)
      values ('cout', $1, 'commission_agent', 'Commission agent', current_date, 'XOF', 1000)`, [d]);
  }));
});
