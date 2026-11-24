-- Mes tâches · vue « Équipe » (maquette GBS Dossiers : sélecteur Mes tâches / Équipe, réservé aux
-- responsables).
-- * Le calcul de « Mes tâches » est extrait dans une fonction privée paramétrée par la personne ;
--   gbs.mes_taches() garde exactement son comportement.
-- * gbs.taches_equipe() : réservée à l'administratrice et au Hub Afrique ; mêmes éléments pour chaque
--   membre interne actif, avec son nom, limités aux dossiers que l'appelant voit (une tâche sans dossier
--   n'apparaît qu'à l'administratrice). Lecture seule.

create or replace function gbs_private.taches_de(p_user uuid, p_visibles boolean)
returns table (nature text, objet_id uuid, dossier_id uuid, dossier_reference text, libelle text,
               echeance date, urgence int)
language plpgsql stable security definer set search_path = '' as $$
declare ph record; e record; po jsonb;
begin
  return query
    select 'tache'::text, t.id, t.dossier_id, d.reference, t.libelle, t.echeance,
           case when t.echeance < current_date then 1 when t.echeance <= current_date + 2 then 2 else 3 end
      from gbs.taches t left join gbs.dossiers d on d.id = t.dossier_id
     where t.assigne_a = p_user and t.statut in ('a_faire','en_cours')
       and (not p_visibles or (t.dossier_id is null and gbs_private.is_admin()) or (t.dossier_id is not null and gbs_private.dossier_visible(t.dossier_id)));
  return query
    select 'point_bloquant'::text, b.id, b.dossier_id, d.reference, b.description, b.echeance,
           case when b.echeance < current_date then 1 when b.echeance <= current_date + 2 then 2 else 3 end
      from gbs.points_bloquants b join gbs.dossiers d on d.id = b.dossier_id
     where b.responsable_id = p_user and b.resolu_le is null
       and (not p_visibles or gbs_private.dossier_visible(d.id));
  return query
    select 'piece'::text, p.id, p.dossier_id, d.reference, p.libelle, null::date, 2
      from gbs.pieces p join gbs.dossiers d on d.id = p.dossier_id
      join gbs.dossier_phases f on f.dossier_id = d.id and f.phase = d.phase_courante
     where d.statut = 'ouvert' and p.phase = d.phase_courante and p.obligatoire
       and p.statut in ('manquante','refusee','expiree')
       and coalesce(f.responsable_id, d.chef_id) = p_user
       and (not p_visibles or gbs_private.dossier_visible(d.id));
  for ph in select d.id, d.reference, d.phase_courante from gbs.dossiers d
              join gbs.dossier_phases f on f.dossier_id = d.id and f.phase = d.phase_courante
             where d.statut = 'ouvert' and coalesce(f.responsable_id, d.chef_id) = p_user
               and (not p_visibles or gbs_private.dossier_visible(d.id)) loop
    select * into e from gbs.etat_delais(ph.id) x where x.phase = ph.phase_courante;
    if e.voyant in ('orange','rouge') then
      nature := 'delai'; objet_id := ph.id; dossier_id := ph.id; dossier_reference := ph.reference;
      libelle := ph.phase_courante; echeance := e.echeance; urgence := case when e.voyant = 'rouge' then 1 else 2 end;
      return next;
    end if;
  end loop;
  for ph in select d.id, d.reference from gbs.dossiers d
             where d.statut = 'ouvert' and d.date_ouverture_site is not null and d.chef_id = p_user
               and (not p_visibles or gbs_private.dossier_visible(d.id)) loop
    po := gbs.planning_ouverture(ph.id);
    if (po ->> 'intenable')::boolean then
      nature := 'ouverture'; objet_id := ph.id; dossier_id := ph.id; dossier_reference := ph.reference;
      libelle := (po ->> 'marge_jours_ouvres'); echeance := (po ->> 'date_ouverture')::date; urgence := 1;
      return next;
    end if;
  end loop;
end $$;

create or replace function gbs.mes_taches()
returns table (nature text, objet_id uuid, dossier_id uuid, dossier_reference text, libelle text,
               echeance date, urgence int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.interne());
  return query select * from gbs_private.taches_de(auth.uid(), false);
end $$;

create or replace function gbs.taches_equipe()
returns table (responsable_id uuid, responsable text, nature text, objet_id uuid, dossier_id uuid, dossier_reference text,
               libelle text, echeance date, urgence int)
language plpgsql stable security definer set search_path = '' as $$
declare u record;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','hub_afrique'));
  for u in select p.id, p.nom from gbs.profils p
            where p.actif and p.role in ('admin','achats_chine','hub_afrique','agent_pays','inspecteur','comptable')
            order by p.nom loop
    return query select u.id, u.nom, x.nature, x.objet_id, x.dossier_id, x.dossier_reference, x.libelle, x.echeance, x.urgence
                   from gbs_private.taches_de(u.id, true) x;
  end loop;
end $$;

revoke all on function gbs_private.taches_de(uuid, boolean) from public, anon, authenticated;
revoke all on function gbs.mes_taches(), gbs.taches_equipe() from public, anon;
grant execute on function gbs.mes_taches(), gbs.taches_equipe() to authenticated;
