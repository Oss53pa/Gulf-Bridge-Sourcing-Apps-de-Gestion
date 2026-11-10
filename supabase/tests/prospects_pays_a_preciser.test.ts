// M1 : demande du site au pays inconnu (« ZZ ») : confiée au Hub, convertie seulement une fois le pays précisé.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, expectError, monde, one, rows, withTx, type Db } from './helpers';

afterAll(closePool);

async function recevoir(db: Db, d: Record<string, unknown>) {
  await asRoot(db);
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  return (await one(db, `select gbs.recevoir_demande_site($1, $2) r`, [JSON.stringify(d), 'c'.repeat(64)])).r;
}

describe('Demande du site au pays à préciser', () => {
  it('confiée au Hub Afrique, invisible de l’agent pays ; conversion refusée tant que le pays n’est pas précisé', () => withTx(async (db) => {
    const m = await monde(db);
    const r = await recevoir(db, { raison_sociale: 'hotel.sn', email: 'contact@hotel.sn', pays: 'ZZ', specialite: 'autre',
      message: "Demande du modèle de rapport d'inspection (PDF)", page_origine: 'https://www.gulfbridgesourcing.com/#rapport', langue: 'fr', consentement: true });
    await asRoot(db);
    expect(await one(db, `select pays, responsable_id, source from gbs.prospects where id = $1`, [r.prospect_id]))
      .toEqual({ pays: 'ZZ', responsable_id: m.hub, source: 'site_web' });
    await as(db, m.agentGA);
    expect(await rows(db, `select 1 from gbs.prospects where id = $1`, [r.prospect_id])).toEqual([]);
    await as(db, m.hub);
    await db.query(`select gbs.enregistrer_action_prospect($1, 'email', current_date, 'Modèle envoyé')`, [r.prospect_id]);
    await expectError(db, 'GBS_PAYS_A_PRECISER', `select gbs.convertir_prospect($1)`, [r.prospect_id]);
    await db.query(`update gbs.prospects set pays = 'SN', specialite = 'equipement_site' where id = $1`, [r.prospect_id]);
    expect((await one(db, `select pays from gbs.convertir_prospect($1)`, [r.prospect_id])).pays).toBe('SN');
  }));
});
