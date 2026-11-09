// Messagerie : cloisonnement interne / client / fournisseur, messages non modifiables, limitation de débit.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, commande, dossier, expectError, monde, one, rows, withTx, type Db } from './helpers';

afterAll(closePool);

async function compte(db: Db, nom: string) {
  await asRoot(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${nom}@ext.test`, { nom, app: 'gbs' }]);
  return id;
}
const fil = (db: Db, p: Record<string, unknown>) => one(db, `select gbs.creer_fil($1) id`, [JSON.stringify({ sujet: 'Date de départ', message: 'Pouvez-vous confirmer ?', ...p })]).then((x) => x.id as string);

describe('Messagerie', () => {
  it('fil client : équipe et client ; fil fournisseur : achats et fournisseur ; fil interne : équipe seulement', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    const c = await commande(db, m, d, [{ qte: 1, pu: 100 }]);
    const cli = await compte(db, 'kouassi'); const frn = await compte(db, 'chen');
    await as(db, m.admin);
    await db.query(`select gbs.admin_compte_client($1, $2, 'valideur')`, [cli, m.clientCI]);
    await db.query(`select gbs.admin_compte_fournisseur($1, $2, 'commercial')`, [frn, m.fournisseur]);
    const fClient = await fil(db, { audience: 'client', dossier_id: d, categorie: 'expedition' });
    const fInterne = await fil(db, { audience: 'interne', dossier_id: d, sujet: 'Marge du dossier' });
    await as(db, m.achats);
    const fFrn = await fil(db, { audience: 'fournisseur', commande_id: c, categorie: 'qualite' });
    // Le client voit son fil, répond, mais ne voit ni le fil interne ni le fil fournisseur.
    await as(db, cli, 'aal1');
    expect((await rows(db, `select id from gbs.mes_fils()`)).map((x) => x.id)).toEqual([fClient]);
    await db.query(`select gbs.envoyer_message($1, 'Merci, bien reçu.')`, [fClient]);
    await expectError(db, '42501', `select gbs.envoyer_message($1, 'Indiscret')`, [fInterne]);
    await expectError(db, '42501', `select * from gbs.messages_du_fil($1)`, [fFrn]);
    await expectError(db, '42501', `select gbs.creer_fil($1)`, [JSON.stringify({ audience: 'interne', dossier_id: d, sujet: 'Tentative', message: 'x' })]);
    expect((await rows(db, `select id from gbs.messages`)).length).toBe(2);
    // Le fournisseur voit son fil seulement.
    await as(db, frn, 'aal1');
    expect((await rows(db, `select id from gbs.mes_fils()`)).map((x) => x.id)).toEqual([fFrn]);
    await expectError(db, '42501', `select * from gbs.messages_du_fil($1)`, [fClient]);
    // L'équipe : le Hub ne voit pas le fil fournisseur ; les achats si.
    await as(db, m.hub);
    expect((await rows(db, `select id from gbs.mes_fils()`)).map((x) => x.id).sort()).toEqual([fClient, fInterne].sort());
    const msgs = await rows(db, `select auteur, moi, interne, corps from gbs.messages_du_fil($1)`, [fClient]);
    expect(msgs.map((x) => [x.interne, x.corps])).toEqual([[true, 'Pouvez-vous confirmer ?'], [false, 'Merci, bien reçu.']]);
  }));

  it('entrées strictes ; message non modifiable ni supprimable ; limitation de débit paramétrée', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await asRoot(db);
    await db.query(`insert into gbs.parametres (cle, valeur, date_effet) values ('messagerie.max_messages_heure', '3', current_date)`);
    await as(db, m.hub);
    for (const p of [{ audience: 'public', dossier_id: d }, { audience: 'client', dossier_id: d, sujet: 'x' }, { audience: 'client', dossier_id: d, message: '' },
      { audience: 'client', dossier_id: d, admin: true }, { audience: 'client', dossier_id: d, categorie: 'urgent' }]) {
      await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.creer_fil($1)`, [JSON.stringify({ sujet: 'Sujet correct', message: 'Bonjour', ...p })]);
    }
    const f = await fil(db, { audience: 'client', dossier_id: d });
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.envoyer_message($1, '   ')`, [f]);
    await db.query(`select gbs.envoyer_message($1, 'Deuxième')`, [f]);
    await db.query(`select gbs.envoyer_message($1, 'Troisième')`, [f]);
    await expectError(db, 'GBS_TROP_DE_MESSAGES', `select gbs.envoyer_message($1, 'Quatrième')`, [f]);
    const id = (await one(db, `select id from gbs.messages where fil_id = $1 limit 1`, [f])).id;
    await expectError(db, '42501', `update gbs.messages set corps = 'Modifié' where id = $1`, [id]);
    await asRoot(db);
    await expectError(db, 'GBS_VALIDATION_RPC', `update gbs.messages set corps = 'Modifié' where id = $1`, [id]);
    await expectError(db, 'GBS_SUPPRESSION_INTERDITE', `delete from gbs.messages where id = $1`, [id]);
  }));
});
