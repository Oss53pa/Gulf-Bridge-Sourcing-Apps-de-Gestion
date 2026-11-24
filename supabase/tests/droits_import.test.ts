// Barème des droits et taxes à l'import (migration 83) : zone, préfixe SH le plus long, lignes datées non modifiables
// une fois en vigueur, prix rendu dans le coût global, droits d'accès.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

const ligne = (x: Record<string, unknown>) => JSON.stringify({ zone: 'UEMOA', code_sh: '69', date_effet: '2026-01-01', droit_douane: 0.2,
  redevance_statistique: 0.01, prelevements_communautaires: 0.013, source: 'Devis transitaire, à confirmer', ...x });
const demain = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

async function offre(db: Db, m: Monde, fretXof: number | null, article = true) {
  const d = await dossier(db, m);
  await as(db, m.achats);
  const rfq = (await one(db, `insert into gbs.consultations_fournisseurs (dossier_id, objet, quantite, date_limite, article_id, fret_estime_xof)
    values ($1, 'Carrelage 60x60', 1000, now() - interval '1 hour', $2, $3) returning id`, [d, article ? m.article : null, fretXof])).id as string;
  await db.query(`insert into gbs.consultation_invites (consultation_id, fournisseur_id) values ($1, $2)`, [rfq, m.fournisseur]);
  const o = (await one(db, `insert into gbs.offres (consultation_id, fournisseur_id, recu_le, canal, incoterm, lieu, devise, montant)
    values ($1, $2, now() - interval '2 hours', 'wechat', 'FOB', 'Shenzhen', 'USD', 10000) returning id`, [rfq, m.fournisseur])).id as string;
  return { d, rfq, o };
}

describe('Barème des droits et taxes à l’import', () => {
  it('saisie par l’administratrice seule, champs inconnus et taux hors bornes refusés', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.achats);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.droits_import_enregistrer($1)`, [ligne({})]);
    await as(db, m.admin);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.droits_import_enregistrer($1)`, [ligne({ secret: 1 })]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.droits_import_enregistrer($1)`, [ligne({ droit_douane: 1.5 })]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.droits_import_enregistrer($1)`, [ligne({ code_sh: '690' })]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.droits_import_enregistrer($1)`, [ligne({ zone: 'CEDEAO' })]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.droits_import_enregistrer($1)`, [ligne({ source: ' ' })]);
    await db.query(`select gbs.droits_import_enregistrer($1)`, [ligne({})]);
    // Pas d'écriture directe sur la table.
    await expectError(db, '42501', `insert into gbs.droits_import (zone, code_sh, date_effet, droit_douane, source) values ('UEMOA', '70', '2026-01-01', 0.1, 'x')`);
    // Lecture par l'équipe interne.
    await as(db, m.achats);
    expect((await rows(db, `select code_sh from gbs.droits_import`)).length).toBe(1);
  }));

  it('ligne en vigueur figée ; ligne à venir corrigée ou retirée, avec trace au journal', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.admin);
    const id = (await one(db, `select gbs.droits_import_enregistrer($1) id`, [ligne({})])).id;
    await expectError(db, 'GBS_BAREME_EN_VIGUEUR', `select gbs.droits_import_enregistrer($1)`, [ligne({ droit_douane: 0.1 })]);
    await expectError(db, 'GBS_BAREME_EN_VIGUEUR', `select gbs.droits_import_retirer($1)`, [id]);
    const futur = (await one(db, `select gbs.droits_import_enregistrer($1) id`, [ligne({ date_effet: demain() })])).id;
    expect((await one(db, `select gbs.droits_import_enregistrer($1) id`, [ligne({ date_effet: demain(), droit_douane: 0.1 })])).id).toBe(futur);
    expect(Number((await one(db, `select droit_douane from gbs.droits_import where id = $1`, [futur])).droit_douane)).toBe(0.1);
    await db.query(`select gbs.droits_import_retirer($1)`, [futur]);
    await asRoot(db);
    expect((await rows(db, `select action from gbs.journal_audit where table_nom = 'droits_import' order by id`)).map((x) => x.action))
      .toEqual(['bareme_droits_cree', 'bareme_droits_cree', 'bareme_droits_corrige', 'bareme_droits_retire']);
  }));

  it('préfixe le plus long, puis date d’effet la plus récente ; zone selon le pays', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.admin);
    await db.query(`select gbs.droits_import_enregistrer($1)`, [ligne({})]);
    await db.query(`select gbs.droits_import_enregistrer($1)`, [ligne({ code_sh: '6907', droit_douane: 0.1 })]);
    await db.query(`select gbs.droits_import_enregistrer($1)`, [ligne({ code_sh: '6907', date_effet: '2026-06-01', droit_douane: 0.05 })]);
    await db.query(`select gbs.droits_import_enregistrer($1)`, [ligne({ code_sh: '6907', date_effet: demain(), droit_douane: 0.35 })]);
    await db.query(`select gbs.droits_import_enregistrer($1)`, [ligne({ zone: 'CEMAC', code_sh: '6907', droit_douane: 0.3 })]);
    await asRoot(db);
    const t = async (z: string, sh: string) => Number((await one(db, `select (gbs_private.droits_applicables($1, $2)).droit_douane t`, [z, sh])).t);
    expect(await t('UEMOA', '690721')).toBe(0.05);
    expect(await t('UEMOA', '691200')).toBe(0.2);
    expect(await t('CEMAC', '690721')).toBe(0.3);
    expect((await one(db, `select (gbs_private.droits_applicables('CEMAC', '691200')).id x`)).x).toBeNull();
    expect((await one(db, `select gbs_private.zone_douaniere('CI') a, gbs_private.zone_douaniere('GA') b, gbs_private.zone_douaniere('FR') c`)))
      .toEqual({ a: 'UEMOA', b: 'CEMAC', c: null });
  }));

  it('prix rendu : CAF (FOB + fret + assurance de référence) + droits ; TVA à part ; manquants signalés', () => withTx(async (db) => {
    const m = await monde(db);
    const sans = await offre(db, m, null, false);
    await as(db, m.achats);
    expect((await one(db, `select gbs.prix_rendu($1) r`, [sans.o])).r).toMatchObject({ estime: false, manquants: ['article', 'fret_estime'] });
    const { o } = await offre(db, m, 1_000_000);
    expect((await one(db, `select gbs.prix_rendu($1) r`, [o])).r).toMatchObject({ estime: false, manquants: ['bareme_UEMOA_690721'] });
    await as(db, m.admin);
    await db.query(`select gbs.droits_import_enregistrer($1)`, [ligne({ tva: 0.18 })]);
    await as(db, m.achats);
    const r = (await one(db, `select gbs.prix_rendu($1) r`, [o])).r;
    // FOB 10 000 USD × 600 = 6 000 000 ; assurance (6 000 000 + 1 000 000) × 1,10 × 0,35 % = 26 950 ; CAF 7 026 950 ;
    // droits 22,3 % = 1 567 010 ; TVA 18 % de (CAF + droits) = 1 546 913, hors coût global.
    expect(r).toMatchObject({ estime: true, zone: 'UEMOA', code_sh: '690721', bareme_code_sh: '69', fret_xof: 1_000_000,
      assurance_xof: 26_950, caf_xof: 7_026_950, droits_xof: 1_567_010, rendu_xof: 8_593_960, tva_import_xof: 1_546_913 });
    expect(Number(r.taux_droits)).toBeCloseTo(0.223);
    // Le coût global part du prix rendu quand il est estimé.
    await asRoot(db);
    await db.query(`insert into gbs.parametres (cle, valeur, date_effet) values
      ('cout_global.energie_xof_kwh.CI', '100', '2026-01-01'), ('cout_global.entretien_xof_heure.CI', '5000', '2026-01-01')`);
    await db.query(`update gbs.offres set cout_global = $2 where id = $1`, [o, JSON.stringify({ puissance_kw: 2, heures_an: 2000, duree_vie_ans: 15,
      entretien_heures_an: 20, pieces_cout_an: 100, pieces_disponibles_ans: 10, sav_afrique: 'Abidjan', delai_pieces_jours: 30 })]);
    const cg = (await one(db, `select gbs_private.cout_global_offre($1) c`, [o])).c;
    expect(cg).toMatchObject({ complet: true, prix_xof: 6_000_000, base_xof: 8_593_960, total_xof: 8_593_960 + 4_000_000 + 1_000_000 + 600_000 });
    // Sans fret estimé, retour à la base FOB.
    await db.query(`update gbs.consultations_fournisseurs set fret_estime_xof = null where id = (select consultation_id from gbs.offres where id = $1)`, [o]);
    expect((await one(db, `select gbs_private.cout_global_offre($1) c`, [o])).c).toMatchObject({ base_xof: 6_000_000, total_xof: 11_600_000 });
  }));

  it('prix rendu réservé à l’équipe achats qui voit le dossier', () => withTx(async (db) => {
    const m = await monde(db);
    const { o } = await offre(db, m, 1_000_000);
    await as(db, m.comptable);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.prix_rendu($1)`, [o]);
    await as(db, m.inspecteur);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.prix_rendu($1)`, [o]);
    await as(db, m.agentGA);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.prix_rendu($1)`, [o]);
  }));
});
