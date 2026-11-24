-- Vérification après la migration 082 (performance_fournisseurs). Lecture seule.
-- Résultat attendu : 2 | 3 | 3 | true | false | true | {search_path=""}
select (select count(*) from supabase_migrations.schema_migrations
         where version in ('20261107000081', '20261107000082')) as historique_2,
       (select count(*) from gbs.parametres_definitions where cle in
         ('fournisseurs.performance_fenetre_mois', 'fournisseurs.alerte_livraison_taux', 'fournisseurs.alerte_ppm')) as definitions_3,
       (select count(*) from gbs.parametres where cle in
         ('fournisseurs.performance_fenetre_mois', 'fournisseurs.alerte_livraison_taux', 'fournisseurs.alerte_ppm')) as parametres_3,
       has_function_privilege('authenticated', 'gbs.performance_fournisseurs(uuid)', 'execute') as authenticated_true,
       has_function_privilege('anon', 'gbs.performance_fournisseurs(uuid)', 'execute') as anon_false,
       (select prosecdef from pg_proc where oid = 'gbs.performance_fournisseurs(uuid)'::regprocedure) as security_definer_true,
       (select proconfig from pg_proc where oid = 'gbs.performance_fournisseurs(uuid)'::regprocedure) as chemin_vide;
