-- Échanges : messages non lus (badge de la messagerie, interne et portails).
-- * Chaque utilisateur marque un fil comme lu en l'ouvrant ; ses propres messages comptent comme lus.
-- * Le compteur ne porte que sur les fils que l'utilisateur voit (même règle que la messagerie).

create table gbs.lectures_fils (
  utilisateur_id uuid not null references gbs.profils(id),
  fil_id         uuid not null references gbs.fils_messages(id),
  lu_le          timestamptz not null default clock_timestamp(),
  primary key (utilisateur_id, fil_id)
);
alter table gbs.lectures_fils enable row level security;
grant select on gbs.lectures_fils to authenticated;
create policy lectures_fils_lecture on gbs.lectures_fils for select using (utilisateur_id = auth.uid());

create or replace function gbs.marquer_fil_lu(p_fil uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(auth.uid() is not null and gbs_private.fil_visible(p_fil));
  insert into gbs.lectures_fils (utilisateur_id, fil_id, lu_le) values (auth.uid(), p_fil, clock_timestamp())
  on conflict (utilisateur_id, fil_id) do update set lu_le = excluded.lu_le;
end $$;

-- Non lus d'un fil pour l'utilisateur connecté.
create or replace function gbs_private.non_lus_fil(p_fil uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from gbs.messages m
   where m.fil_id = p_fil and m.auteur_id <> auth.uid()
     and m.cree_le > coalesce((select l.lu_le from gbs.lectures_fils l where l.fil_id = p_fil and l.utilisateur_id = auth.uid()), '-infinity')
$$;

create or replace function gbs.messages_non_lus() returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(gbs_private.non_lus_fil(f.id)), 0)::int from gbs.fils_messages f
   where auth.uid() is not null and gbs_private.fil_visible(f.id)
$$;

-- Liste des fils avec le nombre de non lus (remplace la version de la migration 60). L'ancienne version
-- est renommée et privée de tout droit (pas de suppression : aucune donnée en jeu, historique conservé).
alter function gbs.mes_fils(int) rename to mes_fils_v60;
revoke all on function gbs.mes_fils_v60(int) from public, anon, authenticated;
create function gbs.mes_fils(p_limite int default 100)
returns table (id uuid, audience text, sujet text, categorie text, reference text, dernier_message_le timestamptz, dernier_auteur text, dernier_extrait text, non_lus int)
language sql stable security definer set search_path = '' as $$
  select f.id, f.audience, f.sujet, f.categorie,
         case when f.audience = 'fournisseur' then (select k.reference from gbs.commandes k where k.id = f.commande_id)
              else (select d.reference from gbs.dossiers d where d.id = f.dossier_id) end,
         f.dernier_message_le,
         (select p.nom from gbs.messages m join gbs.profils p on p.id = m.auteur_id where m.fil_id = f.id order by m.cree_le desc limit 1),
         (select left(m.corps, 160) from gbs.messages m where m.fil_id = f.id order by m.cree_le desc limit 1),
         gbs_private.non_lus_fil(f.id)
    from gbs.fils_messages f
   where gbs_private.fil_visible(f.id)
   order by f.dernier_message_le desc
   limit least(greatest(coalesce(p_limite, 100), 1), 500)
$$;

revoke all on function gbs_private.non_lus_fil(uuid) from public, anon, authenticated;
revoke all on function gbs.marquer_fil_lu(uuid), gbs.messages_non_lus(), gbs.mes_fils(int) from public, anon;
grant execute on function gbs.marquer_fil_lu(uuid), gbs.messages_non_lus(), gbs.mes_fils(int) to authenticated;
