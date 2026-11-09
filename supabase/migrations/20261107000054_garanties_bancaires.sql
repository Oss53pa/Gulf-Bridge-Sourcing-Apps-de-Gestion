-- Finance : garanties bancaires (maquette GAR).
-- * Garantie demandée par une société du groupe : type (soumission, bonne exécution, restitution
--   d'acompte, retenue de garantie, autre), bénéficiaire, banque, montant, taux de commission
--   annuel, rattachée à un dossier ou à un appel d'offres.
-- * Cycle : demandée → émise (date d'émission et échéance) → mainlevée demandée → levée ;
--   appelée par le bénéficiaire (motif) ou refusée par la banque (motif). Une garantie levée,
--   appelée ou refusée est figée.
-- * Suivi calculé par la base : jours avant échéance, garantie échue sans mainlevée, commission
--   bancaire courue (montant × taux × jours depuis l'émission jusqu'à la mainlevée ou aujourd'hui / 365).
-- * Accès : administratrice et comptabilité écrivent ; Hub Afrique lit ; société du groupe vérifiée.
--   Écritures par fonctions, journalisées ; aucune suppression.

create table gbs.garanties_bancaires (
  id               uuid primary key default gen_random_uuid(),
  reference        text not null unique check (reference ~ '^GAR-[0-9]{4}-[0-9]{3,5}$'),
  societe_id       uuid not null references gbs.societes(id),
  type             text not null check (type in ('soumission','bonne_execution','restitution_acompte','retenue_garantie','autre')),
  beneficiaire     text not null check (length(trim(beneficiaire)) between 2 and 200),
  banque           text not null check (length(trim(banque)) between 2 and 200),
  montant          numeric(16,0) not null check (montant > 0 and montant <= 1e13),
  devise           char(3) not null default 'XOF' check (devise in ('XOF','XAF','USD','EUR')),
  taux_commission  numeric(6,4) not null default 0 check (taux_commission between 0 and 0.2),
  dossier_id       uuid references gbs.dossiers(id),
  ao_id            uuid references gbs.appels_offres(id),
  statut           text not null default 'demandee' check (statut in ('demandee','emise','mainlevee_demandee','levee','appelee','refusee')),
  demandee_le      date not null default current_date,
  emise_le         date,
  echeance         date,
  mainlevee_le     date,
  motif            text check (length(motif) <= 1000),
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check (statut in ('demandee','refusee') or (emise_le is not null and echeance is not null and echeance > emise_le)),
  check (statut <> 'levee' or mainlevee_le is not null)
);
create index on gbs.garanties_bancaires (societe_id, statut);

create or replace function gbs_private.trg_garantie_rpc() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'garantie' then
    raise exception 'GBS_VALIDATION_RPC: les garanties se modifient par les fonctions dédiées' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and old.statut in ('levee','appelee','refusee') then
    raise exception 'GBS_GARANTIE_CLOSE' using errcode = 'P0001';
  end if;
  return new;
end $$;

alter table gbs.garanties_bancaires enable row level security;
grant select on gbs.garanties_bancaires to authenticated;
create trigger garanties_rpc before insert or update on gbs.garanties_bancaires for each row execute function gbs_private.trg_garantie_rpc();
create trigger garanties_touch before update on gbs.garanties_bancaires for each row execute function gbs_private.trg_touch();
create trigger garanties_cree before insert on gbs.garanties_bancaires for each row execute function gbs_private.trg_cree_par();
create trigger garanties_audit after insert or update on gbs.garanties_bancaires for each row execute function gbs_private.trg_audit();
create trigger garanties_nodel before delete on gbs.garanties_bancaires for each row execute function gbs_private.trg_no_delete();
create policy garanties_lecture on gbs.garanties_bancaires for select using (
  gbs_private.has_role('admin','comptable','hub_afrique') and gbs_private.societe_ok(societe_id));

create or replace function gbs_private.garantie_modifiable(p_garantie uuid) returns gbs.garanties_bancaires
language plpgsql security definer set search_path = '' as $$
declare g gbs.garanties_bancaires;
begin
  select * into g from gbs.garanties_bancaires where id = p_garantie for update;
  perform gbs_private.exiger(g.id is not null and gbs_private.has_role('admin','comptable') and gbs_private.societe_ok(g.societe_id));
  if g.statut in ('levee','appelee','refusee') then raise exception 'GBS_GARANTIE_CLOSE' using errcode = 'P0001'; end if;
  return g;
end $$;

create or replace function gbs.demander_garantie(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s uuid; n int; an int := extract(year from current_date)::int; r uuid; d uuid; ao uuid;
begin
  if jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) k where k not in ('societe_id','type','beneficiaire','banque','montant','devise','taux_commission','dossier_id','ao_id'))
     or coalesce(jsonb_typeof(p -> 'societe_id'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'type'), '') <> 'string'
     or coalesce(jsonb_typeof(p -> 'beneficiaire'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'banque'), '') <> 'string'
     or coalesce(jsonb_typeof(p -> 'montant'), '') <> 'number'
     or (p ? 'devise' and jsonb_typeof(p -> 'devise') <> 'string')
     or (p ? 'taux_commission' and jsonb_typeof(p -> 'taux_commission') <> 'number')
     or (p ? 'dossier_id' and jsonb_typeof(p -> 'dossier_id') not in ('string','null'))
     or (p ? 'ao_id' and jsonb_typeof(p -> 'ao_id') not in ('string','null')) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  s := (p ->> 'societe_id')::uuid; d := nullif(p ->> 'dossier_id', '')::uuid; ao := nullif(p ->> 'ao_id', '')::uuid;
  perform gbs_private.exiger(gbs_private.has_role('admin','comptable') and gbs_private.societe_ok(s)
    and (d is null or gbs_private.dossier_visible(d)));
  if (d is not null and not exists (select 1 from gbs.dossiers x where x.id = d and x.societe_id = s))
     or (ao is not null and not exists (select 1 from gbs.appels_offres x where x.id = ao and x.societe_id = s)) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('gbs.garanties_bancaires'));
  select coalesce(max(substring(reference from '-([0-9]+)$')::int), 0) + 1 into n
    from gbs.garanties_bancaires where reference like 'GAR-' || an || '-%';
  perform gbs_private.rpc('garantie');
  insert into gbs.garanties_bancaires (reference, societe_id, type, beneficiaire, banque, montant, devise, taux_commission, dossier_id, ao_id)
  values ('GAR-' || an || '-' || lpad(n::text, 3, '0'), s, p ->> 'type', trim(p ->> 'beneficiaire'), trim(p ->> 'banque'),
          (p ->> 'montant')::numeric, coalesce(p ->> 'devise', 'XOF'), coalesce((p ->> 'taux_commission')::numeric, 0), d, ao)
  returning id into r;
  perform gbs_private.rpc('');
  return r;
exception
  when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range or foreign_key_violation then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

create or replace function gbs.emettre_garantie(p_garantie uuid, p_emise_le date, p_echeance date) returns void
language plpgsql security definer set search_path = '' as $$
declare g gbs.garanties_bancaires := gbs_private.garantie_modifiable(p_garantie);
begin
  if g.statut <> 'demandee' then raise exception 'GBS_TRANSITION_INVALIDE' using errcode = 'P0001'; end if;
  if p_emise_le is null or p_echeance is null or p_emise_le > current_date or p_emise_le < g.demandee_le - 365 or p_echeance <= p_emise_le then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform gbs_private.rpc('garantie');
  update gbs.garanties_bancaires set statut = 'emise', emise_le = p_emise_le, echeance = p_echeance where id = g.id;
  perform gbs_private.rpc('');
end $$;

-- Étapes suivantes : mainlevée demandée, levée (date), appelée ou refusée (motif).
create or replace function gbs.suivre_garantie(p_garantie uuid, p_etape text, p_date date default null, p_motif text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare g gbs.garanties_bancaires := gbs_private.garantie_modifiable(p_garantie);
begin
  if p_etape = 'mainlevee_demandee' and g.statut = 'emise' then
    perform gbs_private.rpc('garantie');
    update gbs.garanties_bancaires set statut = 'mainlevee_demandee' where id = g.id;
  elsif p_etape = 'levee' and g.statut in ('emise','mainlevee_demandee') then
    if p_date is null or p_date > current_date or p_date < g.emise_le then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
    perform gbs_private.rpc('garantie');
    update gbs.garanties_bancaires set statut = 'levee', mainlevee_le = p_date where id = g.id;
  elsif p_etape = 'appelee' and g.statut in ('emise','mainlevee_demandee') then
    perform gbs_private.motif(p_motif);
    perform gbs_private.rpc('garantie');
    update gbs.garanties_bancaires set statut = 'appelee', motif = trim(p_motif) where id = g.id;
  elsif p_etape = 'refusee' and g.statut = 'demandee' then
    perform gbs_private.motif(p_motif);
    perform gbs_private.rpc('garantie');
    update gbs.garanties_bancaires set statut = 'refusee', motif = trim(p_motif) where id = g.id;
  else
    raise exception 'GBS_TRANSITION_INVALIDE' using errcode = 'P0001';
  end if;
  perform gbs_private.rpc('');
end $$;

-- Suivi : jours avant échéance, échue sans mainlevée, commission courue (calculée ici, jamais à l'écran).
create or replace function gbs.garanties_suivi()
returns table (id uuid, jours_restants int, echue_sans_mainlevee boolean, commission_courue numeric)
language sql stable security definer set search_path = '' as $$
  select g.id,
         case when g.echeance is not null and g.statut in ('emise','mainlevee_demandee') then g.echeance - current_date end,
         g.statut in ('emise','mainlevee_demandee') and g.echeance < current_date,
         case when g.emise_le is null then 0
              else round(g.montant * g.taux_commission * greatest(0, coalesce(g.mainlevee_le, current_date) - g.emise_le) / 365.0) end
    from gbs.garanties_bancaires g
   where gbs_private.has_role('admin','comptable','hub_afrique') and gbs_private.societe_ok(g.societe_id)
$$;

revoke all on function gbs_private.trg_garantie_rpc(), gbs_private.garantie_modifiable(uuid) from public, anon, authenticated;
revoke all on function gbs.demander_garantie(jsonb), gbs.emettre_garantie(uuid, date, date), gbs.suivre_garantie(uuid, text, date, text), gbs.garanties_suivi() from public, anon;
grant execute on function gbs.demander_garantie(jsonb), gbs.emettre_garantie(uuid, date, date), gbs.suivre_garantie(uuid, text, date, text), gbs.garanties_suivi() to authenticated;
