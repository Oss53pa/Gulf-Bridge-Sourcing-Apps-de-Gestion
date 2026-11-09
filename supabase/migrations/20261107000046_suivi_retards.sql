-- Page de suivi du client : retards par partie prenante (client, fournisseur, transport et transit, GBS, autres).
-- * Jours d'attente : attentes d'un tiers mesurées sur les phases (horloge arrêtée), en jours ouvrés
--   du calendrier de la phase. Ce sont des faits mesurés, sans détail ni nom de société.
-- * Jours d'impact : points bloquants que l'équipe a rendus visibles au client (visibilité choisie
--   point par point, section 4 bis), regroupés par partie ; la catégorie « interne » est imputée à GBS
--   et nommée comme telle. Aucun point non visible n'entre dans les totaux.

create or replace function gbs_private.partie_point_bloquant(p_categorie text) returns text
language sql immutable set search_path = '' as $$
  select case p_categorie when 'client' then 'client' when 'fournisseur' then 'fournisseur' when 'qualite' then 'fournisseur'
                          when 'logistique' then 'transport' when 'interne' then 'gbs' else 'autres' end
$$;

create or replace function gbs_private.retards_par_partie(p_dossier uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with parties(partie, ordre) as (values ('client', 1), ('fournisseur', 2), ('transport', 3), ('gbs', 4), ('autres', 5)),
  attentes as (
    select case a.tiers when 'transporteur' then 'transport' when 'autre' then 'autres' else a.tiers end as partie,
           sum(gbs_private.jours_ouvres_entre(gbs_private.pays_calendrier(f.responsable_id, d.pays), a.debut,
               least(coalesce(a.fin, current_date), current_date)))::int as jours,
           count(*) filter (where a.fin is null)::int as en_cours
      from gbs.phase_attentes a join gbs.dossier_phases f on f.id = a.phase_id join gbs.dossiers d on d.id = a.dossier_id
     where a.dossier_id = p_dossier group by 1
  ), points as (
    select gbs_private.partie_point_bloquant(b.categorie) as partie, sum(coalesce(b.impact_jours, 0))::int as jours,
           count(*) filter (where b.resolu_le is null)::int as ouverts
      from gbs.points_bloquants b where b.dossier_id = p_dossier and b.visible_client group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('partie', p.partie, 'jours_attente', coalesce(a.jours, 0), 'attente_en_cours', coalesce(a.en_cours, 0) > 0,
           'jours_impact', coalesce(x.jours, 0), 'points_ouverts', coalesce(x.ouverts, 0)) order by p.ordre), '[]'::jsonb)
    from parties p left join attentes a on a.partie = p.partie left join points x on x.partie = p.partie
$$;
revoke all on function gbs_private.retards_par_partie(uuid), gbs_private.partie_point_bloquant(text) from public, anon, authenticated;

create or replace function gbs.suivi_client(p_jeton text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l gbs.liens_suivi; d gbs.dossiers; c gbs.clients; po jsonb; max_heure int; k gbs.liens_suivi_consultations; retards jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'GBS_ACCES_REFUSE' using errcode = '42501';
  end if;
  if p_jeton is null or p_jeton !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'GBS_LIEN_INVALIDE' using errcode = 'P0002';
  end if;
  select * into l from gbs.liens_suivi where empreinte = gbs_private.empreinte_jeton(p_jeton) for update;
  if l.id is null or l.revoque_le is not null or l.expire_le <= now() then
    raise exception 'GBS_LIEN_INVALIDE' using errcode = 'P0002';
  end if;
  select * into d from gbs.dossiers where id = l.dossier_id;
  if d.statut = 'annule' then raise exception 'GBS_LIEN_INVALIDE' using errcode = 'P0002'; end if;

  -- Plafond de consultations par heure pour ce lien.
  max_heure := gbs_private.param_num('suivi.consultations_max_heure')::int;
  insert into gbs.liens_suivi_consultations (lien_id) values (l.id) on conflict (lien_id) do nothing;
  select * into k from gbs.liens_suivi_consultations where lien_id = l.id for update;
  if k.fenetre_debut is null or k.fenetre_debut < now() - interval '1 hour' then
    update gbs.liens_suivi_consultations set fenetre_debut = now(), fenetre_n = 1, consultations = consultations + 1,
           derniere = now() where lien_id = l.id;
  elsif k.fenetre_n >= max_heure then
    raise exception 'GBS_TROP_DE_CONSULTATIONS' using errcode = 'P0001';
  else
    update gbs.liens_suivi_consultations set fenetre_n = fenetre_n + 1, consultations = consultations + 1,
           derniere = now() where lien_id = l.id;
  end if;

  select * into c from gbs.clients where id = d.client_id;
  po := gbs_private.planning_ouverture_brut(d.id);
  retards := gbs_private.retards_par_partie(d.id);
  return jsonb_build_object(
    'dossier', jsonb_build_object('reference', d.reference, 'intitule', d.intitule, 'modele', d.modele,
                 'statut', d.statut, 'phase_courante', d.phase_courante, 'ouvert_le', d.ouvert_le),
    'client', jsonb_build_object('raison_sociale', c.raison_sociale, 'langue', c.langue),
    'expire_le', l.expire_le,
    'ouverture', case when d.date_ouverture_site is null then null else jsonb_build_object(
                   'date', d.date_ouverture_site, 'fin_projetee', po ->> 'fin_projetee',
                   'marge_jours_ouvres', po -> 'marge_jours_ouvres') end,
    'phases', (select coalesce(jsonb_agg(jsonb_build_object('phase', f.phase, 'ordre', f.ordre, 'statut',
                 case when f.statut in ('complete','validee') then 'terminee' when f.statut = 'non_commencee' then 'a_venir'
                      else 'en_cours' end,
                 'debut', f.reelle_debut, 'fin', f.reelle_fin, 'fin_prevue', f.prevue_fin) order by f.ordre), '[]'::jsonb)
               from gbs.dossier_phases f where f.dossier_id = d.id),
    'pieces_attendues', (select coalesce(jsonb_agg(jsonb_build_object('libelle', p.libelle, 'phase', p.phase,
                 'statut', case when p.statut in ('recue','a_verifier') then 'recue' else p.statut end,
                 'demandee_le', p.demandee_le) order by p.phase, p.libelle), '[]'::jsonb)
               from gbs.pieces p where p.dossier_id = d.id and p.fournie_par = 'client' and p.obligatoire),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('libelle', p.libelle, 'phase', p.phase,
                 'chemin', p.document_chemin, 'date', p.statut_le) order by p.statut_le), '[]'::jsonb)
               from gbs.pieces p where p.dossier_id = d.id and p.statut = 'validee' and p.document_chemin is not null
                and p.document_chemin like d.id::text || '/%'
                and gbs_private.piece_visible_client(p.code, d.mode_financier)),
    'retards', retards,
    'points_bloquants', (select coalesce(jsonb_agg(jsonb_build_object('description', b.description, 'categorie', b.categorie,
                 'partie', gbs_private.partie_point_bloquant(b.categorie), 'impact_jours', coalesce(b.impact_jours, 0),
                 'resolu', b.resolu_le is not null, 'echeance', b.echeance) order by b.cree_le), '[]'::jsonb)
               from gbs.points_bloquants b where b.dossier_id = d.id and b.visible_client),
    'expeditions', (select coalesce(jsonb_agg(jsonb_build_object('reference', e.reference, 'mode', e.mode, 'statut', e.statut,
                 'port_arrivee', e.port_arrivee, 'etd', e.etd, 'eta', e.eta,
                 'etapes', (select coalesce(jsonb_agg(jsonb_build_object('etape', s.etape, 'lieu', s.lieu, 'survenue_le', s.survenue_le,
                              'commentaire', s.commentaire) order by s.survenue_le), '[]'::jsonb)
                            from gbs.expedition_etapes s where s.expedition_id = e.id and s.visible_client))
                 order by e.cree_le), '[]'::jsonb)
               from gbs.expeditions e where e.dossier_id = d.id),
    'factures', (select coalesce(jsonb_agg(jsonb_build_object('numero', f.numero, 'objet', f.objet, 'type', f.type,
                 'date_emission', f.date_emission, 'echeance', f.echeance, 'devise', f.devise, 'ttc', f.ttc,
                 'net_a_payer', f.net_a_payer, 'encaisse', f.encaisse, 'statut', f.statut) order by f.date_emission), '[]'::jsonb)
               from gbs.factures f where f.dossier_id = d.id and f.client_id = d.client_id
                and f.statut in ('emise','partiellement_payee','payee'))
  );
end $$;

revoke execute on function gbs.suivi_client(text) from public, anon, authenticated;
grant execute on function gbs.suivi_client(text) to service_role;
