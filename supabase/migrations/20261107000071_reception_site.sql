-- Préparer la réception sur site (maquette « Espace client · expédition et livraison »).
-- * L'équipe logistique (gere_expedition) propose des créneaux de livraison (date et demi-journée,
--   six au plus, jamais dans le passé) et la liste des points « site prêt » (dix au plus).
-- * Le client (compte en double facteur, dossier à lui) choisit un créneau et coche les points ;
--   il confirme la réception seulement quand un créneau est choisi et que tous les points sont prêts.
--   Une réception confirmée est figée ; l'équipe peut la rouvrir avec un motif (imprévu de transport).
-- * Une expédition déjà livrée ne se prépare plus.

create table gbs.receptions_site (
  expedition_id  uuid primary key references gbs.expeditions(id),
  dossier_id     uuid not null references gbs.dossiers(id),
  creneaux       jsonb not null default '[]'::jsonb,   -- [{"date":"2026-11-25","moment":"matin"}]
  creneau_choisi int,                                  -- indice dans creneaux
  points         jsonb not null default '[]'::jsonb,   -- [{"libelle":"…","pret":false}]
  confirmee_le   timestamptz,
  confirmee_par  uuid references gbs.profils(id),
  modifie_le     timestamptz not null default now(), modifie_par uuid,
  check (jsonb_typeof(creneaux) = 'array' and jsonb_array_length(creneaux) <= 6),
  check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) <= 10),
  check (creneau_choisi is null or creneau_choisi between 0 and 5),
  check ((confirmee_le is null) = (confirmee_par is null))
);

create or replace function gbs_private.trg_reception_site_rpc() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'reception_site' then
    raise exception 'GBS_VALIDATION_RPC: la réception sur site se prépare par les fonctions dédiées' using errcode = 'P0001';
  end if;
  return new;
end $$;

alter table gbs.receptions_site enable row level security;
grant select on gbs.receptions_site to authenticated;
create trigger receptions_site_rpc before insert or update on gbs.receptions_site for each row execute function gbs_private.trg_reception_site_rpc();
create trigger receptions_site_touch before update on gbs.receptions_site for each row execute function gbs_private.trg_touch();
create trigger receptions_site_audit after insert or update on gbs.receptions_site for each row execute function gbs_private.trg_audit();
create trigger receptions_site_nodel before delete on gbs.receptions_site for each row execute function gbs_private.trg_no_delete();
create policy receptions_site_lecture on gbs.receptions_site for select using (gbs_private.interne() and gbs_private.dossier_visible(dossier_id));

-- Équipe : créneaux et points ; remet le choix et les coches à zéro (sauf points inchangés), rouvre si besoin.
create or replace function gbs.preparer_reception_site(p_expedition uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare e gbs.expeditions; r gbs.receptions_site; cr jsonb; libs text[]; anciens jsonb;
begin
  perform gbs_private.exiger(gbs_private.gere_expedition(p_expedition));
  select * into e from gbs.expeditions where id = p_expedition;
  if e.statut = 'livree' then raise exception 'GBS_EXPEDITION_LIVREE' using errcode = 'P0001'; end if;
  if jsonb_typeof(p) <> 'object' or exists (select 1 from jsonb_object_keys(p) k where k not in ('creneaux','points','motif'))
     or coalesce(jsonb_typeof(p -> 'creneaux'), '') <> 'array' or coalesce(jsonb_typeof(p -> 'points'), '') <> 'array'
     or jsonb_array_length(p -> 'creneaux') not between 1 and 6 or jsonb_array_length(p -> 'points') > 10
     or (p ? 'motif' and jsonb_typeof(p -> 'motif') not in ('string','null')) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  for cr in select value from jsonb_array_elements(p -> 'creneaux') loop
    if jsonb_typeof(cr) <> 'object' or (select count(*) from jsonb_object_keys(cr)) <> 2 or coalesce(jsonb_typeof(cr -> 'date'), '') <> 'string'
       or coalesce(cr ->> 'moment', '') not in ('matin','apres_midi') or (cr ->> 'date')::date < current_date or (cr ->> 'date')::date > current_date + 365 then
      raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
    end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(p -> 'points') v where jsonb_typeof(v) <> 'string') then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  select array_agg(trim(v)) into libs from jsonb_array_elements_text(p -> 'points') v;
  if exists (select 1 from unnest(coalesce(libs, '{}')) l where length(l) not between 3 and 160)
     or (select count(distinct lower(l)) from unnest(coalesce(libs, '{}')) l) <> coalesce(cardinality(libs), 0) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  select * into r from gbs.receptions_site where expedition_id = e.id for update;
  -- Rouvrir une réception confirmée exige un motif (journalisé).
  if r.confirmee_le is not null then perform gbs_private.motif(p ->> 'motif'); end if;
  anciens := coalesce(r.points, '[]'::jsonb);
  perform gbs_private.rpc('reception_site');
  insert into gbs.receptions_site (expedition_id, dossier_id, creneaux, points)
  values (e.id, e.dossier_id,
          (select jsonb_agg(jsonb_build_object('date', x ->> 'date', 'moment', x ->> 'moment')) from jsonb_array_elements(p -> 'creneaux') x),
          coalesce((select jsonb_agg(jsonb_build_object('libelle', l,
                     'pret', coalesce((select (o ->> 'pret')::boolean from jsonb_array_elements(anciens) o where o ->> 'libelle' = l limit 1), false)))
                    from unnest(libs) l), '[]'::jsonb))
  on conflict (expedition_id) do update set creneaux = excluded.creneaux, points = excluded.points, creneau_choisi = null,
    confirmee_le = null, confirmee_par = null;
  if r.confirmee_le is not null then
    perform gbs_private.journaliser('reception_site_rouverte', 'receptions_site', e.id::text, e.dossier_id, null, null, trim(p ->> 'motif'));
  end if;
  perform gbs_private.rpc('');
exception
  when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

-- Client : réception d'une expédition de ses dossiers, non confirmée, expédition non livrée.
create or replace function gbs_private.reception_du_client(p_expedition uuid) returns gbs.receptions_site
language plpgsql security definer set search_path = '' as $$
declare c uuid := gbs_private.mon_client(); r gbs.receptions_site;
begin
  select * into r from gbs.receptions_site where expedition_id = p_expedition for update;
  perform gbs_private.exiger(c is not null and r.expedition_id is not null
    and exists (select 1 from gbs.dossiers d where d.id = r.dossier_id and d.client_id = c and d.statut <> 'annule')
    and exists (select 1 from gbs.expeditions e where e.id = r.expedition_id and e.statut <> 'livree'));
  if r.confirmee_le is not null then raise exception 'GBS_RECEPTION_CONFIRMEE' using errcode = 'P0001'; end if;
  return r;
end $$;

create or replace function gbs.choisir_creneau(p_expedition uuid, p_indice int) returns void
language plpgsql security definer set search_path = '' as $$
declare r gbs.receptions_site := gbs_private.reception_du_client(p_expedition);
begin
  perform gbs_private.limiter('reception_site');
  if p_indice is null or p_indice < 0 or p_indice >= jsonb_array_length(r.creneaux)
     or ((r.creneaux -> p_indice) ->> 'date')::date < current_date then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform gbs_private.rpc('reception_site');
  update gbs.receptions_site set creneau_choisi = p_indice where expedition_id = r.expedition_id;
  perform gbs_private.rpc('');
end $$;

create or replace function gbs.cocher_point_reception(p_expedition uuid, p_indice int, p_pret boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare r gbs.receptions_site := gbs_private.reception_du_client(p_expedition);
begin
  perform gbs_private.limiter('reception_site');
  if p_indice is null or p_pret is null or p_indice < 0 or p_indice >= jsonb_array_length(r.points) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform gbs_private.rpc('reception_site');
  update gbs.receptions_site set points = jsonb_set(points, array[p_indice::text, 'pret'], to_jsonb(p_pret)) where expedition_id = r.expedition_id;
  perform gbs_private.rpc('');
end $$;

create or replace function gbs.confirmer_reception_site(p_expedition uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r gbs.receptions_site := gbs_private.reception_du_client(p_expedition);
begin
  perform gbs_private.limiter('reception_site');
  if r.creneau_choisi is null or exists (select 1 from jsonb_array_elements(r.points) o where not (o ->> 'pret')::boolean) then
    raise exception 'GBS_RECEPTION_INCOMPLETE' using errcode = 'P0001';
  end if;
  perform gbs_private.rpc('reception_site');
  update gbs.receptions_site set confirmee_le = now(), confirmee_par = auth.uid() where expedition_id = r.expedition_id;
  perform gbs_private.rpc('');
end $$;

-- Espace client : préparations de réception de ses expéditions non livrées.
create or replace function gbs.receptions_client(p_dossier uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c uuid := gbs_private.mon_client();
begin
  perform gbs_private.exiger(c is not null and exists (select 1 from gbs.dossiers d where d.id = p_dossier and d.client_id = c and d.statut <> 'annule'));
  return (select coalesce(jsonb_agg(jsonb_build_object('expedition_id', r.expedition_id, 'reference', e.reference, 'creneaux', r.creneaux,
            'creneau_choisi', r.creneau_choisi, 'points', r.points, 'confirmee_le', r.confirmee_le) order by e.eta nulls last), '[]'::jsonb)
            from gbs.receptions_site r join gbs.expeditions e on e.id = r.expedition_id
           where r.dossier_id = p_dossier and e.statut <> 'livree');
end $$;

revoke all on function gbs_private.trg_reception_site_rpc(), gbs_private.reception_du_client(uuid) from public, anon, authenticated;
revoke all on function gbs.preparer_reception_site(uuid, jsonb), gbs.choisir_creneau(uuid, int), gbs.cocher_point_reception(uuid, int, boolean),
  gbs.confirmer_reception_site(uuid), gbs.receptions_client(uuid) from public, anon;
grant execute on function gbs.preparer_reception_site(uuid, jsonb), gbs.choisir_creneau(uuid, int), gbs.cocher_point_reception(uuid, int, boolean),
  gbs.confirmer_reception_site(uuid), gbs.receptions_client(uuid) to authenticated;
