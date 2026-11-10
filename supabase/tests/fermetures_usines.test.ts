// Calendrier des fermetures d'usines (migration 73) : saisie réservée aux achats, annulation motivée,
// commandes dont la production chevauche une fermeture.
import { afterAll, describe, expect, it } from 'vitest';
import { as, closePool, commande, dossier, expectError, fournisseurAgree, monde, one, rows, withTx, type Db } from './helpers';

afterAll(closePool);

const jj = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function preparer(db: Db) {
  const m = await monde(db);
  const d = await dossier(db, m);
  const autre = await fournisseurAgree(db, m, 'Qingdao Polar Cold Chain');
  const k1 = await commande(db, m, d, [{ qte: 10, pu: 100 }]);
  const k2 = await commande(db, m, d, [{ qte: 10, pu: 100 }], { fournisseur: autre });
  await as(db, m.achats);
  await db.query(`update gbs.commandes set date_livraison_promise = $2 where id = $1`, [k1, jj(40)]);
  await db.query(`update gbs.commandes set date_livraison_promise = $2 where id = $1`, [k2, jj(10)]);
  return { m, d, autre, k1, k2 };
}
const ajouter = (db: Db, p: unknown) => one(db, `select gbs.ajouter_fermeture_usine($1) id`, [p]).then((r) => r.id as string);

describe('Fermetures d’usines', () => {
  it('une fermeture générale touche toutes les commandes en cours qui la chevauchent', () => withTx(async (db) => {
    const { m, k1, k2 } = await preparer(db);
    await as(db, m.achats);
    await ajouter(db, { motif: 'Nouvel An chinois', du: jj(20), au: jj(34) });
    const t = await rows(db, `select commande_id, jours_chevauches from gbs.commandes_fermetures()`);
    expect(t).toEqual([{ commande_id: k1, jours_chevauches: 15 }]); // k2 livrée avant la fermeture
    expect(k2).toBeTruthy();
  }));

  it('alerte selon l’horizon paramétré : une fermeture lointaine touche la commande sans alerter', () => withTx(async (db) => {
    const { m, k1 } = await preparer(db);
    await as(db, m.achats);
    await ajouter(db, { motif: 'Golden Week', du: jj(30), au: jj(36) });
    expect(await rows(db, `select commande_id, en_alerte from gbs.commandes_fermetures()`)).toEqual([{ commande_id: k1, en_alerte: true }]);
    await as(db, m.admin);
    await db.query(`insert into gbs.parametres (cle, valeur, date_effet, commentaire) values ('fermetures.horizon_alerte_jours', '20', current_date, 'Essai')`);
    expect((await one(db, `select en_alerte from gbs.commandes_fermetures()`)).en_alerte).toBe(false);
  }));

  it('une fermeture d’usine ne touche que ce fournisseur ; l’annulation la retire', () => withTx(async (db) => {
    const { m, autre, k2 } = await preparer(db);
    await as(db, m.admin);
    const f = await ajouter(db, { fournisseur_id: autre, motif: 'Inventaire de fin d’année', du: jj(5), au: jj(14) });
    expect(await rows(db, `select commande_id, jours_chevauches from gbs.commandes_fermetures()`))
      .toEqual([{ commande_id: k2, jours_chevauches: 6 }]);
    await expectError(db, 'GBS_MOTIF_OBLIGATOIRE', `select gbs.annuler_fermeture_usine($1, '')`, [f]);
    await db.query(`select gbs.annuler_fermeture_usine($1, 'Dates confirmées erronées par l’usine')`, [f]);
    expect(await rows(db, `select * from gbs.commandes_fermetures()`)).toEqual([]);
    await expectError(db, 'GBS_DEMANDE_TRAITEE', `select gbs.annuler_fermeture_usine($1, 'Encore une fois')`, [f]);
    expect((await one(db, `select count(*)::int n from gbs.journal_audit where action = 'fermeture_usine_annulee'`)).n).toBe(1);
  }));

  it('validation stricte et écriture directe interdite', () => withTx(async (db) => {
    const { m } = await preparer(db);
    await as(db, m.achats);
    for (const p of [
      { motif: 'Golden Week', du: jj(10), au: jj(5) },                     // fin avant début
      { motif: 'Golden Week', du: jj(10), au: jj(140) },                   // plus de 120 jours
      { motif: 'GW', du: jj(1), au: jj(2) },                               // motif trop court
      { motif: 'Golden Week', du: 'demain', au: jj(2) },                   // date illisible
      { motif: 'Golden Week', du: jj(1), au: jj(2), x: 1 },                // champ inconnu
      { motif: 'Golden Week', du: jj(1), au: jj(2), fournisseur_id: '00000000-0000-4000-8000-000000000000' },
      { motif: 'Golden Week', du: jj(800), au: jj(801) },                  // trop loin
    ]) await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.ajouter_fermeture_usine($1)`, [p]);
    await expectError(db, '42501', `insert into gbs.fermetures_usines (motif, du, au) values ('Directe', current_date, current_date)`);
    const f = await ajouter(db, { motif: 'Fête de Qingming', du: jj(3), au: jj(3), fournisseur_id: null });
    await expectError(db, '42501', `update gbs.fermetures_usines set motif = 'Autre' where id = $1`, [f]);
    await expectError(db, '42501', `delete from gbs.fermetures_usines where id = $1`, [f]);
  }));

  it('réservée à l’administratrice et aux achats Chine', () => withTx(async (db) => {
    const { m } = await preparer(db);
    await as(db, m.achats);
    await ajouter(db, { motif: 'Golden Week', du: jj(1), au: jj(7) });
    for (const u of [m.hub, m.agentGA, m.inspecteur, m.comptable]) {
      await as(db, u);
      await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.ajouter_fermeture_usine($1)`, [{ motif: 'Golden Week', du: jj(1), au: jj(7) }]);
      await expectError(db, 'GBS_ACCES_REFUSE', `select * from gbs.commandes_fermetures()`);
      expect(await rows(db, `select id from gbs.fermetures_usines`)).toEqual([]);
    }
  }));
});
