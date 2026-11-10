-- Calendrier des fermetures d'usines (cahier des charges M7, lot 0 ; maquette « Achats Chine · FRM ») :
-- Nouvel An chinois, Golden Week, maintenance, inventaire, avec alerte sur les délais promis.
-- * Une fermeture vaut pour toutes les usines (fournisseur vide) ou pour un fournisseur ; 120 jours au plus.
-- * Saisie et annulation (motivée, journalisée) par l'administratrice et les achats Chine, seuls à lire
--   les commandes ; une fermeture ne se modifie pas et ne se supprime pas : on l'annule et on la ressaisit.
-- * Commandes touchées : commandes non terminées (brouillon, contrat signé, en production) dont la période
--   de production, de la signature du contrat (à défaut la création) à la livraison promise, chevauche
--   une fermeture non annulée de leur usine. Le chevauchement est compté en jours calendaires.

create table gbs.fermetures_usines (
  id               uuid primary key default gen_random_uuid(),
  fournisseur_id   uuid references gbs.fournisseurs(id),
  motif            text not null check (length(motif) between 3 and 160),
  du               date not null,
  au               date not null,
  cree_par         uuid references gbs.profils(id),
  cree_le          timestamptz not null default now(),
  annulee_le       timestamptz,
  annulee_par      uuid references gbs.profils(id),
  motif_annulation text check (length(motif_annulation) <= 1000),
  check (au >= du and au - du < 120),
  check ((annulee_le is null) = (annulee_par is null) and (annulee_le is null) = (motif_annulation is null))
);
create index on gbs.fermetures_usines (du, au) where annulee_le is null;

create or replace function gbs_private.trg_fermeture_rpc() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'fermeture_usine' then
    raise exception 'GBS_VALIDATION_RPC: les fermetures d''usines passent par les fonctions dédiées' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and old.annulee_le is not null then raise exception 'GBS_DEMANDE_TRAITEE' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'annulee_le' - 'annulee_par' - 'motif_annulation')
                          is distinct from (to_jsonb(old) - 'annulee_le' - 'annulee_par' - 'motif_annulation') then
    raise exception 'GBS_VALIDATION_RPC: une fermeture ne se modifie pas' using errcode = 'P0001';
  end if;
  return new;
end $$;

alter table gbs.fermetures_usines enable row level security;
grant select on gbs.fermetures_usines to authenticated;
create trigger fermetures_rpc before insert or update on gbs.fermetures_usines for each row execute function gbs_private.trg_fermeture_rpc();
create trigger fermetures_audit after insert or update on gbs.fermetures_usines for each row execute function gbs_private.trg_audit();
create trigger fermetures_nodel before delete on gbs.fermetures_usines for each row execute function gbs_private.trg_no_delete();
create policy fermetures_lecture on gbs.fermetures_usines for select using (gbs_private.has_role('admin','achats_chine'));

create or replace function gbs.ajouter_fermeture_usine(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r uuid; f uuid; d1 date; d2 date;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine'));
  if jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) k where k not in ('fournisseur_id','motif','du','au'))
     or coalesce(jsonb_typeof(p -> 'motif'), '') <> 'string'
     or coalesce(jsonb_typeof(p -> 'du'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'au'), '') <> 'string'
     or (p ? 'fournisseur_id' and jsonb_typeof(p -> 'fournisseur_id') not in ('string','null')) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  f := nullif(p ->> 'fournisseur_id', '')::uuid;
  d1 := (p ->> 'du')::date; d2 := (p ->> 'au')::date;
  -- Pas de saisie rétroactive au-delà d'un an, ni de projection au-delà de deux ans.
  if (f is not null and not exists (select 1 from gbs.fournisseurs x where x.id = f))
     or d1 < current_date - 365 or d2 > current_date + 730 then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform gbs_private.rpc('fermeture_usine');
  insert into gbs.fermetures_usines (fournisseur_id, motif, du, au, cree_par)
  values (f, trim(p ->> 'motif'), d1, d2, auth.uid()) returning id into r;
  perform gbs_private.rpc('');
  return r;
exception
  when check_violation or not_null_violation or invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

create or replace function gbs.annuler_fermeture_usine(p_fermeture uuid, p_motif text) returns void
language plpgsql security definer set search_path = '' as $$
declare x gbs.fermetures_usines;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine'));
  select * into x from gbs.fermetures_usines where id = p_fermeture for update;
  if x.id is null then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  if x.annulee_le is not null then raise exception 'GBS_DEMANDE_TRAITEE' using errcode = 'P0001'; end if;
  perform gbs_private.motif(p_motif);
  perform gbs_private.rpc('fermeture_usine');
  update gbs.fermetures_usines set annulee_le = now(), annulee_par = auth.uid(), motif_annulation = trim(p_motif) where id = x.id;
  perform gbs_private.rpc('');
  perform gbs_private.journaliser('fermeture_usine_annulee', 'fermetures_usines', x.id::text, null, null, null, trim(p_motif));
end $$;

-- Commandes dont la production chevauche une fermeture non annulée (passée ou à venir).
create or replace function gbs.commandes_fermetures()
returns table (fermeture_id uuid, motif text, du date, au date, commande_id uuid, commande_reference text, dossier_id uuid, dossier_reference text,
               fournisseur text, statut text, debut_production date, livraison_promise date, jours_chevauches int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine'));
  return query
    select f.id, f.motif, f.du, f.au, k.id, k.reference, d.id, d.reference, s.raison_sociale_en, k.statut,
           coalesce(k.contrat_signe_le, k.cree_le::date), k.date_livraison_promise,
           (least(f.au, k.date_livraison_promise) - greatest(f.du, coalesce(k.contrat_signe_le, k.cree_le::date)) + 1)::int
      from gbs.fermetures_usines f
      join gbs.commandes k on (f.fournisseur_id is null or f.fournisseur_id = k.fournisseur_id)
      join gbs.dossiers d on d.id = k.dossier_id
      join gbs.fournisseurs s on s.id = k.fournisseur_id
     where f.annulee_le is null and k.statut in ('brouillon','contrat_signe','en_production')
       and k.date_livraison_promise is not null
       and f.du <= k.date_livraison_promise and f.au >= coalesce(k.contrat_signe_le, k.cree_le::date)
     order by f.du, k.reference;
end $$;

revoke all on function gbs_private.trg_fermeture_rpc() from public, anon, authenticated;
revoke all on function gbs.ajouter_fermeture_usine(jsonb), gbs.annuler_fermeture_usine(uuid, text), gbs.commandes_fermetures() from public, anon;
grant execute on function gbs.ajouter_fermeture_usine(jsonb), gbs.annuler_fermeture_usine(uuid, text), gbs.commandes_fermetures() to authenticated;
