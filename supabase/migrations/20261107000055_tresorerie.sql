-- Finance : trésorerie prévisionnelle et risque de change (maquette TRC).
-- * Flux prévus saisis par la finance (salaires, loyers, impôts, fournisseurs, autres), ponctuels ou
--   mensuels jusqu'à une date ; désactivables, jamais modifiés ni supprimés.
-- * Couvertures de change (terme ou option) sur une devise, rattachables à un paiement fournisseur.
-- * Prévision hebdomadaire calculée par la base, consolidée en FCFA au dernier taux connu, flux
--   internes au groupe exclus : solde de départ = derniers soldes de clôture des relevés bancaires ;
--   entrées = factures clients émises restant à encaisser, à leur échéance (en retard : semaine en
--   cours) décalée du retard client simulé ; sorties = paiements fournisseurs préparés ou validés
--   (semaine en cours) et flux prévus. Scénario : retard client en jours et choc de change sur une devise.
-- * Exposition au change : paiements fournisseurs non exécutés et flux prévus en devise, couverts ou non.
-- * Accès : administratrice et comptabilité, sociétés autorisées. Écritures par fonctions, journalisées.

create table gbs.flux_prevus (
  id          uuid primary key default gen_random_uuid(),
  societe_id  uuid not null references gbs.societes(id),
  sens        text not null check (sens in ('entree','sortie')),
  categorie   text not null check (categorie in ('salaires','loyers','impots','fournisseur','client','autre')),
  libelle     text not null check (length(trim(libelle)) between 3 and 200),
  montant     numeric(16,2) not null check (montant > 0 and montant <= 1e13),
  devise      char(3) not null default 'XOF' check (devise in ('XOF','XAF','USD','CNY','EUR')),
  date_prevue date not null,
  mensuel     boolean not null default false,
  jusqu_au    date,
  actif       boolean not null default true,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check (not mensuel or (jusqu_au is not null and jusqu_au >= date_prevue and jusqu_au <= date_prevue + 3660))
);

create table gbs.couvertures_change (
  id          uuid primary key default gen_random_uuid(),
  societe_id  uuid not null references gbs.societes(id),
  devise      char(3) not null check (devise in ('USD','CNY','EUR')),
  montant     numeric(16,2) not null check (montant > 0 and montant <= 1e13),
  type        text not null check (type in ('terme','option')),
  taux        numeric(14,6) not null check (taux > 0 and taux <= 100000),
  echeance    date not null,
  banque      text not null check (length(trim(banque)) between 2 and 200),
  paiement_id uuid references gbs.paiements_fournisseurs(id),
  cree_le timestamptz not null default now(), cree_par uuid
);

create or replace function gbs_private.trg_tresorerie_rpc() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'tresorerie' then
    raise exception 'GBS_VALIDATION_RPC: la trésorerie se modifie par les fonctions dédiées' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    if tg_table_name = 'couvertures_change'
       or (to_jsonb(new) - 'actif' - 'modifie_le' - 'modifie_par') is distinct from (to_jsonb(old) - 'actif' - 'modifie_le' - 'modifie_par') then
      raise exception 'GBS_REGLE_FIGEE' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['flux_prevus','couvertures_change'] loop
    execute format('alter table gbs.%I enable row level security', t);
    execute format('grant select on gbs.%I to authenticated', t);
    execute format('create trigger %I before insert or update on gbs.%I for each row execute function gbs_private.trg_tresorerie_rpc()', t || '_rpc', t);
    execute format('create trigger %I before insert on gbs.%I for each row execute function gbs_private.trg_cree_par()', t || '_cree', t);
    execute format('create trigger %I after insert or update on gbs.%I for each row execute function gbs_private.trg_audit()', t || '_audit', t);
    execute format('create trigger %I before delete on gbs.%I for each row execute function gbs_private.trg_no_delete()', t || '_nodel', t);
    execute format('create policy %I on gbs.%I for select using (gbs_private.finance() and gbs_private.societe_ok(societe_id))', t || '_lecture', t);
  end loop;
end $$;
create trigger flux_prevus_touch before update on gbs.flux_prevus for each row execute function gbs_private.trg_touch();

create or replace function gbs.creer_flux_prevu(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r uuid; s uuid;
begin
  if jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) k where k not in ('societe_id','sens','categorie','libelle','montant','devise','date_prevue','mensuel','jusqu_au'))
     or coalesce(jsonb_typeof(p -> 'societe_id'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'sens'), '') <> 'string'
     or coalesce(jsonb_typeof(p -> 'categorie'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'libelle'), '') <> 'string'
     or coalesce(jsonb_typeof(p -> 'montant'), '') <> 'number' or coalesce(jsonb_typeof(p -> 'date_prevue'), '') <> 'string'
     or (p ? 'devise' and jsonb_typeof(p -> 'devise') <> 'string') or (p ? 'mensuel' and jsonb_typeof(p -> 'mensuel') <> 'boolean')
     or (p ? 'jusqu_au' and jsonb_typeof(p -> 'jusqu_au') not in ('string','null')) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  s := (p ->> 'societe_id')::uuid;
  perform gbs_private.exiger(gbs_private.finance() and gbs_private.societe_ok(s));
  perform gbs_private.rpc('tresorerie');
  insert into gbs.flux_prevus (societe_id, sens, categorie, libelle, montant, devise, date_prevue, mensuel, jusqu_au)
  values (s, p ->> 'sens', p ->> 'categorie', trim(p ->> 'libelle'), (p ->> 'montant')::numeric, coalesce(p ->> 'devise', 'XOF'),
          (p ->> 'date_prevue')::date, coalesce((p ->> 'mensuel')::boolean, false), (p ->> 'jusqu_au')::date)
  returning id into r;
  perform gbs_private.rpc('');
  return r;
exception
  when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow
       or numeric_value_out_of_range or foreign_key_violation then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

create or replace function gbs.desactiver_flux_prevu(p_flux uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(exists (select 1 from gbs.flux_prevus f where f.id = p_flux and f.actif and gbs_private.finance() and gbs_private.societe_ok(f.societe_id)));
  perform gbs_private.rpc('tresorerie');
  update gbs.flux_prevus set actif = false where id = p_flux;
  perform gbs_private.rpc('');
end $$;

create or replace function gbs.creer_couverture(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r uuid; s uuid; pay uuid;
begin
  if jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) k where k not in ('societe_id','devise','montant','type','taux','echeance','banque','paiement_id'))
     or coalesce(jsonb_typeof(p -> 'societe_id'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'devise'), '') <> 'string'
     or coalesce(jsonb_typeof(p -> 'montant'), '') <> 'number' or coalesce(jsonb_typeof(p -> 'type'), '') <> 'string'
     or coalesce(jsonb_typeof(p -> 'taux'), '') <> 'number' or coalesce(jsonb_typeof(p -> 'echeance'), '') <> 'string'
     or coalesce(jsonb_typeof(p -> 'banque'), '') <> 'string' or (p ? 'paiement_id' and jsonb_typeof(p -> 'paiement_id') not in ('string','null')) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  s := (p ->> 'societe_id')::uuid; pay := nullif(p ->> 'paiement_id', '')::uuid;
  perform gbs_private.exiger(gbs_private.finance() and gbs_private.societe_ok(s));
  if pay is not null and not exists (select 1 from gbs.paiements_fournisseurs x join gbs.dossiers d on d.id = x.dossier_id
                                     where x.id = pay and d.societe_id = s and x.devise = p ->> 'devise' and x.statut in ('prepare','valide')) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform gbs_private.rpc('tresorerie');
  insert into gbs.couvertures_change (societe_id, devise, montant, type, taux, echeance, banque, paiement_id)
  values (s, p ->> 'devise', (p ->> 'montant')::numeric, p ->> 'type', (p ->> 'taux')::numeric, (p ->> 'echeance')::date, trim(p ->> 'banque'), pay)
  returning id into r;
  perform gbs_private.rpc('');
  return r;
exception
  when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow
       or numeric_value_out_of_range or foreign_key_violation then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

-- Mouvements prévus détaillés (base de la prévision et de l'exposition).
create or replace function gbs_private.mouvements_prevus(p_societe uuid, p_fin date, p_retard int, p_choc_devise text, p_choc numeric)
returns table (jour date, sens text, montant_xof numeric, devise text, libelle text)
language sql stable security definer set search_path = '' as $$
  with conv as (
    select d.devise, gbs_private.taux_xof(d.devise, current_date) * case when d.devise = p_choc_devise then 1 + p_choc else 1 end as t
      from (values ('XOF'),('XAF'),('USD'),('CNY'),('EUR')) d(devise)
     where d.devise = 'XOF' or exists (select 1 from gbs.taux_change x where x.devise = d.devise)
  )
  select greatest(f.echeance + p_retard, current_date), 'entree', round((f.net_a_payer - f.encaisse) * c.t), f.devise::text,
         coalesce(f.numero, 'Facture') || ' · ' || f.objet
    from gbs.factures f join conv c on c.devise = f.devise
   where f.statut in ('emise','partiellement_payee') and f.client_id is not null and f.echeance is not null
     and (p_societe is null or f.societe_id = p_societe) and gbs_private.societe_ok(f.societe_id)
     and greatest(f.echeance + p_retard, current_date) <= p_fin
  union all
  select current_date, 'sortie', round(x.montant * c.t), x.devise::text, coalesce(x.reference, 'Paiement') || ' · ' || x.nature
    from gbs.paiements_fournisseurs x join gbs.dossiers d on d.id = x.dossier_id join conv c on c.devise = x.devise
   where x.statut in ('prepare','valide') and (p_societe is null or d.societe_id = p_societe) and gbs_private.societe_ok(d.societe_id)
  union all
  select o.jour, f.sens, round(f.montant * c.t), f.devise::text, f.libelle
    from gbs.flux_prevus f join conv c on c.devise = f.devise
    cross join lateral (
      select g::date as jour from generate_series(f.date_prevue, case when f.mensuel then f.jusqu_au else f.date_prevue end, interval '1 month') g
    ) o
   where f.actif and o.jour between current_date and p_fin and (p_societe is null or f.societe_id = p_societe) and gbs_private.societe_ok(f.societe_id)
$$;

create or replace function gbs.prevision_tresorerie(p_societe uuid default null, p_semaines int default 9, p_retard_client int default 0,
  p_choc_devise text default null, p_choc numeric default 0)
returns table (semaine date, entrees numeric, sorties numeric, solde numeric, principal text)
language plpgsql stable security definer set search_path = '' as $$
declare depart numeric; debut date := date_trunc('week', current_date)::date; fin date;
begin
  perform gbs_private.exiger(gbs_private.finance() and (p_societe is null or gbs_private.societe_ok(p_societe)));
  if p_semaines not between 1 and 26 or p_retard_client not between 0 and 180 or p_choc not between -0.5 and 0.5
     or (p_choc_devise is not null and p_choc_devise not in ('USD','CNY','EUR','XAF')) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  fin := debut + p_semaines * 7 - 1;
  select coalesce(sum(round(gbs_private.to_xof(r.solde_cloture, k.devise, current_date))), 0) into depart
    from gbs.comptes_bancaires k
    join lateral (select x.solde_cloture from gbs.releves_bancaires x where x.compte_id = k.id order by x.date_fin desc, x.importe_le desc limit 1) r on true
   where k.actif and (p_societe is null or k.societe_id = p_societe) and gbs_private.societe_ok(k.societe_id);
  return query
  with m as (select * from gbs_private.mouvements_prevus(p_societe, fin, p_retard_client, p_choc_devise, coalesce(p_choc, 0))),
  s as (select g::date sem from generate_series(debut, fin, interval '1 week') g),
  agg as (
    select s.sem,
           coalesce(sum(m.montant_xof) filter (where m.sens = 'entree'), 0) e,
           coalesce(sum(m.montant_xof) filter (where m.sens = 'sortie'), 0) o,
           (select x.libelle from m x where date_trunc('week', x.jour)::date = s.sem order by x.montant_xof desc limit 1) p
      from s left join m on date_trunc('week', m.jour)::date = s.sem
     group by s.sem
  )
  select a.sem, a.e, a.o, depart + sum(a.e - a.o) over (order by a.sem), a.p from agg a order by a.sem;
end $$;

-- Exposition au change : engagements en devise non exécutés, couverture éventuelle.
create or replace function gbs.exposition_change(p_societe uuid default null)
returns table (origine text, ref_id uuid, societe_id uuid, devise text, montant numeric, libelle text, couverture text)
language sql stable security definer set search_path = '' as $$
  select 'paiement', x.id, d.societe_id, x.devise::text, x.montant, coalesce(x.reference, '') || ' · ' || x.nature,
         (select c.type || ' · ' || c.banque from gbs.couvertures_change c where c.paiement_id = x.id limit 1)
    from gbs.paiements_fournisseurs x join gbs.dossiers d on d.id = x.dossier_id
   where gbs_private.finance() and x.statut in ('prepare','valide') and x.devise <> 'XOF'
     and (p_societe is null or d.societe_id = p_societe) and gbs_private.societe_ok(d.societe_id)
  union all
  select 'flux', f.id, f.societe_id, f.devise::text, f.montant, f.libelle, null
    from gbs.flux_prevus f
   where gbs_private.finance() and f.actif and f.devise not in ('XOF','XAF') and (f.mensuel and f.jusqu_au >= current_date or f.date_prevue >= current_date)
     and (p_societe is null or f.societe_id = p_societe) and gbs_private.societe_ok(f.societe_id)
$$;

revoke all on function gbs_private.trg_tresorerie_rpc(), gbs_private.mouvements_prevus(uuid, date, int, text, numeric) from public, anon, authenticated;
revoke all on function gbs.creer_flux_prevu(jsonb), gbs.desactiver_flux_prevu(uuid), gbs.creer_couverture(jsonb),
  gbs.prevision_tresorerie(uuid, int, int, text, numeric), gbs.exposition_change(uuid) from public, anon;
grant execute on function gbs.creer_flux_prevu(jsonb), gbs.desactiver_flux_prevu(uuid), gbs.creer_couverture(jsonb),
  gbs.prevision_tresorerie(uuid, int, int, text, numeric), gbs.exposition_change(uuid) to authenticated;
