-- Section Rapports du module Dossiers (M23, section 4 bis ; maquette « Productivité » PRD et
-- « Clôture et archivage » ARC). Lot 2 du cahier : enquête de satisfaction, archivage, productivité.
-- * Conditions de clôture vérifiées en base, quel que soit le chemin (avancer_phase ou mise à jour
--   directe par l'administratrice) : factures soldées, réserves levées, non-conformités closes,
--   points bloquants résolus. Les pièces de la phase de clôture restent contrôlées par avancer_phase.
-- * Enquête de satisfaction : une note de 1 à 5 par dossier, saisie une seule fois, au journal.
--   Elle est attendue à la clôture mais ne la bloque pas (le client peut ne pas répondre).
-- * Archivage : réservé à l'administratrice, sur un dossier clos ; le dossier archivé n'est plus
--   modifiable ; conservation selon le paramètre archivage.duree_annees.
-- * Productivité : par chef de dossier et par phase, délais réels face aux cibles (jours ouvrés,
--   horloge arrêtée pendant l'attente d'un tiers), complétude, points bloquants résolus à temps,
--   satisfaction.

create table gbs.satisfactions (
  dossier_id  uuid primary key references gbs.dossiers(id),
  note        int not null check (note between 1 and 5),
  commentaire text check (length(commentaire) <= 2000),
  saisie_par  uuid references gbs.profils(id),
  saisie_le   timestamptz not null default now()
);
alter table gbs.satisfactions enable row level security;
-- Aucune écriture directe : ni droit d'insertion ni règle ; la saisie passe par enregistrer_satisfaction().
grant select on gbs.satisfactions to authenticated;
create policy satisfactions_lecture on gbs.satisfactions for select using (gbs_private.interne() and gbs_private.dossier_visible(dossier_id));
create trigger satisfactions_audit after insert on gbs.satisfactions for each row execute function gbs_private.trg_audit();
create trigger satisfactions_immuable before update or delete on gbs.satisfactions for each row execute function gbs_private.trg_immuable();

-- Conditions de clôture d'un dossier : une ligne par condition, bloquante ou non.
create or replace function gbs_private.conditions_cloture_brut(p_dossier uuid)
returns table (code text, ok boolean, bloquante boolean, nombre int)
language sql stable security definer set search_path = '' as $$
  select 'pieces', count(*) = 0, true, count(*)::int from gbs.pieces p
    join gbs.dossier_phases f on f.dossier_id = p.dossier_id and f.phase = p.phase
   where p.dossier_id = p_dossier and p.obligatoire and p.statut <> 'validee' and f.statut <> 'validee'
  union all
  select 'factures', count(*) = 0, true, count(*)::int from gbs.factures x
   where x.dossier_id = p_dossier and x.statut in ('brouillon','en_attente_fne','emise','partiellement_payee')
  union all
  select 'reserves', count(*) = 0, true, count(*)::int from gbs.reserves_reception r
   where r.dossier_id = p_dossier and r.statut = 'ouverte'
  union all
  select 'non_conformites', count(*) = 0, true, count(*)::int from gbs.non_conformites n
   where n.dossier_id = p_dossier and n.statut <> 'close'
  union all
  select 'points_bloquants', count(*) = 0, true, count(*)::int from gbs.points_bloquants b
   where b.dossier_id = p_dossier and b.resolu_le is null
  union all
  select 'satisfaction', exists (select 1 from gbs.satisfactions s where s.dossier_id = p_dossier), false, 0
$$;

create or replace function gbs.conditions_cloture(p_dossier uuid)
returns table (code text, ok boolean, bloquante boolean, nombre int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.interne() and gbs_private.dossier_visible(p_dossier));
  return query select * from gbs_private.conditions_cloture_brut(p_dossier);
end $$;

-- Garde de clôture et d'archivage sur la table des dossiers.
create or replace function gbs_private.trg_dossier_cloture() returns trigger
language plpgsql security definer set search_path = '' as $$
declare manque text;
begin
  if old.archive_le is not null then
    raise exception 'GBS_DOSSIER_ARCHIVE: un dossier archivé est en lecture seule' using errcode = 'P0001';
  end if;
  if new.archive_le is distinct from old.archive_le
     and coalesce(current_setting('gbs.rpc', true), '') <> 'archiver_dossier' then
    raise exception 'GBS_VALIDATION_RPC: l''archivage passe par archiver_dossier()' using errcode = 'P0001';
  end if;
  if new.statut = 'clos' and old.statut <> 'clos' then
    select string_agg(c.code, ', ') into manque from gbs_private.conditions_cloture_brut(new.id) c where c.bloquante and not c.ok;
    if manque is not null then
      raise exception 'GBS_CLOTURE_CONDITIONS: %', manque using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
-- Nom choisi pour passer après dossiers_regles (ordre alphabétique) : les droits sont vérifiés d'abord.
create trigger dossiers_verrou_cloture before update on gbs.dossiers for each row execute function gbs_private.trg_dossier_cloture();

create or replace function gbs.enregistrer_satisfaction(p_dossier uuid, p_note int, p_commentaire text default null)
returns gbs.satisfactions language plpgsql security definer set search_path = '' as $$
declare s gbs.satisfactions;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.dossier_visible(p_dossier));
  if p_note is null or p_note not between 1 and 5 or length(coalesce(p_commentaire, '')) > 2000 then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if exists (select 1 from gbs.dossiers d where d.id = p_dossier and (d.statut = 'annule' or d.archive_le is not null)) then
    raise exception 'GBS_DOSSIER_FERME' using errcode = 'P0001';
  end if;
  if exists (select 1 from gbs.satisfactions x where x.dossier_id = p_dossier) then
    raise exception 'GBS_SATISFACTION_DEJA_SAISIE' using errcode = 'P0001';
  end if;
  perform gbs_private.rpc('enregistrer_satisfaction');
  insert into gbs.satisfactions (dossier_id, note, commentaire, saisie_par)
  values (p_dossier, p_note, nullif(trim(p_commentaire), ''), auth.uid()) returning * into s;
  perform gbs_private.rpc('');
  return s;
end $$;

create or replace function gbs.archiver_dossier(p_dossier uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d gbs.dossiers; duree int := coalesce(gbs_private.param_num_ou_null('archivage.duree_annees'), 10)::int;
begin
  perform gbs_private.exiger(gbs_private.is_admin(), 'GBS_VALIDATION_ADMIN');
  select * into d from gbs.dossiers where id = p_dossier for update;
  if d.id is null then raise exception 'GBS_DOSSIER_INCONNU' using errcode = 'P0002'; end if;
  if d.statut <> 'clos' or d.archive_le is not null then
    raise exception 'GBS_ARCHIVAGE_IMPOSSIBLE: seul un dossier clos et non archivé peut être archivé' using errcode = 'P0001';
  end if;
  perform gbs_private.rpc('archiver_dossier');
  update gbs.dossiers set archive_le = now() where id = p_dossier;
  perform gbs_private.rpc('');
  return jsonb_build_object('archive_le', now(), 'conserve_jusqu_au', (now() + make_interval(years => duree))::date);
end $$;

-- Dossiers à clôturer (phase de livraison ou de clôture) et dossiers clos, avec l'état des conditions.
create or replace function gbs.dossiers_cloture()
returns table (dossier_id uuid, reference text, intitule text, client text, statut text, phase_courante text,
               livre_le date, clos_le timestamptz, archive_le timestamptz, conserve_jusqu_au date,
               conditions_ok int, conditions_total int, bloquantes_manquantes int, satisfaction int)
language plpgsql stable security definer set search_path = '' as $$
declare duree int := coalesce(gbs_private.param_num_ou_null('archivage.duree_annees'), 10)::int;
begin
  perform gbs_private.exiger(gbs_private.interne());
  return query
  select d.id, d.reference, d.intitule, cl.raison_sociale, d.statut, d.phase_courante,
         (select f.reelle_fin from gbs.dossier_phases f where f.dossier_id = d.id and f.phase = 'livraison'),
         d.clos_le, d.archive_le, case when d.archive_le is not null then (d.archive_le + make_interval(years => duree))::date end,
         (select count(*)::int from gbs_private.conditions_cloture_brut(d.id) c where c.ok),
         (select count(*)::int from gbs_private.conditions_cloture_brut(d.id) c),
         (select count(*)::int from gbs_private.conditions_cloture_brut(d.id) c where c.bloquante and not c.ok),
         (select s.note from gbs.satisfactions s where s.dossier_id = d.id)
    from gbs.dossiers d join gbs.clients cl on cl.id = d.client_id
   where gbs_private.dossier_visible(d.id)
     and (d.statut = 'clos' or (d.statut = 'ouvert' and d.phase_courante in ('livraison','cloture')))
   order by d.statut desc, d.clos_le desc nulls last, d.reference
   limit 500;
end $$;

-- Productivité de l'année : par chef de dossier, puis par phase.
create or replace function gbs.productivite_chefs(p_annee int default null)
returns table (chef_id uuid, actifs int, jours_reels int, jours_cibles int, pieces_ok int, pieces_total int,
               blocages_a_temps int, blocages_resolus int, satisfaction numeric)
language plpgsql stable security definer set search_path = '' as $$
declare an int := coalesce(p_annee, extract(year from current_date)::int);
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','hub_afrique','comptable'));
  if an not between 2020 and 2100 then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  return query
  with dos as (
    select d.* from gbs.dossiers d where d.chef_id is not null and gbs_private.dossier_visible(d.id)
       and (d.statut = 'ouvert' or extract(year from coalesce(d.clos_le, d.ouvert_le)) = an)
  ), delais as (
    select dos.chef_id, e.jours_internes, e.cible from dos cross join lateral gbs_private.etat_delais_brut(dos.id) e
     where e.cible is not null and e.debut is not null and extract(year from e.debut) = an and (e.fin is not null or e.statut = 'en_cours')
  )
  select c.chef_id,
         (select count(*)::int from dos x where x.chef_id = c.chef_id and x.statut = 'ouvert'),
         (select coalesce(sum(l.jours_internes), 0)::int from delais l where l.chef_id = c.chef_id),
         (select coalesce(sum(l.cible), 0)::int from delais l where l.chef_id = c.chef_id),
         (select count(*)::int from gbs.pieces p join dos x on x.id = p.dossier_id where x.chef_id = c.chef_id and p.obligatoire and p.statut = 'validee'),
         (select count(*)::int from gbs.pieces p join dos x on x.id = p.dossier_id where x.chef_id = c.chef_id and p.obligatoire),
         (select count(*)::int from gbs.points_bloquants b join dos x on x.id = b.dossier_id
           where x.chef_id = c.chef_id and b.resolu_le is not null and extract(year from b.resolu_le) = an and b.resolu_le::date <= b.echeance),
         (select count(*)::int from gbs.points_bloquants b join dos x on x.id = b.dossier_id
           where x.chef_id = c.chef_id and b.resolu_le is not null and extract(year from b.resolu_le) = an),
         (select round(avg(s.note), 1) from gbs.satisfactions s join dos x on x.id = s.dossier_id where x.chef_id = c.chef_id)
    from (select distinct dos.chef_id from dos) c;
end $$;

create or replace function gbs.productivite_phases(p_annee int default null)
returns table (phase text, ordre int, cible_moyenne numeric, reel_moyen numeric, nombre int)
language plpgsql stable security definer set search_path = '' as $$
declare an int := coalesce(p_annee, extract(year from current_date)::int);
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','hub_afrique','comptable'));
  if an not between 2020 and 2100 then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  return query
  select e.phase, min(e.ordre)::int, round(avg(e.cible), 1), round(avg(e.jours_internes), 1), count(*)::int
    from gbs.dossiers d cross join lateral gbs_private.etat_delais_brut(d.id) e
   where gbs_private.dossier_visible(d.id) and e.cible is not null and e.fin is not null and extract(year from e.fin) = an
   group by e.phase order by min(e.ordre);
end $$;

revoke all on function gbs.conditions_cloture(uuid), gbs.enregistrer_satisfaction(uuid, int, text), gbs.archiver_dossier(uuid),
  gbs.dossiers_cloture(), gbs.productivite_chefs(int), gbs.productivite_phases(int) from public, anon;
grant execute on function gbs.conditions_cloture(uuid), gbs.enregistrer_satisfaction(uuid, int, text), gbs.archiver_dossier(uuid),
  gbs.dossiers_cloture(), gbs.productivite_chefs(int), gbs.productivite_phases(int) to authenticated;
