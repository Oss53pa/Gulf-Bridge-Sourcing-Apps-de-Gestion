-- Lot 1, M27 : non-conformités et actions correctives.
-- Cycle : ouverte → correction exigée (texte, délai) → corrigée (preuve, photos) → close.
-- La clôture d'une non-conformité critique ou majeure (paramètre daté) exige une
-- contre-inspection réalisée après la correction et dont la décision proposée est
-- l'acceptation. Le statut ne change que par les fonctions dédiées. Une non-conformité
-- ouverte bloque toujours la validation de son inspection (lot 0).
-- Impact fournisseur : note qualité sur 12 mois glissants, pénalités par gravité
-- (paramètre daté), majorées si la correction dépasse le délai.

alter table gbs.non_conformites
  add column constat_id      uuid references gbs.constats(id),
  add column fournisseur_id  uuid references gbs.fournisseurs(id),
  add column photos          text[] not null default '{}' check (cardinality(photos) <= 20),
  add column correction_exigee_le timestamptz,
  add column preuve          text check (length(preuve) <= 4000),
  add column photos_correction text[] not null default '{}' check (cardinality(photos_correction) <= 20),
  add column corrigee_le     timestamptz,
  add column contre_inspection_id uuid references gbs.inspections(id),
  add column motif_cloture   text check (length(motif_cloture) <= 1000),
  add column hors_delai      boolean;
create index on gbs.non_conformites (fournisseur_id, cree_le);
create index on gbs.non_conformites (statut, delai);

-- Non-conformités existantes (avant les nouvelles règles) : fournisseur renseigné depuis la commande.
update gbs.non_conformites n set fournisseur_id = c.fournisseur_id
  from gbs.commandes c where c.id = n.commande_id and n.fournisseur_id is null;

insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('nc.contre_inspection_requise', '["critique","majeur"]', date '2026-01-01',
   'Gravités dont la clôture exige une contre-inspection acceptée'),
  ('nc.penalites', '{"critique":20,"majeur":8,"mineur":2,"majoration_retard":1.5}', date '2026-01-01',
   'Points retirés à la note qualité du fournisseur (sur 100) par non-conformité sur 12 mois');

-- Photos : fichiers du dossier déposés par gbs-depot (type vérifié sur les octets, nom régénéré).
create or replace function gbs_private.photos_valides(p_dossier uuid, p text[]) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(bool_and(x ~ ('^' || p_dossier::text || '/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$')), true)
    from unnest(p) x
$$;

create or replace function gbs_private.trg_nc() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int; rpc text := coalesce(current_setting('gbs.rpc', true), ''); k gbs.constats;
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(7314);
    select coalesce(max(substring(reference from '-([0-9]+)$')::int), 0) + 1 into n
      from gbs.non_conformites where reference like 'NC-' || extract(year from now())::int || '-%';
    new.reference := 'NC-' || extract(year from now())::int || '-' || lpad(n::text, 3, '0');
    if new.inspection_id is not null then
      select i.dossier_id, i.commande_id into new.dossier_id, new.commande_id
        from gbs.inspections i where i.id = new.inspection_id;
    end if;
    if new.constat_id is not null then
      select * into k from gbs.constats where id = new.constat_id;
      if k.inspection_id is distinct from new.inspection_id then
        raise exception 'GBS_CONSTAT_INVALIDE' using errcode = '22023';
      end if;
    end if;
    new.fournisseur_id := (select c.fournisseur_id from gbs.commandes c where c.id = new.commande_id);
    -- À la création : ouverte, sans correction ni clôture.
    if new.statut <> 'ouverte' or new.correction is not null or new.preuve is not null or new.corrigee_le is not null
       or new.contre_inspection_id is not null or new.close_le is not null or new.close_par is not null
       or new.motif_cloture is not null or new.hors_delai is not null or new.correction_exigee_le is not null
       or cardinality(new.photos_correction) > 0 then
      raise exception 'GBS_VALIDATION_RPC: la non-conformité s''ouvre, puis suit son cycle par les fonctions dédiées' using errcode = 'P0001';
    end if;
    if new.delai is not null and new.delai < current_date then
      raise exception 'GBS_DELAI_INVALIDE' using errcode = '22023';
    end if;
  else
    if (new.reference, new.dossier_id, new.inspection_id, new.commande_id, new.constat_id, new.fournisseur_id, new.gravite)
       is distinct from (old.reference, old.dossier_id, old.inspection_id, old.commande_id, old.constat_id, old.fournisseur_id, old.gravite) then
      raise exception 'GBS_NC_FIGEE: l''origine et la gravité d''une non-conformité ne se modifient pas' using errcode = 'P0001';
    end if;
    if rpc <> 'nc' and (new.statut, new.correction, new.delai, new.correction_exigee_le, new.preuve, new.photos_correction,
                        new.corrigee_le, new.contre_inspection_id, new.close_le, new.close_par, new.motif_cloture, new.hors_delai)
       is distinct from (old.statut, old.correction, old.delai, old.correction_exigee_le, old.preuve, old.photos_correction,
                         old.corrigee_le, old.contre_inspection_id, old.close_le, old.close_par, old.motif_cloture, old.hors_delai) then
      raise exception 'GBS_VALIDATION_RPC: le cycle de la non-conformité passe par les fonctions dédiées' using errcode = 'P0001';
    end if;
    if old.statut = 'close' and rpc <> 'nc' then
      raise exception 'GBS_DOCUMENT_VALIDE: non-conformité close' using errcode = 'P0001';
    end if;
  end if;
  if not gbs_private.photos_valides(new.dossier_id, new.photos)
     or not gbs_private.photos_valides(new.dossier_id, new.photos_correction) then
    raise exception 'GBS_PHOTOS_INVALIDES' using errcode = '22023';
  end if;
  return new;
end $$;

-- Correction exigée du fournisseur, avec délai.
create or replace function gbs.exiger_correction_nc(p_nc uuid, p_correction text, p_delai date)
returns gbs.non_conformites language plpgsql security definer set search_path = '' as $$
declare x gbs.non_conformites; c text := trim(coalesce(p_correction, ''));
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine'));
  select * into x from gbs.non_conformites where id = p_nc for update;
  perform gbs_private.exiger(x.id is not null and gbs_private.dossier_visible(x.dossier_id));
  if x.statut <> 'ouverte' then raise exception 'GBS_NC_STATUT' using errcode = 'P0001'; end if;
  if length(c) not between 10 and 4000 then raise exception 'GBS_CORRECTION_INVALIDE' using errcode = '22023'; end if;
  if p_delai is null or p_delai < current_date or p_delai > current_date + 365 then
    raise exception 'GBS_DELAI_INVALIDE' using errcode = '22023';
  end if;
  perform set_config('gbs.rpc', 'nc', true);
  update gbs.non_conformites set correction = c, delai = p_delai, correction_exigee_le = now()
   where id = p_nc returning * into x;
  perform set_config('gbs.rpc', '', true);
  return x;
end $$;

-- Correction déclarée (pour le fournisseur, en attendant son portail) : preuve et photos.
create or replace function gbs.declarer_correction_nc(p_nc uuid, p_preuve text, p_photos text[] default '{}')
returns gbs.non_conformites language plpgsql security definer set search_path = '' as $$
declare x gbs.non_conformites; pr text := trim(coalesce(p_preuve, ''));
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine'));
  select * into x from gbs.non_conformites where id = p_nc for update;
  perform gbs_private.exiger(x.id is not null and gbs_private.dossier_visible(x.dossier_id));
  if x.statut <> 'ouverte' or x.correction is null then
    raise exception 'GBS_NC_STATUT: exigez d''abord la correction' using errcode = 'P0001';
  end if;
  if length(pr) not between 10 and 4000 then raise exception 'GBS_PREUVE_INVALIDE' using errcode = '22023'; end if;
  perform set_config('gbs.rpc', 'nc', true);
  update gbs.non_conformites set statut = 'corrigee', preuve = pr, photos_correction = coalesce(p_photos, '{}'),
         corrigee_le = now()
   where id = p_nc returning * into x;
  perform set_config('gbs.rpc', '', true);
  return x;
end $$;

-- Clôture : correction déclarée ; contre-inspection acceptée pour les gravités qui l'exigent.
create or replace function gbs.clore_nc(p_nc uuid, p_contre_inspection uuid default null, p_motif text default null)
returns gbs.non_conformites language plpgsql security definer set search_path = '' as $$
declare x gbs.non_conformites; ci gbs.inspections; requise boolean;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine'));
  select * into x from gbs.non_conformites where id = p_nc for update;
  perform gbs_private.exiger(x.id is not null and gbs_private.dossier_visible(x.dossier_id));
  if x.statut <> 'corrigee' then raise exception 'GBS_NC_STATUT: la correction n''est pas déclarée' using errcode = 'P0001'; end if;
  requise := coalesce(gbs_private.param('nc.contre_inspection_requise') ? x.gravite, true);
  if p_contre_inspection is not null then
    select * into ci from gbs.inspections where id = p_contre_inspection;
    if ci.id is null or ci.id = x.inspection_id or ci.dossier_id <> x.dossier_id
       or (x.commande_id is not null and ci.commande_id is distinct from x.commande_id)
       or ci.type not in ('contre_inspection','inspection_seule')
       or ci.statut not in ('realisee','validee') or ci.date_realisee is null
       or ci.date_realisee < x.corrigee_le::date then
      raise exception 'GBS_CONTRE_INSPECTION_INVALIDE' using errcode = '22023';
    end if;
    if ci.decision_proposee <> 'acceptee' then
      raise exception 'GBS_CONTRE_INSPECTION_REFUSEE: la contre-inspection ne confirme pas la correction' using errcode = 'P0001';
    end if;
  elsif requise then
    raise exception 'GBS_CONTRE_INSPECTION_REQUISE' using errcode = 'P0001';
  end if;
  if p_motif is not null and length(trim(p_motif)) > 1000 then raise exception 'GBS_MOTIF_INVALIDE' using errcode = '22023'; end if;
  perform set_config('gbs.rpc', 'nc', true);
  update gbs.non_conformites set statut = 'close', contre_inspection_id = p_contre_inspection,
         motif_cloture = nullif(trim(coalesce(p_motif, '')), ''), close_le = now(), close_par = auth.uid(),
         hors_delai = x.delai is not null and x.corrigee_le::date > x.delai
   where id = p_nc returning * into x;
  perform set_config('gbs.rpc', '', true);
  return x;
end $$;

-- Note qualité du fournisseur (0 à 100) sur 12 mois glissants.
create or replace function gbs_private.note_qualite_brute(p_fournisseur uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select greatest(0, 100 - coalesce(sum(
           (gbs_private.param('nc.penalites') ->> n.gravite)::numeric
           * case when n.delai is not null and (coalesce(n.corrigee_le::date, current_date) > n.delai)
                  then (gbs_private.param('nc.penalites') ->> 'majoration_retard')::numeric else 1 end), 0))
    from gbs.non_conformites n
   where n.fournisseur_id = p_fournisseur and n.cree_le >= now() - interval '12 months'
$$;

create or replace function gbs.qualite_fournisseurs()
returns table (fournisseur_id uuid, fournisseur text, nc_12_mois bigint, nc_ouvertes bigint, nc_en_retard bigint,
               critiques_12_mois bigint, note_qualite numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine'));
  return query
  select f.id, f.raison_sociale_en,
         count(n.id) filter (where n.cree_le >= now() - interval '12 months'),
         count(n.id) filter (where n.statut <> 'close'),
         count(n.id) filter (where n.statut = 'ouverte' and n.delai < current_date),
         count(n.id) filter (where n.gravite = 'critique' and n.cree_le >= now() - interval '12 months'),
         gbs_private.note_qualite_brute(f.id)
    from gbs.fournisseurs f
    join gbs.non_conformites n on n.fournisseur_id = f.id
   group by f.id, f.raison_sociale_en
   order by 7, 2;
end $$;

revoke execute on function gbs.exiger_correction_nc(uuid, text, date), gbs.declarer_correction_nc(uuid, text, text[]),
  gbs.clore_nc(uuid, uuid, text), gbs.qualite_fournisseurs(),
  gbs_private.photos_valides(uuid, text[]), gbs_private.note_qualite_brute(uuid) from public;
grant execute on function gbs.exiger_correction_nc(uuid, text, date), gbs.declarer_correction_nc(uuid, text, text[]),
  gbs.clore_nc(uuid, uuid, text), gbs.qualite_fournisseurs() to authenticated;
grant execute on all functions in schema gbs_private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Correctif M21 : la commission d'agent entre automatiquement dans les coûts du dossier
-- (migration 22) ; une saisie manuelle dans cette catégorie la compterait deux fois.
-- -----------------------------------------------------------------------------
create or replace function gbs_private.trg_cout_categorie() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.categorie = 'commission_agent' and (tg_op = 'INSERT' or old.categorie is distinct from 'commission_agent') then
    raise exception 'GBS_CATEGORIE_AUTOMATIQUE: la commission de l''agent pays est calculée à l''encaissement' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger couts_categorie before insert or update of categorie on gbs.couts
  for each row execute function gbs_private.trg_cout_categorie();
revoke execute on function gbs_private.trg_cout_categorie() from public;
grant execute on function gbs_private.trg_cout_categorie() to authenticated, service_role;
