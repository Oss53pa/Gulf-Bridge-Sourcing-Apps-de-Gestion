-- Vérification après la migration 083 (droits_import). Lecture seule.
-- Résultat attendu : 2 | true | true | 3 | true | false | false | true | 0
select (select count(*) from supabase_migrations.schema_migrations
         where version in ('20261107000082', '20261107000083')) as historique_2,
       (select relrowsecurity from pg_class where oid = 'gbs.droits_import'::regclass) as rls_true,
       has_table_privilege('authenticated', 'gbs.droits_import', 'select') as lecture_true,
       (select count(*) from information_schema.columns where table_schema = 'gbs' and table_name = 'consultations_fournisseurs'
         and column_name in ('article_id', 'fret_estime_xof', 'fret_source')) as colonnes_3,
       has_function_privilege('authenticated', 'gbs.prix_rendu(uuid)', 'execute') as authenticated_true,
       has_function_privilege('anon', 'gbs.prix_rendu(uuid)', 'execute') as anon_false,
       has_function_privilege('anon', 'gbs.droits_import_enregistrer(jsonb)', 'execute') as anon_ecriture_false,
       (select bool_and(prosecdef and proconfig = array['search_path=""']) from pg_proc
         where oid in ('gbs.prix_rendu(uuid)'::regprocedure, 'gbs.droits_import_enregistrer(jsonb)'::regprocedure,
                       'gbs.droits_import_retirer(uuid)'::regprocedure, 'gbs_private.prix_rendu_offre(uuid)'::regprocedure,
                       'gbs_private.cout_global_offre(uuid)'::regprocedure)) as definer_chemin_vide_true,
       (select count(*) from gbs.droits_import) as bareme_vide_0;
