-- Fige le search_path de toutes les fonctions GBS qui ne l'avaient pas encore
-- (avertissement « function_search_path_mutable » du linter Supabase).
-- Toutes les références de ces fonctions sont qualifiées par leur schéma.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('gbs', 'gbs_private') and p.prokind = 'f'
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = %L', f.sig, '');
  end loop;
end $$;
