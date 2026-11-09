// Portail fournisseur avec compte : ses commandes seulement, sans client, dossier ni prix de vente.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, commande, contratSigne, dossier, expectError, fournisseurAgree, mandatSigne, monde, one, withTx, type Db } from './helpers';

afterAll(closePool);

async function compte(db: Db, nom: string) {
  await asRoot(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${nom}@usine.test`, { nom, app: 'gbs' }]);
  return id;
}

describe('Espace fournisseur', () => {
  it('ses commandes et paiements seulement ; ni client, ni dossier, ni autre fournisseur ; comptes masqués', () => withTx(async (db) => {
    const m = await monde(db);
    const autre = await fournisseurAgree(db, m, 'Ningbo Brightlux');
    const d = await dossier(db, m);
    const c1 = await commande(db, m, d, [{ qte: 6, pu: 23000 }]);
    const c2 = await commande(db, m, d, [{ qte: 2, pu: 999 }], { fournisseur: autre });
    await mandatSigne(db, m, d);
    await contratSigne(db, m, c1);
    await contratSigne(db, m, c2);
    const u = await compte(db, 'chen');
    await as(db, m.achats);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.admin_compte_fournisseur($1, $2, 'directeur')`, [u, m.fournisseur]);
    await db.query(`select gbs.admin_compte_fournisseur($1, $2, 'commercial')`, [u, m.fournisseur]);
    // Les achats ne transforment pas un compte interne en compte fournisseur.
    await expectError(db, '42501', `select gbs.admin_compte_fournisseur($1, $2, 'finance')`, [m.comptable, m.fournisseur]);
    await as(db, u, 'aal1');
    const e = (await one(db, `select gbs.espace_fournisseur() e`)).e;
    expect(e.commandes.length).toBe(1);
    expect(e.commandes[0].lignes[0]).toMatchObject({ quantite: 6, prix_unitaire: 23000 });
    const texte = JSON.stringify(e);
    const client = (await (async () => { await asRoot(db); return one(db, `select c.raison_sociale, d.reference from gbs.dossiers d join gbs.clients c on c.id = d.client_id where d.id = $1`, [d]); })());
    expect(texte).not.toContain(client.raison_sociale);
    expect(texte).not.toContain(client.reference);
    expect(texte).not.toContain('Ningbo');
    expect(texte).not.toContain(d);
    for (const c of e.comptes) expect(c.fin_numero.length).toBeLessThanOrEqual(4);
    // Aucune lecture directe des tables internes.
    await as(db, u, 'aal1');
    expect((await db.query(`select id from gbs.commandes`)).rows).toEqual([]);
    expect((await db.query(`select id from gbs.fournisseurs`)).rows).toEqual([]);
    await expectError(db, '42501', `select gbs.espace_client()`);
  }));

  it('un fournisseur ne change jamais son rattachement ; un interne n’a pas d’espace fournisseur', () => withTx(async (db) => {
    const m = await monde(db);
    const autre = await fournisseurAgree(db, m, 'Qingdao Polar');
    const u = await compte(db, 'li');
    await as(db, m.admin);
    await db.query(`select gbs.admin_compte_fournisseur($1, $2, 'qualite')`, [u, m.fournisseur]);
    await as(db, u, 'aal1');
    await expectError(db, '42501', `update gbs.profils set fournisseur_id = $2 where id = $1`, [u, autre]);
    await as(db, m.achats);
    await expectError(db, '42501', `select gbs.espace_fournisseur()`);
    await as(db, m.admin);
    await expectError(db, 'GBS_PARAMETRES_INVALIDES', `select gbs.admin_definir_profil($1, 'fournisseur', '{}')`, [u]);
  }));
});
