// Lot 1, M21 : commissions des agents pays (contrat, relevé mensuel, paiement, export, marge).
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

/** Facture émise par GBS Chine au client gabonais, encaissée intégralement le jour indiqué (USD à 600 FCFA). */
async function encaisser(db: Db, m: Monde, ht: number, recuLe: string, dossierId: string | null = null) {
  await as(db, m.admin);
  const f = (await one(db, `insert into gbs.factures (societe_id, client_id, dossier_id, type, objet, devise)
    values ($1, $2, $3, 'inspection', 'Inspection avant expédition', 'USD') returning id`, [m.cn, m.clientGA, dossierId])).id;
  await db.query(`insert into gbs.lignes_facture (facture_id, libelle, prix_unitaire) values ($1, 'Inspection', $2)`, [f, ht]);
  await db.query(`select gbs.emettre_facture($1)`, [f]);
  const net = (await one(db, `select net_a_payer from gbs.factures where id = $1`, [f])).net_a_payer;
  await db.query(`insert into gbs.encaissements (facture_id, montant, devise, recu_le, mode) values ($1, $2, 'USD', $3, 'virement')`, [f, net, recuLe]);
  return f;
}
const contrat = (db: Db, m: Monde, taux: number, debut: string, fin: string | null = null, pays = 'GA', agent = m.agentGA) =>
  one(db, `insert into gbs.contrats_agents (agent_id, pays, taux, debut, fin, reference) values ($1, $2, $3, $4, $5, 'CAC-GA-001') returning id`,
    [agent, pays, taux, debut, fin]);
const moisPasse = (n: number) => `date_trunc('month', current_date - interval '${n} month')::date`;

describe('Commissions des agents pays (M21)', () => {
  it('le taux du contrat en vigueur à l’encaissement s’applique ; sans contrat, le paramètre daté, signalé', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.admin);
    const debut = (await one(db, `select ${moisPasse(1)}::text d`)).d;
    await contrat(db, m, 0.12, debut);
    await encaisser(db, m, 1000, (await one(db, `select (${moisPasse(2)} + 3)::text d`)).d);   // avant le contrat
    await encaisser(db, m, 1000, (await one(db, `select (${moisPasse(1)} + 3)::text d`)).d);   // sous contrat
    await as(db, m.agentGA);
    const p = await rows(db, `select regle, taux, montant_xof, contrat_agent_id is not null avec from gbs.partages order by mois`);
    expect(p.map((x) => [x.regle, Number(x.taux), Number(x.montant_xof), x.avec])).toEqual([
      ['agent.taux', 0.15, 90_000, false], ['contrat_agent', 0.12, 72_000, true]]);
  }));

  it('contrat : réservé à l’administratrice, agent de son pays, sans chevauchement, taux figé', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.comptable);
    await expectError(db, '42501', `insert into gbs.contrats_agents (agent_id, pays, taux, debut, reference) values ($1, 'GA', 0.15, '2026-01-01', 'CAC-1')`, [m.agentGA]);
    await as(db, m.admin);
    await expectError(db, 'GBS_AGENT_INVALIDE', `insert into gbs.contrats_agents (agent_id, pays, taux, debut, reference) values ($1, 'CM', 0.15, '2026-01-01', 'CAC-1')`, [m.agentGA]);
    await expectError(db, 'GBS_AGENT_INVALIDE', `insert into gbs.contrats_agents (agent_id, pays, taux, debut, reference) values ($1, 'GA', 0.15, '2026-01-01', 'CAC-1')`, [m.hub]);
    const c = (await contrat(db, m, 0.15, '2026-01-01', '2026-06-30')).id;
    await expectError(db, 'GBS_CONTRATS_CHEVAUCHES', `insert into gbs.contrats_agents (agent_id, pays, taux, debut, reference) values ($1, 'GA', 0.10, '2026-06-01', 'CAC-2')`, [m.agentGA]);
    await contrat(db, m, 0.10, '2026-07-01');
    // Taux et dates de début figés (droits par colonne) ; seule la fin se modifie.
    await expectError(db, '42501', `update gbs.contrats_agents set taux = 0.2 where id = $1`, [c]);
    await db.query(`update gbs.contrats_agents set fin = '2026-06-15' where id = $1`, [c]);
    await expectError(db, '42501', `delete from gbs.contrats_agents where id = $1`, [c]);
    // L'agent voit ses contrats, pas ceux d'un autre.
    await as(db, m.agentCM);
    expect(await rows(db, `select id from gbs.contrats_agents`)).toEqual([]);
    await as(db, m.agentGA);
    expect(await rows(db, `select id from gbs.contrats_agents`)).toHaveLength(2);
  }));

  it('relevé d’un mois écoulé, validé par l’administratrice, payé par une autre personne ; la régularisation entre au relevé suivant', () => withTx(async (db) => {
    const m = await monde(db);
    const m2 = (await one(db, `select (${moisPasse(2)} + 4)::text d`)).d;
    const m1 = (await one(db, `select (${moisPasse(1)} + 4)::text d`)).d;
    await encaisser(db, m, 1000, m2);
    await encaisser(db, m, 2000, (await one(db, `select current_date::text d`)).d);
    await as(db, m.admin);
    const f = (await one(db, `insert into gbs.factures (societe_id, client_id, type, objet, devise) values ($1, $2, 'inspection', 'Objet test', 'USD') returning id`, [m.cn, m.clientGA])).id;
    await db.query(`insert into gbs.lignes_facture (facture_id, libelle, prix_unitaire) values ($1, 'x', 10)`, [f]);
    await db.query(`select gbs.emettre_facture($1)`, [f]);
    await expectError(db, 'GBS_DATE_ENCAISSEMENT_INVALIDE', `insert into gbs.encaissements (facture_id, montant, devise, recu_le, mode)
      values ($1, 1, 'USD', current_date + 1, 'virement')`, [f]);
    await expectError(db, 'GBS_MOIS_NON_ECOULE', `select * from gbs.valider_releve_agent($1, current_date)`, [m.agentGA]);
    await as(db, m.comptable);
    await expectError(db, 'GBS_VALIDATION_ADMIN', `select * from gbs.valider_releve_agent($1, $2)`, [m.agentGA, m2]);
    await as(db, m.admin);
    await expectError(db, '42501', `insert into gbs.releves_agents (agent_id, societe_id, mois, nb_lignes, total_xof, valide_par)
      values ($1, $2, '2026-01-01', 1, 1, $3)`, [m.agentGA, m.cn, m.admin]);
    const r = await one(db, `select * from gbs.valider_releve_agent($1, $2)`, [m.agentGA, m2]);
    expect([Number(r.total_xof), r.nb_lignes, r.lignes_sans_contrat]).toEqual([90_000, 1, 1]);
    // Encaissement saisi en retard sur le mois déjà relevé : il ira dans le relevé suivant.
    await encaisser(db, m, 500, m2);
    await encaisser(db, m, 100, m1);
    await as(db, m.admin);
    const r2 = await one(db, `select * from gbs.valider_releve_agent($1, $2)`, [m.agentGA, m1]);
    expect([Number(r2.total_xof), r2.nb_lignes]).toEqual([54_000, 2]);
    await expectError(db, 'GBS_RELEVE_VIDE', `select * from gbs.valider_releve_agent($1, $2)`, [m.agentGA, m1]);
    // Paiement : jamais par la personne qui a validé.
    await expectError(db, 'GBS_QUATRE_YEUX', `select gbs.payer_releve_agent($1, current_date, 'VIR-2026-118')`, [r.id]);
    await asRoot(db);
    await db.query(`update gbs.profils set societes = $2 where id = $1`, [m.comptable, [m.ci, m.cn]]);
    await as(db, m.comptable);
    await expectError(db, 'GBS_REFERENCE_PAIEMENT_INVALIDE', `select gbs.payer_releve_agent($1, current_date, ' ')`, [r.id]);
    await expectError(db, 'GBS_DATE_PAIEMENT_INVALIDE', `select gbs.payer_releve_agent($1, current_date + 1, 'VIR-2026-118')`, [r.id]);
    const p = await one(db, `select * from gbs.payer_releve_agent($1, current_date, 'VIR-2026-118')`, [r.id]);
    expect(p.reference_paiement).toBe('VIR-2026-118');
    await expectError(db, 'GBS_DEJA_PAYE', `select gbs.payer_releve_agent($1, current_date, 'VIR-2026-119')`, [r.id]);
    await expectError(db, '42501', `update gbs.releves_agents set total_xof = 1 where id = $1`, [r.id]);
    // L'agent voit ses relevés ; l'autre agent rien.
    await as(db, m.agentGA);
    expect(await rows(db, `select id from gbs.releves_agents`)).toHaveLength(2);
    await as(db, m.agentCM);
    expect(await rows(db, `select id from gbs.releves_agents`)).toEqual([]);
  }));

  it('export comptable : charge à la validation, règlement au paiement, en FCFA et en devise de tenue ; cloisonné par société', () => withTx(async (db) => {
    const m = await monde(db);
    await encaisser(db, m, 1000, (await one(db, `select (${moisPasse(1)} + 4)::text d`)).d);
    await as(db, m.admin);
    const r = await one(db, `select * from gbs.valider_releve_agent($1, (current_date - interval '1 month')::date)`, [m.agentGA]);
    await asRoot(db);
    await db.query(`update gbs.profils set societes = $2 where id = $1`, [m.comptable, [m.ci, m.cn]]);
    await as(db, m.comptable);
    await db.query(`select gbs.payer_releve_agent($1, current_date, 'VIR-2026-120')`, [r.id]);
    const e = await rows(db, `select journal, compte, debit_xof, credit_xof, devise_tenue, debit_devise, credit_devise
      from gbs.export_commissions_agents($1, current_date - 5, current_date)`, [m.cn]);
    expect(e.map((x) => [x.journal, x.compte, Number(x.debit_xof), Number(x.credit_xof)])).toEqual([
      ['ZJ', '6601', 90_000, 0], ['ZJ', '2241', 0, 90_000], ['YH', '2241', 90_000, 0], ['YH', '1002', 0, 90_000]]);
    expect(e[0].devise_tenue).toBe('CNY');
    expect(Number(e[0].debit_devise)).toBe(1071.43);   // 90 000 FCFA à 84 FCFA le yuan
    await expectError(db, 'GBS_PERIODE_INVALIDE', `select * from gbs.export_commissions_agents($1, current_date, current_date - 1)`, [m.cn]);
    await asRoot(db);
    await db.query(`update gbs.profils set societes = $2 where id = $1`, [m.comptable, [m.ci]]);
    await as(db, m.comptable);
    await expectError(db, 'GBS_ACCES_REFUSE', `select * from gbs.export_commissions_agents($1, current_date - 5, current_date)`, [m.cn]);
    expect(await rows(db, `select id from gbs.releves_agents`)).toEqual([]);
  }));

  it('la commission entre dans les coûts du dossier (marge directe)', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m, { client: m.clientGA, societe: m.cn });
    await encaisser(db, m, 1000, (await one(db, `select current_date::text d`)).d, d);
    await as(db, m.admin);
    const marge = (await one(db, `select gbs.marge_directe($1) j`, [d])).j;
    expect(marge.couts_par_categorie).toEqual({ commission_agent: 90_000 });
    expect(marge.marge_directe_facturee_xof).toBe(600_000 - 90_000);
  }));
});
