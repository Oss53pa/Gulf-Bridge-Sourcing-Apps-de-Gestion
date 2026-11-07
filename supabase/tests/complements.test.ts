// Compléments du lot 0 : accords-cadres (mensualités, échéance) et annulation par le client.
import { afterAll, describe, expect, it } from 'vitest';
import { as, closePool, commande, contratSigne, dossier, expectError, mandatSigne, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

async function cadre(db: Db, m: Monde, debut: string, fin: string) {
  return dossier(db, m, { modele: 'accord_cadre', extra: { cadre_debut: debut, cadre_fin: fin, forfait_mensuel_ht: 350000 } });
}

describe('Accord-cadre : forfait mensuel facturé automatiquement', () => {
  it('une facture par accord-cadre actif et par mois, jamais deux fois', () => withTx(async (db) => {
    const m = await monde(db);
    const k = await cadre(db, m, '2026-01-01', '2026-12-31');
    await cadre(db, m, '2027-01-01', '2027-12-31');           // pas encore actif
    await as(db, m.hub);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.facturer_mensualites_cadre('2026-11-01')`);
    await as(db, m.admin);
    expect((await one(db, `select gbs.facturer_mensualites_cadre('2026-11-15') n`)).n).toBe(1);
    expect((await one(db, `select gbs.facturer_mensualites_cadre('2026-11-01') n`)).n).toBe(0);
    const f = await one(db, `select f.* from gbs.factures f join gbs.mensualites_cadre x on x.facture_id = f.id where x.dossier_id = $1`, [k]);
    expect(f.devise).toBe('XOF');
    expect(Number(f.montant_ht)).toBe(350000);
    expect(f.statut).toBe('en_attente_fne');  // GBS CI : certification FNE avant envoi
    expect(f.numero).toMatch(/^FNE-/);
  }));

  it('client gabonais : facturé par GBS Chine en USD', () => withTx(async (db) => {
    const m = await monde(db);
    await dossier(db, m, { client: m.clientGA, societe: m.cn, modele: 'accord_cadre',
      extra: { cadre_debut: '2026-01-01', cadre_fin: '2026-12-31', forfait_mensuel_ht: 360000 } });
    await as(db, m.admin);
    await db.query(`select gbs.facturer_mensualites_cadre('2026-11-01')`);
    const f = await one(db, `select * from gbs.factures where type = 'accord_cadre'`);
    expect(f.devise).toBe('USD');
    expect(Number(f.montant_ht)).toBe(600);
    expect(Number(f.retenue_taux)).toBe(0.25);
  }));

  it('alerte 60 jours avant l\'échéance', () => withTx(async (db) => {
    const m = await monde(db);
    const proche = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const loin = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10);
    await cadre(db, m, '2026-01-01', proche);
    await cadre(db, m, '2026-01-01', loin);
    await as(db, m.hub);
    const r = await rows(db, `select * from gbs.cadres_a_echeance()`);
    expect(r).toHaveLength(1);
    expect(r[0].jours_restants).toBe(30);
  }));
});

describe('Annulation par le client selon la phase atteinte', () => {
  it('avant la signature du contrat fournisseur : aucune commission due', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await commande(db, m, d, [{ qte: 1, pu: 50_000 }]);
    await mandatSigne(db, m, d);
    await as(db, m.hub);
    await expectError(db, 'GBS_ANNULATION_ADMIN', `select gbs.annuler_dossier($1, 'Le client renonce au projet')`, [d]);
    await as(db, m.admin);
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', `select gbs.annuler_dossier($1, '')`, [d]);
    const r = (await one(db, `select gbs.annuler_dossier($1, 'Le client renonce au projet') r`, [d])).r;
    expect(r.phase_atteinte).toBe('avant_contrat');
    expect(r.factures_emises).toEqual([]);
    expect((await one(db, `select statut from gbs.dossiers where id = $1`, [d])).statut).toBe('annule');
    expect((await one(db, `select statut from gbs.commandes where dossier_id = $1`, [d])).statut).toBe('annulee');
  }));

  it('après la signature, avant la production : la première moitié reste acquise, le solde est annulé par avoir', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const c = await commande(db, m, d, [{ qte: 1, pu: 50_000 }]);
    await mandatSigne(db, m, d);
    await contratSigne(db, m, c);
    await as(db, m.hub);
    for (const t of [1, 2]) {
      const f = await one(db, `select * from gbs.facturer_commission($1, $2)`, [d, t]);
      await db.query(`select gbs.emettre_facture($1)`, [f.id]);
      await db.query(`select gbs.certifier_fne($1, $2, 'https://fne.dgi.gouv.ci/qr/x')`, [f.id, `DGI-T${t}`]);
    }
    await as(db, m.admin);
    const r = (await one(db, `select gbs.annuler_dossier($1, 'Projet suspendu par le promoteur') r`, [d])).r;
    expect(r.phase_atteinte).toBe('avant_production');
    expect(r.avoirs).toHaveLength(1);
    const av = await one(db, `select a.montant_ht, o.tranche from gbs.factures a join gbs.factures o on o.id = a.avoir_de where a.type = 'avoir'`);
    expect(av.tranche).toBe(2);
    expect(Number(av.montant_ht)).toBe(-1_500_000);
  }));

  it('après le début de la production : la commission totale est due', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const c = await commande(db, m, d, [{ qte: 1, pu: 50_000 }]);
    await mandatSigne(db, m, d);
    await contratSigne(db, m, c);
    await as(db, m.achats);
    const p = (await one(db, `insert into gbs.paiements_fournisseurs (commande_id, nature, flux, canal, compte_id, montant, devise)
      values ($1, 'acompte', 'instruction_client', 'virement', $2, 15000, 'USD') returning id`, [c, m.compte])).id;
    await as(db, m.admin);
    await db.query(`select gbs.valider_paiement($1)`, [p]);
    await db.query(`select gbs.executer_paiement($1, 'SWIFT-9', 'j.pdf')`, [p]);
    await db.query(`select gbs.changer_statut_commande($1, 'en_production')`, [c]);
    const r = (await one(db, `select gbs.annuler_dossier($1, 'Client en difficulté financière') r`, [d])).r;
    expect(r.phase_atteinte).toBe('apres_production');
    expect(r.factures_emises).toHaveLength(2);
    const tot = await one(db, `select sum(montant_ht)::numeric s from gbs.factures where dossier_id = $1 and type = 'commission' and statut <> 'annulee'`, [d]);
    expect(Number(tot.s)).toBe(3_000_000);
  }));
});

describe('Projet Supabase partagé : GBS ne touche pas aux autres applications', () => {
  it('les tables homonymes du schéma public gardent leurs droits et restent sans RLS', () => withTx(async (db) => {
    const r = await one(db, `select relrowsecurity rls from pg_class where oid = 'public.dossiers'::regclass`);
    expect(r.rls).toBe(false);
    const g = await one(db, `select has_table_privilege('anon', 'public.dossiers', 'select') a, has_table_privilege('authenticated', 'public.societes', 'insert') b`);
    expect(g).toEqual({ a: true, b: true });
    await db.query(`set local role anon`);
    expect((await one(db, `select libelle from public.dossiers where id = 1`)).libelle).toBe('autre application');
  }));

  it('un utilisateur d\'une autre application ne reçoit pas de profil GBS, et son inscription ne peut pas échouer', () => withTx(async (db) => {
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'x@autre.app', '{"nom":"X"}')`);
    expect((await one(db, `select count(*)::int n from gbs.profils where email = 'x@autre.app'`)).n).toBe(0);
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'y@gbs.test', '{"app":"gbs"}')`);
    const p = await one(db, `select role from gbs.profils where email = 'y@gbs.test'`);
    expect(p.role).toBeNull();
  }));
});
