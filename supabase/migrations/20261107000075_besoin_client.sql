-- Guide d'expression du besoin ouvert au client (cahier des charges M31, lot 1 ; maquette « Portails »).
-- * Le client (compte en double facteur, dossier à lui, non annulé) remplit son besoin, le soumet et
--   répond aux questions de l'équipe, champ par champ ; mêmes contrôles en base que pour l'équipe.
-- * Sous-rôles : demandeur, technique et valideur ; le sous-rôle finance ne voit pas le besoin.
-- * La création du besoin et sa validation sur cahier des charges signé restent à l'équipe.
-- * gbs.besoin_detail : lecture unique (besoin, état, questions, versions) pour l'équipe et le client.

create or replace function gbs_private.besoin_client_ok(b gbs.besoins) returns boolean
language sql stable security definer set search_path = '' as $$
  select b.id is not null and gbs_private.mon_client() is not null
     and (gbs_private.profil()).sous_role in ('demandeur','technique','valideur')
     and exists (select 1 from gbs.dossiers d where d.id = b.dossier_id and d.client_id = gbs_private.mon_client() and d.statut <> 'annule')
$$;

-- Rédaction (réponses, soumission, réponses aux questions) : équipe commerciale du dossier ou client.
create or replace function gbs_private.besoin_redigeable(b gbs.besoins) returns boolean
language sql stable security definer set search_path = '' as $$
  select b.id is not null and (
    (gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.dossier_visible(b.dossier_id))
    or gbs_private.besoin_client_ok(b))
$$;

create or replace function gbs.etat_besoin(p_besoin uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare b gbs.besoins;
begin
  select * into b from gbs.besoins where id = p_besoin;
  perform gbs_private.exiger(b.id is not null and ((gbs_private.interne() and gbs_private.dossier_visible(b.dossier_id)) or gbs_private.besoin_client_ok(b)));
  return gbs_private.etat_besoin(b) || jsonb_build_object('etapes_definition', gbs_private.etapes_besoin(b.tronc_id, b.questionnaire_id));
end $$;

-- Détail d'un besoin : réponses, état, questions (avec le nom de l'auteur) et versions soumises.
create or replace function gbs.besoin_detail(p_besoin uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare b gbs.besoins;
begin
  select * into b from gbs.besoins where id = p_besoin;
  perform gbs_private.exiger(b.id is not null and ((gbs_private.interne() and gbs_private.dossier_visible(b.dossier_id)) or gbs_private.besoin_client_ok(b)));
  return jsonb_build_object(
    'besoin', jsonb_build_object('id', b.id, 'dossier_id', b.dossier_id, 'categorie', b.categorie, 'statut', b.statut, 'version', b.version,
      'reponses', b.reponses, 'pays', b.pays, 'soumis_le', b.soumis_le, 'valide_le', b.valide_le, 'signe_le', b.signe_le,
      'categorie_libelle', (select q.libelle from gbs.questionnaires_besoin q where q.id = coalesce(b.questionnaire_id, b.tronc_id))),
    'etat', gbs_private.etat_besoin(b) || jsonb_build_object('etapes_definition', gbs_private.etapes_besoin(b.tronc_id, b.questionnaire_id)),
    'questions', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'champ', q.champ, 'question', q.question, 'auteur', p.nom,
                    'cree_le', q.cree_le, 'reponse', q.reponse, 'repondu_le', q.repondu_le) order by q.cree_le), '[]'::jsonb)
                  from gbs.besoins_questions q left join gbs.profils p on p.id = q.auteur_id where q.besoin_id = b.id),
    'versions', (select coalesce(jsonb_agg(jsonb_build_object('version', v.version, 'cree_le', v.cree_le) order by v.version desc), '[]'::jsonb)
                 from gbs.besoins_versions v where v.besoin_id = b.id));
end $$;

-- Espace client : besoins d'un dossier à lui.
create or replace function gbs.besoins_client(p_dossier uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c uuid := gbs_private.mon_client();
begin
  perform gbs_private.exiger(c is not null and (gbs_private.profil()).sous_role in ('demandeur','technique','valideur')
    and exists (select 1 from gbs.dossiers d where d.id = p_dossier and d.client_id = c and d.statut <> 'annule'));
  return (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'categorie', b.categorie, 'statut', b.statut, 'version', b.version,
            'completude', gbs_private.etat_besoin(b) -> 'completude',
            'questions_ouvertes', (select count(*) from gbs.besoins_questions q where q.besoin_id = b.id and q.reponse is null)) order by b.cree_le), '[]'::jsonb)
            from gbs.besoins b where b.dossier_id = p_dossier);
end $$;

revoke all on function gbs_private.besoin_client_ok(gbs.besoins), gbs_private.besoin_redigeable(gbs.besoins) from public, anon, authenticated;
revoke all on function gbs.besoin_detail(uuid), gbs.besoins_client(uuid) from public, anon;
grant execute on function gbs.besoin_detail(uuid), gbs.besoins_client(uuid) to authenticated;
