// Page de suivi du client : retards par partie prenante (attentes mesurées et points bloquants visibles).
import { afterAll, describe, expect, it } from 'vitest';
import { as, asRoot, closePool, dossier, monde, one, withTx, type Db } from './helpers';

afterAll(closePool);

const suivre = async (db: Db, jeton: string) => {
  await asRoot(db);
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  return (await one(db, `select gbs.suivi_client($1) r`, [jeton])).r;
};

describe('Suivi client : retards par partie prenante', () => {
  it('attentes de tiers mesurées ; seuls les points bloquants visibles comptent ; GBS nommée', () => withTx(async (db) => {
    const m = await monde(db);
    const d = await dossier(db, m);
    await as(db, m.admin);
    const p = (await one(db, `select id from gbs.dossier_phases where dossier_id = $1 and phase = 'consultation'`, [d])).id;
    // Attente du client du lundi 02.11 au vendredi 06.11.2026 : 4 jours ouvrés (] début, fin ]).
    await asRoot(db);
    await db.query(`insert into gbs.phase_attentes (phase_id, dossier_id, tiers, debut, fin) values ($1, $2, 'client', '2026-11-02', '2026-11-06')`, [p, d]);
    await as(db, m.admin);
    await db.query(`insert into gbs.points_bloquants (dossier_id, description, categorie, impact_jours, echeance, visible_client) values
      ($1, 'Retard de production chez le fabricant', 'fournisseur', 5, current_date + 3, true),
      ($1, 'Plan de chargement repris par GBS', 'interne', 2, current_date + 3, true),
      ($1, 'Litige commercial interne', 'interne', 9, current_date + 3, false)`, [d]);
    await as(db, m.hub);
    const l = (await one(db, `select gbs.creer_lien_suivi($1, 'Direction', 30) r`, [d])).r;
    const s = await suivre(db, l.jeton);
    const par = Object.fromEntries(s.retards.map((x: any) => [x.partie, x]));
    expect(s.retards.map((x: any) => x.partie)).toEqual(['client', 'fournisseur', 'transport', 'gbs', 'autres']);
    expect(par.client.jours_attente).toBe(4);
    expect(par.fournisseur).toMatchObject({ jours_impact: 5, points_ouverts: 1 });
    expect(par.gbs).toMatchObject({ jours_impact: 2, points_ouverts: 1 });   // le point non visible (9 j) n'entre pas
    expect(s.points_bloquants).toHaveLength(2);
    expect(s.points_bloquants.find((x: any) => x.categorie === 'interne').partie).toBe('gbs');
  }));
});
