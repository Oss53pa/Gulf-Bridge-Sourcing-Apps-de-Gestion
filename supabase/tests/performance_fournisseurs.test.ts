// Indicateurs de performance des fournisseurs (migration 82) : livraison complète et à l'heure, défauts en parties
// par million, réponse aux cotations, non-conformités ouvertes ; alertes paramétrées ; droits et cloisonnement.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, commande, dossier, expectError, fournisseurAgree, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

const jj = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const perf = (db: Db, f: string) => one(db, `select * from gbs.performance_fournisseurs($1)`, [f]);

async function livrer(db: Db, m: Monde, c: string, promise: string, reelle: string) {
  await as(db, m.achats);
  await db.query(`update gbs.commandes set date_livraison_promise = $2, livraison_reelle_le = $3 where id = $1`, [c, promise, reelle]);
}

async function inspecter(db: Db, m: Monde, c: string, defauts: { crit?: number; maj?: number; min?: number }) {
  await as(db, m.achats);
  const i = (await one(db, `insert into gbs.inspections (commande_id, type, inspecteur_id, taille_lot) values ($1, 'en_production', $2, 1200) returning id`,
    [c, m.inspecteur])).id as string;
  await as(db, m.inspecteur);
  await db.query(`update gbs.inspections set statut = 'realisee', date_realisee = current_date, defauts_critiques = $2, defauts_majeurs = $3,
    defauts_mineurs = $4 where id = $1`, [i, defauts.crit ?? 0, defauts.maj ?? 0, defauts.min ?? 0]);
  await asRoot(db);
  const p = await one(db, `select greatest((plan->'critique'->>'n')::int, (plan->'majeur'->>'n')::int, (plan->'mineur'->>'n')::int) n from gbs.inspections where id = $1`, [i]);
  return { i, n: p.n as number };
}

describe('Performance des fournisseurs', () => {
  it('livraison complète et à l’heure : retard, réception en entrepôt incomplète, commandes non contrôlées', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const k1 = await commande(db, m, d, [{ qte: 10, pu: 100 }]);
    const k2 = await commande(db, m, d, [{ qte: 10, pu: 100 }]);
    const k3 = await commande(db, m, d, [{ qte: 10, pu: 100 }]);
    const k4 = await commande(db, m, d, [{ qte: 10, pu: 100 }]);
    await livrer(db, m, k1, jj(-20), jj(-22));   // en avance
    await livrer(db, m, k2, jj(-20), jj(-15));   // 5 jours de retard
    await livrer(db, m, k3, jj(-30), jj(-30));   // à l'heure mais incomplète à la réception
    await livrer(db, m, k4, jj(-900), jj(-890)); // hors fenêtre de 12 mois
    await as(db, m.achats);
    const c = (await one(db, `select gbs.ouvrir_consolidation($1, '40_hc', 'Foshan') id`, [d])).id;
    await db.query(`select gbs.receptionner($1, $2)`, [c, { commande_id: k1, colis_attendus: 20, recue_le: jj(-1), colis_recus: 20, volume_m3: 5, poids_kg: 900 }]);
    const r3 = (await one(db, `select gbs.receptionner($1, $2) id`, [c, { commande_id: k3, colis_attendus: 20, recue_le: jj(-1), colis_recus: 18, volume_m3: 5, poids_kg: 900 }])).id;
    await db.query(`select gbs.lever_reserve_entrepot($1, 'Deux colis livrés le lendemain')`, [r3]); // la livraison reste incomplète
    expect(await perf(db, m.fournisseur)).toMatchObject({
      livraisons: 3, a_l_heure: 2, completes: 2, completes_controlees: 2, otif: 1, taux_otif: '0.3333', retard_moyen_jours: '5.0',
      en_alerte: true, motifs_alerte: ['livraison'],
    });
  }));

  it('défauts en parties par million sur les unités contrôlées ; contre-inspection comptée, inspection planifiée ignorée', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const k = await commande(db, m, d, [{ qte: 1200, pu: 10 }]);
    const a = await inspecter(db, m, k, { maj: 2, min: 1 });
    const b = await inspecter(db, m, k, {});
    await as(db, m.achats);
    await db.query(`insert into gbs.inspections (commande_id, type, inspecteur_id, taille_lot) values ($1, 'avant_expedition', $2, 1200)`, [k, m.inspecteur]);
    const p = await perf(db, m.fournisseur);
    const unites = a.n + b.n;
    expect(p).toMatchObject({ inspections: 2, unites_inspectees: unites, defauts: 3, ppm: Math.round(3 * 1e6 / unites) });
    expect(p.en_alerte).toBe(p.ppm > 15000);
    await as(db, m.admin);
    await db.query(`insert into gbs.parametres (cle, valeur, date_effet, commentaire) values ('fournisseurs.alerte_ppm', '100', current_date, 'Essai')`);
    expect((await perf(db, m.fournisseur)).motifs_alerte).toEqual(['defauts']);
  }));

  it('réponse aux cotations : taux et délai médian ; consultation en cours ou annulée ignorée', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.achats);
    const rfq = async (limite: string, statut = 'ouverte') => {
      const r = (await one(db, `insert into gbs.consultations_fournisseurs (dossier_id, objet, quantite, date_limite) values ($1, 'Carrelage', 100, ${limite}) returning id`, [d])).id;
      await db.query(`insert into gbs.consultation_invites (consultation_id, fournisseur_id, invite_le) values ($1, $2, now() - interval '100 hours')`, [r, m.fournisseur]);
      if (statut !== 'ouverte') await db.query(`update gbs.consultations_fournisseurs set statut = $2 where id = $1`, [r, statut]);
      return r;
    };
    const offre = (r: string, il_y_a: number) => db.query(`insert into gbs.offres (consultation_id, fournisseur_id, recu_le, canal, incoterm, lieu, devise, montant)
      values ($1, $2, now() - make_interval(hours => $3), 'wechat', 'FOB', 'Shenzhen', 'USD', 1000)`, [r, m.fournisseur, il_y_a]);
    const a = await rfq(`now() - interval '1 hour'`); await offre(a, 76);  // réponse en 24 h
    const b = await rfq(`now() - interval '1 hour'`); await offre(b, 52);  // réponse en 48 h
    await rfq(`now() - interval '1 hour'`);                                  // pas de réponse
    await rfq(`now() + interval '5 days'`);                                  // en cours : ignorée
    const z = await rfq(`now() - interval '1 hour'`, 'annulee'); expect(z).toBeTruthy();
    expect(await perf(db, m.fournisseur)).toMatchObject({ invitations: 3, reponses: 2, taux_reponse: '0.6667', delai_reponse_heures: '36.0' });
  }));

  it('non-conformités ouvertes et critiques : alerte ; une non-conformité close sort du compte', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const k = await commande(db, m, d, [{ qte: 1200, pu: 10 }]);
    const { i } = await inspecter(db, m, k, { maj: 1 });
    await as(db, m.inspecteur);
    await db.query(`insert into gbs.non_conformites (inspection_id, gravite, description) values ($1, 'majeur', 'Émail écaillé sur les bords')`, [i]);
    await db.query(`insert into gbs.non_conformites (inspection_id, gravite, description) values ($1, 'critique', 'Arête vive coupante')`, [i]);
    await expectError(db, 'GBS_ACCES_REFUSE', `select * from gbs.performance_fournisseurs($1)`, [m.fournisseur]); // l'inspecteur n'y a pas accès
    await as(db, m.achats);
    expect(await perf(db, m.fournisseur)).toMatchObject({ nc_ouvertes: 2, nc_critiques_ouvertes: 1, en_alerte: true, motifs_alerte: ['nc_critique'] });
    const autre = await fournisseurAgree(db, m, 'Zibo Porcelain Inc');
    await as(db, m.achats);
    expect(await perf(db, autre)).toMatchObject({ livraisons: 0, taux_otif: null, ppm: null, taux_reponse: null, nc_ouvertes: 0, en_alerte: false, motifs_alerte: [] });
  }));

  it('réservé aux achats, à l’administratrice et au Hub ; le Hub ne compte que les dossiers de sa société', () => withTx(async (db) => {
    const m = await monde(db);
    const dCI = await dossier(db, m);
    const dCN = await dossier(db, m, { societe: m.cn, client: m.clientGA });
    const k1 = await commande(db, m, dCI, [{ qte: 10, pu: 100 }]);
    const k2 = await commande(db, m, dCN, [{ qte: 10, pu: 100 }]);
    await livrer(db, m, k1, jj(-10), jj(-10));
    await livrer(db, m, k2, jj(-10), jj(-3));
    for (const u of [m.agentGA, m.inspecteur, m.comptable]) {
      await as(db, u);
      await expectError(db, 'GBS_ACCES_REFUSE', `select * from gbs.performance_fournisseurs($1)`, [m.fournisseur]);
    }
    await as(db, m.admin);
    expect(await perf(db, m.fournisseur)).toMatchObject({ livraisons: 2, otif: 1 });
    await as(db, m.hub);
    expect(await perf(db, m.fournisseur)).toMatchObject({ livraisons: 1, otif: 1, taux_otif: '1.0000' });
    await as(db, m.achats);
    expect((await rows(db, `select fournisseur_id from gbs.performance_fournisseurs()`)).length).toBeGreaterThanOrEqual(1);
    await asRoot(db);
    await db.query('set local role anon');
    await expectError(db, '42501', `select * from gbs.performance_fournisseurs(null)`);
  }));
});
