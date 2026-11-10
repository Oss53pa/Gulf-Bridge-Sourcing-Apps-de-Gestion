-- Portail fournisseur : demande de nouveau compte de paiement (changement de coordonnées bancaires).
-- Le changement de compte est le premier vecteur de fraude au paiement fournisseur. Règles :
-- * Le portail ne crée jamais de compte : il dépose une demande. Seuls l'administratrice et les achats
--   Chine la traitent ; l'acceptation crée un compte « non vérifié », soumis ensuite au contrôle à quatre
--   yeux existant (demande de vérification puis validation par une autre personne) avant tout paiement.
-- * Demande réservée au sous-rôle finance du fournisseur, en double facteur (mon_fournisseur).
-- * Une seule demande en attente par fournisseur ; plafond de demandes sur 30 jours (paramètre).
-- * Le fournisseur revoit ses demandes avec le numéro masqué ; une demande traitée est figée.

insert into gbs.parametres_definitions (cle, type, minimum, maximum, validateur, module, libelle) values
  ('portail.max_demandes_compte_30j', 'entier', 1, 20, null, 'achats', 'Demandes de changement de compte au plus par fournisseur sur 30 jours (portail)');
insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('portail.max_demandes_compte_30j', '3', date '2026-01-01', 'Limite anti-abus du portail fournisseur');

create table gbs.demandes_comptes_fournisseurs (
  id             uuid primary key default gen_random_uuid(),
  fournisseur_id uuid not null references gbs.fournisseurs(id),
  auteur_id      uuid not null references gbs.profils(id),
  type           text not null check (type in ('banque','wechat_pay','alipay')),
  titulaire      text not null check (length(trim(titulaire)) between 2 and 200),
  devise         char(3) not null check (devise in ('USD','CNY')),
  banque         text check (length(banque) <= 200),
  numero         text not null check (numero ~ '^[A-Za-z0-9 -]{4,64}$'),
  swift          text check (swift ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$'),
  titulaire_est_entreprise boolean not null default true,
  motif          text not null check (length(trim(motif)) between 5 and 1000),
  statut         text not null default 'nouvelle' check (statut in ('nouvelle','acceptee','refusee')),
  compte_id      uuid references gbs.comptes_paiement(id),
  motif_refus    text check (length(motif_refus) <= 1000),
  traitee_par    uuid references gbs.profils(id),
  traitee_le     timestamptz,
  cree_le        timestamptz not null default clock_timestamp(),
  check (type = 'banque' or titulaire_est_entreprise),
  check (type <> 'banque' or banque is not null),
  check (statut <> 'acceptee' or compte_id is not null),
  check (statut <> 'refusee' or motif_refus is not null)
);
create index on gbs.demandes_comptes_fournisseurs (fournisseur_id, cree_le);
create unique index demandes_comptes_une_en_attente on gbs.demandes_comptes_fournisseurs (fournisseur_id) where statut = 'nouvelle';

create or replace function gbs_private.trg_demande_compte_rpc() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'demande_compte' then
    raise exception 'GBS_VALIDATION_RPC: les demandes de compte se modifient par les fonctions dédiées' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and old.statut <> 'nouvelle' then raise exception 'GBS_DEMANDE_TRAITEE' using errcode = 'P0001'; end if;
  return new;
end $$;

alter table gbs.demandes_comptes_fournisseurs enable row level security;
grant select on gbs.demandes_comptes_fournisseurs to authenticated;
create trigger demandes_comptes_rpc before insert or update on gbs.demandes_comptes_fournisseurs for each row execute function gbs_private.trg_demande_compte_rpc();
create trigger demandes_comptes_audit after insert or update on gbs.demandes_comptes_fournisseurs for each row execute function gbs_private.trg_audit();
create trigger demandes_comptes_nodel before delete on gbs.demandes_comptes_fournisseurs for each row execute function gbs_private.trg_no_delete();
-- Lecture directe : l'équipe qui gère les comptes de paiement. Le fournisseur passe par espace_fournisseur (numéro masqué).
create policy demandes_comptes_lecture on gbs.demandes_comptes_fournisseurs for select using (gbs_private.has_role('admin','achats_chine'));

create or replace function gbs.demander_compte_fournisseur(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare f uuid := gbs_private.mon_fournisseur(); r uuid; n int;
begin
  perform gbs_private.exiger(f is not null and exists (select 1 from gbs.profils x where x.id = auth.uid() and x.sous_role = 'finance'));
  if jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) k where k not in ('type','titulaire','devise','banque','numero','swift','titulaire_est_entreprise','motif'))
     or coalesce(jsonb_typeof(p -> 'type'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'titulaire'), '') <> 'string'
     or coalesce(jsonb_typeof(p -> 'devise'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'numero'), '') <> 'string'
     or coalesce(jsonb_typeof(p -> 'motif'), '') <> 'string'
     or (p ? 'banque' and jsonb_typeof(p -> 'banque') not in ('string','null'))
     or (p ? 'swift' and jsonb_typeof(p -> 'swift') not in ('string','null'))
     or (p ? 'titulaire_est_entreprise' and jsonb_typeof(p -> 'titulaire_est_entreprise') <> 'boolean') then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('gbs.demandes_comptes.' || f::text));
  if exists (select 1 from gbs.demandes_comptes_fournisseurs where fournisseur_id = f and statut = 'nouvelle') then
    raise exception 'GBS_DEMANDE_EN_COURS' using errcode = 'P0001';
  end if;
  select count(*) into n from gbs.demandes_comptes_fournisseurs where fournisseur_id = f and cree_le > now() - interval '30 days';
  if n >= gbs_private.param_num('portail.max_demandes_compte_30j', current_date) then
    raise exception 'GBS_TROP_DE_DEMANDES' using errcode = 'P0001';
  end if;
  perform gbs_private.rpc('demande_compte');
  insert into gbs.demandes_comptes_fournisseurs (fournisseur_id, auteur_id, type, titulaire, devise, banque, numero, swift, titulaire_est_entreprise, motif)
  values (f, auth.uid(), p ->> 'type', trim(p ->> 'titulaire'), p ->> 'devise', nullif(trim(p ->> 'banque'), ''), trim(p ->> 'numero'),
          nullif(upper(trim(p ->> 'swift')), ''), coalesce((p ->> 'titulaire_est_entreprise')::boolean, true), trim(p ->> 'motif'))
  returning id into r;
  perform gbs_private.rpc('');
  return r;
exception
  when check_violation or not_null_violation or invalid_text_representation then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

-- Traitement : acceptation (compte créé non vérifié, quatre yeux ensuite) ou refus motivé.
create or replace function gbs.traiter_demande_compte(p_demande uuid, p_accepter boolean, p_motif text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d gbs.demandes_comptes_fournisseurs; c uuid;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine'));
  select * into d from gbs.demandes_comptes_fournisseurs where id = p_demande for update;
  if d.id is null or p_accepter is null then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  if d.statut <> 'nouvelle' then raise exception 'GBS_DEMANDE_TRAITEE' using errcode = 'P0001'; end if;
  if p_accepter then
    insert into gbs.comptes_paiement (fournisseur_id, type, titulaire, devise, banque, numero, swift, titulaire_est_entreprise)
    values (d.fournisseur_id, d.type, d.titulaire, d.devise, d.banque, d.numero, d.swift, d.titulaire_est_entreprise)
    returning id into c;
    perform gbs_private.rpc('demande_compte');
    update gbs.demandes_comptes_fournisseurs set statut = 'acceptee', compte_id = c, traitee_par = auth.uid(), traitee_le = now() where id = d.id;
  else
    perform gbs_private.motif(p_motif);
    perform gbs_private.rpc('demande_compte');
    update gbs.demandes_comptes_fournisseurs set statut = 'refusee', motif_refus = trim(p_motif), traitee_par = auth.uid(), traitee_le = now() where id = d.id;
  end if;
  perform gbs_private.rpc('');
  return c;
end $$;

-- Espace fournisseur : ses demandes, numéro masqué ; le motif de refus interne n'est pas montré.
create or replace function gbs_private.demandes_compte_du_fournisseur(p_fournisseur uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('type', d.type, 'banque', d.banque, 'devise', d.devise, 'fin_numero', right(d.numero, 4),
           'statut', d.statut, 'cree_le', d.cree_le, 'traitee_le', d.traitee_le) order by d.cree_le desc), '[]'::jsonb)
    from gbs.demandes_comptes_fournisseurs d where d.fournisseur_id = p_fournisseur
$$;

create or replace function gbs.mes_demandes_compte() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f uuid := gbs_private.mon_fournisseur();
begin
  perform gbs_private.exiger(f is not null);
  return gbs_private.demandes_compte_du_fournisseur(f);
end $$;

revoke all on function gbs_private.trg_demande_compte_rpc(), gbs_private.demandes_compte_du_fournisseur(uuid) from public, anon, authenticated;
revoke all on function gbs.demander_compte_fournisseur(jsonb), gbs.traiter_demande_compte(uuid, boolean, text), gbs.mes_demandes_compte() from public, anon;
grant execute on function gbs.demander_compte_fournisseur(jsonb), gbs.traiter_demande_compte(uuid, boolean, text), gbs.mes_demandes_compte() to authenticated;
