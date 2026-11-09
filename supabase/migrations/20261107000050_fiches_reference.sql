-- M34 (lot 2) : fiches de référence clients (section Appels d'offres du module Commercial ; maquette
-- « Fiches de référence clients » REF).
-- * Générée à partir d'un dossier clos : besoin repris du dossier, délais tenus calculés (chaque phase
--   terminée dans sa cible en jours ouvrés, horloge arrêtée pendant l'attente d'un tiers) et jamais
--   saisis ; sans phase mesurable, la valeur reste vide plutôt que supposée tenue. Solution et écart de coût global obtenu saisis par l'équipe, bornés.
-- * Accord du client : non demandé, demandé, accordé (preuve écrite obligatoire : référence du courrier
--   ou du courriel), refusé.
-- * Publication dans la plaquette : sans accord écrit, seule la version anonymisée est publiable ;
--   une fiche publiée est figée.
-- * Accès : administratrice et Hub Afrique, sur les dossiers qu'ils voient. Écritures par fonctions
--   uniquement, journalisées ; aucune suppression.

create table gbs.fiches_reference (
  id                uuid primary key default gen_random_uuid(),
  dossier_id        uuid not null unique references gbs.dossiers(id),
  reference         text not null unique check (reference ~ '^REF-[0-9]{3,6}$'),
  besoin            text check (length(besoin) <= 2000),
  solution          text check (length(solution) <= 2000),
  delais_tenus      boolean,          -- null : aucune phase mesurable (jamais supposé tenu)
  ecart_cout_global numeric(5,1) check (ecart_cout_global between -100 and 100),
  anonymisee        boolean not null default true,
  accord            text not null default 'non_demande' check (accord in ('non_demande','demande','accorde','refuse')),
  accord_preuve     text check (length(accord_preuve) <= 300),
  accord_le         timestamptz,
  publiee_le        timestamptz,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check (accord <> 'accorde' or length(trim(coalesce(accord_preuve, ''))) >= 3),
  check (publiee_le is null or anonymisee or accord = 'accorde')
);

alter table gbs.fiches_reference enable row level security;
grant select on gbs.fiches_reference to authenticated;
create policy fiches_reference_lecture on gbs.fiches_reference for select
  using (gbs_private.has_role('admin','hub_afrique') and gbs_private.dossier_visible(dossier_id));

create or replace function gbs_private.trg_fiche_reference_rpc() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'fiche_reference' then
    raise exception 'GBS_VALIDATION_RPC: les fiches de référence se modifient par les fonctions dédiées' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and old.publiee_le is not null then
    raise exception 'GBS_FICHE_PUBLIEE' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger fiches_reference_rpc before insert or update on gbs.fiches_reference for each row execute function gbs_private.trg_fiche_reference_rpc();
create trigger fiches_reference_touch before update on gbs.fiches_reference for each row execute function gbs_private.trg_touch();
create trigger fiches_reference_cree before insert on gbs.fiches_reference for each row execute function gbs_private.trg_cree_par();
create trigger fiches_reference_audit after insert or update on gbs.fiches_reference for each row execute function gbs_private.trg_audit();
create trigger fiches_reference_nodel before delete on gbs.fiches_reference for each row execute function gbs_private.trg_no_delete();

-- Fiche visible et modifiable (non publiée), sinon refus.
create or replace function gbs_private.fiche_reference_modifiable(p_fiche uuid) returns gbs.fiches_reference
language plpgsql security definer set search_path = '' as $$
declare f gbs.fiches_reference;
begin
  select * into f from gbs.fiches_reference where id = p_fiche for update;
  perform gbs_private.exiger(f.id is not null and gbs_private.has_role('admin','hub_afrique') and gbs_private.dossier_visible(f.dossier_id));
  if f.publiee_le is not null then raise exception 'GBS_FICHE_PUBLIEE' using errcode = 'P0001'; end if;
  return f;
end $$;

create or replace function gbs.generer_fiche_reference(p_dossier uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d gbs.dossiers; tenus boolean; r uuid;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','hub_afrique') and gbs_private.dossier_visible(p_dossier));
  select * into d from gbs.dossiers where id = p_dossier;
  if d.statut <> 'clos' then raise exception 'GBS_DOSSIER_NON_CLOS' using errcode = 'P0001'; end if;
  if exists (select 1 from gbs.fiches_reference where dossier_id = p_dossier) then
    raise exception 'GBS_FICHE_EXISTANTE' using errcode = 'P0001';
  end if;
  select bool_and(e.jours_internes <= e.cible) into tenus
    from gbs_private.etat_delais_brut(p_dossier) e where e.cible is not null and e.fin is not null;
  perform gbs_private.rpc('fiche_reference');
  insert into gbs.fiches_reference (dossier_id, reference, besoin, delais_tenus)
  values (d.id, 'REF-' || substring(d.reference from '-([0-9]+)$'), left(d.besoin, 2000), tenus) returning id into r;
  perform gbs_private.rpc('');
  return r;
end $$;

create or replace function gbs.modifier_fiche_reference(p_fiche uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare f gbs.fiches_reference := gbs_private.fiche_reference_modifiable(p_fiche);
begin
  if jsonb_typeof(p) <> 'object' or exists (select 1 from jsonb_object_keys(p) k where k not in ('besoin','solution','ecart_cout_global','anonymisee'))
     or (p ? 'anonymisee' and jsonb_typeof(p -> 'anonymisee') <> 'boolean')
     or (p ? 'ecart_cout_global' and jsonb_typeof(p -> 'ecart_cout_global') not in ('number','null')) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform gbs_private.rpc('fiche_reference');
  update gbs.fiches_reference set
    besoin = case when p ? 'besoin' then nullif(trim(p ->> 'besoin'), '') else besoin end,
    solution = case when p ? 'solution' then nullif(trim(p ->> 'solution'), '') else solution end,
    ecart_cout_global = case when p ? 'ecart_cout_global' then (p ->> 'ecart_cout_global')::numeric else ecart_cout_global end,
    anonymisee = case when p ? 'anonymisee' then (p ->> 'anonymisee')::boolean else anonymisee end
   where id = f.id;
  perform gbs_private.rpc('');
exception when check_violation or numeric_value_out_of_range or invalid_text_representation then
  raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

create or replace function gbs.accord_fiche_reference(p_fiche uuid, p_accord text, p_preuve text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare f gbs.fiches_reference := gbs_private.fiche_reference_modifiable(p_fiche);
begin
  if p_accord not in ('non_demande','demande','accorde','refuse') or length(coalesce(p_preuve, '')) > 300 then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if p_accord = 'accorde' and length(trim(coalesce(p_preuve, ''))) < 3 then
    raise exception 'GBS_ACCORD_ECRIT_REQUIS' using errcode = 'P0001';
  end if;
  perform gbs_private.rpc('fiche_reference');
  update gbs.fiches_reference set accord = p_accord, accord_preuve = nullif(trim(p_preuve), ''),
         accord_le = case when p_accord in ('accorde','refuse') then now() end
   where id = f.id;
  perform gbs_private.rpc('');
end $$;

create or replace function gbs.publier_fiche_reference(p_fiche uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare f gbs.fiches_reference := gbs_private.fiche_reference_modifiable(p_fiche);
begin
  if f.besoin is null or f.solution is null then raise exception 'GBS_FICHE_INCOMPLETE' using errcode = 'P0001'; end if;
  if not f.anonymisee and f.accord <> 'accorde' then raise exception 'GBS_ACCORD_ECRIT_REQUIS' using errcode = 'P0001'; end if;
  perform gbs_private.rpc('fiche_reference');
  update gbs.fiches_reference set publiee_le = now() where id = f.id;
  perform gbs_private.rpc('');
end $$;

revoke all on function gbs_private.fiche_reference_modifiable(uuid), gbs_private.trg_fiche_reference_rpc() from public, anon, authenticated;
revoke all on function gbs.generer_fiche_reference(uuid), gbs.modifier_fiche_reference(uuid, jsonb), gbs.accord_fiche_reference(uuid, text, text),
  gbs.publier_fiche_reference(uuid) from public, anon;
grant execute on function gbs.generer_fiche_reference(uuid), gbs.modifier_fiche_reference(uuid, jsonb), gbs.accord_fiche_reference(uuid, text, text),
  gbs.publier_fiche_reference(uuid) to authenticated;
