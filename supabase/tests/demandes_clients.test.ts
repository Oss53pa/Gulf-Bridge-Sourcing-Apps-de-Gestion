// Portail client : nouvelle demande, traitée par l'équipe (conversion ou refus), limitation de débit.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, rows, withTx, type Db } from './helpers';

afterAll(closePool);

async function compteClient(db: Db, m: { admin: string }, client: string, nom: string) {
  await asRoot(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${nom}@client.test`, { nom, app: 'gbs' }]);
  await as(db, m.admin);
  await db.query(`select gbs.admin_compte_client($1, $2, 'demandeur')`, [id, client]);
  return id;
}
const BESOIN = { besoin: 'Linge de chambre pour 220 chambres, renouvellement complet', quantite: '220 parures', ouverture_souhaitee: '2099-03-01' };

describe('Demandes des clients', () => {
  it('déposée par le client ; convertie en consultation de ce client ou refusée avec motif ; puis figée', () => withTx(async (db) => {
    const m = await monde(db);
    const u = await compteClient(db, m, m.clientCI, 'yao');
    await as(db, u);
    const dm = (await one(db, `select gbs.deposer_demande_client($1) id`, [JSON.stringify(BESOIN)])).id;
    const dm2 = (await one(db, `select gbs.deposer_demande_client($1) id`, [JSON.stringify({ besoin: 'Mobilier de réception pour le hall' })])).id;
    expect((await rows(db, `select id from gbs.demandes_clients`)).length).toBe(2);
    await expectError(db, '42501', `select gbs.traiter_demande_client($1, null, 'Refus par le client')`, [dm]);
    // L'équipe : conversion vers un dossier du même client seulement.
    const autre = await dossier(db, m, { client: m.clientGA, societe: m.ci });
    const d = await dossier(db, m);
    await as(db, m.hub);
    expect((await rows(db, `select id from gbs.demandes_clients`)).length).toBe(2);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.traiter_demande_client($1, $2)`, [dm, autre]);
    await db.query(`select gbs.traiter_demande_client($1, $2)`, [dm, d]);
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', `select gbs.traiter_demande_client($1)`, [dm2]);
    await db.query(`select gbs.traiter_demande_client($1, null, 'Hors de notre périmètre')`, [dm2]);
    await expectError(db, 'GBS_DEMANDE_TRAITEE', `select gbs.traiter_demande_client($1, null, 'Encore')`, [dm]);
    await as(db, u);
    expect((await rows(db, `select statut from gbs.demandes_clients order by cree_le`)).map((x) => x.statut)).toEqual(['convertie', 'refusee']);
  }));

  it('entrées strictes ; cloisonnement entre clients ; limitation de débit ; aucune écriture directe', () => withTx(async (db) => {
    const m = await monde(db);
    const u = await compteClient(db, m, m.clientCI, 'awa');
    const v = await compteClient(db, m, m.clientGA, 'nze');
    await asRoot(db);
    await db.query(`insert into gbs.parametres (cle, valeur, date_effet) values ('portail.max_demandes_jour', '2', current_date)`);
    await as(db, u);
    for (const p of [{ besoin: 'court' }, { besoin: 'Besoin assez long pour passer', client_id: m.clientGA }, { besoin: 'Besoin assez long pour passer', ouverture_souhaitee: '2020-01-01' },
      { besoin: 'Besoin assez long pour passer', ouverture_souhaitee: 'bientôt' }]) {
      await expectError(db, p.ouverture_souhaitee === '2020-01-01' ? 'GBS_DATE_INVALIDE' : 'GBS_PARAMETRES_INVALIDES', `select gbs.deposer_demande_client($1)`, [JSON.stringify(p)]);
    }
    await db.query(`select gbs.deposer_demande_client($1)`, [JSON.stringify(BESOIN)]);
    await db.query(`select gbs.deposer_demande_client($1)`, [JSON.stringify(BESOIN)]);
    await expectError(db, 'GBS_TROP_DE_DEMANDES', `select gbs.deposer_demande_client($1)`, [JSON.stringify(BESOIN)]);
    await as(db, v);
    expect(await rows(db, `select id from gbs.demandes_clients`)).toEqual([]);
    await as(db, m.achats);
    expect(await rows(db, `select id from gbs.demandes_clients`)).toEqual([]);
    await as(db, u);
    const id = (await one(db, `select id from gbs.demandes_clients limit 1`)).id;
    await expectError(db, '42501', `update gbs.demandes_clients set statut = 'convertie' where id = $1`, [id]);
    await asRoot(db);
    await expectError(db, 'GBS_VALIDATION_RPC', `update gbs.demandes_clients set besoin = 'Modifié par erreur' where id = $1`, [id]);
    await expectError(db, 'GBS_SUPPRESSION_INTERDITE', `delete from gbs.demandes_clients where id = $1`, [id]);
  }));
});
