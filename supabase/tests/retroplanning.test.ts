// Lot 1, M33 : planning à rebours depuis la date d'ouverture du site.
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, expectError, monde, one, rows, withTx, type Db, type Monde } from './helpers';

afterAll(closePool);

const dansJours = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function projet(db: Db, m: Monde, ouverture: string) {
  const d = await dossier(db, m, { by: m.hub, modele: 'equipement_site', extra: {
    date_ouverture_site: ouverture, forfait_projet_ht: 6_000_000, taux_commission_projet: 0.04 } });
  await asRoot(db);
  await db.query(`update gbs.dossiers set chef_id = $2 where id = $1`, [d, m.hub]);
  return d;
}
async function cibles(db: Db, m: Monde, jours: number) {
  await as(db, m.admin);
  await db.query(`insert into gbs.delais_cibles (modele, phase, jours_ouvres)
    select 'equipement_site', p, $1 from unnest((select phases from gbs.modeles_dossier where code = 'equipement_site')) p
    where p <> 'cloture'`, [jours]);
}
const plan = async (db: Db, d: string) => (await one(db, `select gbs.planning_ouverture($1) p`, [d])).p;

describe('Planning à rebours (M33)', () => {
  it('sans délais cibles : rien n’est inventé et l’application est refusée', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await projet(db, m, '2027-03-01');
    await as(db, m.hub);
    const p = await plan(db, d);
    expect(p.cibles_manquantes).toHaveLength(10);
    expect(p.debut_au_plus_tard).toBeNull();
    expect(p.marge_jours_ouvres).toBeNull();
    await expectError(db, 'GBS_DELAIS_CIBLES_MANQUANTS', `select gbs.appliquer_planning_ouverture($1)`, [d]);
  }));

  it('dates au plus tard calculées à rebours en jours ouvrés, puis recopiées dans le planning', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await projet(db, m, '2027-03-01');
    await cibles(db, m, 10);
    await as(db, m.hub);
    const p = await plan(db, d);
    const livraison = p.phases.find((x: any) => x.phase === 'livraison');
    // Lundi 1er mars 2027 moins 10 jours ouvrés : lundi 15 février.
    expect([livraison.debut_au_plus_tard, livraison.fin_au_plus_tard]).toEqual(['2027-02-15', '2027-03-01']);
    expect(p.debut_au_plus_tard).toBe(p.phases[0].debut_au_plus_tard);
    expect(await one(db, `select gbs.appliquer_planning_ouverture($1) n`, [d])).toEqual({ n: 10 });
    expect((await one(db, `select prevue_fin::text f from gbs.dossier_phases where dossier_id = $1 and phase = 'livraison'`, [d])).f)
      .toBe('2027-03-01');
  }));

  it('date intenable : retard chiffré et alerte dans « mes tâches » du chef de dossier', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await projet(db, m, dansJours(20));
    await cibles(db, m, 10);
    await as(db, m.hub);
    const p = await plan(db, d);
    expect(p.intenable).toBe(true);
    expect(p.marge_jours_ouvres).toBeLessThan(0);
    expect(p.phases.some((x: any) => x.en_retard)).toBe(true);
    expect((await rows(db, `select nature, urgence from gbs.mes_taches() where nature = 'ouverture'`)))
      .toEqual([{ nature: 'ouverture', urgence: 1 }]);
  }));

  it('date tenable : avance positive, aucune alerte', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await projet(db, m, dansJours(500));
    await cibles(db, m, 10);
    await as(db, m.hub);
    const p = await plan(db, d);
    expect(p.intenable).toBe(false);
    expect(p.marge_jours_ouvres).toBeGreaterThan(0);
    expect(await rows(db, `select 1 from gbs.mes_taches() where nature = 'ouverture'`)).toEqual([]);
  }));

  it('réservé à l’équipe du dossier', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await projet(db, m, '2027-03-01');
    await as(db, m.agentCM);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.planning_ouverture($1)`, [d]);
    await as(db, m.comptable);
    await expectError(db, 'GBS_ACCES_REFUSE', `select gbs.appliquer_planning_ouverture($1)`, [d]);
  }));
});
