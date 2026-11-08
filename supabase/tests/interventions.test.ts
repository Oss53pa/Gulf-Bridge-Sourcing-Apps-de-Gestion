// Lot 1, M37 : interventions sur site, HSE, coût réel et facturation au coût + 15 %.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

const fichier = (d: string, n: number) => `${d}/${String(n).padStart(8, '0')}-eeee-4fff-8aaa-bbbbbbbbbbbb.pdf`;
const RISQUES = JSON.stringify([{ danger: 'Travail sur armoire électrique', mesure: 'Consignation et vérification d’absence de tension' }]);

async function preparer(db: Db, m: Monde, type = 'mise_en_service') {
  const d = await dossier(db, m, { modele: 'installation' });
  await as(db, m.hub);
  const i = (await one(db, `insert into gbs.interventions (dossier_id, type, objet, lieu, date_debut, date_fin, habilitations_requises, permis_requis, analyse_risques, epi)
    values ($1, $2, 'Mise en service de la chambre froide', 'Hôtel Lagune, Assinie', current_date, current_date + 2, '{electrique,accueil_site}', '{permis_feu}', $3, '{casque,gants isolants}')
    returning id`, [d, type, RISQUES])).id as string;
  return { d, i };
}
const habiliter = async (db: Db, m: Monde, tech: string, type: string, expire = 'current_date + 60') => {
  await as(db, m.hub);
  await db.query(`insert into gbs.habilitations (technicien_id, type, libelle, delivree_le, expire_le) values ($1, $2, 'Habilitation', current_date - 100, ${expire})`, [tech, type]);
};

describe('Interventions sur site (M37)', () => {
  it('démarrage refusé tant que techniciens, habilitations valides et permis ne sont pas réunis', () => withTx(async (db) => {
    const m = await monde(db);
    const { d, i } = await preparer(db, m);
    await as(db, m.hub);
    await expectError(db, 'GBS_HSE_INCOMPLET', `select gbs.demarrer_intervention($1)`, [i]);
    await db.query(`insert into gbs.intervention_techniciens (intervention_id, technicien_id) values ($1, $2)`, [i, m.inspecteur]);
    await habiliter(db, m, m.inspecteur, 'electrique', 'current_date + 1');   // expire pendant l'intervention
    await habiliter(db, m, m.inspecteur, 'accueil_site');
    await as(db, m.hub);
    const c = await one(db, `select gbs.controles_hse($1) c`, [i]);
    expect(c.c.map((x: { controle: string; type?: string }) => `${x.controle}:${x.type ?? ''}`).sort()).toEqual(['habilitation:electrique', 'permis:permis_feu']);
    await habiliter(db, m, m.inspecteur, 'electrique');
    await as(db, m.hub);
    await db.query(`insert into gbs.permis_travail (intervention_id, type, numero, delivre_par, valide_du, valide_au, document)
      values ($1, 'permis_feu', 'PF-2026-114', 'Service technique de l''hôtel', current_date, current_date + 2, $2)`, [i, fichier(d, 1)]);
    await db.query(`select gbs.demarrer_intervention($1)`, [i]);
    await expectError(db, 'GBS_INTERVENTION_FIGEE', `update gbs.interventions set epi = '{}' where id = $1`, [i]);
    await expectError(db, '42501', `update gbs.interventions set statut = 'terminee' where id = $1`, [i]);
  }));

  it('temps du technicien, frais rattachés, PV de mise en service ; facture au coût réel + 15 %', () => withTx(async (db) => {
    const m = await monde(db);
    const { d, i } = await preparer(db, m);
    await as(db, m.hub);
    await db.query(`update gbs.interventions set habilitations_requises = '{}', permis_requis = '{}' where id = $1`, [i]);
    await db.query(`insert into gbs.intervention_techniciens (intervention_id, technicien_id) values ($1, $2), ($1, $3)`, [i, m.inspecteur, m.hub]);
    await expectError(db, 'GBS_INTERVENTION_STATUT', `insert into gbs.intervention_temps (intervention_id, technicien_id, date_travail, heures, taux_horaire_xof, travaux)
      values ($1, $2, current_date, 8, 10000, 'Raccordement')`, [i, m.inspecteur]);
    await db.query(`select gbs.demarrer_intervention($1)`, [i]);
    // Le technicien saisit son temps, pas celui d'un autre.
    await as(db, m.inspecteur);
    await db.query(`insert into gbs.intervention_temps (intervention_id, technicien_id, date_travail, heures, taux_horaire_xof, travaux)
      values ($1, $2, current_date, 8, 10000, 'Raccordement et tirage au vide')`, [i, m.inspecteur]);
    await expectError(db, '42501', `insert into gbs.intervention_temps (intervention_id, technicien_id, date_travail, heures, taux_horaire_xof, travaux)
      values ($1, $2, current_date, 8, 10000, 'Pour un autre')`, [i, m.hub]);
    await db.query(`insert into gbs.incidents_hse (intervention_id, survenu_le, nature, description, mesures)
      values ($1, now(), 'presque_accident', 'Chute d’un outil depuis l’escabeau sans blessé', 'Rappel du port du casque, outils attachés')`, [i]);
    await expectError(db, '42501', `update gbs.incidents_hse set mesures = 'Rien' where intervention_id = $1`, [i]);
    await as(db, m.admin);   // les coûts directs sont saisis par la finance (notes de frais : validées par elle)
    await db.query(`insert into gbs.couts (nature, dossier_id, categorie, libelle, date_cout, devise, montant_ht, intervention_id)
      values ('cout', $1, 'deplacement', 'Location de véhicule', current_date, 'XOF', 20000, $2)`, [d, i]);
    await as(db, m.hub);
    await expectError(db, 'GBS_PV_MISE_EN_SERVICE', `select gbs.terminer_intervention($1, 'Chambre froide à -18 °C en 3 h')`, [i]);
    await db.query(`select gbs.terminer_intervention($1, 'Chambre froide à -18 °C en 3 h', $2)`, [i, fichier(d, 2)]);
    expect((await one(db, `select gbs.cout_intervention($1) c`, [i])).c).toMatchObject({ heures: 8, temps_xof: 80000, frais_xof: 20000, cout_reel_xof: 100000, a_facturer_xof: 115000 });
    const f = await one(db, `select * from gbs.facturer_intervention($1)`, [i]);
    expect([f.type, f.devise, Number(f.montant_ht), f.statut]).toEqual(['installation', 'XOF', 115000, 'brouillon']);
    await asRoot(db);
    expect((await one(db, `select statut from gbs.pieces where dossier_id = $1 and code = 'pv_mise_en_service'`, [d])).statut).toBe('validee');
    await as(db, m.admin);
    const marge = (await one(db, `select gbs.marge_directe($1) j`, [d])).j;
    expect(marge.couts_par_categorie).toEqual({ installation: 80000, deplacement: 20000 });
  }));

  it('cloisonnement : le technicien ne voit que ses interventions ; habilitations à renouveler', () => withTx(async (db) => {
    const m = await monde(db);
    await preparer(db, m);
    for (const u of [m.inspecteur, m.agentGA, m.comptable]) {
      await as(db, u);
      expect(await rows(db, `select id from gbs.interventions`)).toEqual([]);
    }
    await habiliter(db, m, m.inspecteur, 'travail_hauteur', 'current_date + 10');
    await as(db, m.hub);
    expect((await rows(db, `select type from gbs.habilitations_a_renouveler()`)).map((x) => x.type)).toEqual(['travail_hauteur']);
    await as(db, m.inspecteur);
    await expectError(db, '42501', `insert into gbs.habilitations (technicien_id, type, libelle, delivree_le, expire_le) values ($1, 'electrique', 'Auto-déclarée', current_date, current_date + 300)`, [m.inspecteur]);
  }));
});
