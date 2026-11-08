// Lot 1, M5 : suivi des échantillons, coût, refacturation au client ou prise en charge.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

const justif = (d: string) => `${d}/0000aaaa-1111-4222-8333-444444444444.pdf`;
async function echantillon(db: Db, m: Monde, d: string) {
  await as(db, m.achats);
  return (await one(db, `insert into gbs.echantillons (dossier_id, fournisseur_id, designation, quantite, statut)
    values ($1, $2, 'Carreau 60x60 gris anthracite', 2, 'evalue') returning id, statut`, [d, m.fournisseur]));
}

describe('Échantillons (M5)', () => {
  it('cycle demandé, expédié, reçu, évalué ; informations exigées à chaque étape ; écriture directe refusée', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const e = await echantillon(db, m, d);
    expect(e.statut).toBe('demande');   // un statut fourni à la création est ignoré
    await expectError(db, '42501', `update gbs.echantillons set statut = 'recu' where id = $1`, [e.id]);
    await expectError(db, 'GBS_ECHANTILLON_ENVOI_INCOMPLET', `select gbs.suivre_echantillon($1, 'expedie', '{"transporteur":"SF Express"}')`, [e.id]);
    await expectError(db, 'GBS_TRANSITION_INVALIDE', `select gbs.suivre_echantillon($1, 'recu', $2)`, [e.id, JSON.stringify({ recu_le: '2026-11-01' })]);
    await db.query(`select gbs.suivre_echantillon($1, 'expedie', $2)`, [e.id, JSON.stringify({ transporteur: 'SF Express', numero_suivi: 'sf1234567890', envoye_le: new Date().toISOString().slice(0, 10) })]);
    // Réception à Abidjan par le Hub ; l'évaluation exige un avis.
    await as(db, m.hub);
    await db.query(`select gbs.suivre_echantillon($1, 'recu', $2)`, [e.id, JSON.stringify({ recu_le: new Date().toISOString().slice(0, 10), lieu_reception: 'Bureau Abidjan' })]);
    await expectError(db, 'GBS_ECHANTILLON_AVIS_REQUIS', `select gbs.suivre_echantillon($1, 'evalue', '{"evaluation":"conforme"}')`, [e.id]);
    await db.query(`select gbs.suivre_echantillon($1, 'evalue', '{"evaluation":"conforme","avis":"Teinte et planéité conformes à la demande"}')`, [e.id]);
    const x = await one(db, `select statut, numero_suivi, evaluation from gbs.echantillons where id = $1`, [e.id]);
    expect([x.statut, x.numero_suivi, x.evaluation]).toEqual(['evalue', 'SF1234567890', 'conforme']);
    await expectError(db, '42501', `select gbs.suivre_echantillon($1, 'annule', '{"motif":"Erreur de saisie"}')`, [e.id]);
    await as(db, m.achats);
    await expectError(db, 'GBS_TRANSITION_INVALIDE', `select gbs.suivre_echantillon($1, 'annule', '{"motif":"Erreur de saisie"}')`, [e.id]);
    // Le Hub ne peut pas saisir de coût ; l'inspecteur ne voit rien.
    await as(db, m.hub);
    await expectError(db, '42501', `select gbs.enregistrer_cout_echantillon($1, 300, 'CNY', current_date, $2, 'client')`, [e.id, justif(d)]);
    await as(db, m.inspecteur);
    expect(await rows(db, `select id from gbs.echantillons`)).toEqual([]);
  }));

  it('coût au dossier avec justificatif ; prise en charge motivée ; refacturation au coût, une seule fois, sur un brouillon du dossier', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const e = await echantillon(db, m, d);
    await expectError(db, 'GBS_JUSTIFICATIF_INVALIDE', `select gbs.enregistrer_cout_echantillon($1, 300, 'CNY', current_date, 'autre/x.pdf', 'client')`, [e.id]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.enregistrer_cout_echantillon($1, 300, 'CNY', current_date, $2, 'gbs')`, [e.id, justif(d)]);
    await db.query(`select gbs.enregistrer_cout_echantillon($1, 300, 'CNY', current_date, $2, 'client')`, [e.id, justif(d)]);
    await expectError(db, 'GBS_ECHANTILLON_COUT_DEJA_SAISI', `select gbs.enregistrer_cout_echantillon($1, 300, 'CNY', current_date, $2, 'client')`, [e.id, justif(d)]);
    await asRoot(db);
    const c = await one(db, `select categorie, dossier_id, montant_ht, devise, statut from gbs.couts where id = (select cout_id from gbs.echantillons where id = $1)`, [e.id]);
    expect([c.categorie, c.dossier_id, Number(c.montant_ht), c.devise, c.statut]).toEqual(['echantillon', d, 300, 'CNY', 'validee']);
    // Refacturation par le Hub (GBS Côte d'Ivoire) sur une facture brouillon du dossier.
    await as(db, m.hub);
    expect((await rows(db, `select echantillon_id from gbs.echantillons_a_refacturer()`)).map((x) => x.echantillon_id)).toEqual([e.id]);
    const autre = await dossier(db, m);
    await as(db, m.hub);
    const fa = (await one(db, `insert into gbs.factures (societe_id, client_id, dossier_id, type, objet, devise) values ($1, $2, $3, 'forfait_consultation', 'Autre', 'XOF') returning id`, [m.ci, m.clientCI, autre])).id;
    const f = (await one(db, `insert into gbs.factures (societe_id, client_id, dossier_id, type, objet, devise) values ($1, $2, $3, 'forfait_consultation', 'Frais', 'XOF') returning id`, [m.ci, m.clientCI, d])).id;
    await expectError(db, 'GBS_FACTURE_INCOMPATIBLE', `select gbs.refacturer_echantillon($1, $2)`, [e.id, fa]);
    const l = await one(db, `select * from gbs.refacturer_echantillon($1, $2)`, [e.id, f]);
    expect(Number(l.prix_unitaire)).toBe(300 * 84);   // 1 CNY = 84 FCFA au taux de test
    await expectError(db, 'GBS_ECHANTILLON_DEJA_REFACTURE', `select gbs.refacturer_echantillon($1, $2)`, [e.id, f]);
    expect(await rows(db, `select echantillon_id from gbs.echantillons_a_refacturer()`)).toEqual([]);
    // Ligne retirée du brouillon : l'échantillon redevient à refacturer.
    await db.query(`delete from gbs.lignes_facture where id = $1`, [l.id]);
    expect((await rows(db, `select echantillon_id from gbs.echantillons_a_refacturer()`)).map((x) => x.echantillon_id)).toEqual([e.id]);
    // Prise en charge par GBS : jamais refacturé.
    const e2 = await echantillon(db, m, d);
    await db.query(`select gbs.enregistrer_cout_echantillon($1, 50, 'USD', current_date, $2, 'gbs', 'Geste commercial sur le premier dossier')`, [e2.id, justif(d)]);
    await as(db, m.hub);
    await expectError(db, 'GBS_ECHANTILLON_NON_REFACTURABLE', `select gbs.refacturer_echantillon($1, $2)`, [e2.id, f]);
  }));
});
