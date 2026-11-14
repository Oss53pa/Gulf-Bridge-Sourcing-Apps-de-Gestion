// Entrepôt de consolidation (migration 80) : réceptions, réserves, liste de colisage, empotage.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, commande, dossier, expectError, monde, one, rows, withTx, type Db } from './helpers';

afterAll(closePool);

const auj = () => new Date().toISOString().slice(0, 10);
async function preparer(db: Db, type = '40_hc') {
  const m = await monde(db);
  const d = await dossier(db, m);
  await as(db, m.achats);
  const c = (await one(db, `select gbs.ouvrir_consolidation($1, $2, 'Foshan') id`, [d, type])).id as string;
  return { m, d, c };
}
const recevoir = (db: Db, c: string, p: Record<string, unknown>) => one(db, `select gbs.receptionner($1, $2) id`, [c, p]).then((x) => x.id as string);
const etat = (db: Db, c: string) => one(db, `select gbs.etat_consolidation($1) e`, [c]).then((x) => x.e);

describe('Entrepôt de consolidation', () => {
  it('réception : écart de colis = réserve automatique ; levée motivée ; totaux et capacité', () => withTx(async (db) => {
    const { m, c } = await preparer(db);
    const r1 = await recevoir(db, c, { fournisseur_id: m.fournisseur, recue_le: auj(), colis_attendus: 48, colis_recus: 48, volume_m3: 31.2, poids_kg: 9800, emplacement: 'A-12' });
    const r2 = await recevoir(db, c, { fournisseur_id: m.fournisseur, recue_le: auj(), colis_attendus: 120, colis_recus: 114, volume_m3: 9.4, poids_kg: 2100, reserve: 'Deux cartons écrasés' });
    expect(await rows(db, `select statut, reserve from gbs.receptions_entrepot where id in ($1, $2) order by reference`, [r1, r2])).toEqual([
      { statut: 'conforme', reserve: null }, { statut: 'reserve', reserve: '6 colis manquant(s) ; Deux cartons écrasés' }]);
    expect(await etat(db, c)).toMatchObject({ receptions: 2, colis_recus: 162, colis_attendus: 168, volume_m3: 40.6, reserves_ouvertes: 1, capacite_m3: 67, charge_kg: 26500 });
    await expectError(db, 'GBS_RESERVES_OUVERTES', `select gbs.clore_colisage($1)`, [c]);
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', `select gbs.lever_reserve_entrepot($1, '')`, [r2]);
    await db.query(`select gbs.lever_reserve_entrepot($1, 'Six colis livrés le lendemain, cartons reconditionnés')`, [r2]);
    await expectError(db, 'GBS_DEMANDE_TRAITEE', `select gbs.lever_reserve_entrepot($1, 'Encore une fois')`, [r2]);
  }));

  it('colis attendus repris de la liste de colisage validée du fournisseur', () => withTx(async (db) => {
    const { m, d, c } = await preparer(db);
    const k = await commande(db, m, d, [{ qte: 10, pu: 100 }]);
    await asRoot(db);
    await db.query(`select set_config('gbs.rpc', 'colisage', true)`);
    await db.query(`insert into gbs.colisages (commande_id, dossier_id, caisses, poids_brut_kg, volume_m3, statut, auteur_id) values ($1, $2, 36, 4000, 12, 'validee', $3)`, [k, d, m.achats]);
    await db.query(`select set_config('gbs.rpc', '', true)`);
    await as(db, m.achats);
    const r = await recevoir(db, c, { commande_id: k, recue_le: auj(), colis_recus: 36, volume_m3: 12, poids_kg: 4000 });
    expect(await one(db, `select colis_attendus, statut, fournisseur_id = $2 f from gbs.receptions_entrepot where id = $1`, [r, m.fournisseur]))
      .toEqual({ colis_attendus: 36, statut: 'conforme', f: true });
    const autre = await dossier(db, m);
    const k2 = await commande(db, m, autre, [{ qte: 1, pu: 1 }]);
    await as(db, m.achats);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.receptionner($1, $2)`, [c, { commande_id: k2, recue_le: auj(), colis_recus: 1, volume_m3: 1, poids_kg: 1 }]);
    await expectError(db, 'GBS_COLIS_ATTENDUS_REQUIS', `select gbs.receptionner($1, $2)`, [c, { fournisseur_id: m.fournisseur, recue_le: auj(), colis_recus: 1, volume_m3: 1, poids_kg: 1 }]);
  }));

  it('clôture : capacité respectée, liste figée ; empotage planifié puis confirmé avec photos, conteneur et plomb', () => withTx(async (db) => {
    const { m, c } = await preparer(db, '20_dv');
    await recevoir(db, c, { fournisseur_id: m.fournisseur, recue_le: auj(), colis_attendus: 10, colis_recus: 10, volume_m3: 30, poids_kg: 5000 });
    await expectError(db, 'GBS_CAPACITE_DEPASSEE', `select gbs.clore_colisage($1)`, [c]);
    const { c: c2 } = await (async () => { const d2 = (await one(db, `select dossier_id from gbs.consolidations where id = $1`, [c])).dossier_id;
      return { c: (await one(db, `select gbs.ouvrir_consolidation($1, '40_hc', 'Foshan') id`, [d2])).id as string }; })();
    await expectError(db, 'GBS_AUCUNE_RECEPTION', `select gbs.clore_colisage($1)`, [c2]);
    await recevoir(db, c2, { fournisseur_id: m.fournisseur, recue_le: auj(), colis_attendus: 10, colis_recus: 10, volume_m3: 30, poids_kg: 5000 });
    await expectError(db, 'GBS_COLISAGE_NON_CLOS', `select gbs.planifier_empotage($1, current_date + 2)`, [c2]);
    await db.query(`select gbs.clore_colisage($1)`, [c2]);
    expect((await one(db, `select liste_colisage -> 'lignes' -> 0 ->> 'colis' n from gbs.consolidations where id = $1`, [c2])).n).toBe('10');
    await expectError(db, 'GBS_COLISAGE_CLOS', `select gbs.receptionner($1, $2)`, [c2, { fournisseur_id: m.fournisseur, recue_le: auj(), colis_attendus: 1, colis_recus: 1, volume_m3: 1, poids_kg: 1 }]);
    await expectError(db, 'GBS_EMPOTAGE_NON_PLANIFIE', `select gbs.confirmer_empotage($1, '{}')`, [c2]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.planifier_empotage($1, current_date - 1)`, [c2]);
    await db.query(`select gbs.planifier_empotage($1, current_date + 2)`, [c2]);
    const base = { numero_conteneur: 'MSKU4821930', numero_plomb: 'ML-778812' };
    for (const p of [{ ...base, photos: [] }, { ...base, numero_conteneur: 'MSKU48', photos: ['d/x.jpg'] }, { ...base, photos: ['../x.jpg'] }]) {
      await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.confirmer_empotage($1, $2)`, [c2, p]);
    }
    const d2 = (await one(db, `select dossier_id from gbs.consolidations where id = $1`, [c2])).dossier_id;
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.confirmer_empotage($1, $2)`, [c2, { ...base, photos: ['dossiers/x/empotage-1.jpg'] }]);
    await db.query(`select gbs.confirmer_empotage($1, $2)`, [c2, { ...base, photos: [`${d2}/${randomUUID()}.jpg`] }]);
    expect((await one(db, `select statut from gbs.consolidations where id = $1`, [c2])).statut).toBe('empote');
    // Rattachement à l'expédition du dossier : conteneur, plomb et lieu de remise reportés une seule fois.
    const e = (await one(db, `insert into gbs.expeditions (dossier_id, mode, pays_destination, port_arrivee, conteneurs) values ($1, 'conteneur_complet', 'CI', 'Abidjan', '{MSKU4821930}') returning id`, [d2])).id;
    await expectError(db, 'GBS_EMPOTAGE_NON_CONFIRME', `select gbs.rattacher_expedition($1, $2)`, [c, e]);
    await db.query(`select gbs.rattacher_expedition($1, $2)`, [c2, e]);
    expect(await one(db, `select conteneurs, plombs, lieu_remise from gbs.expeditions where id = $1`, [e]))
      .toEqual({ conteneurs: ['MSKU4821930'], plombs: ['ML-778812'], lieu_remise: 'Entrepôt de consolidation · Foshan' });
    await expectError(db, 'GBS_DEMANDE_TRAITEE', `select gbs.rattacher_expedition($1, $2)`, [c2, e]);
  }));

  it('droits : écriture réservée à l’entrepôt ; écriture directe interdite ; lecture selon le dossier', () => withTx(async (db) => {
    const { m, d, c } = await preparer(db);
    for (const u of [m.hub, m.comptable, m.inspecteur]) {
      await as(db, u);
      await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.ouvrir_consolidation($1, '40_hc', 'Foshan')`, [d]);
      await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.receptionner($1, $2)`, [c, { fournisseur_id: m.fournisseur, recue_le: auj(), colis_attendus: 1, colis_recus: 1, volume_m3: 1, poids_kg: 1 }]);
    }
    await as(db, m.achats);
    await expectError(db, '42501', `update gbs.consolidations set statut = 'empote' where id = $1`, [c]);
    await as(db, m.agentCM);
    expect(await rows(db, `select id from gbs.consolidations`)).toEqual([]);
    await as(db, m.hub);
    expect((await rows(db, `select id from gbs.consolidations`)).length).toBe(1);
  }));
});
