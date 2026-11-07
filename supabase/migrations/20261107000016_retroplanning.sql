-- Lot 1, M33 : planning à rebours depuis la date d'ouverture du site.
-- Les phases précédant la clôture doivent être terminées à la date d'ouverture ;
-- chacune dure son délai cible, en jours ouvrés du pays de la personne qui agit.
-- La projection part de l'état réel (phases terminées, jours internes consommés)
-- et donne l'avance ou le retard sur la date d'ouverture, en jours ouvrés du pays
-- du dossier ; l'alerte se lève dès que la date devient intenable.

create or replace function gbs.planning_ouverture(p_dossier uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d gbs.dossiers; e record; retro jsonb := '{}'::jsonb; phases jsonb := '[]'::jsonb;
        manquantes text[]; fin date; debut date; proj_debut date; proj_fin date := null;
        projection_possible boolean := true; marge int; projete date;
begin
  perform gbs_private.exiger(gbs_private.interne() and gbs_private.dossier_visible(p_dossier));
  select * into d from gbs.dossiers where id = p_dossier;
  if d.date_ouverture_site is null then
    return jsonb_build_object('date_ouverture', null);
  end if;

  select coalesce(array_agg(x.phase order by x.ordre), '{}') into manquantes
    from gbs.etat_delais(p_dossier) x where x.phase <> 'cloture' and x.cible is null;

  -- 1. À rebours : fin au plus tard de chaque phase, de l'ouverture vers le début.
  if cardinality(manquantes) = 0 then
    fin := d.date_ouverture_site;
    for e in select * from gbs.etat_delais(p_dossier) x where x.phase <> 'cloture' order by x.ordre desc loop
      debut := gbs_private.decaler_jours_ouvres(e.pays_calendrier, fin, -e.cible);
      retro := retro || jsonb_build_object(e.phase, jsonb_build_object('debut', debut, 'fin', fin));
      fin := debut;
    end loop;
  end if;

  -- 2. Projection : de l'état réel vers l'ouverture.
  for e in select * from gbs.etat_delais(p_dossier) x where x.phase <> 'cloture' order by x.ordre loop
    proj_debut := null;
    if e.statut in ('complete','validee') then
      proj_debut := e.debut; proj_fin := coalesce(e.fin, proj_fin);
    elsif not projection_possible or e.cible is null then
      projection_possible := false; proj_fin := null;
    elsif e.debut is not null then
      -- Phase en cours : reste du délai cible à partir d'aujourd'hui.
      proj_debut := e.debut;
      proj_fin := gbs_private.ajouter_jours_ouvres(e.pays_calendrier, greatest(current_date, e.debut),
                                                   greatest(e.cible - coalesce(e.jours_internes, 0), 0));
    else
      proj_debut := coalesce(proj_fin, current_date);
      proj_fin := gbs_private.ajouter_jours_ouvres(e.pays_calendrier, proj_debut, e.cible);
    end if;
    phases := phases || jsonb_build_array(jsonb_build_object(
      'phase', e.phase, 'ordre', e.ordre, 'statut', e.statut, 'cible', e.cible, 'pays_calendrier', e.pays_calendrier,
      'debut_au_plus_tard', retro -> e.phase ->> 'debut', 'fin_au_plus_tard', retro -> e.phase ->> 'fin',
      'debut_projete', proj_debut, 'fin_projetee', case when projection_possible then proj_fin end,
      'en_retard', projection_possible and proj_fin is not null and retro ? e.phase
                   and proj_fin > (retro -> e.phase ->> 'fin')::date));
  end loop;

  projete := case when projection_possible then proj_fin end;
  if projete is not null then
    marge := case when projete <= d.date_ouverture_site
                  then gbs_private.jours_ouvres_entre(d.pays, projete, d.date_ouverture_site)
                  else -gbs_private.jours_ouvres_entre(d.pays, d.date_ouverture_site, projete) end;
  end if;
  return jsonb_build_object(
    'date_ouverture', d.date_ouverture_site,
    'cibles_manquantes', to_jsonb(manquantes),
    'debut_au_plus_tard', (select min((v ->> 'debut')::date) from jsonb_each(retro) as j(k, v)),
    'fin_projetee', projete,
    'marge_jours_ouvres', marge,
    'intenable', marge is not null and marge < 0,
    'phases', phases);
end $$;

-- Recopie du planning à rebours dans les dates prévues des phases non terminées.
create or replace function gbs.appliquer_planning_ouverture(p_dossier uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare p jsonb; ph jsonb; n int := 0; k int;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine','hub_afrique')
                             and gbs_private.dossier_visible(p_dossier));
  p := gbs.planning_ouverture(p_dossier);
  if p ->> 'date_ouverture' is null then
    raise exception 'GBS_DATE_OUVERTURE_ABSENTE' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p -> 'cibles_manquantes') > 0 then
    raise exception 'GBS_DELAIS_CIBLES_MANQUANTS: %', (select string_agg(x, ', ') from jsonb_array_elements_text(p -> 'cibles_manquantes') x)
      using errcode = 'P0001';
  end if;
  for ph in select value from jsonb_array_elements(p -> 'phases') loop
    update gbs.dossier_phases set prevue_debut = (ph ->> 'debut_au_plus_tard')::date, prevue_fin = (ph ->> 'fin_au_plus_tard')::date
     where dossier_id = p_dossier and phase = ph ->> 'phase' and statut not in ('complete','validee');
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  return n;
end $$;

-- « Mes tâches » : ajout de l'alerte d'ouverture intenable pour le chef de dossier.
create or replace function gbs.mes_taches()
returns table (nature text, objet_id uuid, dossier_id uuid, dossier_reference text, libelle text,
               echeance date, urgence int)
language plpgsql stable security definer set search_path = '' as $$
declare moi uuid := auth.uid(); ph record; e record; po jsonb;
begin
  perform gbs_private.exiger(gbs_private.interne());
  return query
    select 'tache'::text, t.id, t.dossier_id, d.reference, t.libelle, t.echeance,
           case when t.echeance < current_date then 1 when t.echeance <= current_date + 2 then 2 else 3 end
      from gbs.taches t left join gbs.dossiers d on d.id = t.dossier_id
     where t.assigne_a = moi and t.statut in ('a_faire','en_cours');
  return query
    select 'point_bloquant'::text, b.id, b.dossier_id, d.reference, b.description, b.echeance,
           case when b.echeance < current_date then 1 when b.echeance <= current_date + 2 then 2 else 3 end
      from gbs.points_bloquants b join gbs.dossiers d on d.id = b.dossier_id
     where b.responsable_id = moi and b.resolu_le is null;
  return query
    select 'piece'::text, p.id, p.dossier_id, d.reference, p.libelle, null::date, 2
      from gbs.pieces p join gbs.dossiers d on d.id = p.dossier_id
      join gbs.dossier_phases f on f.dossier_id = d.id and f.phase = d.phase_courante
     where d.statut = 'ouvert' and p.phase = d.phase_courante and p.obligatoire
       and p.statut in ('manquante','refusee','expiree')
       and coalesce(f.responsable_id, d.chef_id) = moi;
  for ph in select d.id, d.reference, d.phase_courante from gbs.dossiers d
              join gbs.dossier_phases f on f.dossier_id = d.id and f.phase = d.phase_courante
             where d.statut = 'ouvert' and coalesce(f.responsable_id, d.chef_id) = moi loop
    select * into e from gbs.etat_delais(ph.id) x where x.phase = ph.phase_courante;
    if e.voyant in ('orange','rouge') then
      nature := 'delai'; objet_id := ph.id; dossier_id := ph.id; dossier_reference := ph.reference;
      libelle := ph.phase_courante; echeance := e.echeance; urgence := case when e.voyant = 'rouge' then 1 else 2 end;
      return next;
    end if;
  end loop;
  for ph in select d.id, d.reference from gbs.dossiers d
             where d.statut = 'ouvert' and d.date_ouverture_site is not null and d.chef_id = moi loop
    po := gbs.planning_ouverture(ph.id);
    if (po ->> 'intenable')::boolean then
      nature := 'ouverture'; objet_id := ph.id; dossier_id := ph.id; dossier_reference := ph.reference;
      libelle := (po ->> 'marge_jours_ouvres'); echeance := (po ->> 'date_ouverture')::date; urgence := 1;
      return next;
    end if;
  end loop;
end $$;

revoke execute on function gbs.planning_ouverture(uuid), gbs.appliquer_planning_ouverture(uuid) from public;
grant execute on function gbs.planning_ouverture(uuid), gbs.appliquer_planning_ouverture(uuid) to authenticated;
