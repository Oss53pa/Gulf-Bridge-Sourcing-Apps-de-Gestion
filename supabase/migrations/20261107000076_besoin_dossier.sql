-- Relier le guide d'expression du besoin au dossier.
-- * La validation du besoin sur cahier des charges signé renseigne la pièce exigée « Cahier des charges du
--   client validé et signé » (phase Consultation) avec le même document, validée par la même personne :
--   plus de double dépôt. Une pièce déjà validée avec un autre document n'est pas écrasée.
-- * Un besoin soumis devient un élément de « Mes tâches » du responsable de la phase Consultation (à défaut
--   le chef de dossier), à relire dans le délai paramétré « besoin.delai_relecture_jours » ; en retard au-delà.

insert into gbs.parametres_definitions (cle, type, minimum, maximum, validateur, module, libelle) values
  ('besoin.delai_relecture_jours', 'entier', 0, 60, null, 'commercial', 'Relecture d''un besoin soumis : délai (jours calendaires)');
insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('besoin.delai_relecture_jours', '2', date '2026-01-01', 'Relire un besoin soumis sous deux jours');

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
  -- Besoin soumis par le client ou l'équipe : à relire par le responsable de la phase (à défaut le chef).
  return query
    select 'besoin'::text, b.id, b.dossier_id, d.reference, b.categorie, (b.soumis_le at time zone 'UTC')::date + gbs_private.param_num('besoin.delai_relecture_jours')::int,
           case when (b.soumis_le at time zone 'UTC')::date + gbs_private.param_num('besoin.delai_relecture_jours')::int < current_date then 1 else 2 end
      from gbs.besoins b join gbs.dossiers d on d.id = b.dossier_id
      left join gbs.dossier_phases f on f.dossier_id = d.id and f.phase = 'consultation'
     where b.statut = 'soumis' and d.statut = 'ouvert' and coalesce(f.responsable_id, d.chef_id) = p_user
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


create or replace function gbs.valider_besoin(p_besoin uuid, p_document text, p_signe_le date) returns void
language plpgsql security definer set search_path = '' as $$
declare b gbs.besoins; pc gbs.pieces;
begin
  select * into b from gbs.besoins where id = p_besoin for update;
  perform gbs_private.exiger(b.id is not null and gbs_private.has_role('admin','hub_afrique') and gbs_private.dossier_visible(b.dossier_id));
  if b.statut <> 'soumis' then raise exception 'GBS_BESOIN_NON_SOUMIS' using errcode = 'P0001'; end if;
  if exists (select 1 from gbs.besoins_questions q where q.besoin_id = b.id and q.reponse is null) then
    raise exception 'GBS_QUESTIONS_OUVERTES' using errcode = 'P0001';
  end if;
  if p_document is null or p_document !~ '^[A-Za-z0-9/_.-]+$' or length(p_document) not between 3 and 400 or p_document ~ '\.\.' or p_signe_le is null
     or not gbs_private.photos_valides(b.dossier_id, array[p_document])
     or p_signe_le > current_date or p_signe_le < b.soumis_le::date then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform gbs_private.rpc('besoin');
  update gbs.besoins set statut = 'valide', valide_le = now(), valide_par = auth.uid(), document_signe = p_document, signe_le = p_signe_le where id = b.id;
  perform gbs_private.rpc('');
  select * into pc from gbs.pieces where dossier_id = b.dossier_id and code = 'client_cdc_signe' and commande_id is null and expedition_id is null for update;
  if pc.id is not null and pc.statut <> 'validee' then
    perform gbs_private.rpc('deposer_piece');
    update gbs.pieces set document_chemin = p_document, document_empreinte = null, statut = 'validee',
           commentaire = 'Besoin validé, version ' || b.version where id = pc.id;
    perform gbs_private.rpc('');
  end if;
  perform gbs_private.journaliser('besoin_valide', 'besoins', b.id::text, b.dossier_id, null,
    jsonb_build_object('version', b.version, 'document', p_document, 'signe_le', p_signe_le, 'piece', pc.id), null);
end $$;
