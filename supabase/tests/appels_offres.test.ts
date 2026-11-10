// M24 : appels d'offres clients et préqualification.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, expectError, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

const PIECES = ['Attestation de régularité fiscale', 'Caution de soumission', 'Offre technique', 'Offre financière'];
async function creer(db: Db, m: Monde, u: string, extra: Record<string, unknown> = {}) {
  await as(db, u);
  return (await one(db, `select gbs.creer_appel_offres($1) id`, [JSON.stringify({
    societe_id: m.ci, donneur_ordre: "Port Autonome d'Abidjan", objet: 'Mobilier de bureaux · 3 lots', procedure: 'ouvert',
    date_limite: new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10), valeur_estimee: 120000000, devise: 'XOF', pieces: PIECES, ...extra,
  })])).id as string;
}

describe('Appels d’offres (M24)', () => {
  it('création avec pièces pré-remplies et référence ; dépôt refusé tant qu’une pièce manque ; résultat motivé', () => withTx(async (db) => {
    const m = await monde(db);
    const ao = await creer(db, m, m.hub);
    const a = await one(db, `select reference, statut from gbs.appels_offres where id = $1`, [ao]);
    expect(a.reference).toMatch(/^AO-\d{4}-01$/);
    expect(a.statut).toBe('en_preparation');
    const p = await rows(db, `select id, libelle from gbs.appels_offres_pieces where ao_id = $1 order by ordre`, [ao]);
    expect(p.map((x) => x.libelle)).toEqual(PIECES);
    await expectError(db, 'GBS_AO_PIECES_MANQUANTES', `select gbs.deposer_appel_offres($1)`, [ao]);
    for (const x of p) await db.query(`select gbs.marquer_piece_appel_offres($1, true)`, [x.id]);
    await expectError(db, 'GBS_AO_NON_DEPOSE', `select gbs.resultat_appel_offres($1, 'gagne')`, [ao]);
    await db.query(`select gbs.deposer_appel_offres($1)`, [ao]);
    // Après dépôt : plus aucune pièce ne change, plus de question.
    await expectError(db, 'GBS_AO_CLOS', `select gbs.marquer_piece_appel_offres($1, false)`, [p[0].id]);
    await expectError(db, 'GBS_AO_CLOS', `select gbs.ajouter_piece_appel_offres($1, 'Pièce tardive')`, [ao]);
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', `select gbs.resultat_appel_offres($1, 'perdu')`, [ao]);
    await db.query(`select gbs.resultat_appel_offres($1, 'perdu', 'Prix supérieur de 8 % au moins-disant')`, [ao]);
    expect(await one(db, `select statut, motif_resultat from gbs.appels_offres where id = $1`, [ao]))
      .toEqual({ statut: 'perdu', motif_resultat: 'Prix supérieur de 8 % au moins-disant' });
    await expectError(db, 'GBS_AO_CLOS', `select gbs.resultat_appel_offres($1, 'gagne')`, [ao]);
  }));

  it('questions et réponses datées ; abandon motivé sans dépôt', () => withTx(async (db) => {
    const m = await monde(db);
    const ao = await creer(db, m, m.admin, { nature: 'prequalification', procedure: 'referencement', pieces: [] });
    const q = (await one(db, `select gbs.poser_question_appel_offres($1, 'Les lots peuvent-ils être attribués séparément ?') id`, [ao])).id;
    await db.query(`select gbs.repondre_question_appel_offres($1, 'Oui, attribution par lot.')`, [q]);
    await expectError(db, 'GBS_DEJA_REPONDU', `select gbs.repondre_question_appel_offres($1, 'Autre')`, [q]);
    await expectError(db, 'GBS_AO_PIECES_MANQUANTES', `select gbs.deposer_appel_offres($1)`, [ao]);
    await db.query(`select gbs.resultat_appel_offres($1, 'abandonne', 'Hors de notre périmètre')`, [ao]);
    expect((await one(db, `select statut from gbs.appels_offres where id = $1`, [ao])).statut).toBe('abandonne');
  }));

  it('entrées strictes ; droits : admin et Hub Afrique sur leurs sociétés ; aucune écriture directe ni suppression', () => withTx(async (db) => {
    const m = await monde(db);
    for (const [extra, code] of [[{ admin: true }, 'GBS_PARAMETRES_INVALIDES'], [{ date_limite: '2020-01-01' }, 'GBS_DATE_INVALIDE'], [{ devise: 'EUR' }, 'GBS_PARAMETRES_INVALIDES'],
      [{ objet: 'x' }, 'GBS_PARAMETRES_INVALIDES'], [{ valeur_estimee: -5 }, 'GBS_PARAMETRES_INVALIDES'], [{ procedure: 'gré à gré' }, 'GBS_PARAMETRES_INVALIDES'],
      [{ date_limite: 'demain' }, 'GBS_PARAMETRES_INVALIDES']] as [Record<string, unknown>, string][]) {
      await as(db, m.hub);
      await expectError(db, code, `select gbs.creer_appel_offres($1)`, [JSON.stringify({ societe_id: m.ci, donneur_ordre: 'Hôpital', objet: 'Lits médicaux',
        date_limite: '2099-01-01', ...extra })]);
    }
    const ao = await creer(db, m, m.hub);
    // Le Hub Afrique n'est pas rattaché à GBS Chine.
    await as(db, m.hub);
    await expectError(db, '42501', `select gbs.creer_appel_offres($1)`, [JSON.stringify({ societe_id: m.cn, donneur_ordre: 'Opérateur', objet: 'Référencement', date_limite: '2099-01-01' })]);
    for (const u of [m.achats, m.agentGA, m.comptable, m.inspecteur]) {
      await as(db, u);
      expect(await rows(db, `select id from gbs.appels_offres`)).toEqual([]);
      await expectError(db, '42501', `select gbs.poser_question_appel_offres($1, 'Question ?')`, [ao]);
    }
    await as(db, m.hub);
    await expectError(db, '42501', `update gbs.appels_offres set statut = 'gagne' where id = $1`, [ao]);
    await expectError(db, '42501', `insert into gbs.appels_offres_pieces (ao_id, libelle) values ($1, 'Pièce')`, [ao]);
    await asRoot(db);
    await expectError(db, 'GBS_VALIDATION_RPC', `update gbs.appels_offres set statut = 'gagne' where id = $1`, [ao]);
    await expectError(db, 'GBS_SUPPRESSION_INTERDITE', `delete from gbs.appels_offres_pieces where ao_id = $1`, [ao]);
    expect(Number((await one(db, `select count(*) n from gbs.journal_audit where table_nom = 'appels_offres'`)).n)).toBeGreaterThan(0);
  }));
});
