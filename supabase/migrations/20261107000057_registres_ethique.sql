-- Qualité : registres éthiques (M30, lot 2 ; maquette ETH), sur les principes de la norme ISO 37001.
-- * Déclaration par tout collaborateur interne : cadeau reçu, invitation, conflit d'intérêts,
--   sollicitation (dont toute demande ou offre de commission d'un fournisseur), autre ; avec le tiers,
--   le fournisseur éventuel, la valeur et la devise.
-- * Un cadeau ou une invitation sous le seuil paramétré est accepté d'office ; au-delà, et pour tout
--   autre type, la décision revient à l'administratrice (acceptée, refusée et restituée, mise à l'écart
--   du dossier, prise acte) avec un motif. Une décision rendue est figée.
-- * Chacun voit ses propres déclarations ; l'administratrice voit tout. Le déclarant est l'utilisateur
--   connecté, jamais saisi. Écritures par fonctions, journalisées ; aucune suppression.
-- * L'engagement de non-commission des fournisseurs existe déjà (fournisseurs.engagement_non_commission_le).

insert into gbs.parametres_definitions (cle, type, minimum, maximum, validateur, module, libelle) values
  ('ethique.seuil_cadeau_cny', 'nombre', 0, 100000, null, 'qualite', 'Seuil des cadeaux et invitations acceptés d''office (CNY)');
insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('ethique.seuil_cadeau_cny', '500', date '2026-01-01', 'Valeur de la maquette : à confirmer par la direction');

create table gbs.declarations_ethique (
  id             uuid primary key default gen_random_uuid(),
  reference      text not null unique check (reference ~ '^ETH-[0-9]{4}-[0-9]{3,5}$'),
  declarant_id   uuid not null references gbs.profils(id),
  date_fait      date not null check (date_fait <= current_date),
  type           text not null check (type in ('cadeau','invitation','conflit_interets','sollicitation','autre')),
  tiers          text not null check (length(trim(tiers)) between 2 and 200),
  fournisseur_id uuid references gbs.fournisseurs(id),
  dossier_id     uuid references gbs.dossiers(id),
  valeur         numeric(14,2) check (valeur >= 0 and valeur <= 1e10),
  devise         char(3) check (devise in ('CNY','XOF','XAF','USD','EUR')),
  description    text not null check (length(trim(description)) between 5 and 2000),
  decision       text not null default 'a_decider' check (decision in ('a_decider','accepte','refuse_restitue','mise_a_ecart','prise_acte')),
  decide_par     uuid references gbs.profils(id),
  decide_le      timestamptz,
  motif_decision text check (length(motif_decision) <= 1000),
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check ((valeur is null) = (devise is null))
);
create index on gbs.declarations_ethique (declarant_id);

create or replace function gbs_private.trg_ethique_rpc() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'ethique' then
    raise exception 'GBS_VALIDATION_RPC: les déclarations éthiques se modifient par les fonctions dédiées' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and old.decision <> 'a_decider' then raise exception 'GBS_DECISION_RENDUE' using errcode = 'P0001'; end if;
  return new;
end $$;

alter table gbs.declarations_ethique enable row level security;
grant select on gbs.declarations_ethique to authenticated;
create trigger ethique_rpc before insert or update on gbs.declarations_ethique for each row execute function gbs_private.trg_ethique_rpc();
create trigger ethique_touch before update on gbs.declarations_ethique for each row execute function gbs_private.trg_touch();
create trigger ethique_cree before insert on gbs.declarations_ethique for each row execute function gbs_private.trg_cree_par();
create trigger ethique_audit after insert or update on gbs.declarations_ethique for each row execute function gbs_private.trg_audit();
create trigger ethique_nodel before delete on gbs.declarations_ethique for each row execute function gbs_private.trg_no_delete();
create policy ethique_lecture on gbs.declarations_ethique for select using (
  gbs_private.interne() and (declarant_id = auth.uid() or gbs_private.is_admin()));

create or replace function gbs.declarer_ethique(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare n int; an int := extract(year from current_date)::int; r uuid; t text; v numeric; dv text; seuil numeric; dec text := 'a_decider';
begin
  perform gbs_private.exiger(gbs_private.interne() and auth.uid() is not null);
  if jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) k where k not in ('date_fait','type','tiers','fournisseur_id','dossier_id','valeur','devise','description'))
     or coalesce(jsonb_typeof(p -> 'date_fait'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'type'), '') <> 'string'
     or coalesce(jsonb_typeof(p -> 'tiers'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'description'), '') <> 'string'
     or (p ? 'valeur' and jsonb_typeof(p -> 'valeur') not in ('number','null')) or (p ? 'devise' and jsonb_typeof(p -> 'devise') not in ('string','null'))
     or (p ? 'fournisseur_id' and jsonb_typeof(p -> 'fournisseur_id') not in ('string','null'))
     or (p ? 'dossier_id' and jsonb_typeof(p -> 'dossier_id') not in ('string','null')) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  t := p ->> 'type'; v := (p ->> 'valeur')::numeric; dv := nullif(p ->> 'devise', '');
  if nullif(p ->> 'dossier_id', '') is not null and not gbs_private.dossier_visible((p ->> 'dossier_id')::uuid) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  -- Cadeau ou invitation sous le seuil : accepté d'office (valeur convertie en CNY au dernier taux).
  if t in ('cadeau','invitation') and v is not null and dv is not null then
    seuil := gbs_private.param_num('ethique.seuil_cadeau_cny', current_date);
    if (case when dv = 'CNY' then v else gbs_private.to_xof(v, dv, current_date) / gbs_private.taux_xof('CNY', current_date) end) <= seuil then
      dec := 'accepte';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('gbs.declarations_ethique'));
  select coalesce(max(substring(reference from '-([0-9]+)$')::int), 0) + 1 into n
    from gbs.declarations_ethique where reference like 'ETH-' || an || '-%';
  perform gbs_private.rpc('ethique');
  insert into gbs.declarations_ethique (reference, declarant_id, date_fait, type, tiers, fournisseur_id, dossier_id, valeur, devise, description, decision,
                                        motif_decision, decide_le)
  values ('ETH-' || an || '-' || lpad(n::text, 3, '0'), auth.uid(), (p ->> 'date_fait')::date, t, trim(p ->> 'tiers'),
          nullif(p ->> 'fournisseur_id', '')::uuid, nullif(p ->> 'dossier_id', '')::uuid, v, dv, trim(p ->> 'description'), dec,
          case when dec = 'accepte' then 'Sous le seuil paramétré' end, case when dec = 'accepte' then now() end)
  returning id into r;
  perform gbs_private.rpc('');
  return r;
exception
  when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow
       or numeric_value_out_of_range or foreign_key_violation then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

create or replace function gbs.decider_ethique(p_declaration uuid, p_decision text, p_motif text) returns void
language plpgsql security definer set search_path = '' as $$
declare d gbs.declarations_ethique;
begin
  perform gbs_private.exiger(gbs_private.is_admin());
  select * into d from gbs.declarations_ethique where id = p_declaration for update;
  if d.id is null or p_decision not in ('accepte','refuse_restitue','mise_a_ecart','prise_acte') then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if d.decision <> 'a_decider' then raise exception 'GBS_DECISION_RENDUE' using errcode = 'P0001'; end if;
  -- Une déclaration ne se tranche pas par son propre auteur.
  if d.declarant_id = auth.uid() then raise exception 'GBS_AUTO_VALIDATION' using errcode = 'P0001'; end if;
  perform gbs_private.motif(p_motif);
  perform gbs_private.rpc('ethique');
  update gbs.declarations_ethique set decision = p_decision, decide_par = auth.uid(), decide_le = now(), motif_decision = trim(p_motif) where id = d.id;
  perform gbs_private.rpc('');
end $$;

-- Engagements de non-commission des fournisseurs actifs (lecture pour l'écran).
create or replace function gbs.engagements_non_commission()
returns table (fournisseur_id uuid, fournisseur text, signe_le date)
language sql stable security definer set search_path = '' as $$
  select f.id, f.raison_sociale_en, f.engagement_non_commission_le from gbs.fournisseurs f
   where gbs_private.has_role('admin','achats_chine') order by f.engagement_non_commission_le is not null, f.raison_sociale_en
$$;

revoke all on function gbs_private.trg_ethique_rpc() from public, anon, authenticated;
revoke all on function gbs.declarer_ethique(jsonb), gbs.decider_ethique(uuid, text, text), gbs.engagements_non_commission() from public, anon;
grant execute on function gbs.declarer_ethique(jsonb), gbs.decider_ethique(uuid, text, text), gbs.engagements_non_commission() to authenticated;
