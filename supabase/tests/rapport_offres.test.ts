// Lot 1, M5 : coût global, grille pondérée, rapport anonyme des 3 offres, choix signé du client.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, fournisseurAgree, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

interface Offre { montant: number; delai: number; garantie: number; technique: number; cg?: Record<string, unknown> | null }

/** Consultation close (date limite passée) et trois offres de fournisseurs agréés différents. */
async function consultation(db: Db, m: Monde, offres: Offre[], limite = `now() - interval '1 hour'`) {
  const d = await dossier(db, m);
  const noms = ['Foshan Ceramics Co.', 'Guangzhou Tiles Ltd', 'Zibo Porcelain Inc'];
  const fournisseurs = [m.fournisseur];
  for (const n of noms.slice(1, offres.length)) fournisseurs.push(await fournisseurAgree(db, m, n));
  await as(db, m.achats);
  const rfq = (await one(db, `insert into gbs.consultations_fournisseurs (dossier_id, objet, quantite, date_limite)
    values ($1, 'Carrelage 60x60', 1000, ${limite}) returning id`, [d])).id as string;
  for (const f of fournisseurs) await db.query(`insert into gbs.consultation_invites (consultation_id, fournisseur_id) values ($1, $2)`, [rfq, f]);
  const ids: string[] = [];
  if (limite.includes('-')) {
    for (const [i, o] of offres.entries()) {
      ids.push((await one(db, `insert into gbs.offres (consultation_id, fournisseur_id, recu_le, canal, incoterm, lieu, devise, montant,
          delai_jours, garantie_mois, note_technique, cout_global)
        values ($1, $2, now() - interval '2 hours', 'wechat', 'FOB', 'Shenzhen', 'USD', $3, $4, $5, $6, $7) returning id`,
        [rfq, fournisseurs[i], o.montant, o.delai, o.garantie, o.technique, o.cg ? JSON.stringify(o.cg) : null])).id);
    }
  }
  await asRoot(db);
  return { d, rfq, ids, noms };
}

const cgComplet = (kw: number, piecesUsd: number) => ({ puissance_kw: kw, heures_an: 2000, duree_vie_ans: 15, entretien_heures_an: 20,
  pieces_cout_an: piecesUsd, pieces_disponibles_ans: 10, sav_afrique: 'Partenaire à Abidjan', delai_pieces_jours: 30 });

async function rapport(db: Db, m: Monde, rfq: string) {
  await as(db, m.achats);
  const id = (await one(db, `select gbs.generer_rapport_offres($1) id`, [rfq])).id as string;
  return { id, contenu: (await one(db, `select contenu from gbs.rapports_offres where id = $1`, [id])).contenu };
}

describe('Rapport des 3 offres (M5)', () => {
  it('anonyme (A, B, C), noté, recommandé ; explication si la recommandée n’est pas la moins chère', () => withTx(async (db) => {
    const m = await monde(db);
    const { rfq, noms } = await consultation(db, m, [
      { montant: 10000, delai: 60, garantie: 12, technique: 3 },
      { montant: 10500, delai: 45, garantie: 36, technique: 5 },
      { montant: 9800, delai: 90, garantie: 12, technique: 2 },
    ]);
    const { contenu } = await rapport(db, m, rfq);
    expect(contenu.offres.map((o: any) => o.lettre)).toEqual(['A', 'B', 'C']);
    expect(contenu.recommandation).toBe('A');
    expect(contenu.critere_prix).toBe('fob');   // coût global incomplet : retour au prix FOB
    const texte = JSON.stringify(contenu);
    for (const n of noms) expect(texte).not.toContain(n);
    expect(texte).not.toContain('fournisseur_id');
    // La recommandée (meilleure note) n'est pas la moins chère : l'écart est expliqué.
    expect(contenu.explication_prix.surcout_achat_xof).toBe((10500 - 9800) * 600);
    expect(contenu.offres[0].points_forts).toContain('garantie_la_plus_longue');
    expect(contenu.offres[0].risques).toContain('donnees_cout_global_incompletes');
  }));

  it('coût global exact quand les données et les paramètres locaux sont là', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.admin);
    await db.query(`insert into gbs.parametres (cle, valeur, date_effet) values
      ('cout_global.energie_xof_kwh.CI', '100', '2026-01-01'), ('cout_global.entretien_xof_heure.CI', '5000', '2026-01-01')`);
    const { rfq } = await consultation(db, m, [
      { montant: 10000, delai: 60, garantie: 12, technique: 4, cg: cgComplet(2, 100) },
      { montant: 9000, delai: 60, garantie: 12, technique: 4, cg: cgComplet(6, 100) },
      { montant: 9500, delai: 60, garantie: 12, technique: 4, cg: cgComplet(3, 100) },
    ]);
    const { contenu } = await rapport(db, m, rfq);
    expect(contenu.critere_prix).toBe('cout_global');
    const o = contenu.offres.find((x: any) => Number(x.fob_xof) === 6_000_000);
    // 6 000 000 FOB + énergie 2 kW × 2 000 h × 10 ans × 100 + entretien 20 h × 10 × 5 000 + pièces 100 USD × 600 × 10
    expect(o.cout_global).toMatchObject({ complet: true, energie_xof: 4_000_000, entretien_xof: 1_000_000, pieces_xof: 600_000, total_xof: 11_600_000 });
    // La moins chère à l'achat consomme 3 fois plus : elle n'est pas recommandée.
    expect(contenu.offres[0].fob_xof).toBe(6_000_000);
    expect(contenu.offres[0].points_forts).toContain('cout_global_le_plus_bas');
    expect(contenu.explication_prix.ecart_cout_global_xof).toBeLessThan(0);
  }));

  it('données de coût global : champs inconnus ou hors bornes refusés', () => withTx(async (db) => {
    const m = await monde(db);
    const { ids } = await consultation(db, m, [{ montant: 10000, delai: 60, garantie: 12, technique: 3 }]);
    await as(db, m.achats);
    await expectError(db, 'GBS_COUT_GLOBAL_INVALIDE', `update gbs.offres set cout_global = '{"puissance_kw": 2, "prix_secret": 1}' where id = $1`, [ids[0]]);
    await expectError(db, 'GBS_COUT_GLOBAL_INVALIDE', `update gbs.offres set cout_global = '{"heures_an": 99999}' where id = $1`, [ids[0]]);
    await expectError(db, 'GBS_COUT_GLOBAL_INVALIDE', `update gbs.offres set cout_global = '{"puissance_kw": "2"}' where id = $1`, [ids[0]]);
    await db.query(`update gbs.offres set cout_global = '{"puissance_kw": 2}' where id = $1`, [ids[0]]);  // partiel : accepté, signalé incomplet
  }));

  it('pas de rapport avant la date limite ; moins de 3 offres signalé', () => withTx(async (db) => {
    const m = await monde(db);
    const fermee = await consultation(db, m, [], `now() + interval '1 day'`);
    await as(db, m.achats);
    await expectError(db, 'GBS_PLI_FERME', `select gbs.generer_rapport_offres($1)`, [fermee.rfq]);
    const { rfq } = await consultation(db, m, [{ montant: 10000, delai: 60, garantie: 12, technique: 3 }, { montant: 11000, delai: 60, garantie: 12, technique: 3 }]);
    expect((await rapport(db, m, rfq)).contenu.moins_de_trois_offres).toBe(true);
  }));

  it('choix signé du client : offre retenue, consultation attribuée, rapport figé ; correspondance réservée aux achats', () => withTx(async (db) => {
    const m = await monde(db);
    const { d, rfq, ids, noms } = await consultation(db, m, [
      { montant: 10000, delai: 60, garantie: 12, technique: 3 },
      { montant: 10500, delai: 45, garantie: 36, technique: 5 },
      { montant: 9800, delai: 90, garantie: 12, technique: 2 },
    ]);
    const { id } = await rapport(db, m, rfq);
    // L'équipe Afrique présente le rapport mais ne voit ni la correspondance ni les fournisseurs.
    await as(db, m.hub);
    await expectError(db, '42501', `select correspondance from gbs.rapports_offres where id = $1`, [id]);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.correspondance_rapport($1)`, [id]);
    expect((await one(db, `select contenu ->> 'recommandation' r from gbs.rapports_offres where id = $1`, [id])).r).toBe('A');
    const doc = `${d}/33333333-3333-4333-8333-333333333333.pdf`;
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.enregistrer_choix_client($1, 'Z', $2, current_date)`, [id, doc]);
    await db.query(`select gbs.enregistrer_choix_client($1, 'A', $2, current_date)`, [id, doc]);
    await expectError(db, 'GBS_CHOIX_DEJA_ENREGISTRE', `select gbs.enregistrer_choix_client($1, 'B', $2, current_date)`, [id, doc]);
    await expectError(db, '42501', `update gbs.rapports_offres set choix_lettre = 'B' where id = $1`, [id]); // aucune écriture directe
    await as(db, m.achats);
    const corr = (await one(db, `select gbs.correspondance_rapport($1) c`, [id])).c;
    expect(corr.A.fournisseur).toBe(noms[1]);
    expect(await rows(db, `select id from gbs.offres where consultation_id = $1 and retenue`, [rfq])).toEqual([{ id: ids[1] }]);
    expect((await one(db, `select statut from gbs.consultations_fournisseurs where id = $1`, [rfq])).statut).toBe('attribuee');
  }));
});
