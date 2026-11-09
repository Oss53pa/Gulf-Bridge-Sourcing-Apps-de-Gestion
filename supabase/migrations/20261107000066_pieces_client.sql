-- Portail client : le client transmet lui-même les pièces attendues de lui (maquette « Espace client ·
-- actions attendues »).
-- * Pièce déposable : fournie par le client, sur un de ses dossiers ouverts, manquante, refusée ou
--   expirée. Une pièce transmise passe « reçue » et attend la vérification de l'équipe : le client ne
--   la redépose qu'après un refus ou une expiration (limite naturelle du nombre de dépôts).
-- * Le fichier passe par la fonction serveur gbs-depot (type vérifié sur les octets, taille bornée, nom
--   régénéré, empreinte). L'enregistrement de la pièce n'est exécutable que par le rôle de service,
--   après le dépôt : un compte client ne rattache jamais lui-même un chemin de fichier à une pièce.
-- * Accès vérifié en base avec la session : compte client actif en double facteur (mon_client).

-- Dossier de la pièce si le compte connecté peut la déposer (sinon refus).
create or replace function gbs.verifier_depot_piece_client(p_piece uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare c uuid := gbs_private.mon_client(); x gbs.pieces;
begin
  select * into x from gbs.pieces where id = p_piece;
  perform gbs_private.exiger(c is not null and x.id is not null and x.fournie_par = 'client'
    and x.statut in ('manquante','refusee','expiree')
    and exists (select 1 from gbs.dossiers d where d.id = x.dossier_id and d.client_id = c and d.statut = 'ouvert'));
  return x.dossier_id;
end $$;

-- Enregistrement (rôle de service, appelé par gbs-depot après stockage du fichier).
create or replace function gbs.enregistrer_piece_client(p_user uuid, p_piece uuid, p_chemin text, p_empreinte text)
returns void language plpgsql security definer set search_path = '' as $$
declare pr gbs.profils; x gbs.pieces;
begin
  select * into pr from gbs.profils where id = p_user;
  select * into x from gbs.pieces where id = p_piece for update;
  if pr.id is null or not pr.actif or pr.role is distinct from 'client' or pr.client_id is null or x.id is null
     or x.fournie_par is distinct from 'client' or x.statut not in ('manquante','refusee','expiree')
     or not exists (select 1 from gbs.dossiers d where d.id = x.dossier_id and d.client_id = pr.client_id and d.statut = 'ouvert') then
    raise exception 'GBS_ACCES_REFUSE' using errcode = '42501';
  end if;
  if p_chemin is null or not gbs_private.photos_valides(x.dossier_id, array[p_chemin])
     or p_empreinte is null or p_empreinte !~ '^[0-9a-f]{64}$' then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform gbs_private.rpc('deposer_piece');
  update gbs.pieces set document_chemin = p_chemin, document_empreinte = p_empreinte, statut = 'recue' where id = x.id;
  -- Auteur réel du dépôt (le déclencheur de statut ne connaît que la session de service).
  update gbs.pieces set statut_par = pr.id where id = x.id;
  perform gbs_private.rpc('');
end $$;

-- Espace client : pièces que le compte peut transmettre maintenant, avec leur identifiant.
create or replace function gbs.espace_client_dossier(p_dossier uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c uuid := gbs_private.mon_client();
begin
  perform gbs_private.exiger(c is not null and exists (select 1 from gbs.dossiers d where d.id = p_dossier and d.client_id = c and d.statut <> 'annule'));
  return gbs_private.contenu_dossier_client(p_dossier) || jsonb_build_object(
    'production', gbs_private.production_qualite_client(p_dossier),
    'depots', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'libelle', p.libelle, 'phase', p.phase, 'statut', p.statut) order by p.phase, p.libelle), '[]'::jsonb)
               from gbs.pieces p join gbs.dossiers d on d.id = p.dossier_id
              where p.dossier_id = p_dossier and d.statut = 'ouvert' and p.fournie_par = 'client'
                and p.statut in ('manquante','refusee','expiree')));
end $$;

revoke all on function gbs.verifier_depot_piece_client(uuid) from public, anon;
grant execute on function gbs.verifier_depot_piece_client(uuid) to authenticated;
revoke all on function gbs.enregistrer_piece_client(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function gbs.enregistrer_piece_client(uuid, uuid, text, text) to service_role;
