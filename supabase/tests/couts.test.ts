// Lot 1, M22 et M15 : notes de frais, coûts par dossier, marge directe, missions à perte.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

/** Facture de consultation de 1 200 000 FCFA HT émise sur le dossier ; encaissement facultatif. */
async function facturer(db: Db, m: Monde, d: string, encaisser: 'tout' | 'rien') {
  await as(db, m.hub);
  const f = (await one(db, `insert into gbs.factures (societe_id, client_id, dossier_id, type, objet, devise)
    values ($1, $2, $3, 'forfait_consultation', 'Forfait de consultation', 'XOF') returning id`, [m.ci, m.clientCI, d])).id;
  await db.query(`insert into gbs.lignes_facture (facture_id, libelle, service, prix_unitaire) values ($1, 'Consultation', 'S2', 1200000)`, [f]);
  await db.query(`select gbs.emettre_facture($1)`, [f]);
  await db.query(`select gbs.certifier_fne($1, 'DGI-2026-000777', 'https://fne.dgi.gouv.ci/qr/000777')`, [f]);
  if (encaisser === 'tout') {
    const net = Number((await one(db, `select net_a_payer from gbs.factures where id = $1`, [f])).net_a_payer);
    await db.query(`insert into gbs.encaissements (facture_id, montant, devise, recu_le, mode) values ($1, $2, 'XOF', current_date, 'virement')`, [f, net]);
  }
  await asRoot(db);
  return f as string;
}

async function cout(db: Db, m: Monde, d: string | null, montant: number, extra: { categorie?: string; cause?: string; devise?: string } = {}) {
  await as(db, m.comptable);
  return (await one(db, `insert into gbs.couts (nature, dossier_id, frais_generaux, categorie, libelle, date_cout, devise, montant_ht, cause_perte)
    values ('cout', $1, $2, $3, 'Coût de test', current_date, $4, $5, $6) returning id, statut, montant_xof`,
    [d, d === null, extra.categorie ?? 'sous_traitance', extra.devise ?? 'XOF', montant, extra.cause ?? null]));
}

describe('Notes de frais', () => {
  it('sans dossier ni frais généraux, une note ne peut pas être validée pour remboursement', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.achats);
    const n = (await one(db, `insert into gbs.couts (nature, categorie, libelle, date_cout, devise, montant_ht, justificatif_chemin)
      values ('note_frais', 'deplacement', 'Train Shenzhen – Foshan', current_date, 'CNY', 250, $1) returning id, statut, montant_xof`,
      [`frais/${m.achats}/11111111-1111-4111-8111-111111111111.jpg`])).id;
    await as(db, m.comptable);
    await expectError(db, 'GBS_COUT_NON_AFFECTE', `select gbs.statuer_cout($1, 'validee')`, [n]);
    // Affectation par la finance, puis validation et remboursement.
    await db.query(`update gbs.couts set dossier_id = $2 where id = $1`, [n, d]);
    await db.query(`select gbs.statuer_cout($1, 'validee')`, [n]);
    await db.query(`select gbs.statuer_cout($1, 'remboursee')`, [n]);
    // 250 CNY × 84 = 21 000 FCFA, au cours du jour de la dépense.
    expect(await one(db, `select statut, montant_xof::int x, rembourse_le is not null r from gbs.couts where id = $1`, [n]))
      .toEqual({ statut: 'remboursee', x: 21000, r: true });
  }));

  it('justificatif exigé, rangé chez son auteur ; l’auteur ne valide pas sa propre note', () => withTx(async (db) => {
    const m = await monde(db);
    await as(db, m.achats);
    const base = `insert into gbs.couts (nature, frais_generaux, categorie, libelle, date_cout, devise, montant_ht, justificatif_chemin)
      values ('note_frais', true, 'repas', 'Dîner fournisseur', current_date, 'CNY', 300, $1) returning id`;
    await expectError(db, 'GBS_JUSTIFICATIF_INVALIDE', base, [`frais/${m.hub}/11111111-1111-4111-8111-111111111111.jpg`]);
    await expectError(db, 'GBS_JUSTIFICATIF_INVALIDE', base, ['frais/../../x.jpg']);
    const sans = (await one(db, base, [null])).id;
    await as(db, m.comptable);
    await expectError(db, 'GBS_JUSTIFICATIF_MANQUANT', `select gbs.statuer_cout($1, 'validee')`, [sans]);
    await as(db, m.achats);
    await db.query(`update gbs.couts set justificatif_chemin = $2 where id = $1`, [sans, `frais/${m.achats}/22222222-2222-4222-8222-222222222222.png`]);
    await expectError(db, 'GBS_VALIDATION_ADMIN', `select gbs.statuer_cout($1, 'validee')`, [sans]);
    await expectError(db, 'GBS_VALIDATION_RPC', `update gbs.couts set statut = 'validee' where id = $1`, [sans]);
    // Un autre membre de l'équipe ne voit pas la note ; la comptabilité oui.
    await as(db, m.hub);
    expect(await rows(db, `select id from gbs.couts`)).toEqual([]);
    await as(db, m.comptable);
    expect((await rows(db, `select id from gbs.couts`)).length).toBe(1);
  }));

  it('seule la finance saisit un coût direct ; un coût validé est figé', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.achats);
    await expectError(db, 'GBS_ACCES_REFUSE', `insert into gbs.couts (nature, dossier_id, categorie, libelle, date_cout, devise, montant_ht)
      values ('cout', $1, 'laboratoire', 'Essai labo', current_date, 'XOF', 100000)`, [d]);
    const c = await cout(db, m, d, 100000);
    expect(c.statut).toBe('validee');
    await expectError(db, 'GBS_COUT_FIGE', `update gbs.couts set montant_ht = 1 where id = $1`, [c.id]);
  }));
});

describe('Marge directe et missions à perte', () => {
  it('déplacement de 300 000 FCFA partagé 6 h / 2 h : 225 000 et 75 000, règle au journal', () => withTx(async (db) => {
    const m = await monde(db);
    const d1 = await dossier(db, m);
    const d2 = await dossier(db, m);
    const c = await cout(db, m, d1, 300000, { categorie: 'deplacement' });
    await as(db, m.comptable);
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', `select * from gbs.repartir_cout($1, $2, '')`,
      [c.id, JSON.stringify([{ dossier_id: d1, heures: 6 }, { dossier_id: d2, heures: 2 }])]);
    await expectError(db, 'GBS_REPARTITION_INVALIDE', `select * from gbs.repartir_cout($1, $2, 'Déplacement commun Foshan')`,
      [c.id, JSON.stringify([{ dossier_id: d1, heures: 6 }, { dossier_id: d1, heures: 2 }])]);
    await db.query(`select * from gbs.repartir_cout($1, $2, 'Déplacement commun Foshan')`,
      [c.id, JSON.stringify([{ dossier_id: d1, heures: 6 }, { dossier_id: d2, heures: 2 }])]);
    await expectError(db, 'GBS_DEJA_REPARTI', `select * from gbs.repartir_cout($1, $2, 'Nouvelle répartition')`,
      [c.id, JSON.stringify([{ dossier_id: d1, heures: 1 }, { dossier_id: d2, heures: 1 }])]);
    expect(Number((await one(db, `select gbs.marge_directe($1) m`, [d1])).m.couts_xof)).toBe(225000);
    expect(Number((await one(db, `select gbs.marge_directe($1) m`, [d2])).m.couts_xof)).toBe(75000);
    await asRoot(db);
    expect((await rows(db, `select motif from gbs.journal_audit where table_nom = 'couts_repartition' and action = 'insert'`))
      .map((x) => x.motif)).toEqual(['Déplacement commun Foshan', 'Déplacement commun Foshan']);
  }));

  it('une contre-inspection non facturée fait apparaître la mission à perte avec sa cause', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await facturer(db, m, d, 'tout');
    await cout(db, m, d, 900000, { categorie: 'inspecteur' });
    await cout(db, m, d, 450000, { categorie: 'inspecteur', cause: 'contre_inspection_non_facturee' });
    await as(db, m.comptable);
    const mg = (await one(db, `select gbs.marge_directe($1) m`, [d])).m;
    expect(mg).toMatchObject({ honoraires_factures_xof: 1200000, couts_xof: 1350000, marge_directe_facturee_xof: -150000,
      cause_perte: 'contre_inspection_non_facturee' });
    expect(await rows(db, `select cause_perte from gbs.missions_a_perte() where dossier_id = $1`, [d]))
      .toEqual([{ cause_perte: 'contre_inspection_non_facturee' }]);
  }));

  it('un impayé réduit la marge encaissée, pas la marge facturée', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await facturer(db, m, d, 'rien');
    await cout(db, m, d, 300000);
    await as(db, m.comptable);
    const mg = (await one(db, `select gbs.marge_directe($1) m`, [d])).m;
    expect(mg).toMatchObject({ marge_directe_facturee_xof: 900000, marge_directe_encaissee_xof: -300000, cause_perte: 'impaye' });
    expect(Number(mg.taux_marge_facturee)).toBe(0.75);
  }));

  it('accès réservé à la finance ; frais généraux hors marge des dossiers', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await cout(db, m, null, 500000, { categorie: 'autre' });
    await as(db, m.comptable);
    expect(Number((await one(db, `select gbs.marge_directe($1) m`, [d])).m.couts_xof)).toBe(0);
    for (const u of [m.hub, m.achats, m.agentGA]) {
      await as(db, u);
      await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.marge_directe($1)`, [d]);
      await expectError(db, 'GBS_ACCES_REFUSE', `select * from gbs.missions_a_perte()`);
    }
  }));
});

describe('Justificatifs dans le stockage', () => {
  it('lisibles par leur auteur et la finance seulement', () => withTx(async (db) => {
    const m = await monde(db);
    const chemin = `frais/${m.achats}/11111111-1111-4111-8111-111111111111.jpg`;
    const visible = async (u: string) => { await as(db, u); return (await one(db, `select gbs_private.document_visible('gbs-documents', $1) v`, [chemin])).v; };
    expect(await visible(m.achats)).toBe(true);
    expect(await visible(m.comptable)).toBe(true);
    expect(await visible(m.admin)).toBe(true);
    expect(await visible(m.hub)).toBe(false);
    expect(await visible(m.inspecteur)).toBe(false);
  }));
});
