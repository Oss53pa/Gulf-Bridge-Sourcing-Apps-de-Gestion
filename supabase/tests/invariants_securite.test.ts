// Invariants de sécurité de toute la base, vérifiés à chaque migration (règles permanentes du projet) :
// autorisation en base, aucune surface anonyme, fonctions privilégiées à chemin de recherche fixé.
import { afterAll, describe, expect, it } from 'vitest';
import { asRoot, closePool, rows, withTx } from './helpers';

afterAll(closePool);

describe('Invariants de sécurité', () => {
  it('chaque table métier a la sécurité par ligne activée', () => withTx(async (db) => {
    await asRoot(db);
    expect(await rows(db, `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'gbs' and c.relkind = 'r' and not c.relrowsecurity order by 1`)).toEqual([]);
  }));

  it('le rôle anonyme n’atteint ni les schémas, ni les tables, ni les fonctions métier', () => withTx(async (db) => {
    await asRoot(db);
    expect(await rows(db, `select nspname from pg_namespace where nspname in ('gbs','gbs_private') and has_schema_privilege('anon', oid, 'usage')`)).toEqual([]);
    expect(await rows(db, `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('gbs','gbs_private') and c.relkind in ('r','v','m')
        and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))`)).toEqual([]);
    expect(await rows(db, `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'gbs' and has_function_privilege('anon', p.oid, 'execute') order by 1`)).toEqual([]);
  }));

  it('toute fonction exécutée avec les droits du propriétaire fixe son chemin de recherche', () => withTx(async (db) => {
    await asRoot(db);
    expect(await rows(db, `select n.nspname || '.' || p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('gbs','gbs_private') and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) x where x like 'search_path=%') order by 1`)).toEqual([]);
  }));

  it('aucune table modifiable par un utilisateur connecté sans règle d’écriture', () => withTx(async (db) => {
    await asRoot(db);
    expect(await rows(db, `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'gbs' and c.relkind = 'r'
        and (has_table_privilege('authenticated', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'update') or has_table_privilege('authenticated', c.oid, 'delete'))
        and not exists (select 1 from pg_policy po where po.polrelid = c.oid and po.polcmd in ('a','w','d','*')) order by 1`)).toEqual([]);
  }));

  it('aucune suppression directe : chaque table métier est protégée par un déclencheur ou sans droit de suppression', () => withTx(async (db) => {
    await asRoot(db);
    expect(await rows(db, `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'gbs' and c.relkind = 'r' and has_table_privilege('authenticated', c.oid, 'delete')
        and not exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = c.oid and p.proname in ('trg_no_delete','trg_immuable'))
        and not exists (select 1 from pg_policy po where po.polrelid = c.oid and po.polcmd in ('d','*')) order by 1`)).toEqual([]);
  }));
});
