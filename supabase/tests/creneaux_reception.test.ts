// Préparer la réception sur site : créneaux et points proposés par l'équipe, choisis et confirmés par le client.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, withTx, type Db } from './helpers';

afterAll(closePool);

async function compte(db: Db, nom: string) {
  await asRoot(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${nom}@client.test`, { nom, app: 'gbs' }]);
  return id;
}
const jour = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

describe('Réception sur site', () => {
  it('équipe propose ; client choisit, coche, confirme ; figée ; réouverture motivée', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const autre = await dossier(db, m, { client: m.clientGA, societe: m.ci });
    await as(db, m.admin);
    const e = (await one(db, `insert into gbs.expeditions (dossier_id, mode, pays_destination, port_arrivee) values ($1, 'conteneur_complet', 'CI', 'Abidjan') returning id`, [d])).id;
    const e2 = (await one(db, `insert into gbs.expeditions (dossier_id, mode, pays_destination, port_arrivee) values ($1, 'conteneur_complet', 'CI', 'Abidjan') returning id`, [autre])).id;
    const p = { creneaux: [{ date: jour(10), moment: 'matin' }, { date: jour(11), moment: 'apres_midi' }], points: ["Accès camion 40' jusqu'à la buanderie", 'Arrivée électrique 380 V'] };
    await as(db, m.comptable);
    await expectError(db, '42501', `select gbs.preparer_reception_site($1, $2)`, [e, p]);
    await as(db, m.achats);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.preparer_reception_site($1, $2)`, [e, { ...p, creneaux: [{ date: jour(-1), moment: 'matin' }] }]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.preparer_reception_site($1, $2)`, [e, { ...p, creneaux: [{ date: jour(3), moment: 'nuit' }] }]);
    await db.query(`select gbs.preparer_reception_site($1, $2)`, [e, p]);
    await db.query(`select gbs.preparer_reception_site($1, $2)`, [e2, p]);

    const u = await compte(db, 'yao');
    await as(db, m.admin);
    await db.query(`select gbs.admin_compte_client($1, $2, 'technique')`, [u, m.clientCI]);
    await as(db, u);
    expect((await one(db, `select gbs.receptions_client($1) r`, [d])).r).toEqual([expect.objectContaining({ expedition_id: e, creneau_choisi: null })]);
    await expectError(db, '42501', `select gbs.choisir_creneau($1, 0)`, [e2]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.choisir_creneau($1, 5)`, [e]);
    await expectError(db, 'GBS_RECEPTION_INCOMPLETE', `select gbs.confirmer_reception_site($1)`, [e]);
    await db.query(`select gbs.choisir_creneau($1, 1)`, [e]);
    await db.query(`select gbs.cocher_point_reception($1, 0, true)`, [e]);
    await expectError(db, 'GBS_RECEPTION_INCOMPLETE', `select gbs.confirmer_reception_site($1)`, [e]);
    await db.query(`select gbs.cocher_point_reception($1, 1, true)`, [e]);
    await db.query(`select gbs.confirmer_reception_site($1)`, [e]);
    await expectError(db, 'GBS_RECEPTION_CONFIRMEE', `select gbs.cocher_point_reception($1, 0, false)`, [e]);
    await expectError(db, '42501', `update gbs.receptions_site set confirmee_le = null where expedition_id = $1`, [e]);

    // Réouverture par l'équipe : motif exigé ; points conservés, créneau à rechoisir.
    await as(db, m.achats);
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', `select gbs.preparer_reception_site($1, $2)`, [e, p]);
    await db.query(`select gbs.preparer_reception_site($1, $2)`, [e, { ...p, motif: 'Navire retardé de quatre jours' }]);
    const r = await one(db, `select creneau_choisi, confirmee_le, points from gbs.receptions_site where expedition_id = $1`, [e]);
    expect(r.creneau_choisi).toBeNull();
    expect(r.confirmee_le).toBeNull();
    expect(r.points.every((x: any) => x.pret)).toBe(true);
  }));
});
