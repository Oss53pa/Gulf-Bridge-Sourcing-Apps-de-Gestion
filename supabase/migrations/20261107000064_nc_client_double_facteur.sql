-- Portail client, deux décisions validées le 09.11.2026 :
-- 1. Non-conformités : le client ne voit jamais le texte interne de l'inspecteur. Il voit un libellé
--    rédigé et publié par l'équipe qualité (admin, achats Chine) ; sans libellé publié, la
--    non-conformité n'apparaît pas dans son espace. Le libellé se retire (null) à tout moment.
-- 2. Double facteur : les comptes clients et fournisseurs n'ont accès à leur portail qu'en session
--    AAL2 (cahier des charges, section « Authentification » ; l'interface l'exigeait déjà).

alter table gbs.non_conformites
  add column libelle_client     text check (length(trim(libelle_client)) between 10 and 1000),
  add column libelle_client_par uuid references gbs.profils(id),
  add column libelle_client_le  timestamptz,
  add constraint nc_libelle_client_trace check ((libelle_client is null) = (libelle_client_par is null) and (libelle_client is null) = (libelle_client_le is null));

create or replace function gbs_private.trg_nc_libelle_client() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'nc_client' then
    if tg_op = 'INSERT' and (new.libelle_client, new.libelle_client_par, new.libelle_client_le) is distinct from (null::text, null::uuid, null::timestamptz) then
      raise exception 'GBS_VALIDATION_RPC: le libellé client se publie par publier_nc_client()' using errcode = 'P0001';
    end if;
    if tg_op = 'UPDATE' and (new.libelle_client, new.libelle_client_par, new.libelle_client_le)
       is distinct from (old.libelle_client, old.libelle_client_par, old.libelle_client_le) then
      raise exception 'GBS_VALIDATION_RPC: le libellé client se publie par publier_nc_client()' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger non_conformites_libelle_client before insert or update on gbs.non_conformites
  for each row execute function gbs_private.trg_nc_libelle_client();

create or replace function gbs.publier_nc_client(p_nc uuid, p_libelle text) returns void
language plpgsql security definer set search_path = '' as $$
declare n gbs.non_conformites; l text := nullif(trim(coalesce(p_libelle, '')), '');
begin
  select * into n from gbs.non_conformites where id = p_nc for update;
  perform gbs_private.exiger(n.id is not null and gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(n.dossier_id));
  if l is not null and length(l) not between 10 and 1000 then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform gbs_private.rpc('nc_client');
  update gbs.non_conformites set libelle_client = l,
         libelle_client_par = case when l is null then null else auth.uid() end,
         libelle_client_le = case when l is null then null else now() end
   where id = n.id;
  perform gbs_private.rpc('');
end $$;

-- Espace client : seules les non-conformités au libellé publié, sans texte interne ni correction.
create or replace function gbs_private.production_qualite_client(p_dossier uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'commandes', (select coalesce(jsonb_agg(jsonb_build_object('reference', k.reference, 'statut', k.statut,
                    'fabricant', case when d.mode_financier = 'accompagne' then f.raison_sociale_en end,
                    'produits', (select coalesce(jsonb_agg(jsonb_build_object('designation', a.designation, 'quantite', l.quantite) order by l.cree_le), '[]'::jsonb)
                                 from gbs.lignes_commande l join gbs.articles a on a.id = l.article_id where l.commande_id = k.id))
                    order by k.reference), '[]'::jsonb)
                  from gbs.commandes k join gbs.fournisseurs f on f.id = k.fournisseur_id
                 where k.dossier_id = d.id and k.statut not in ('brouillon','annulee')),
    'inspections', (select coalesce(jsonb_agg(jsonb_build_object('reference', i.reference, 'type', i.type, 'produit', i.produit,
                      'date_prevue', i.date_prevue, 'date_realisee', i.date_realisee, 'statut', i.statut,
                      'decision', case when i.statut = 'validee' then i.decision end,
                      'defauts', case when i.statut = 'validee' then jsonb_build_object('critiques', i.defauts_critiques, 'majeurs', i.defauts_majeurs, 'mineurs', i.defauts_mineurs) end)
                      order by coalesce(i.date_realisee, i.date_prevue) desc nulls last), '[]'::jsonb)
                    from gbs.inspections i where i.dossier_id = d.id),
    'non_conformites', (select coalesce(jsonb_agg(jsonb_build_object('reference', n.reference, 'gravite', n.gravite, 'libelle', n.libelle_client,
                          'statut', n.statut, 'delai', n.delai) order by n.cree_le desc), '[]'::jsonb)
                        from gbs.non_conformites n where n.dossier_id = d.id and n.libelle_client is not null))
  from gbs.dossiers d where d.id = p_dossier
$$;

-- Double facteur pour les portails : tout accès client ou fournisseur passe par ces deux fonctions.
create or replace function gbs_private.mon_client() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.client_id from gbs.profils p
   where p.id = auth.uid() and p.actif and p.role = 'client' and gbs_private.role() = 'client' and gbs_private.aal_ok()
$$;
create or replace function gbs_private.mon_fournisseur() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.fournisseur_id from gbs.profils p
   where p.id = auth.uid() and p.actif and p.role = 'fournisseur' and gbs_private.role() = 'fournisseur' and gbs_private.aal_ok()
$$;

revoke all on function gbs_private.trg_nc_libelle_client() from public, anon, authenticated;
revoke all on function gbs.publier_nc_client(uuid, text) from public, anon;
grant execute on function gbs.publier_nc_client(uuid, text) to authenticated;
