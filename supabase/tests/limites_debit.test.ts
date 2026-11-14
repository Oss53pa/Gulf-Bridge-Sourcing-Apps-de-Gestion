// Limitation de débit des écritures des comptes externes (migration 69, utilisée par 69, 71 et 74).
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, withTx } from './helpers';

afterAll(closePool);

describe('Limitation de débit des portails', () => {
  it('au-delà du seuil horaire, le compte client est arrêté ; l’équipe interne ne l’est pas', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m, { extra: { pays: 'CI' } });
    await as(db, m.admin);
    await db.query(`insert into gbs.parametres (cle, valeur, date_effet, commentaire) values ('portail.max_ecritures_heure', '3', current_date, 'Essai')`);
    await db.query(`select gbs.activer_questionnaire_besoin(id) from gbs.questionnaires_besoin where categorie = 'tronc_commun'`);
    await as(db, m.hub);
    const b = (await one(db, `select gbs.creer_besoin($1, 'tronc_commun') id`, [d])).id;
    await asRoot(db);
    const u = randomUUID();
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [u, `${u}@client.test`, { nom: 'Client', app: 'gbs' }]);
    await as(db, m.admin);
    await db.query(`select gbs.admin_compte_client($1, $2, 'demandeur')`, [u, m.clientCI]);
    await as(db, u);
    for (let i = 0; i < 3; i++) await db.query(`select gbs.enregistrer_besoin($1, $2)`, [b, { usage: `Lingerie, essai ${i}` }]);
    await expectError(db, 'GBS_TROP_DE_DEMANDES', `select gbs.enregistrer_besoin($1, '{"usage":"Encore une"}')`, [b]);
    // Le blocage persiste dans l'heure (le refus ne remet pas le compteur à zéro).
    await expectError(db, 'GBS_TROP_DE_DEMANDES', `select gbs.enregistrer_besoin($1, '{"usage":"Et encore"}')`, [b]);
    // L'équipe interne n'est pas limitée ; le compteur n'est lisible par personne directement.
    await as(db, m.hub);
    for (let i = 0; i < 5; i++) await db.query(`select gbs.enregistrer_besoin($1, $2)`, [b, { usage: `Équipe ${i}` }]);
    await expectError(db, '42501', `select * from gbs.limites_debit`);
    expect(b).toBeTruthy();
  }));
});
