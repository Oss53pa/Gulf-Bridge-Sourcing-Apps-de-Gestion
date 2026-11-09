// Documents du dossier et leurs versions.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, rows, withTx } from './helpers';

afterAll(closePool);

const fichier = (d: string, n: number) => `${d}/00000000-0000-4000-8000-${String(n).padStart(12, '0')}.pdf`;

describe('Documents et versions', () => {
  it('versions numérotées par la base ; circuit de statut ; nouvelle version d’un document en vigueur → revue ; archivé figé', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.achats);
    const doc = (await one(db, `select gbs.creer_document($1) id`, [JSON.stringify({ dossier_id: d, type: 'mandat', titre: "Mandat d'achat", partie: 'Résidence Les Cocotiers' })])).id;
    await expectError(db, 'GBS_DOCUMENT_SANS_VERSION', `select gbs.changer_statut_document($1, 'en_revue')`, [doc]);
    expect((await one(db, `select gbs.deposer_version_document($1, $2, 'Version initiale') v`, [doc, fichier(d, 1)])).v).toBe(1);
    await expectError(db, 'GBS_TRANSITION_INVALIDE', `select gbs.changer_statut_document($1, 'en_signature')`, [doc]);
    await db.query(`select gbs.changer_statut_document($1, 'en_revue')`, [doc]);
    await db.query(`select gbs.changer_statut_document($1, 'en_signature')`, [doc]);
    await db.query(`select gbs.changer_statut_document($1, 'en_vigueur')`, [doc]);
    expect((await one(db, `select gbs.deposer_version_document($1, $2, 'Échéancier révisé') v`, [doc, fichier(d, 2)])).v).toBe(2);
    expect(await one(db, `select statut, version_courante from gbs.documents_dossier where id = $1`, [doc])).toEqual({ statut: 'en_revue', version_courante: 2 });
    expect((await rows(db, `select version from gbs.documents_versions where document_id = $1 order by version`, [doc])).map((x) => x.version)).toEqual([1, 2]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.deposer_version_document($1, 'ailleurs/x.pdf', 'Autre')`, [doc]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.deposer_version_document($1, $2, 'x')`, [doc, fichier(d, 3)]);
    await db.query(`select gbs.changer_statut_document($1, 'archive')`, [doc]);
    await expectError(db, 'GBS_DOCUMENT_ARCHIVE', `select gbs.deposer_version_document($1, $2, 'Après archivage')`, [doc, fichier(d, 4)]);
  }));

  it('entrées strictes ; droits ; aucune écriture directe ni suppression ; journalisé', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.hub);
    for (const p of [{ dossier_id: d, type: 'lettre', titre: 'Titre ok' }, { dossier_id: d, type: 'contrat', titre: 'x' }, { dossier_id: d, type: 'contrat', titre: 'Titre', admin: true },
      { type: 'contrat', titre: 'Sans dossier' }]) {
      await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.creer_document($1)`, [JSON.stringify(p)]);
    }
    const doc = (await one(db, `select gbs.creer_document($1) id`, [JSON.stringify({ dossier_id: d, type: 'contrat', titre: 'Contrat tripartite' })])).id;
    for (const u of [m.comptable, m.inspecteur]) {
      await as(db, u);
      await expectError(db, '42501', `select gbs.creer_document($1)`, [JSON.stringify({ dossier_id: d, type: 'contrat', titre: 'Contrat' })]);
    }
    await as(db, m.inspecteur);
    expect(await rows(db, `select id from gbs.documents_dossier`)).toEqual([]);
    await as(db, m.comptable);
    expect((await rows(db, `select id from gbs.documents_dossier`)).length).toBe(1);
    await as(db, m.hub);
    await expectError(db, '42501', `update gbs.documents_dossier set statut = 'en_vigueur' where id = $1`, [doc]);
    await asRoot(db);
    await expectError(db, 'GBS_VALIDATION_RPC', `update gbs.documents_dossier set titre = 'Autre' where id = $1`, [doc]);
    await expectError(db, 'GBS_SUPPRESSION_INTERDITE', `delete from gbs.documents_dossier where id = $1`, [doc]);
    expect(Number((await one(db, `select count(*) n from gbs.journal_audit where table_nom = 'documents_dossier'`)).n)).toBeGreaterThan(0);
  }));
});
