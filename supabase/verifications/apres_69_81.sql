-- Vérification après application des migrations 69 à 81 en production (lecture seule).
-- Renvoie une ligne par anomalie ; aucune ligne = tout est en place.
with
tables_attendues(t) as (values
  ('colisages'),('limites_debit'),('annonces_virements'),('receptions_site'),('fermetures_usines'),
  ('questionnaires_besoin'),('pays_electricite'),('besoins'),('besoins_versions'),('besoins_questions'),
  ('beneficiaires_fournisseurs'),('controles_sanctions'),('polices_assurance'),('sinistres'),
  ('consolidations'),('receptions_entrepot')),
fonctions_attendues(f) as (values
  ('gbs.declarer_colisage'),('gbs.traiter_colisage'),('gbs_private.limiter'),('gbs.annoncer_virement'),
  ('gbs.designer_compte_encaissement'),('gbs.preparer_reception_site'),('gbs.confirmer_reception_site'),
  ('gbs.taches_equipe'),('gbs_private.taches_de'),('gbs.ajouter_fermeture_usine'),('gbs.commandes_fermetures'),
  ('gbs.creer_besoin'),('gbs.enregistrer_besoin'),('gbs.soumettre_besoin'),('gbs.valider_besoin'),
  ('gbs.besoin_detail'),('gbs.besoins_client'),('gbs.enregistrer_controle_sanctions'),('gbs_private.sanction_confirmee'),
  ('gbs.export_ecritures'),('gbs.enregistrer_police'),('gbs.declarer_sinistre'),('gbs.traiter_sinistre'),
  ('gbs.ouvrir_consolidation'),('gbs.receptionner'),('gbs.clore_colisage'),('gbs.confirmer_empotage'),
  ('gbs.rattacher_expedition'),('gbs_private.fournisseur_bloque'),('gbs_private.limiter_compte')),
parametres_attendus(c) as (values
  ('portail.max_ecritures_heure'),('fermetures.horizon_alerte_jours'),('besoin.delai_relecture_jours'),
  ('due_diligence.sanctions_fraicheur_jours'),('export.ventes.GBS_CI'),('export.ventes.GBS_CN'),
  ('assurance.majoration_valeur'),('assurance.taux_prime'),('assurance.delai_declaration_jours'),
  ('entrepot.capacite_m3.40_hc'),('entrepot.charge_kg.40_hc'),('production.photos_max_commande'))
select 'table manquante' anomalie, t detail from tables_attendues
 where to_regclass('gbs.' || t) is null
union all
select 'table sans sécurité par ligne', c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'gbs' and c.relkind = 'r' and not c.relrowsecurity
union all
select 'fonction manquante', f from fonctions_attendues
 where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = f)
union all
select 'paramètre sans valeur', c from parametres_attendus
 where not exists (select 1 from gbs.parametres p where p.cle = c and p.date_effet <= current_date)
union all
select 'déclencheur manquant', 'fournisseurs_sanction'
 where not exists (select 1 from pg_trigger where tgname = 'fournisseurs_sanction' and tgrelid = 'gbs.fournisseurs'::regclass)
union all
select 'déclencheur manquant', 'comptes_bancaires_encaissement'
 where not exists (select 1 from pg_trigger where tgname = 'comptes_bancaires_encaissement' and tgrelid = 'gbs.comptes_bancaires'::regclass)
union all
select 'migration 81 absente (lien fournisseur sans contrôle de blocage)', 'gbs_private.lien_fournisseur'
 where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'gbs_private' and p.proname = 'lien_fournisseur' and p.prosrc like '%fournisseur_bloque%')
union all
-- Requête dynamique : le script doit aussi tourner (et signaler l'absence) avant l'application.
select 'questionnaire tronc commun absent', 'questionnaires_besoin'
 where to_regclass('gbs.questionnaires_besoin') is not null
   and (xpath('/row/n/text()', query_to_xml(
         'select count(*) n from gbs.questionnaires_besoin where categorie = ''tronc_commun''', false, true, '')))[1]::text::int = 0
union all
select 'accès anonyme au schéma', nspname from pg_namespace
 where nspname in ('gbs','gbs_private') and has_schema_privilege('anon', oid, 'usage')
union all
select 'fonction exécutable par anonyme', p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'gbs' and has_function_privilege('anon', p.oid, 'execute')
union all
select 'fonction privilégiée sans chemin fixé', n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('gbs','gbs_private') and p.prosecdef
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) x where x like 'search_path=%')
order by 1, 2;
