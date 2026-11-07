-- Lot 1, M7 : pénalités de retard calculées selon le contrat (taux par jour, plafond)
-- et proposées en retenue sur le solde. Le retard se compte en jours calendaires entre
-- la date de livraison promise (décalée par les avenants signés) et la date de livraison
-- effective au sens de l'Incoterm, saisie par les achats ; tant qu'elle manque, le calcul
-- court jusqu'à aujourd'hui et la pénalité est « provisoire ».

alter table gbs.commandes
  add column livraison_reelle_le date;

create or replace function gbs_private.trg_commande_livraison() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.livraison_reelle_le is distinct from old.livraison_reelle_le and new.livraison_reelle_le is not null then
    if new.livraison_reelle_le > current_date
       or (new.contrat_signe_le is not null and new.livraison_reelle_le < new.contrat_signe_le) then
      raise exception 'GBS_DATE_LIVRAISON_INVALIDE' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
create trigger commandes_livraison before update on gbs.commandes
  for each row execute function gbs_private.trg_commande_livraison();

create or replace function gbs_private.penalite_commande(p_commande uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c gbs.commandes; jusqua date; jours int; brut numeric; plafond numeric; montant numeric;
begin
  select * into c from gbs.commandes where id = p_commande;
  if c.id is null or c.date_livraison_promise is null or coalesce(c.penalite_taux_jour, 0) = 0 then
    return jsonb_build_object('applicable', false);
  end if;
  jusqua := coalesce(c.livraison_reelle_le, current_date);
  jours := greatest(jusqua - c.date_livraison_promise, 0);
  brut := round(c.montant_marchandise * c.penalite_taux_jour * jours, 2);
  plafond := round(c.montant_marchandise * coalesce(c.penalite_plafond, 1), 2);
  montant := least(brut, plafond);
  return jsonb_build_object('applicable', true, 'devise', c.devise, 'date_promise', c.date_livraison_promise,
    'date_reference', jusqua, 'provisoire', c.livraison_reelle_le is null, 'jours_retard', jours,
    'taux_jour', c.penalite_taux_jour, 'plafond', c.penalite_plafond, 'base', c.montant_marchandise,
    'montant_brut', brut, 'montant', montant, 'plafonnee', brut > plafond);
end $$;

create or replace function gbs.penalite_commande(p_commande uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine','comptable')
    and exists (select 1 from gbs.commandes c where c.id = p_commande and gbs_private.dossier_visible(c.dossier_id)));
  return gbs_private.penalite_commande(p_commande);
end $$;

-- -----------------------------------------------------------------------------
-- Retenue sur le solde : proposée par le calcul, décidée par la personne qui prépare
-- l'ordre (vu par le second validateur), motivée si elle est inférieure à la proposition.
-- -----------------------------------------------------------------------------
alter table gbs.paiements_fournisseurs
  add column penalite_proposee numeric(16,2),
  add column penalite_retenue numeric(16,2) not null default 0 check (penalite_retenue >= 0),
  add column penalite_motif text check (length(penalite_motif) <= 1000);

create or replace function gbs_private.trg_paiement_penalite() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p jsonb; cmd gbs.commandes; proposee numeric;
begin
  if tg_op = 'UPDATE' then
    if (new.penalite_proposee, new.penalite_retenue, new.penalite_motif)
       is distinct from (old.penalite_proposee, old.penalite_retenue, old.penalite_motif) then
      raise exception 'GBS_PAIEMENT_FIGE' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.nature <> 'solde' then
    if new.penalite_retenue <> 0 then raise exception 'GBS_PENALITE_SUR_SOLDE' using errcode = '22023'; end if;
    new.penalite_proposee := null; new.penalite_motif := null;
    return new;
  end if;
  select * into cmd from gbs.commandes where id = new.commande_id;
  p := gbs_private.penalite_commande(new.commande_id);
  proposee := 0;
  if (p ->> 'applicable')::boolean then
    -- Pénalité exprimée dans la devise de l'ordre de paiement.
    proposee := case when cmd.devise = new.devise then (p ->> 'montant')::numeric
                     else round(gbs_private.to_xof((p ->> 'montant')::numeric, cmd.devise, current_date)
                                / gbs_private.taux_xof(new.devise, current_date), 2) end;
  end if;
  new.penalite_proposee := proposee;
  if new.penalite_retenue > proposee then
    raise exception 'GBS_RETENUE_SUPERIEURE: la retenue dépasse la pénalité calculée' using errcode = '22023';
  end if;
  if new.penalite_retenue < proposee then
    if new.penalite_motif is null or length(trim(new.penalite_motif)) < 5 then
      raise exception 'GBS_MOTIF_OBLIGATOIRE: renoncer à tout ou partie de la pénalité exige un motif' using errcode = 'P0001';
    end if;
  else
    new.penalite_motif := nullif(trim(coalesce(new.penalite_motif, '')), '');
  end if;
  return new;
end $$;
create trigger paiements_penalite before insert or update on gbs.paiements_fournisseurs
  for each row execute function gbs_private.trg_paiement_penalite();

revoke execute on function gbs.penalite_commande(uuid), gbs_private.penalite_commande(uuid),
  gbs_private.trg_commande_livraison(), gbs_private.trg_paiement_penalite() from public;
grant execute on function gbs.penalite_commande(uuid) to authenticated;
grant execute on all functions in schema gbs_private to authenticated, service_role;
