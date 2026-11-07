// Import automatique des taux BCE : contrôles avant écriture, refus tracés, droits.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, expectError, monde, one, rows, withTx, type Db } from './helpers';

afterAll(closePool);

const jour = (decalage: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + decalage);
  return d.toISOString().slice(0, 10);
};
const bce = (date: string, usd: string, cny: string, prefixe = '') => `<?xml version="1.0" encoding="UTF-8"?>${prefixe}
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <Cube><Cube time="${date}"><Cube currency="USD" rate="${usd}"/><Cube currency="JPY" rate="162.5"/><Cube currency="CNY" rate="${cny}"/></Cube></Cube>
</gesmes:Envelope>`;

async function service(db: Db) {
  await asRoot(db);
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
}
async function importer(db: Db) {
  await service(db);
  return (await one(db, `select gbs.importer_taux_bce() r`)).r as any[];
}
async function repondre(db: Db, contenu: string, statut = 200) {
  await asRoot(db);
  const id = (await one(db, `select max(id) id from net.requetes`)).id;
  await db.query(`insert into net._http_response (id, status_code, content) values ($1, $2, $3)`, [id, statut, contenu]);
}
const dernierImport = (db: Db) => one(db, `select statut, motif, taux from gbs.imports_taux order by id desc limit 1`);
const taux = (db: Db, devise: string) =>
  rows(db, `select date_taux::text, taux_xof::text from gbs.taux_change where devise = $1 order by date_taux`, [devise]);

describe('Taux BCE', () => {
  it('envoie la requête, puis écrit USD et CNY convertis par la parité EUR/XOF', () =>
    withTx(async (db) => {
      await asRoot(db);
      const r1 = await importer(db);
      expect(r1).toEqual([expect.objectContaining({ statut: 'demande' })]);
      expect((await one(db, `select url from net.requetes order by id desc limit 1`)).url)
        .toBe('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml');
      // Pas de seconde requête tant que la première est en attente.
      expect(await importer(db)).toEqual([]);

      await repondre(db, bce(jour(-1), '1.0800', '7.8000'));
      const r2 = await importer(db);
      expect(r2[0]).toMatchObject({ statut: 'importe', date_taux: jour(-1) });
      await asRoot(db);
      expect(await taux(db, 'USD')).toEqual([{ date_taux: jour(-1), taux_xof: '607.36759259' }]);
      expect(await taux(db, 'CNY')).toEqual([{ date_taux: jour(-1), taux_xof: '84.09705128' }]);
      // Import réussi aujourd'hui : plus aucune requête.
      expect(await importer(db)).toEqual([]);
    }));

  it('rejette une variation de plus de 10 % sans rien écrire', () =>
    withTx(async (db) => {
      await asRoot(db);
      await db.query(`insert into gbs.taux_change (devise, date_taux, taux_xof, source) values
        ('USD', $1, 600, 'test'), ('CNY', $1, 84, 'test')`, [jour(-5)]);
      await importer(db);
      await repondre(db, bce(jour(-1), '0.9000', '7.8000'));
      expect((await importer(db))[0]).toMatchObject({ statut: 'rejete' });
      await asRoot(db);
      expect((await dernierImport(db)).motif).toMatch(/variation de 21\.5 % sur USD/);
      expect(await taux(db, 'USD')).toHaveLength(1);
      expect(await taux(db, 'CNY')).toHaveLength(1); // le lot entier est annulé
      // Une publication rejetée ne relance pas de requête le même jour : saisie manuelle attendue.
      expect(await importer(db)).toEqual([]);
    }));

  it('rejette DOCTYPE, XML invalide, date ancienne et taux hors bornes', () =>
    withTx(async (db) => {
      await asRoot(db);
      const cas: [string, RegExp][] = [
        [bce(jour(-1), '1.08', '7.8', '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>'), /DOCTYPE/],
        ['<pas du xml', /XML invalide/],
        [bce(jour(-30), '1.08', '7.8'), /hors plage/],
        [bce(jour(-1), '50', '7.8'), /USD hors bornes/],
        [bce(jour(-1), '1.08', 'abc'), /CNY absent ou mal formé/],
      ];
      for (const [contenu, motif] of cas) {
        await asRoot(db);
        await db.query(`delete from gbs.imports_taux`);
        await importer(db);
        await repondre(db, contenu);
        expect((await importer(db))[0]).toMatchObject({ statut: 'rejete' });
        await asRoot(db);
        expect((await dernierImport(db)).motif).toMatch(motif);
      }
      expect(await taux(db, 'USD')).toEqual([]);
    }));

  it('trace une erreur HTTP et plafonne le nombre de requêtes par jour', () =>
    withTx(async (db) => {
      await asRoot(db);
      for (let i = 0; i < 6; i++) {
        await importer(db);
        await repondre(db, 'Service Unavailable', 503);
        expect((await importer(db)).map((x) => x.statut)).toContain('erreur');
      }
      await asRoot(db);
      expect((await dernierImport(db)).motif).toBe('Réponse HTTP 503');
      expect((await one(db, `select count(*)::int n from net.requetes`)).n).toBe(6);
      expect(await importer(db)).toEqual([]); // plafond atteint
    }));

  it('est réservé à l’administratrice et au service ; journal lisible par la comptabilité seulement', () =>
    withTx(async (db) => {
      const m = await monde(db);
      await as(db, m.achats);
      await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.importer_taux_bce()`);
      await as(db, m.admin);
      await db.query(`select gbs.importer_taux_bce()`);
      await as(db, m.comptable);
      expect(await rows(db, `select statut from gbs.imports_taux`)).toHaveLength(1);
      await as(db, m.hub);
      expect(await rows(db, `select statut from gbs.imports_taux`)).toHaveLength(0);
      await as(db, m.comptable);
      await expectError(db, '42501', `insert into gbs.imports_taux (statut) values ('importe')`);
    }));
});
