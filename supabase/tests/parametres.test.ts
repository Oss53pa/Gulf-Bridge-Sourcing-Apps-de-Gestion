// Paramètres métier : chaque clé a une définition (type, bornes, validateur) et chaque valeur est contrôlée en base.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, rows, withTx } from './helpers';

afterAll(closePool);

describe('Registre des paramètres', () => {
  it('toutes les valeurs déjà enregistrées respectent leur définition', () => withTx(async (db) => {
    await asRoot(db);
    const r = await rows(db, `select p.cle, d.cle as def, gbs_private.valeur_parametre_valide(d, p.valeur) as ok
      from gbs.parametres p left join lateral gbs_private.definition_parametre(p.cle) d on true`);
    expect(r.filter((x) => !x.def || !x.ok).map((x) => x.cle)).toEqual([]);
  }));

  it('clé inconnue, taux saisi en pourcentage, barème incohérent et adresse hors BCE refusés', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.admin);
    const ins = `insert into gbs.parametres (cle, valeur, date_effet) values ($1, $2, current_date + 1)`;
    await expectError(db, 'GBS_PARAMETRE_INCONNU', ins, ['negoce.marge_piece', '0.3']);
    await expectError(db, 'GBS_PARAMETRE_INVALIDE', ins, ['negoce.marge_pieces', '25']);
    await expectError(db, 'GBS_PARAMETRE_INVALIDE', ins, ['negoce.marge_pieces', '"0.3"']);
    await expectError(db, 'GBS_PARAMETRE_INVALIDE', ins, ['hse.habilitation_alerte_jours', '12.5']);
    await expectError(db, 'GBS_PARAMETRE_INVALIDE', ins, ['offre.grille', '{"prix":50,"technique":40}']);
    await expectError(db, 'GBS_PARAMETRE_INVALIDE', ins, ['commission.bareme', '[{"jusqu_a":null,"taux":0.05},{"jusqu_a":100,"taux":0.04}]']);
    await expectError(db, 'GBS_PARAMETRE_INVALIDE', ins, ['taux.source_url', '"http://169.254.169.254/latest"']);
    await expectError(db, 'GBS_PARAMETRE_INVALIDE', ins, ['taux.source_url', '"https://www.ecb.europa.eu.attaquant.io/x"']);
    await expectError(db, 'GBS_PARAMETRE_INVALIDE', ins, ['qualite.seuils_note', '{"vert":60,"orange":80}']);
    await expectError(db, 'GBS_PARAMETRE_INVALIDE', ins, ['tva.GBS_CI', '18']);
    await expectError(db, 'GBS_PARAMETRE_INCONNU', ins, ['tva.GBS CI', '0.18']);
    // Valeurs correctes, y compris dans une famille de clés.
    await db.query(ins, ['negoce.marge_pieces', '0.3']);
    await db.query(ins, ['cout_global.energie_xof_kwh.SN', '120']);
    await db.query(ins, ['taux.source_url', '"https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"']);
    // Le catalogue expose définition et valeur en vigueur à l'équipe interne.
    const c = await rows(db, `select cle, type, module from gbs.catalogue_parametres() where cle in ('negoce.marge_pieces','tva.GBS_CI')`);
    expect(c.map((x) => [x.cle, x.type])).toEqual(expect.arrayContaining([['negoce.marge_pieces', 'taux'], ['tva.GBS_CI', 'taux']]));
    await as(db, m.hub);
    await expectError(db, '42501', ins, ['negoce.marge_pieces', '0.2']);
  }));

  it('le taux horaire des techniciens vient du paramètre, sauf correction de l’administratrice', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m, { modele: 'installation' });
    await as(db, m.hub);
    const i = (await one(db, `insert into gbs.interventions (dossier_id, type, objet, lieu, date_debut, date_fin, analyse_risques, epi)
      values ($1, 'apres_vente', 'Révision', 'Abidjan', current_date, current_date, '[{"danger":"Chute","mesure":"Harnais"}]', '{casque}') returning id`, [d])).id;
    await db.query(`insert into gbs.intervention_techniciens (intervention_id, technicien_id) values ($1, $2)`, [i, m.inspecteur]);
    await db.query(`select gbs.demarrer_intervention($1)`, [i]);
    await as(db, m.inspecteur);
    const t = await one(db, `insert into gbs.intervention_temps (intervention_id, technicien_id, date_travail, heures, taux_horaire_xof, travaux)
      values ($1, $2, current_date, 2, 999999, 'Révision') returning taux_horaire_xof, cout_xof`, [i, m.inspecteur]);
    expect([Number(t.taux_horaire_xof), Number(t.cout_xof)]).toEqual([10000, 20000]);
    await as(db, m.admin);
    const a = await one(db, `insert into gbs.intervention_temps (intervention_id, technicien_id, date_travail, heures, taux_horaire_xof, travaux)
      values ($1, $2, current_date, 1, 15000, 'Astreinte de nuit') returning taux_horaire_xof`, [i, m.inspecteur]);
    expect(Number(a.taux_horaire_xof)).toBe(15000);
    expect((await one(db, `select gbs_private.param_num('hse.habilitation_alerte_jours') j`)).j).toBe('30');
  }));
});
