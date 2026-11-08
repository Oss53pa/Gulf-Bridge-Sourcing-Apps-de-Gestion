-- Lot 1, M5 : suivi des échantillons (demande, envoi, numéro de suivi, coût, refacturation au
-- client ou prise en charge par GBS).
-- * Cycle : demandé, expédié (transporteur et numéro de suivi), reçu, évalué ; ou annulé (motif).
-- * Coût enregistré avec son justificatif : il devient un coût « échantillon » du dossier (marge
--   directe) ; la décision de prise en charge est obligatoire, motivée si GBS l'absorbe.
-- * Refacturation au client : ajout d'une ligne au coût, convertie dans la devise de la facture,
--   sur une facture brouillon du même dossier, par qui peut facturer ; un échantillon n'est
--   jamais refacturé deux fois.

create table gbs.echantillons (
  id               uuid primary key default gen_random_uuid(),
  dossier_id       uuid not null references gbs.dossiers(id),
  consultation_id  uuid references gbs.consultations_fournisseurs(id),
  fournisseur_id   uuid not null references gbs.fournisseurs(id),
  designation      text not null check (length(trim(designation)) between 2 and 200),
  quantite         numeric(10,2) not null default 1 check (quantite > 0 and quantite <= 10000),
  statut           text not null default 'demande' check (statut in ('demande','expedie','recu','evalue','annule')),
  demande_le       date not null default current_date,
  transporteur     text check (length(transporteur) <= 80),
  numero_suivi     text check (numero_suivi ~ '^[A-Za-z0-9-]{4,40}$'),
  envoye_le        date,
  recu_le          date,
  lieu_reception   text check (length(lieu_reception) <= 120),
  evaluation       text check (evaluation in ('conforme','non_conforme')),
  avis             text check (length(avis) <= 2000),
  motif_annulation text check (length(motif_annulation) <= 1000),
  cout_id          uuid unique references gbs.couts(id),
  prise_en_charge  text check (prise_en_charge in ('client','gbs')),
  motif_prise_en_charge text check (length(motif_prise_en_charge) <= 1000),
  ligne_facture_id uuid unique references gbs.lignes_facture(id) on delete set null,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check ((cout_id is null) = (prise_en_charge is null)),
  check (prise_en_charge is distinct from 'gbs' or motif_prise_en_charge is not null),
  check (ligne_facture_id is null or prise_en_charge = 'client')
);
create index on gbs.echantillons (dossier_id);

-- -----------------------------------------------------------------------------
-- Règles
-- -----------------------------------------------------------------------------
create or replace function gbs_private.trg_echantillon() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.consultation_id is not null and not exists (select 1 from gbs.consultations_fournisseurs c
         where c.id = new.consultation_id and c.dossier_id = new.dossier_id) then
      raise exception 'GBS_CONSULTATION_AUTRE_DOSSIER' using errcode = '22023';
    end if;
    -- Une demande naît « demandée », sans envoi, coût ni facture.
    if coalesce(current_setting('gbs.rpc', true), '') <> 'echantillon' then
      new.statut := 'demande'; new.transporteur := null; new.numero_suivi := null; new.envoye_le := null; new.recu_le := null;
      new.lieu_reception := null; new.evaluation := null; new.avis := null; new.motif_annulation := null;
      new.cout_id := null; new.prise_en_charge := null; new.motif_prise_en_charge := null; new.ligne_facture_id := null;
    end if;
    return new;
  end if;
  -- Ligne de facture retirée d'un brouillon : l'échantillon redevient à refacturer.
  if new.ligne_facture_id is null and old.ligne_facture_id is not null
     and (to_jsonb(new) - 'ligne_facture_id' - 'modifie_le' - 'modifie_par') = (to_jsonb(old) - 'ligne_facture_id' - 'modifie_le' - 'modifie_par') then
    return new;
  end if;
  if coalesce(current_setting('gbs.rpc', true), '') <> 'echantillon'
     and (new.statut, new.transporteur, new.numero_suivi, new.envoye_le, new.recu_le, new.lieu_reception, new.evaluation, new.avis,
          new.motif_annulation, new.cout_id, new.prise_en_charge, new.motif_prise_en_charge, new.ligne_facture_id,
          new.dossier_id, new.fournisseur_id, new.consultation_id)
         is distinct from
         (old.statut, old.transporteur, old.numero_suivi, old.envoye_le, old.recu_le, old.lieu_reception, old.evaluation, old.avis,
          old.motif_annulation, old.cout_id, old.prise_en_charge, old.motif_prise_en_charge, old.ligne_facture_id,
          old.dossier_id, old.fournisseur_id, old.consultation_id) then
    raise exception 'GBS_VALIDATION_RPC: le suivi d''un échantillon passe par les fonctions dédiées' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger echantillons_regles before insert or update on gbs.echantillons
  for each row execute function gbs_private.trg_echantillon();

do $$
begin
  execute 'create trigger echantillons_touch before update on gbs.echantillons for each row execute function gbs_private.trg_touch()';
  execute 'create trigger echantillons_cree before insert on gbs.echantillons for each row execute function gbs_private.trg_cree_par()';
  execute 'create trigger echantillons_audit after insert or update or delete on gbs.echantillons for each row execute function gbs_private.trg_audit()';
  execute 'create trigger echantillons_nodel before delete on gbs.echantillons for each row execute function gbs_private.trg_no_delete()';
end $$;

create or replace function gbs_private.echantillon_ecrit(p_dossier uuid, p_reception boolean default false) returns boolean
language sql stable security definer set search_path = '' as $$
  select gbs_private.dossier_visible(p_dossier)
     and (gbs_private.has_role('admin','achats_chine') or (p_reception and gbs_private.has_role('hub_afrique')))
$$;

-- Passage d'un état à l'autre, chacun avec ses informations obligatoires.
create or replace function gbs.suivre_echantillon(p_echantillon uuid, p_statut text, p_infos jsonb default '{}'::jsonb)
returns gbs.echantillons language plpgsql security definer set search_path = '' as $$
declare x gbs.echantillons; i jsonb := coalesce(p_infos, '{}'::jsonb); d date;
begin
  select * into x from gbs.echantillons where id = p_echantillon for update;
  perform gbs_private.exiger(x.id is not null and gbs_private.echantillon_ecrit(x.dossier_id, p_statut in ('recu','evalue')));
  if jsonb_typeof(i) <> 'object' or exists (select 1 from jsonb_object_keys(i) k
       where k not in ('transporteur','numero_suivi','envoye_le','recu_le','lieu_reception','evaluation','avis','motif')) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if x.statut in ('evalue','annule')
     or not ((x.statut = 'demande' and p_statut in ('expedie','annule')) or (x.statut = 'expedie' and p_statut in ('recu','annule'))
             or (x.statut = 'recu' and p_statut = 'evalue')) then
    raise exception 'GBS_TRANSITION_INVALIDE: % vers %', x.statut, p_statut using errcode = 'P0001';
  end if;
  perform set_config('gbs.rpc', 'echantillon', true);
  if p_statut = 'expedie' then
    d := nullif(i ->> 'envoye_le', '')::date;
    if length(trim(coalesce(i ->> 'transporteur', ''))) not between 2 and 80 or coalesce(i ->> 'numero_suivi', '') !~ '^[A-Za-z0-9-]{4,40}$'
       or d is null or d > current_date or d < x.demande_le then
      raise exception 'GBS_ECHANTILLON_ENVOI_INCOMPLET: transporteur, numéro de suivi et date d''envoi exigés' using errcode = '22023';
    end if;
    update gbs.echantillons set statut = 'expedie', transporteur = trim(i ->> 'transporteur'), numero_suivi = upper(i ->> 'numero_suivi'), envoye_le = d
     where id = x.id returning * into x;
  elsif p_statut = 'recu' then
    d := nullif(i ->> 'recu_le', '')::date;
    if d is null or d > current_date or d < x.envoye_le or length(i ->> 'lieu_reception') > 120 then
      raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
    end if;
    update gbs.echantillons set statut = 'recu', recu_le = d, lieu_reception = nullif(trim(i ->> 'lieu_reception'), '') where id = x.id returning * into x;
  elsif p_statut = 'evalue' then
    if coalesce(i ->> 'evaluation', '') not in ('conforme','non_conforme') or length(trim(coalesce(i ->> 'avis', ''))) not between 5 and 2000 then
      raise exception 'GBS_ECHANTILLON_AVIS_REQUIS' using errcode = '22023';
    end if;
    update gbs.echantillons set statut = 'evalue', evaluation = i ->> 'evaluation', avis = trim(i ->> 'avis') where id = x.id returning * into x;
  else
    if length(trim(coalesce(i ->> 'motif', ''))) not between 5 and 1000 then raise exception 'GBS_MOTIF_OBLIGATOIRE' using errcode = '22023'; end if;
    update gbs.echantillons set statut = 'annule', motif_annulation = trim(i ->> 'motif') where id = x.id returning * into x;
  end if;
  perform set_config('gbs.rpc', '', true);
  return x;
end $$;

-- Coût de l'échantillon : coût « échantillon » du dossier, justificatif obligatoire ; décision de
-- prise en charge (client : à refacturer ; GBS : motif obligatoire).
create or replace function gbs.enregistrer_cout_echantillon(p_echantillon uuid, p_montant numeric, p_devise text, p_date date,
                                                         p_justificatif text, p_prise_en_charge text, p_motif text default null)
returns gbs.echantillons language plpgsql security definer set search_path = '' as $$
declare x gbs.echantillons; c uuid;
begin
  select * into x from gbs.echantillons where id = p_echantillon for update;
  perform gbs_private.exiger(x.id is not null and gbs_private.echantillon_ecrit(x.dossier_id));
  if x.cout_id is not null then raise exception 'GBS_ECHANTILLON_COUT_DEJA_SAISI' using errcode = 'P0001'; end if;
  if x.statut = 'annule' and p_prise_en_charge = 'client' then raise exception 'GBS_TRANSITION_INVALIDE' using errcode = 'P0001'; end if;
  if p_montant is null or p_montant <= 0 or p_montant >= 1e9 or p_devise not in ('CNY','USD','XOF','XAF','EUR')
     or p_date is null or p_date > current_date or p_date < date '2026-01-01' or p_prise_en_charge not in ('client','gbs')
     or (p_prise_en_charge = 'gbs' and length(trim(coalesce(p_motif, ''))) not between 5 and 1000) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if p_justificatif is null or p_justificatif !~ ('^' || x.dossier_id::text || '/[0-9a-f-]{36}\.(pdf|png|jpg|webp)$') then
    raise exception 'GBS_JUSTIFICATIF_INVALIDE' using errcode = '22023';
  end if;
  insert into gbs.couts (nature, dossier_id, categorie, libelle, date_cout, devise, montant_ht, justificatif_chemin)
  values ('cout', x.dossier_id, 'echantillon', left('Échantillon — ' || x.designation, 300), p_date, p_devise, round(p_montant, 2), p_justificatif)
  returning id into c;
  perform set_config('gbs.rpc', 'echantillon', true);
  update gbs.echantillons set cout_id = c, prise_en_charge = p_prise_en_charge,
         motif_prise_en_charge = case when p_prise_en_charge = 'gbs' then trim(p_motif) end
   where id = x.id returning * into x;
  perform set_config('gbs.rpc', '', true);
  return x;
end $$;

-- Refacturation au client : une ligne au coût, convertie dans la devise de la facture au taux du
-- jour du coût, sur une facture brouillon du même dossier.
create or replace function gbs.refacturer_echantillon(p_echantillon uuid, p_facture uuid)
returns gbs.lignes_facture language plpgsql security definer set search_path = '' as $$
declare x gbs.echantillons; f gbs.factures; c gbs.couts; l gbs.lignes_facture; pu numeric;
begin
  select * into x from gbs.echantillons where id = p_echantillon for update;
  select * into f from gbs.factures where id = p_facture for update;
  perform gbs_private.exiger(x.id is not null and f.id is not null and gbs_private.peut_facturer(f.societe_id) and gbs_private.dossier_visible(x.dossier_id));
  if x.prise_en_charge is distinct from 'client' then raise exception 'GBS_ECHANTILLON_NON_REFACTURABLE' using errcode = 'P0001'; end if;
  if x.ligne_facture_id is not null then raise exception 'GBS_ECHANTILLON_DEJA_REFACTURE' using errcode = 'P0001'; end if;
  if f.statut <> 'brouillon' or f.dossier_id is distinct from x.dossier_id or f.societe_dest_id is not null then
    raise exception 'GBS_FACTURE_INCOMPATIBLE: facture brouillon du même dossier exigée' using errcode = 'P0001';
  end if;
  select * into c from gbs.couts where id = x.cout_id;
  pu := gbs_private.depuis_xof(gbs_private.to_xof(c.montant_ht, c.devise, c.date_cout), f.devise, c.date_cout);
  insert into gbs.lignes_facture (facture_id, libelle, quantite, prix_unitaire, dossier_ref)
  values (f.id, left('Échantillon refacturé au coût — ' || x.designation, 300), 1, pu, x.dossier_id)
  returning * into l;
  perform set_config('gbs.rpc', 'echantillon', true);
  update gbs.echantillons set ligne_facture_id = l.id where id = x.id;
  perform set_config('gbs.rpc', '', true);
  return l;
end $$;

-- Échantillons à refacturer : coût à la charge du client, pas encore sur une facture.
create or replace function gbs.echantillons_a_refacturer()
returns table (echantillon_id uuid, dossier_id uuid, designation text, montant numeric, devise text, date_cout date)
language sql stable security definer set search_path = '' as $$
  select x.id, x.dossier_id, x.designation, c.montant_ht, c.devise::text, c.date_cout
    from gbs.echantillons x join gbs.couts c on c.id = x.cout_id
    join gbs.dossiers d on d.id = x.dossier_id
   where x.prise_en_charge = 'client' and x.ligne_facture_id is null
     and gbs_private.dossier_visible(x.dossier_id) and gbs_private.peut_facturer(d.societe_id)
   order by c.date_cout
$$;

-- -----------------------------------------------------------------------------
-- Droits
-- -----------------------------------------------------------------------------
alter table gbs.echantillons enable row level security;
grant select, insert on gbs.echantillons to authenticated;
grant update (designation, quantite) on gbs.echantillons to authenticated;
create policy echantillons_lecture on gbs.echantillons for select using (
  gbs_private.has_role('admin','achats_chine','hub_afrique','comptable') and gbs_private.dossier_visible(dossier_id));
create policy echantillons_creation on gbs.echantillons for insert with check (gbs_private.echantillon_ecrit(dossier_id));
create policy echantillons_maj on gbs.echantillons for update using (gbs_private.echantillon_ecrit(dossier_id) and statut = 'demande');

revoke execute on function gbs.suivre_echantillon(uuid, text, jsonb), gbs.enregistrer_cout_echantillon(uuid, numeric, text, date, text, text, text),
  gbs.refacturer_echantillon(uuid, uuid), gbs.echantillons_a_refacturer(), gbs_private.trg_echantillon(),
  gbs_private.echantillon_ecrit(uuid, boolean) from public;
grant execute on function gbs.suivre_echantillon(uuid, text, jsonb), gbs.enregistrer_cout_echantillon(uuid, numeric, text, date, text, text, text),
  gbs.refacturer_echantillon(uuid, uuid), gbs.echantillons_a_refacturer() to authenticated;
grant execute on all functions in schema gbs_private to authenticated, service_role;
