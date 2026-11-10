// Conformité à l'import : référentiel daté par pays et catégorie, liste de contrôle par expédition.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

async function expedition(db: Db, m: Monde, pays = 'GA') {
  const d = await dossier(db, m);
  await as(db, m.admin);
  const e = (await one(db, `insert into gbs.expeditions (dossier_id, mode, pays_destination, port_arrivee) values ($1, 'conteneur_complet', $2, 'Owendo') returning id`, [d, pays])).id as string;
  return { d, e };
}

describe('Conformité à l’import', () => {
  it('liste de contrôle selon pays et catégorie ; document reçu une fois, rangé dans le dossier', () => withTx(async (db) => {
    const m = await monde(db);
    const { d, e } = await expedition(db, m);
    await as(db, m.admin);
    await db.query(`select gbs.creer_categorie_import('froid', 'Équipements frigorifiques')`);
    const regle = async (p: Record<string, unknown>) => (await one(db, `select gbs.creer_exigence_import($1) id`, [JSON.stringify(p)])).id as string;
    const cc = await regle({ pays: 'GA', categorie: 'froid', document: 'Certificat de conformité', emetteur: 'Organisme agréé', delai_jours: 7 });
    await regle({ pays: '*', document: "Certificat d'origine", emetteur: 'CCPIT', delai_jours: 3 });
    await regle({ pays: 'CM', document: 'Programme d’évaluation de la conformité', delai_jours: 6 });
    await regle({ pays: 'GA', document: 'Règle future', date_effet: '2099-01-01' });
    // Sans catégorie : seules les règles « toutes catégories » du pays et de tous pays.
    expect((await rows(db, `select document from gbs.conformite_expedition($1)`, [e])).map((x) => x.document)).toEqual(["Certificat d'origine"]);
    await as(db, m.achats);
    await db.query(`select gbs.definir_categorie_import($1, 'froid')`, [e]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.definir_categorie_import($1, 'inconnue')`, [e]);
    const liste = await rows(db, `select document, recu from gbs.conformite_expedition($1)`, [e]);
    expect(liste).toEqual([{ document: 'Certificat de conformité', recu: false }, { document: "Certificat d'origine", recu: false }]);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.deposer_document_conformite($1, $2, 'ailleurs/x.pdf')`, [e, cc]);
    const chemin = `${d}/00000000-0000-4000-8000-0000000000aa.pdf`;
    await db.query(`select gbs.deposer_document_conformite($1, $2, $3)`, [e, cc, chemin]);
    await expectError(db, 'GBS_DOCUMENT_DEJA_RECU', `select gbs.deposer_document_conformite($1, $2, $3)`, [e, cc, chemin]);
    expect((await one(db, `select recu from gbs.conformite_expedition($1) where exigence_id = $2`, [e, cc])).recu).toBe(true);
    // Règle désactivée : sort de la liste ; son contenu ne change pas.
    await as(db, m.admin);
    await db.query(`select gbs.desactiver_exigence_import($1)`, [cc]);
    expect((await rows(db, `select document from gbs.conformite_expedition($1)`, [e])).map((x) => x.document)).toEqual(["Certificat d'origine"]);
  }));

  it('entrées strictes ; référentiel écrit par l’administratrice ; aucune écriture directe ni suppression', () => withTx(async (db) => {
    const m = await monde(db);
    const { e } = await expedition(db, m);
    await as(db, m.admin);
    for (const p of [{ pays: 'Gabon', document: 'X doc' }, { pays: 'GA', document: 'ok' }, { pays: 'GA', document: 'Doc', delai_jours: 500 },
      { pays: 'GA', document: 'Doc', categorie: 'inconnue' }, { pays: 'GA', document: 'Doc', admin: true }, { document: 'Doc' }]) {
      await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.creer_exigence_import($1)`, [JSON.stringify(p)]);
    }
    const r = (await one(db, `select gbs.creer_exigence_import($1) id`, [JSON.stringify({ pays: 'GA', document: 'Bordereau de suivi', delai_jours: 2 })])).id;
    for (const u of [m.hub, m.achats, m.comptable]) {
      await as(db, u);
      await expectError(db, '42501', `select gbs.creer_exigence_import($1)`, [JSON.stringify({ pays: 'GA', document: 'Autre doc' })]);
    }
    await as(db, m.comptable);
    await expectError(db, '42501', `select * from gbs.conformite_expedition($1)`, [e]);
    await as(db, m.admin);
    await expectError(db, '42501', `update gbs.exigences_import set delai_jours = 1 where id = $1`, [r]);
    await asRoot(db);
    await expectError(db, 'GBS_VALIDATION_RPC', `update gbs.exigences_import set delai_jours = 1 where id = $1`, [r]);
    await db.query(`select set_config('gbs.rpc', 'conformite_import', true)`);
    await expectError(db, 'GBS_REGLE_FIGEE', `update gbs.exigences_import set delai_jours = 1 where id = $1`, [r]);
    await db.query(`select set_config('gbs.rpc', '', true)`);
    await expectError(db, 'GBS_SUPPRESSION_INTERDITE', `delete from gbs.exigences_import where id = $1`, [r]);
  }));
});
