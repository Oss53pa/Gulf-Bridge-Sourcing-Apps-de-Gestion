// Lot 1, M23 : jours ouvrés, délais cibles, attente d'un tiers, tâches, délégation.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, rows, withTx, type Db } from './helpers';

afterAll(closePool);

const ouvres = async (db: Db, pays: string, d1: string, d2: string) =>
  (await one(db, `select gbs_private.jours_ouvres_entre($1, $2::date, $3::date) n`, [pays, d1, d2])).n as number;

async function phase(db: Db, d: string, nom: string) {
  return (await one(db, `select id from gbs.dossier_phases where dossier_id = $1 and phase = $2`, [d, nom])).id as string;
}
async function etat(db: Db, d: string, nom: string) {
  return one(db, `select cible, jours_internes, jours_externes, echeance::text, voyant
                    from gbs.etat_delais($1) where phase = $2`, [d, nom]);
}

describe('Calendrier et jours ouvrés', () => {
  it('Pâques et jours fériés liés, week-ends exclus', () => withTx(async (db) => {
    await asRoot(db);
    expect((await one(db, `select gbs_private.paques(2026)::text p`)).p).toBe('2026-04-05');
    expect((await one(db, `select gbs_private.paques(2027)::text p`)).p).toBe('2027-03-28');
    // Vendredi 3 avril → vendredi 10 avril 2026 en Côte d'Ivoire : lundi de Pâques férié.
    expect(await ouvres(db, 'CI', '2026-04-03', '2026-04-10')).toBe(4);
    // Au Cameroun, le vendredi saint est férié, pas le lundi de Pâques.
    expect(await ouvres(db, 'CM', '2026-04-02', '2026-04-07')).toBe(2);
    expect((await one(db, `select gbs_private.ajouter_jours_ouvres('CI', '2026-04-03', 1)::text d`)).d).toBe('2026-04-07');
    expect(await ouvres(db, 'CI', '2026-04-10', '2026-04-03')).toBe(0);
  }));

  it('Chine : jour de compensation travaillé un samedi, congé en semaine', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.admin);
    await db.query(`insert into gbs.calendrier (pays, jour, nature, libelle, confirme) values
      ('CN', '2026-02-14', 'ouvre', 'Jour de compensation', true),
      ('CN', '2026-02-16', 'ferie', 'Fête du printemps', true)`);
    await asRoot(db);
    // ]ven. 13 ; lun. 16] : samedi travaillé, dimanche chômé, lundi férié.
    expect(await ouvres(db, 'CN', '2026-02-13', '2026-02-16')).toBe(1);
  }));

  it('seule l’administratrice modifie le calendrier et les délais cibles', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.hub);
    await expectError(db, '42501', `insert into gbs.calendrier (pays, jour, nature, libelle) values ('CI', '2026-07-01', 'ferie', 'Essai')`);
    await expectError(db, '42501', `insert into gbs.delais_cibles (modele, phase, jours_ouvres) values ('achat_accompagne', 'consultation', 10)`);
    expect((await rows(db, `select 1 from gbs.calendrier where pays = 'CI'`)).length).toBeGreaterThan(30);
  }));
});

describe('Délais cibles et attente d’un tiers', () => {
  it('délai interne, délai externe, échéance et voyants', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.admin);
    // Sans délai cible : aucun voyant.
    expect((await etat(db, d, 'consultation')).voyant).toBeNull();
    await db.query(`insert into gbs.delais_cibles (modele, phase, jours_ouvres) values ('achat_accompagne', 'consultation', 10)`);
    const p = await phase(db, d, 'consultation');
    await db.query(`update gbs.dossier_phases set reelle_debut = '2026-06-01', reelle_fin = '2026-06-12' where id = $1`, [p]);
    // 9 jours ouvrés sur 10 : orange (seuil 80 %).
    expect(await etat(db, d, 'consultation')).toEqual({
      cible: 10, jours_internes: 9, jours_externes: 0, echeance: '2026-06-15', voyant: 'orange' });
    // Deux jours d'attente du client : l'horloge interne s'arrête, l'échéance recule.
    await asRoot(db);
    await db.query(`insert into gbs.phase_attentes (phase_id, dossier_id, tiers, debut, fin)
      values ($1, $2, 'client', '2026-06-08', '2026-06-10')`, [p, d]);
    await as(db, m.admin);
    expect(await etat(db, d, 'consultation')).toEqual({
      cible: 10, jours_internes: 7, jours_externes: 2, echeance: '2026-06-17', voyant: 'vert' });
  }));

  it('le passage en attente exige le tiers et ouvre puis ferme la période', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const p = await phase(db, d, 'consultation');
    await as(db, m.hub);
    await expectError(db, 'GBS_TIERS_REQUIS', `update gbs.dossier_phases set statut = 'attente_tiers' where id = $1`, [p]);
    await db.query(`update gbs.dossier_phases set statut = 'attente_tiers', attente_tiers = 'fournisseur' where id = $1`, [p]);
    expect(await rows(db, `select tiers, fin from gbs.phase_attentes where phase_id = $1`, [p]))
      .toEqual([{ tiers: 'fournisseur', fin: null }]);
    await db.query(`update gbs.dossier_phases set statut = 'en_cours' where id = $1`, [p]);
    const a = await one(db, `select fin is not null ferme, (select attente_tiers from gbs.dossier_phases where id = $1) t
                               from gbs.phase_attentes where phase_id = $1`, [p]);
    expect(a).toEqual({ ferme: true, t: null });
    // La première phase démarre à la date d'ouverture du dossier.
    expect((await one(db, `select reelle_debut::text r from gbs.dossier_phases where id = $1`, [p])).r).toBe('2026-06-01');
  }));
});

describe('Tâches, « mes tâches » et délégation', () => {
  async function preparer(db: Db) {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.hub);
    const t = (await one(db, `insert into gbs.taches (dossier_id, phase, libelle, assigne_a, echeance)
      values ($1, 'consultation', 'Relancer le client pour le cahier des charges', $2, current_date - 1) returning id`, [d, m.achats])).id;
    return { m, d, t: t as string };
  }

  it('l’assigné voit et termine sa tâche, sans pouvoir la réécrire', () => withTx(async (db) => {
    const { m, d, t } = await preparer(db);
    await as(db, m.achats);
    const mes = await rows(db, `select nature, libelle, urgence from gbs.mes_taches() where nature = 'tache'`);
    expect(mes).toEqual([{ nature: 'tache', libelle: 'Relancer le client pour le cahier des charges', urgence: 1 }]);
    await expectError(db, 'GBS_ACCES_REFUSE', `update gbs.taches set libelle = 'Autre chose' where id = $1`, [t]);
    await db.query(`update gbs.taches set statut = 'faite' where id = $1`, [t]);
    expect((await one(db, `select faite_le is not null f from gbs.taches where id = $1`, [t])).f).toBe(true);
    // Un agent pays d'un autre pays ne voit pas la tâche ; l'agent ne peut pas l'assigner hors équipe.
    await as(db, m.agentCM);
    expect(await rows(db, `select id from gbs.taches where id = $1`, [t])).toEqual([]);
    await as(db, m.hub);
    await expectError(db, 'GBS_ASSIGNE_INVALIDE', `insert into gbs.taches (dossier_id, libelle, assigne_a) values ($1, 'Essai', $2)`,
      [d, '00000000-0000-4000-8000-000000000000']);
    await expectError(db, '42501', `delete from gbs.taches where id = $1`, [t]);
  }));

  it('« mes tâches » remonte points bloquants, pièces manquantes et délais dépassés', () => withTx(async (db) => {
    const { m, d } = await preparer(db);
    await as(db, m.admin);
    await db.query(`insert into gbs.delais_cibles (modele, phase, jours_ouvres) values ('achat_accompagne', 'consultation', 5)`);
    await db.query(`update gbs.dossier_phases set responsable_id = $2, reelle_debut = current_date - 40
                     where dossier_id = $1 and phase = 'consultation'`, [d, m.hub]);
    await db.query(`insert into gbs.points_bloquants (dossier_id, description, categorie, responsable_id, echeance)
      values ($1, 'Cahier des charges incomplet', 'client', $2, current_date + 5)`, [d, m.hub]);
    await as(db, m.hub);
    const natures = (await rows(db, `select nature, urgence from gbs.mes_taches() order by nature`));
    expect(natures.map((x) => x.nature)).toEqual(['delai', 'piece', 'piece', 'point_bloquant']);
    expect(natures.find((x) => x.nature === 'delai')!.urgence).toBe(1);
    expect(await rows(db, `select voyant from gbs.alertes_delais()`)).toEqual([{ voyant: 'rouge' }]);
    // Le client ne voit rien de tout cela.
    await asRoot(db);
    await expectError(db, 'GBS_ACCES_REFUSE', `select * from gbs.alertes_delais()`);
  }));

  it('délégation en cas d’absence : tâches, phases et points bloquants transférés', () => withTx(async (db) => {
    const { m, d } = await preparer(db);
    await as(db, m.admin);
    await db.query(`update gbs.dossier_phases set responsable_id = $2 where dossier_id = $1 and phase = 'consultation'`, [d, m.achats]);
    await as(db, m.agentGA);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.deleguer($1, $2, 'Congé annuel')`, [m.achats, m.agentGA]);
    await as(db, m.achats);
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', `select gbs.deleguer($1, $2, '')`, [m.achats, m.delegue]);
    const r = (await one(db, `select gbs.deleguer($1, $2, 'Congé annuel du 1er au 15') r`, [m.achats, m.delegue])).r;
    expect(r).toEqual({ taches: 1, phases: 1, points_bloquants: 0 });
    await as(db, m.delegue);
    expect((await rows(db, `select nature from gbs.mes_taches() where nature = 'tache'`)).length).toBe(1);
    await asRoot(db);
    // Aucune perte d'historique : le transfert est au journal, avec son motif.
    expect(await rows(db, `select motif from gbs.journal_audit where table_nom = 'taches' and action = 'update'`))
      .toEqual([{ motif: 'Congé annuel du 1er au 15' }]);
  }));
});
