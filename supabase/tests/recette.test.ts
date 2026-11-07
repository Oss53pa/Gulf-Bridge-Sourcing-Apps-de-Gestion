// Tests de recette du lot 0 (cahier des charges, section 13), automatisés et
// exécutés directement sur la base : règles d'argent, verrous, droits par rôle.
import { afterAll, describe, expect, it } from 'vitest';
import {
  as, asRoot, closePool, commande, compteVerifie, contratSigne, dossier, expectError, fournisseurAgree,
  inspectionValidee, mandatSigne, monde, one, rows, withTx, type Db, type Monde,
} from './helpers';

afterAll(closePool);

async function commissionApresMandat(db: Db, m: Monde, d: string) {
  const v = await mandatSigne(db, m, d);
  return (await one(db, `select calcul from public.devis where id = $1`, [v])).calcul;
}

// --------------------------------------------------------------------------- Barème
describe('Commission : barème, majorations, minimum (section 5)', () => {
  it.each([
    [10_000, 720_000, 1_000_000, 0.12],      // 6 M FCFA : 12 %, porté au minimum
    [50_000, 3_000_000, 3_000_000, 0.10],    // 30 M : 10 %
    [200_000, 9_600_000, 9_600_000, 0.08],   // 120 M : 8 %
    [500_000, 18_000_000, 18_000_000, 0.06], // 300 M : 6 %
    [1_000_000, 27_000_000, 27_000_000, 0.045], // 600 M : 4,5 %
  ])('FOB %d USD → commission calculée %d, due %d (taux %d)', async (usd, calculee, due, taux) =>
    withTx(async (db) => {
      const m = await monde(db);
      const d = await dossier(db, m);
      await commande(db, m, d, [{ qte: 1, pu: usd }]);
      const c = await commissionApresMandat(db, m, d);
      expect(Number(c.base_fob_xof)).toBe(usd * 600);
      expect(Number(c.taux_tranche)).toBe(taux);
      expect(Number(c.commission_calculee)).toBe(calculee);
      expect(Number(c.commission_totale)).toBe(due);
    }));

  it('bornes des tranches incluses (« jusqu\'à »)', () => withTx(async (db) => {
    await monde(db);
    const t = await rows(db, `select private.taux_tranche(x, date '2026-06-01') as t from unnest(array[
      10000000, 10000001, 50000000, 50000001, 150000000, 150000001, 500000000, 500000001]::numeric[]) x`);
    expect(t.map((r) => Number(r.t))).toEqual([0.12, 0.10, 0.10, 0.08, 0.08, 0.06, 0.06, 0.045]);
  }));

  it('trois commandes de 2 M FCFA : minimum de 1 M appliqué une seule fois', () => withTx(async (db) => {
    const m = await monde(db);
    await db.query(`insert into public.taux_change values ('USD', '2026-06-09', 500, 'test', now(), null)`);
    const d = await dossier(db, m);
    for (let i = 0; i < 3; i++) await commande(db, m, d, [{ qte: 1, pu: 4000 }]);
    const c = await commissionApresMandat(db, m, d);
    expect(Number(c.base_fob_xof)).toBe(6_000_000);
    expect(Number(c.commission_calculee)).toBe(720_000);
    expect(Number(c.commission_totale)).toBe(1_000_000);
  }));

  it('+2 points sur les seules lignes sur mesure', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await commande(db, m, d, [{ qte: 1, pu: 30_000 }, { qte: 1, pu: 20_000, sur_mesure: true }]);
    const c = await commissionApresMandat(db, m, d);
    expect(Number(c.commission_totale)).toBe(18_000_000 * 0.10 + 12_000_000 * 0.12);
  }));

  it('réassort : commission réduite de 50 % sur les lignes en réassort', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await commande(db, m, d, [{ qte: 1, pu: 30_000 }, { qte: 1, pu: 20_000, reassort: true }]);
    const c = await commissionApresMandat(db, m, d);
    expect(Number(c.commission_totale)).toBe(1_800_000 + 600_000);
  }));

  it('accord-cadre : -1 point, -2 points au-delà du seuil d\'engagement', () => withTx(async (db) => {
    const m = await monde(db);
    for (const [engagement, attendu] of [[50_000_000, 2_700_000], [200_000_000, 2_400_000]] as const) {
      const cadre = await dossier(db, m, { modele: 'accord_cadre', extra: {
        cadre_debut: '2026-01-01', cadre_fin: '2026-12-31', forfait_mensuel_ht: 350000, engagement_annuel_xof: engagement } });
      const d = await dossier(db, m, { extra: { cadre_id: cadre } });
      await commande(db, m, d, [{ qte: 1, pu: 50_000 }]);
      const c = await commissionApresMandat(db, m, d);
      expect(Number(c.commission_totale)).toBe(attendu);
    }
  }));

  it('le découpage en plusieurs commandes ne change pas le taux (tranche lue sur le total)', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await commande(db, m, d, [{ qte: 1, pu: 50_000 }]);
    await commande(db, m, d, [{ qte: 1, pu: 50_000 }]);   // 60 M au total : 8 %
    const c = await commissionApresMandat(db, m, d);
    expect(Number(c.taux_tranche)).toBe(0.08);
    expect(Number(c.commission_totale)).toBe(4_800_000);
  }));

  it('forfait au projet : taux réduit de la proposition à la place du barème', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m, { modele: 'equipement_site', extra: {
      date_ouverture_site: '2027-03-01', forfait_projet_ht: 6_000_000, taux_commission_projet: 0.04 } });
    await commande(db, m, d, [{ qte: 1, pu: 100_000 }]);
    const c = await commissionApresMandat(db, m, d);
    expect(Number(c.commission_totale)).toBe(2_400_000);
  }));
});

// --------------------------------------------------------------------------- FOB
describe('Ramenée à la base FOB (Incoterms)', () => {
  it('EXW et CFR pour le même produit ramenés à une base FOB cohérente', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const exw = await commande(db, m, d, [{ qte: 1, pu: 49_000 }], { incoterm: 'CFR', fret: 1_000 });
    await as(db, m.admin);
    const f = await one(db, `select fob_montant from public.commandes where id = $1`, [exw]);
    expect(Number(f.fob_montant)).toBe(48_000);
    expect(Number((await one(db, `select private.base_fob('EXW', 47000, null, null, 1000, current_date) v`)).v)).toBe(48_000);
    expect(Number((await one(db, `select private.base_fob('EXW', 10000, null, null, null, current_date) v`)).v)).toBe(10_300);
    expect(Number((await one(db, `select private.base_fob('CIF', 50000, 1500, 500, null, current_date) v`)).v)).toBe(48_000);
    await expectError(db, 'GBS_FRET_REQUIS', `select private.base_fob('CFR', 50000, null, null, null, current_date)`);
    await asRoot(db);
    const c = await commissionApresMandat(db, m, d);
    expect(Number(c.base_fob_xof)).toBe(48_000 * 600);
  }));

  it('EXW et DDP bloqués sans dérogation motivée de l\'administratrice', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.achats);
    await expectError(db, 'GBS_INCOTERM_BLOQUE', `insert into public.commandes (dossier_id, fournisseur_id, incoterm, lieu, devise)
      values ($1, $2, 'EXW', 'Foshan', 'USD')`, [d, m.fournisseur]);
    await expectError(db, 'GBS_DEROGATION_ADMIN', `insert into public.commandes (dossier_id, fournisseur_id, incoterm, lieu, devise, derogation_incoterm)
      values ($1, $2, 'EXW', 'Foshan', 'USD', 'Usine sans accès port')`, [d, m.fournisseur]);
    await as(db, m.admin);
    await db.query(`insert into public.commandes (dossier_id, fournisseur_id, incoterm, lieu, devise, derogation_incoterm)
      values ($1, $2, 'EXW', 'Foshan', 'USD', 'Usine sans accès port')`, [d, m.fournisseur]);
  }));
});

// --------------------------------------------------------------------------- Agrément
describe('Agrément des fournisseurs et vérification des clients', () => {
  it('pas de demande de cotation à un fournisseur non agréé ; commande refusée si la DD est expirée', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.achats);
    const candidat = (await one(db, `insert into public.fournisseurs (raison_sociale_en) values ('Candidat Co') returning id`)).id;
    const rfq = (await one(db, `insert into public.consultations_fournisseurs (dossier_id, objet, date_limite)
      values ($1, 'Carrelage', now() - interval '1 hour') returning id`, [d])).id;
    await expectError(db, 'GBS_FOURNISSEUR_NON_AGREE', `insert into public.consultation_invites (consultation_id, fournisseur_id)
      values ($1, $2)`, [rfq, candidat]);
    await db.query(`insert into public.consultation_invites (consultation_id, fournisseur_id) values ($1, $2)`, [rfq, m.fournisseur]);
    // DD expirée
    await asRoot(db);
    await db.query(`select set_config('gbs.rpc', 'valider_due_diligence', true)`);
    await db.query(`update public.due_diligences set valide_jusqu_au = current_date - 1 where fournisseur_id = $1`, [m.fournisseur]);
    await as(db, m.achats);
    await expectError(db, 'GBS_FOURNISSEUR_NON_AGREE', `insert into public.commandes (dossier_id, fournisseur_id, incoterm, lieu, devise)
      values ($1, $2, 'FOB', 'Shenzhen', 'USD')`, [d, m.fournisseur]);
  }));

  it('un fournisseur sans engagement de non-commission ne peut pas être agréé', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.achats);
    const f = (await one(db, `insert into public.fournisseurs (raison_sociale_en) values ('Sans engagement') returning id`)).id;
    const dd = (await one(db, `insert into public.due_diligences (fournisseur_id, grille) values ($1, '[{"critere":"x","poids":1,"note":5}]') returning id`, [f])).id;
    await as(db, m.admin);
    await db.query(`select public.valider_due_diligence($1, 'validee')`, [dd]);
    await expectError(db, 'GBS_ENGAGEMENT_NON_COMMISSION', `select public.agreer_fournisseur($1)`, [f]);
    // Et personne ne contourne la fonction en écrivant le statut directement.
    await expectError(db, 'GBS_VALIDATION_RPC', `update public.fournisseurs set statut_agrement = 'agree' where id = $1`, [f]);
  }));

  it('négoce ou lettre de crédit impossibles sans vérification du client', () => withTx(async (db) => {
    const m = await monde(db);
    await expectError(db, 'GBS_CLIENT_NON_VERIFIE', `insert into public.dossiers (intitule, societe_id, client_id, modele)
      values ('Négoce GA', $1, $2, 'negoce')`, [m.cn, m.clientGA]);
    await as(db, m.admin);
    await expectError(db, 'GBS_CLIENT_NON_VERIFIE', `insert into public.dossiers (intitule, societe_id, client_id, modele, lettre_credit)
      values ('LC GA', $1, $2, 'achat_accompagne', true)`, [m.cn, m.clientGA]);
    await db.query(`update public.clients set verification_statut = 'verifie', verification_date = current_date where id = $1`, [m.clientGA]);
    await db.query(`insert into public.dossiers (intitule, societe_id, client_id, modele) values ('Négoce GA', $1, $2, 'negoce')`, [m.cn, m.clientGA]);
  }));

  it('seule l\'administratrice statue la vérification d\'un client', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.agentGA);
    await expectError(db, 'GBS_VALIDATION_ADMIN', `update public.clients set verification_statut = 'verifie' where id = $1`, [m.clientGA]);
  }));
});

// --------------------------------------------------------------------------- Déductions
describe('Déductions sur la première facture de commission', () => {
  async function scenario(db: Db, joursAvantContrat: number) {
    const m = await monde(db);
    await db.query(`insert into public.taux_change values ('USD', '2026-03-01', 500, 'test', now(), null),
      ('USD', '2026-06-01', 600, 'test', now(), null)`);
    const d = await dossier(db, m);
    // Vérification de fournisseur vendue au client (facturée par GBS Chine, en USD : 1 000 USD = 500 000 FCFA)
    await as(db, m.admin);
    const f = (await one(db, `insert into public.factures (societe_id, client_id, type, objet, devise)
      values ($1, $2, 'due_diligence', 'Vérification fournisseur standard', 'USD') returning id`, [m.cn, m.clientCI])).id;
    await db.query(`insert into public.lignes_facture (facture_id, libelle, service, prix_unitaire) values ($1, 'Due diligence', 'S1', 1000)`, [f]);
    await db.query(`select public.emettre_facture($1)`, [f]);
    await asRoot(db);
    const contrat = new Date('2026-07-15');
    const emission = new Date(contrat.getTime() - joursAvantContrat * 86400000).toISOString().slice(0, 10);
    await db.query(`select set_config('gbs.rpc', 'emettre_facture', true)`);
    await db.query(`update public.factures set date_emission = $2 where id = $1`, [f, emission]);
    await db.query(`select set_config('gbs.rpc', '', true)`);
    const c = await commande(db, m, d, [{ qte: 1, pu: 50_000 }]);
    await mandatSigne(db, m, d, '2026-07-01');
    await contratSigne(db, m, c, '2026-07-15');
    await as(db, m.hub);
    const fc = await one(db, `select * from public.facturer_commission($1, 1)`, [d]);
    return Number(fc.montant_ht);
  }

  it('vérification de 500 000 FCFA, contrat signé 60 jours plus tard : -250 000 FCFA', () => withTx(async (db) => {
    expect(await scenario(db, 60)).toBe(1_500_000 - 250_000);
  }));

  it('contrat signé 100 jours plus tard : aucune déduction', () => withTx(async (db) => {
    expect(await scenario(db, 100)).toBe(1_500_000);
  }));

  it('le forfait de consultation payé est déduit ; rien n\'est remboursé si la commission est inférieure', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.hub);
    const f = (await one(db, `insert into public.factures (societe_id, client_id, dossier_id, type, objet, devise)
      values ($1, $2, $3, 'forfait_consultation', 'Forfait de consultation', 'XOF') returning id`, [m.ci, m.clientCI, d])).id;
    await db.query(`insert into public.lignes_facture (facture_id, libelle, service, prix_unitaire) values ($1, 'Consultation', 'S2', 1200000)`, [f]);
    await db.query(`select public.emettre_facture($1)`, [f]);
    await db.query(`select public.certifier_fne($1, 'DGI-2026-000123', 'https://fne.dgi.gouv.ci/qr/000123')`, [f]);
    const net = Number((await one(db, `select net_a_payer from public.factures where id = $1`, [f])).net_a_payer);
    await db.query(`insert into public.encaissements (facture_id, montant, devise, recu_le, mode) values ($1, $2, 'XOF', current_date, 'virement')`, [f, net]);
    await asRoot(db);
    await commande(db, m, d, [{ qte: 1, pu: 10_000 }]);   // commission au minimum : 1 000 000
    const c = await commissionApresMandat(db, m, d);
    expect(Number(c.commission_totale)).toBe(1_000_000);
    expect(Number(c.deduction_forfait_consultation)).toBe(1_000_000);  // plafonnée : rien n'est remboursé
    expect(Number(c.commission_nette)).toBe(0);
  }));
});

// --------------------------------------------------------------------------- Forfait au projet
describe('Forfait au projet (équipement d\'un site)', () => {
  it('ne s\'ouvre pas sans date d\'ouverture', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.hub);
    await expectError(db, 'GBS_DATE_OUVERTURE_OBLIGATOIRE', `insert into public.dossiers (intitule, societe_id, client_id, modele, forfait_projet_ht, taux_commission_projet)
      values ('Hôtel', $1, $2, 'equipement_site', 6000000, 0.04)`, [m.ci, m.clientCI]);
  }));

  it('la facture du deuxième versement affiche le premier déduit et le reste dû exact', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m, { by: m.hub, modele: 'equipement_site', extra: {
      date_ouverture_site: '2027-03-01', forfait_projet_ht: 6_000_000, taux_commission_projet: 0.04 } });
    await as(db, m.hub);
    await db.query(`insert into public.echeances_projet (dossier_id, ordre, libelle, montant_ht) values
      ($1, 1, 'Signature de la proposition', 2000000), ($1, 2, 'Rapport des offres', 2500000), ($1, 3, 'Réception', 1500000)`, [d]);
    const f1 = await one(db, `select * from public.facturer_echeance($1, 1)`, [d]);
    expect(f1.recapitulatif.reste_du_xof).toBe(4_000_000);
    await expectError(db, 'GBS_ECHEANCE_PRECEDENTE', `select public.facturer_echeance($1, 3)`, [d]);
    const f2 = await one(db, `select * from public.facturer_echeance($1, 2)`, [d]);
    expect(f2.recapitulatif).toMatchObject({ forfait_total_xof: 6_000_000, versements_factures_xof: 2_000_000,
      ce_versement_xof: 2_500_000, reste_du_xof: 1_500_000 });
    expect(Number(f2.montant_ht)).toBe(2_500_000);
  }));
});

// --------------------------------------------------------------------------- Verrous
describe('Verrou 1 : aucun achat sans contrat signé', () => {
  it('ni production ni acompte sans mandat et contrat signés', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const c = await commande(db, m, d, [{ qte: 1, pu: 50_000 }]);
    await as(db, m.achats);
    await expectError(db, 'GBS_TRANSITION_INVALIDE', `select public.changer_statut_commande($1, 'en_production')`, [c]);
    await expectError(db, 'GBS_VERROU1', `insert into public.paiements_fournisseurs (commande_id, nature, flux, canal, compte_id, montant, devise)
      values ($1, 'acompte', 'instruction_client', 'virement', $2, 15000, 'USD')`, [c, m.compte]);
    await expectError(db, 'GBS_VALIDATION_RPC', `update public.commandes set statut = 'en_production' where id = $1`, [c]);
    // Contrat sans mandat : refusé
    await as(db, m.admin);
    await expectError(db, 'GBS_VERROU1', `select public.valider_contrat($1, 'c.pdf', 'cachet', current_date)`, [c]);
    await asRoot(db);
    await mandatSigne(db, m, d);
    await contratSigne(db, m, c);
    // Contrat signé mais acompte non justifié : production toujours bloquée
    await as(db, m.achats);
    await expectError(db, 'GBS_VERROU1_ACOMPTE', `select public.changer_statut_commande($1, 'en_production')`, [c]);
    const p = (await one(db, `insert into public.paiements_fournisseurs (commande_id, nature, flux, canal, compte_id, montant, devise)
      values ($1, 'acompte', 'instruction_client', 'virement', $2, 15000, 'USD') returning id`, [c, m.compte])).id;
    await as(db, m.admin);
    await db.query(`select public.valider_paiement($1)`, [p]);
    await as(db, m.achats);
    await db.query(`select public.executer_paiement($1, 'SWIFT-123', 'justificatifs/acompte.pdf')`, [p]);
    const r = await one(db, `select (public.changer_statut_commande($1, 'en_production')).statut`, [c]);
    expect(r.statut).toBe('en_production');
  }));

  it('une commande sur mesure ne passe pas en production sans approbation technique', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const c = await commande(db, m, d, [{ qte: 1, pu: 50_000, sur_mesure: true }]);
    await mandatSigne(db, m, d);
    await contratSigne(db, m, c);
    await as(db, m.achats);
    const p = (await one(db, `insert into public.paiements_fournisseurs (commande_id, nature, flux, canal, compte_id, montant, devise)
      values ($1, 'acompte', 'instruction_client', 'virement', $2, 15000, 'USD') returning id`, [c, m.compte])).id;
    await as(db, m.admin);
    await db.query(`select public.valider_paiement($1)`, [p]);
    await db.query(`select public.executer_paiement($1, 'SWIFT-1', 'j.pdf')`, [p]);
    await expectError(db, 'GBS_VERROU1_APPROBATION', `select public.changer_statut_commande($1, 'en_production')`, [c]);
    await db.query(`select public.valider_approbation($1, 'approbations/plans-v3.pdf')`, [c]);
    await db.query(`select public.changer_statut_commande($1, 'en_production')`, [c]);
  }));

  it('mode 1 : GBS ne paie jamais le fournisseur à la place du client', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const c = await commande(db, m, d, [{ qte: 1, pu: 50_000 }]);
    await mandatSigne(db, m, d);
    await contratSigne(db, m, c);
    await as(db, m.achats);
    await expectError(db, 'GBS_MODE1_FONDS_CLIENT', `insert into public.paiements_fournisseurs (commande_id, nature, flux, canal, compte_id, montant, devise)
      values ($1, 'acompte', 'gbs', 'virement', $2, 15000, 'USD')`, [c, m.compte]);
  }));
});

describe('Verrou 2 : aucune expédition sans inspection validée', () => {
  async function preparer(db: Db) {
    const m = await monde(db);
    const d = await dossier(db, m);
    const c = await commande(db, m, d, [{ qte: 1, pu: 50_000 }]);
    await mandatSigne(db, m, d);
    await contratSigne(db, m, c);
    return { m, d, c };
  }

  it('solde et bon à payer bloqués tant que l\'inspection n\'est pas validée ; dérogation motivée au journal', () => withTx(async (db) => {
    const { m, d, c } = await preparer(db);
    await as(db, m.achats);
    const sql = `insert into public.paiements_fournisseurs (commande_id, nature, flux, canal, compte_id, montant, devise)
      values ($1, 'solde', 'instruction_client', 'virement', $2, 35000, 'USD') returning id`;
    await expectError(db, 'GBS_VERROU2', sql, [c, m.compte]);
    await expectError(db, 'GBS_DEROGATION_ADMIN', `select public.deroger($1, 'verrou_inspection', 'Client a inspecté lui-même', $2)`, [d, c]);
    await as(db, m.admin);
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', `select public.deroger($1, 'verrou_inspection', '', $2)`, [d, c]);
    await db.query(`select public.deroger($1, 'verrou_inspection', 'Client présent à l''inspection finale, rapport tiers SGS', $2)`, [d, c]);
    const j = await one(db, `select motif from public.journal_audit where table_nom = 'derogations' order by id desc limit 1`);
    expect(j.motif).toContain('rapport tiers SGS');
    await as(db, m.achats);
    await db.query(sql, [c, m.compte]);
  }));

  it('solde autorisé après inspection avant expédition validée', () => withTx(async (db) => {
    const { m, c } = await preparer(db);
    await inspectionValidee(db, m, c);
    await as(db, m.achats);
    await db.query(`insert into public.paiements_fournisseurs (commande_id, nature, flux, canal, compte_id, montant, devise)
      values ($1, 'solde', 'instruction_client', 'virement', $2, 35000, 'USD')`, [c, m.compte]);
  }));

  it('expédition bloquée : inspection, commission impayée, bordereau BSC, marchandise dangereuse', () => withTx(async (db) => {
    const { m, d, c } = await preparer(db);
    await as(db, m.achats);
    const e = (await one(db, `insert into public.expeditions (dossier_id, mode, pays_destination, port_arrivee)
      values ($1, 'conteneur_complet', 'CI', 'Abidjan') returning id`, [d])).id;
    await db.query(`insert into public.expedition_commandes values ($1, $2)`, [e, c]);
    await db.query(`select public.changer_statut_expedition($1, 'remise_transporteur')`, [e]);
    await expectError(db, 'GBS_VERROU2', `select public.changer_statut_expedition($1, 'expediee')`, [e]);
    await inspectionValidee(db, m, c);
    await as(db, m.achats);
    await expectError(db, 'GBS_COMMISSION_IMPAYEE', `select public.changer_statut_expedition($1, 'expediee')`, [e]);
    // Commission réglée (deux tranches)
    await as(db, m.hub);
    for (const t of [1, 2]) {
      const f = await one(db, `select * from public.facturer_commission($1, $2)`, [d, t]);
      await db.query(`select public.emettre_facture($1)`, [f.id]);
      await db.query(`select public.certifier_fne($1, $2, 'https://fne.dgi.gouv.ci/qr/xyz')`, [f.id, `DGI-${t}-0001`]);
      const net = (await one(db, `select net_a_payer from public.factures where id = $1`, [f.id])).net_a_payer;
      await db.query(`insert into public.encaissements (facture_id, montant, devise, recu_le, mode) values ($1, $2, 'XOF', current_date, 'virement')`, [f.id, net]);
    }
    await as(db, m.achats);
    await expectError(db, 'GBS_BORDEREAU_SUIVI', `select public.changer_statut_expedition($1, 'expediee')`, [e]);
    await db.query(`update public.expeditions set bordereau_reference = 'BSC-2026-778899' where id = $1`, [e]);
    const r = await one(db, `select (public.changer_statut_expedition($1, 'expediee')).statut`, [e]);
    expect(r.statut).toBe('expediee');
    expect((await one(db, `select statut from public.commandes where id = $1`, [c])).statut).toBe('expediee');
  }));

  it('expédition contenant une batterie au lithium bloquée sans FDS, déclaration IMDG ni UN38.3', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m, { modele: 'negoce', societe: m.cn, client: m.clientCI });
    const c = await commande(db, m, d, [{ qte: 10, pu: 500, article: m.articleDanger }]);
    await mandatSigne(db, m, d);
    await contratSigne(db, m, c);
    await inspectionValidee(db, m, c);
    await as(db, m.achats);
    const e = (await one(db, `insert into public.expeditions (dossier_id, mode, pays_destination, bordereau_reference)
      values ($1, 'groupage', 'CI', 'BSC-1') returning id`, [d])).id;
    await db.query(`insert into public.expedition_commandes values ($1, $2)`, [e, c]);
    await expectError(db, 'GBS_MARCHANDISE_DANGEREUSE', `select public.changer_statut_expedition($1, 'expediee')`, [e]);
    await db.query(`update public.expeditions set fds_document = 'fds.pdf', declaration_imdg_document = 'imdg.pdf' where id = $1`, [e]);
    await expectError(db, 'GBS_UN38_3', `select public.changer_statut_expedition($1, 'expediee')`, [e]);
    await db.query(`update public.expeditions set un38_3_document = 'un383.pdf' where id = $1`, [e]);
    await db.query(`select public.changer_statut_expedition($1, 'expediee')`, [e]);
  }));
});

// --------------------------------------------------------------------------- Paiements
describe('Paiements : comptes vérifiés et contrôle à quatre yeux', () => {
  it('paiement refusé vers un compte non vérifié ; modifier un compte vérifié le repasse à non vérifié', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m, { modele: 'negoce', societe: m.cn });
    const c = await commande(db, m, d, [{ qte: 1, pu: 50_000 }]);
    await mandatSigne(db, m, d);
    await contratSigne(db, m, c);
    await as(db, m.achats);
    await db.query(`update public.comptes_paiement set numero = '6217000099999' where id = $1`, [m.compte]);
    expect((await one(db, `select verifie from public.comptes_paiement where id = $1`, [m.compte])).verifie).toBe(false);
    await expectError(db, 'GBS_COMPTE_NON_VERIFIE', `insert into public.paiements_fournisseurs (commande_id, nature, flux, canal, compte_id, montant, devise)
      values ($1, 'acompte', 'gbs', 'virement', $2, 15000, 'USD')`, [c, m.compte]);
    await expectError(db, 'GBS_VERIFICATION_RPC', `update public.comptes_paiement set verifie = true where id = $1`, [m.compte]);
  }));

  it('la personne qui prépare un ordre de paiement ne peut pas le valider', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m, { modele: 'negoce', societe: m.cn });
    const c = await commande(db, m, d, [{ qte: 1, pu: 50_000 }]);
    await mandatSigne(db, m, d);
    await contratSigne(db, m, c);
    await as(db, m.admin);
    const p = (await one(db, `insert into public.paiements_fournisseurs (commande_id, nature, flux, canal, compte_id, montant, devise)
      values ($1, 'acompte', 'gbs', 'virement', $2, 15000, 'USD') returning id`, [c, m.compte])).id;
    await expectError(db, 'GBS_QUATRE_YEUX', `select public.valider_paiement($1)`, [p]);
    // Préparé par l'administratrice : seule la seconde personne désignée valide.
    await as(db, m.achats);
    await expectError(db, 'GBS_QUATRE_YEUX_DELEGUE', `select public.valider_paiement($1)`, [p]);
    await as(db, m.delegue);
    await db.query(`select public.valider_paiement($1)`, [p]);
  }));

  it('la vérification d\'un compte exige une seconde personne', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.admin);
    const c = (await one(db, `insert into public.comptes_paiement (fournisseur_id, type, titulaire, devise, numero)
      values ($1, 'alipay', 'Foshan Ceramics Co. Ltd', 'CNY', 'alipay-foshan') returning id`, [m.fournisseur])).id;
    await db.query(`select public.demander_verification_compte($1)`, [c]);
    await expectError(db, 'GBS_QUATRE_YEUX', `select public.verifier_compte($1)`, [c]);
  }));

  it('WeChat Pay / Alipay : CNY, paiements propres de GBS, plafond par paiement', () => withTx(async (db) => {
    const m = await monde(db);
    const w = await compteVerifie(db, m, m.fournisseur, 'wechat_pay', 'CNY');
    const d = await dossier(db, m, { modele: 'negoce', societe: m.cn });
    const c = await commande(db, m, d, [{ qte: 1, pu: 50_000 }]);
    await mandatSigne(db, m, d);
    await contratSigne(db, m, c);
    await as(db, m.achats);
    await expectError(db, 'GBS_PLAFOND_WALLET', `insert into public.paiements_fournisseurs (commande_id, nature, flux, canal, compte_id, montant, devise)
      values ($1, 'acompte', 'gbs', 'wechat_pay', $2, 80000, 'CNY')`, [c, w]);
    await db.query(`insert into public.paiements_fournisseurs (commande_id, nature, flux, canal, compte_id, montant, devise)
      values ($1, 'echantillon', 'gbs', 'wechat_pay', $2, 1200, 'CNY')`, [c, w]);
  }));
});

// --------------------------------------------------------------------------- ISO 2859-1
describe('Inspection : échantillonnage ISO 2859-1', () => {
  it('lot de 1 200 pièces, niveau II : lettre J, 80 pièces ; NQA 2,5 → 5/6 ; NQA 4,0 → 7/8 ; critique 0/1', () => withTx(async (db) => {
    const p = (await one(db, `select public.plan_echantillonnage(1200, 'II', 0, 2.5, 4.0) p`)).p;
    expect(p.majeur).toEqual({ lettre: 'J', n: 80, ac: 5, re: 6, controle_total: false });
    expect(p.mineur).toEqual({ lettre: 'J', n: 80, ac: 7, re: 8, controle_total: false });
    expect(p.critique).toMatchObject({ lettre: 'J', n: 80, ac: 0, re: 1 });
  }));

  it.each([
    [500, 'II', 1.0, 'H', 50, 1],    // H, NQA 1,0 : 1/2
    [150, 'II', 0.65, 'F', 20, 0],   // F, NQA 0,65 : 0/1
    [280, 'II', 0.65, 'F', 20, 0],   // G, NQA 0,65 : flèche vers le haut → F (20), 0/1
    [280, 'II', 1.0, 'H', 50, 1],    // G, NQA 1,0 : flèche vers le bas → 1/2 avec n = 50
    [90, 'II', 1.5, 'D', 8, 0],      // E, NQA 1,5 : flèche vers le haut → D (8), 0/1
    [10000, 'II', 0.065, 'L', 200, 0],
    [3200, 'II', 6.5, 'K', 125, 14],
    [50000, 'II', 6.5, 'L', 200, 21],
    [500000, 'II', 6.5, 'L', 200, 21], // au-delà de 21/22 : flèche vers le haut
  ])('lot %d, niveau %s, NQA %d → %s, n=%d, Ac=%d', (lot, niv, nqa, lettre, n, ac) => withTx(async (db) => {
    const p = (await one(db, `select private.iso2859_plan($1, $2, $3) p`, [lot, niv, nqa])).p;
    expect(p).toMatchObject({ lettre, n, ac, re: ac + 1 });
  }));

  it('décision proposée conforme au calcul manuel ; une NC ouverte bloque la validation', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const c = await commande(db, m, d, [{ qte: 1200, pu: 40 }]);
    await as(db, m.achats);
    const i = (await one(db, `insert into public.inspections (commande_id, type, inspecteur_id, taille_lot)
      values ($1, 'avant_expedition', $2, 1200) returning id`, [c, m.inspecteur])).id;
    await as(db, m.inspecteur);
    await db.query(`update public.inspections set statut = 'realisee', date_realisee = current_date, defauts_majeurs = 6 where id = $1`, [i]);
    expect((await one(db, `select decision_proposee from public.inspections where id = $1`, [i])).decision_proposee).toBe('refusee');
    await db.query(`update public.inspections set defauts_majeurs = 5, defauts_mineurs = 7 where id = $1`, [i]);
    expect((await one(db, `select decision_proposee from public.inspections where id = $1`, [i])).decision_proposee).toBe('acceptee');
    const nc = (await one(db, `insert into public.non_conformites (inspection_id, gravite, description) values ($1, 'majeur', 'Calibre hors tolérance') returning id`, [i])).id;
    // L'inspecteur ne valide pas lui-même
    await expectError(db, 'GBS_VALIDATION_ADMIN', `select public.valider_inspection($1, 'liberation')`, [i]);
    await as(db, m.admin);
    await expectError(db, 'GBS_NC_OUVERTE', `select public.valider_inspection($1, 'liberation')`, [i]);
    await db.query(`update public.non_conformites set statut = 'close' where id = $1`, [nc]);
    await db.query(`select public.valider_inspection($1, 'liberation')`, [i]);
  }));

  it('libérer un lot dont la décision proposée est le refus exige une dérogation motivée', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const c = await commande(db, m, d, [{ qte: 1200, pu: 40 }]);
    await as(db, m.achats);
    const i = (await one(db, `insert into public.inspections (commande_id, type, inspecteur_id, taille_lot) values ($1, 'avant_expedition', $2, 1200) returning id`, [c, m.inspecteur])).id;
    await db.query(`update public.inspections set statut = 'realisee', date_realisee = current_date, defauts_critiques = 1 where id = $1`, [i]);
    await as(db, m.admin);
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', `select public.valider_inspection($1, 'liberation')`, [i]);
    await db.query(`select public.valider_inspection($1, 'liberation', 'Défaut critique corrigé et recontrôlé sur place')`, [i]);
  }));
});

// --------------------------------------------------------------------------- Dossiers
describe('Dossiers : complétude, phases, points bloquants', () => {
  it('passage refusé tant qu\'une pièce obligatoire manque ; dérogation motivée au journal', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m, { by: m.hub });
    await as(db, m.hub);
    await expectError(db, 'GBS_PIECES_MANQUANTES', `select public.avancer_phase($1)`, [d]);
    const pieces = await rows(db, `select id from public.pieces where dossier_id = $1 and phase = 'consultation' and obligatoire`, [d]);
    for (const p of pieces) {
      await db.query(`select public.deposer_piece($1, $2, null)`, [p.id, `${d}/piece.pdf`]);
      await db.query(`select public.statuer_piece($1, 'validee')`, [p.id]);
    }
    const r = await one(db, `select public.avancer_phase($1) r`, [d]);
    expect(r.r.phase).toBe('verification');
    // Dérogation : administratrice seule, avec motif
    await expectError(db, 'GBS_DEROGATION_ADMIN', `select public.avancer_phase($1, 'Licence en cours de traduction')`, [d]);
    await as(db, m.admin);
    await db.query(`select public.avancer_phase($1, 'Licence en cours de traduction, reçue en chinois')`, [d]);
    const j = await one(db, `select count(*)::int n from public.journal_audit where table_nom = 'derogations' and motif like 'Licence%'`);
    expect(j.n).toBe(1);
    await expectError(db, 'GBS_VALIDATION_RPC', `update public.dossiers set phase_courante = 'cloture' where id = $1`, [d]);
  }));

  it('un dossier de due diligence seule n\'exige aucune pièce d\'expédition', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m, { modele: 'due_diligence' });
    const n = await one(db, `select count(*)::int n from public.pieces where dossier_id = $1 and phase = 'expedition'`, [d]);
    expect(n.n).toBe(0);
  }));

  it('le bordereau de suivi des cargaisons du pays de destination est exigé dans la phase Expédition', () => withTx(async (db) => {
    const m = await monde(db);
    const ci = await dossier(db, m);
    const ga = await dossier(db, m, { societe: m.cn, client: m.clientGA });
    const lib = async (d: string) => (await one(db, `select libelle from public.pieces where dossier_id = $1 and code = 'bordereau_suivi'`, [d])).libelle;
    expect(await lib(ci)).toContain('BSC');
    expect(await lib(ga)).toContain('BIETC');
  }));

  it('un point bloquant échu est escaladé à l\'administratrice', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.hub);
    await db.query(`insert into public.points_bloquants (dossier_id, description, categorie, echeance) values ($1, 'Plans non reçus', 'client', current_date - 1)`, [d]);
    await expectError(db, 'GBS_ACCES_REFUSE', `select public.escalader_points_bloquants()`);
    await as(db, m.admin);
    expect((await one(db, `select public.escalader_points_bloquants() n`)).n).toBe(1);
  }));

  it('le mode financier est figé à l\'ouverture', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.admin);
    await expectError(db, 'GBS_MODE_FIGE', `update public.dossiers set mode_financier = 'negoce' where id = $1`, [d]);
  }));

  it('le négoce est porté par GBS Chine', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.admin);
    await expectError(db, 'GBS_NEGOCE_GBS_CHINE', `insert into public.dossiers (intitule, societe_id, client_id, modele) values ('x', $1, $2, 'negoce')`, [m.ci, m.clientCI]);
  }));
});

// --------------------------------------------------------------------------- Registre
describe('Registre des fournisseurs présentés', () => {
  it('inscription automatique avec date et dossier, sans modification possible', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await commande(db, m, d, [{ qte: 1, pu: 1000 }]);
    await as(db, m.admin);
    const r = await one(db, `select * from public.registre_presentations where client_id = $1`, [m.clientCI]);
    expect(r.dossier_id).toBe(d);
    await expectError(db, '42501', `delete from public.registre_presentations where id = $1`, [r.id]);
    await asRoot(db);
    await expectError(db, 'GBS_IMMUABLE', `update public.registre_presentations set presente_le = now() where id = $1`, [r.id]);
  }));
});

// --------------------------------------------------------------------------- Facturation
describe('Facturation par société, devises, retenues, FNE', () => {
  it('GBS CI facture en XOF, GBS Chine en USD ; la règle de la société facturante est imposée', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.admin);
    await expectError(db, 'GBS_DEVISE_SOCIETE', `insert into public.factures (societe_id, client_id, type, objet, devise) values ($1, $2, 'commission', 'Objet test', 'USD')`, [m.ci, m.clientCI]);
    await expectError(db, 'GBS_SOCIETE_FACTURANTE', `insert into public.factures (societe_id, client_id, type, objet, devise) values ($1, $2, 'inspection', 'Objet test', 'XOF')`, [m.ci, m.clientCI]);
    await expectError(db, 'GBS_SOCIETE_FACTURANTE', `insert into public.factures (societe_id, client_id, type, objet, devise) values ($1, $2, 'commission', 'Objet test', 'XAF')`, [m.ci, m.clientGA]);
    await db.query(`insert into public.factures (societe_id, client_id, type, objet, devise) values ($1, $2, 'inspection', 'Objet test', 'USD')`, [m.cn, m.clientCI]);
  }));

  it('retenue à la source : factures de GBS Chine au taux du pays du client, jamais GBS CI à un client ivoirien', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.admin);
    const taux = async (soc: string, cli: string, type: string, dev: string) =>
      Number((await one(db, `insert into public.factures (societe_id, client_id, type, objet, devise) values ($1, $2, $3, 'Objet test', $4) returning retenue_taux`,
        [soc, cli, type, dev])).retenue_taux);
    expect(await taux(m.cn, m.clientCI, 'inspection', 'USD')).toBe(0.20);
    expect(await taux(m.cn, m.clientCM, 'commission', 'USD')).toBe(0.15);
    expect(await taux(m.cn, m.clientGA, 'commission', 'USD')).toBe(0.25);
    expect(await taux(m.ci, m.clientCI, 'commission', 'XOF')).toBe(0);
  }));

  it('une facture de GBS CI ne part pas sans numéro et QR code FNE', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.hub);
    const f = (await one(db, `insert into public.factures (societe_id, client_id, type, objet, devise) values ($1, $2, 'forfait_consultation', 'Forfait', 'XOF') returning id`, [m.ci, m.clientCI])).id;
    await db.query(`insert into public.lignes_facture (facture_id, libelle, prix_unitaire) values ($1, 'Forfait', 500000)`, [f]);
    const e = await one(db, `select * from public.emettre_facture($1)`, [f]);
    expect(e.statut).toBe('en_attente_fne');
    expect(e.numero).toMatch(/^FNE-\d{4}-\d{5}$/);
    expect(Number(e.ttc)).toBe(590_000);
    await expectError(db, 'GBS_FACTURE_NON_EMISE', `insert into public.encaissements (facture_id, montant, devise, recu_le, mode) values ($1, 100, 'XOF', current_date, 'virement')`, [f]);
    await asRoot(db);
    await db.query(`select set_config('gbs.rpc', 'emettre_facture', true)`);
    await expectError(db, 'factures_check', `update public.factures set statut = 'emise' where id = $1`, [f]);
    await as(db, m.hub);
    const ok = await one(db, `select * from public.certifier_fne($1, 'DGI-2026-55', 'https://fne.dgi.gouv.ci/qr/55')`, [f]);
    expect(ok.statut).toBe('emise');
    await expectError(db, 'GBS_FACTURE_EMISE', `update public.factures set objet = 'autre' where id = $1`, [f]);
  }));

  it('un paiement reçu en XAF est enregistré en XAF ; une devise différente de la facture est refusée', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.admin);
    const f = (await one(db, `insert into public.factures (societe_id, client_id, type, objet, devise) values ($1, $2, 'inspection', 'Inspection', 'USD') returning id`, [m.cn, m.clientGA])).id;
    await db.query(`insert into public.lignes_facture (facture_id, libelle, prix_unitaire) values ($1, 'Inspection 2 jours', 540)`, [f]);
    await db.query(`select public.emettre_facture($1)`, [f]);
    await expectError(db, 'GBS_DEVISE_ENCAISSEMENT', `insert into public.encaissements (facture_id, montant, devise, recu_le, mode) values ($1, 100, 'XAF', current_date, 'virement')`, [f]);
    // Prestation facturée par GBS CI en XAF à un client gabonais (mois 1 à 3)
    await asRoot(db);
    await db.query(`update public.societes set date_creation = current_date + 30 where code = 'GBS_CN'`);
    await as(db, m.admin);
    const g = (await one(db, `insert into public.factures (societe_id, client_id, type, objet, devise) values ($1, $2, 'inspection', 'Inspection', 'XAF') returning id`, [m.ci, m.clientGA])).id;
    await db.query(`insert into public.lignes_facture (facture_id, libelle, prix_unitaire) values ($1, 'Inspection', 320000)`, [g]);
    await db.query(`select public.emettre_facture($1)`, [g]);
    await db.query(`select public.certifier_fne($1, 'DGI-9', 'https://fne.dgi.gouv.ci/qr/9')`, [g]);
    const e = await one(db, `insert into public.encaissements (facture_id, montant, devise, recu_le, mode) values ($1, 100000, 'XAF', current_date, 'virement') returning devise, montant_xof`, [g]);
    expect(e.devise).toBe('XAF');
    expect(Number(e.montant_xof)).toBe(100000);
  }));

  it('aucun montant sans code devise ISO 4217', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.admin);
    await expectError(db, 'GBS_DEVISE_SOCIETE', `insert into public.factures (societe_id, client_id, type, objet, devise) values ($1, $2, 'commission', 'Objet test', 'FCF')`, [m.ci, m.clientCI]);
    await expectError(db, 'taux_change_devise_check', `insert into public.taux_change (devise, date_taux, taux_xof) values ('FCF', current_date, 1)`);
    await expectError(db, 'null value', `insert into public.factures (societe_id, client_id, type, objet) values ($1, $2, 'commission', 'x')`, [m.ci, m.clientCI]);
  }));
});

// --------------------------------------------------------------------------- Partage
describe('Partage de la valeur et flux entre sociétés', () => {
  async function encaisser(db: Db, m: Monde, soc: string, cli: string, type: string, dev: string, ht: number, dossierId?: string, marge?: number) {
    await as(db, m.admin);
    const f = (await one(db, `insert into public.factures (societe_id, client_id, dossier_id, type, objet, devise, marge_ht) values ($1,$2,$3,$4,'Objet test',$5,$6) returning id`,
      [soc, cli, dossierId ?? null, type, dev, marge ?? null])).id;
    await db.query(`insert into public.lignes_facture (facture_id, libelle, prix_unitaire) values ($1, 'x', $2)`, [f, ht]);
    const e = await one(db, `select * from public.emettre_facture($1)`, [f]);
    if (e.statut === 'en_attente_fne') await db.query(`select public.certifier_fne($1, $2, 'https://fne.dgi.gouv.ci/qr/1')`, [f, `DGI-${f.slice(0, 8)}`]);
    const net = (await one(db, `select net_a_payer from public.factures where id = $1`, [f])).net_a_payer;
    await db.query(`insert into public.encaissements (facture_id, montant, devise, recu_le, mode) values ($1, $2, $3, current_date, 'virement')`, [f, net, dev]);
    return f;
  }

  it('commission encaissée par GBS CI : 70 % dus à GBS Chine ; forfait : 60 %', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await encaisser(db, m, m.ci, m.clientCI, 'commission', 'XOF', 3_000_000, d);
    await encaisser(db, m, m.ci, m.clientCI, 'forfait_consultation', 'XOF', 500_000, d);
    const p = await rows(db, `select regle, base_xof, montant_xof from public.partages order by montant_xof desc`);
    expect(p.map((x) => [x.regle, Number(x.base_xof), Number(x.montant_xof)])).toEqual([
      ['partage.ci_vers_cn.commissions', 3_000_000, 2_100_000],
      ['partage.ci_vers_cn.forfaits', 500_000, 300_000],
    ]);
  }));

  it('services réalisés en Chine pour un client ivoirien : 5 % de frais de gestion pour GBS CI ; négoce : 30 % de la marge', () => withTx(async (db) => {
    const m = await monde(db);
    await encaisser(db, m, m.cn, m.clientCI, 'inspection', 'USD', 1000);
    await asRoot(db);
    await db.query(`update public.clients set verification_statut = 'verifie', verification_date = current_date where id = $1`, [m.clientCI]);
    await encaisser(db, m, m.cn, m.clientCI, 'negoce', 'USD', 100_000, undefined, 20_000);
    const p = await rows(db, `select regle, base_xof, montant_xof from public.partages order by montant_xof`);
    expect(p.map((x) => [x.regle, Number(x.base_xof), Number(x.montant_xof)])).toEqual([
      ['partage.cn_vers_ci.frais_gestion', 600_000, 30_000],
      ['partage.cn_vers_ci.marge_negoce', 12_000_000, 3_600_000],
    ]);
  }));

  it('agent pays : 15 % des honoraires de ses clients, à l\'encaissement ; il ne voit que les siens', () => withTx(async (db) => {
    const m = await monde(db);
    await encaisser(db, m, m.cn, m.clientGA, 'inspection', 'USD', 1000);
    await encaisser(db, m, m.cn, m.clientCM, 'inspection', 'USD', 2000);
    await as(db, m.agentGA);
    const p = await rows(db, `select montant_xof from public.partages`);
    expect(p.map((x) => Number(x.montant_xof))).toEqual([90_000]);
  }));

  it('relevé mensuel identique au calcul manuel ; vue consolidée = somme des sociétés moins les flux internes', () => withTx(async (db) => {
    const m = await monde(db);
    const ventes = [
      [m.ci, m.clientCI, 'commission', 'XOF', 2_000_000], [m.ci, m.clientCI, 'forfait_consultation', 'XOF', 800_000],
      [m.cn, m.clientCI, 'inspection', 'USD', 500], [m.cn, m.clientCI, 'due_diligence', 'USD', 900],
      [m.cn, m.clientGA, 'commission', 'USD', 3000], [m.ci, m.clientCI, 'installation', 'XOF', 1_000_000],
      [m.ci, m.clientCI, 'commission', 'XOF', 4_000_000], [m.cn, m.clientCM, 'logistique', 'USD', 400],
      [m.cn, m.clientCI, 'logistique', 'USD', 1200], [m.ci, m.clientCI, 'accord_cadre', 'XOF', 350_000],
    ] as const;
    for (const v of ventes) await encaisser(db, m, v[0], v[1], v[2], v[3], v[4]);
    // Calcul manuel
    const ciVersCn = 0.70 * (2_000_000 + 4_000_000) + 0.60 * (800_000 + 350_000);
    const cnVersCi = 0.05 * (500 + 900 + 1200) * 600;
    const agents = 0.15 * (3000 + 400) * 600;
    await as(db, m.admin);
    const r = await one(db, `select * from public.valider_releve(current_date)`);
    expect(Number(r.total_ci_vers_cn)).toBe(ciVersCn);
    expect(Number(r.total_cn_vers_ci)).toBe(cnVersCi);
    expect(Number(r.total_agents)).toBe(agents);
    // Consolidation : CA du dispositif = facturé aux clients ; les flux internes s'annulent.
    const ca = (await one(db, `select sum(round(private.to_xof(montant_ht, devise, date_emission))) s from public.factures where client_id is not null`)).s;
    const fi = await rows(db, `select * from public.generer_factures_intragroupe(current_date)`);
    expect(fi).toHaveLength(2);
    const parSociete = await one(db, `select sum(round(private.to_xof(montant_ht, devise, date_emission))) s from public.factures`);
    const internes = await one(db, `select sum(round(private.to_xof(montant_ht, devise, date_emission))) s from public.factures where type = 'intragroupe'`);
    expect(Number(parSociete.s) - Number(internes.s)).toBe(Number(ca));
    expect(Math.abs(Number(internes.s) - (ciVersCn + cnVersCi))).toBeLessThanOrEqual(1);
  }));

  it('un changement de règle de partage daté ne modifie pas les dossiers ouverts avant sa date d\'effet', () => withTx(async (db) => {
    const m = await monde(db);
    const ancien = await dossier(db, m, { extra: { ouvert_le: '2026-06-01' } });
    await as(db, m.admin);
    await db.query(`insert into public.parametres (cle, valeur, date_effet) values ('partage.ci_vers_cn.commissions', '0.65', '2026-09-01')`);
    const nouveau = await dossier(db, m, { extra: { ouvert_le: '2026-10-01' } });
    await encaisser(db, m, m.ci, m.clientCI, 'commission', 'XOF', 1_000_000, ancien);
    await encaisser(db, m, m.ci, m.clientCI, 'commission', 'XOF', 1_000_000, nouveau);
    const p = await rows(db, `select dossier_id, taux from public.partages`);
    expect(Number(p.find((x) => x.dossier_id === ancien)!.taux)).toBe(0.70);
    expect(Number(p.find((x) => x.dossier_id === nouveau)!.taux)).toBe(0.65);
  }));
});

// --------------------------------------------------------------------------- Droits
describe('Droits par rôle, appliqués en base', () => {
  it('un compte interne sans double authentification n\'accède à rien', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.admin, 'aal1');
    expect(await rows(db, `select * from public.clients`)).toHaveLength(0);
    expect(await rows(db, `select * from public.societes`)).toHaveLength(0);
    await expectError(db, 'GBS_ACCES_REFUSE', `select public.tableau_de_bord()`);
    await as(db, null);
    await db.query('set local role anon');
    await expectError(db, '42501', `select * from public.clients`);
  }));

  it('Hub Afrique : ni prix fournisseurs détaillés, ni comptes de paiement, ni factures de GBS Chine', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await commande(db, m, d, [{ qte: 1, pu: 1000 }]);
    await as(db, m.admin);
    const f = (await one(db, `insert into public.factures (societe_id, client_id, type, objet, devise) values ($1, $2, 'inspection', 'Objet test', 'USD') returning id`, [m.cn, m.clientCI])).id;
    await as(db, m.hub);
    expect(await rows(db, `select * from public.commandes`)).toHaveLength(0);
    expect(await rows(db, `select * from public.lignes_commande`)).toHaveLength(0);
    expect(await rows(db, `select * from public.comptes_paiement`)).toHaveLength(0);
    expect(await rows(db, `select * from public.fournisseurs`)).toHaveLength(0);
    expect(await rows(db, `select * from public.factures where id = $1`, [f])).toHaveLength(0);
    // Valeur FOB des dossiers ivoiriens en achat accompagné : oui
    expect(await rows(db, `select * from public.dossier_fob($1)`, [d])).toHaveLength(1);
  }));

  it('agent pays : ni prix fournisseurs, ni clients d\'un autre pays', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.agentGA);
    const c = await rows(db, `select raison_sociale from public.clients`);
    expect(c.map((x) => x.raison_sociale)).toEqual(['Base-vie Moanda']);
    expect(await rows(db, `select * from public.commandes`)).toHaveLength(0);
    expect(await rows(db, `select * from public.fournisseurs`)).toHaveLength(0);
    expect(await rows(db, `select * from public.factures`)).toHaveLength(0);
    const tdb = (await one(db, `select public.tableau_de_bord() t`)).t;
    expect(tdb.montants_visibles).toBe(false);
    expect(tdb.ca_mois_xof).toBeNull();
  }));

  it('inspecteur : uniquement ses missions', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const c = await commande(db, m, d, [{ qte: 100, pu: 10 }]);
    await as(db, m.achats);
    await db.query(`insert into public.inspections (commande_id, type, inspecteur_id, taille_lot) values ($1, 'en_production', $2, 100)`, [c, m.inspecteur]);
    await db.query(`insert into public.inspections (commande_id, type, inspecteur_id, taille_lot) values ($1, 'avant_expedition', $2, 100)`, [c, m.delegue]);
    await as(db, m.inspecteur);
    expect(await rows(db, `select * from public.inspections`)).toHaveLength(1);
    expect(await rows(db, `select * from public.commandes`)).toHaveLength(0);
    expect(await rows(db, `select * from public.clients`)).toHaveLength(0);
    await expectError(db, 'GBS_ACCES_REFUSE', `update public.inspections set nqa_majeur = 6.5`);
  }));

  it('un utilisateur ne modifie pas son propre rôle', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.hub);
    await expectError(db, 'GBS_ACCES_REFUSE', `update public.profils set role = 'admin' where id = $1`, [m.hub]);
    await db.query(`update public.profils set langue = 'en' where id = $1`, [m.hub]);
  }));

  it('cloisonnement par société : la comptable de GBS CI ne voit pas les factures de GBS Chine', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.admin);
    await db.query(`insert into public.factures (societe_id, client_id, type, objet, devise) values ($1, $2, 'inspection', 'Objet test', 'USD')`, [m.cn, m.clientCI]);
    await db.query(`insert into public.factures (societe_id, client_id, type, objet, devise) values ($1, $2, 'commission', 'Objet test', 'XOF')`, [m.ci, m.clientCI]);
    await as(db, m.comptable);
    const f = await rows(db, `select devise from public.factures`);
    expect(f.map((x) => x.devise)).toEqual(['XOF']);
  }));
});

// --------------------------------------------------------------------------- Journal
describe('Journal d\'audit : ajout seul, altération détectable', () => {
  it('chaque action est tracée ; le journal ne se modifie pas ; une altération en base est détectée', () => withTx(async (db) => {
    const m = await monde(db);
    await dossier(db, m);
    await as(db, m.admin);
    const v = await one(db, `select * from public.audit_verifier()`);
    expect(v.premiere_ligne_alteree).toBeNull();
    expect(Number(v.lignes_verifiees)).toBeGreaterThan(10);
    await expectError(db, '42501', `update public.journal_audit set motif = 'x'`);
    await asRoot(db);
    await expectError(db, 'GBS_IMMUABLE', `delete from public.journal_audit`);
    // Altération directe (contournement des triggers par un superutilisateur) : détectée.
    await db.query(`alter table public.journal_audit disable trigger journal_audit_immuable`);
    const cible = (await one(db, `select id from public.journal_audit order by id limit 1 offset 3`)).id;
    await db.query(`update public.journal_audit set apres = '{"falsifie":true}' where id = $1`, [cible]);
    await db.query(`alter table public.journal_audit enable trigger journal_audit_immuable`);
    await as(db, m.admin);
    const w = await one(db, `select * from public.audit_verifier()`);
    expect(Number(w.premiere_ligne_alteree)).toBe(Number(cible));
  }));

  it('aucune suppression physique des données métier', () => withTx(async (db) => {
    const m = await monde(db);
    await asRoot(db);
    await expectError(db, 'GBS_SUPPRESSION_INTERDITE', `delete from public.clients where id = $1`, [m.clientCI]);
  }));
});

// --------------------------------------------------------------------------- Fuseaux
describe('Fuseaux horaires', () => {
  it('une date limite fixée à 18 h à Abidjan s\'affiche à 2 h le lendemain à Guangzhou', () => withTx(async (db) => {
    const r = await one(db, `select to_char((timestamptz '2026-11-20 18:00:00 Africa/Abidjan') at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') v`);
    expect(r.v).toBe('2026-11-21 02:00');
  }));

  it('offres enregistrées seulement après la date limite (plis fermés, lot 0)', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.achats);
    const rfq = (await one(db, `insert into public.consultations_fournisseurs (dossier_id, objet, date_limite) values ($1, 'Carrelage 60x60', now() + interval '1 day') returning id`, [d])).id;
    await db.query(`insert into public.consultation_invites values ($1, $2)`, [rfq, m.fournisseur]);
    await expectError(db, 'GBS_PLI_FERME', `insert into public.offres (consultation_id, fournisseur_id, recu_le, canal, incoterm, lieu, devise, montant)
      values ($1, $2, now(), 'wechat', 'FOB', 'Shenzhen', 'USD', 1000)`, [rfq, m.fournisseur]);
  }));
});

// --------------------------------------------------------------------------- Intégrité
describe('Intégrité : aucun champ calculé ou validé ne s\'écrit en direct par l\'API', () => {
  it('devis accepté, montants de facture, décision d\'inspection, date des règles du dossier', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m, { by: m.hub });
    const c = await commande(db, m, d, [{ qte: 1, pu: 1000 }]);
    await as(db, m.hub);
    const v = (await one(db, `insert into public.devis (dossier_id) values ($1) returning id`, [d])).id;
    await expectError(db, 'GBS_VALIDATION_RPC', `update public.devis set statut = 'accepte' where id = $1`, [v]);
    await expectError(db, 'GBS_MONTANTS_CALCULES', `update public.devis set commission_ht = 1 where id = $1`, [v]);
    await expectError(db, 'GBS_DOSSIER_FIGE', `update public.dossiers set ouvert_le = '2026-01-02' where id = $1`, [d]);
    await expectError(db, 'GBS_VALIDATION_ADMIN', `update public.dossiers set statut = 'clos' where id = $1`, [d]);
    const f = await one(db, `insert into public.factures (societe_id, client_id, type, objet, devise, montant_ht, ttc, net_a_payer)
      values ($1, $2, 'forfait_consultation', 'Forfait', 'XOF', 999999, 999999, 999999) returning *`, [m.ci, m.clientCI]);
    expect(Number(f.montant_ht)).toBe(0);
    await expectError(db, 'GBS_FACTURE_VIDE', `select public.emettre_facture($1)`, [f.id]);
    await expectError(db, 'GBS_MONTANTS_CALCULES', `update public.factures set montant_ht = 5 where id = $1`, [f.id]);
    await as(db, m.achats);
    await expectError(db, 'GBS_MONTANTS_CALCULES', `update public.commandes set montant_marchandise = 1 where id = $1`, [c]);
    const i = (await one(db, `insert into public.inspections (commande_id, type, taille_lot) values ($1, 'avant_expedition', 500) returning id`, [c])).id;
    await expectError(db, 'GBS_VALIDATION_RPC', `update public.inspections set decision = 'liberation' where id = $1`, [i]);
  }));
});
