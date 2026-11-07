-- Lot 1, M23 : avenants (modification signée d'une commande ou d'un délai, prix et
-- planning recalculés) et relance automatique des pièces manquantes, qui deviennent
-- des points bloquants au-delà du délai paramétré (cahier des charges, section 4 bis).

-- -----------------------------------------------------------------------------
-- Décalage en jours ouvrés, dans les deux sens.
-- -----------------------------------------------------------------------------
create or replace function gbs_private.decaler_jours_ouvres(p_pays text, p_depart date, p_n int) returns date
language plpgsql stable security definer set search_path = '' as $$
declare j date := p_depart; reste int := abs(coalesce(p_n, 0)); pas int := case when p_n < 0 then -1 else 1 end;
begin
  if reste > 3650 then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  while reste > 0 loop
    j := j + pas;
    if gbs_private.est_ouvre(p_pays, j) then reste := reste - 1; end if;
  end loop;
  return j;
end $$;

-- -----------------------------------------------------------------------------
-- Avenants.
-- -----------------------------------------------------------------------------
create table gbs.avenants (
  id            uuid primary key default gen_random_uuid(),
  reference     text unique check (reference ~ '^AVN-[0-9]{4}-[0-9]{3,5}-[0-9]{2}$'),
  dossier_id    uuid not null references gbs.dossiers(id),
  commande_id   uuid references gbs.commandes(id),
  objets        text[] not null check (cardinality(objets) between 1 and 4
                  and objets <@ array['quantite','specification','prix','delai']::text[]),
  description   text not null check (length(description) between 5 and 4000),
  -- Nouvelles valeurs des lignes : [{ "ligne_id": uuid|null, "article_id": uuid, "quantite": n, "prix_unitaire": n }]
  lignes        jsonb not null default '[]'::jsonb check (jsonb_typeof(lignes) = 'array' and jsonb_array_length(lignes) <= 200),
  impact_jours  int not null default 0 check (impact_jours between -365 and 365),
  montant_avant numeric(16,2),
  montant_apres numeric(16,2),
  impact_prix   numeric(16,2) generated always as (montant_apres - montant_avant) stored,
  statut        text not null default 'brouillon' check (statut in ('brouillon','valide','signe','refuse')),
  valide_par    uuid references gbs.profils(id),
  valide_le     timestamptz,
  motif_refus   text check (length(motif_refus) <= 1000),
  document_chemin text check (length(document_chemin) <= 400),
  signe_le      date,
  applique_par  uuid references gbs.profils(id),
  applique_le   timestamptz,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check ('delai' = any(objets) or impact_jours = 0),
  check (commande_id is not null or (objets <@ array['delai','specification']::text[] and lignes = '[]'::jsonb))
);
create index on gbs.avenants (dossier_id);
create trigger avenants_touch before update on gbs.avenants for each row execute function gbs_private.trg_touch();
create trigger avenants_cree before insert on gbs.avenants for each row execute function gbs_private.trg_cree_par();
create trigger avenants_audit after insert or update or delete on gbs.avenants for each row execute function gbs_private.trg_audit();
create trigger avenants_nodel before delete on gbs.avenants for each row execute function gbs_private.trg_no_delete();

-- Contrôle de la saisie, calcul des montants avant/après, statut tenu par les fonctions dédiées.
create or replace function gbs_private.trg_avenant() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c gbs.commandes; d gbs.dossiers; l jsonb; apres numeric := 0; n int;
begin
  select * into d from gbs.dossiers where id = new.dossier_id;
  if d.id is null or d.statut <> 'ouvert' then raise exception 'GBS_DOSSIER_FERME' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' then
    if (new.statut, new.valide_par, new.valide_le, new.document_chemin, new.signe_le, new.applique_le, new.motif_refus)
       is distinct from (old.statut, old.valide_par, old.valide_le, old.document_chemin, old.signe_le, old.applique_le, old.motif_refus)
       and coalesce(current_setting('gbs.rpc', true), '') <> 'avenant' then
      raise exception 'GBS_VALIDATION_RPC: un avenant se valide et se signe par les actions dédiées' using errcode = 'P0001';
    end if;
    if old.statut <> 'brouillon' and (new.dossier_id, new.commande_id, new.objets, new.description, new.lignes, new.impact_jours)
       is distinct from (old.dossier_id, old.commande_id, old.objets, old.description, old.lignes, old.impact_jours) then
      raise exception 'GBS_AVENANT_FIGE: seul un avenant en brouillon se modifie' using errcode = 'P0001';
    end if;
  else
    new.statut := 'brouillon'; new.valide_par := null; new.valide_le := null; new.document_chemin := null;
    new.signe_le := null; new.applique_par := null; new.applique_le := null;
    perform pg_catalog.pg_advisory_xact_lock(7322);
    select count(*) + 1 into n from gbs.avenants where dossier_id = new.dossier_id;
    new.reference := 'AVN-' || substring(d.reference from 5) || '-' || lpad(n::text, 2, '0');
  end if;
  if new.commande_id is not null then
    select * into c from gbs.commandes where id = new.commande_id;
    if c.dossier_id is distinct from new.dossier_id then
      raise exception 'GBS_COMMANDE_AUTRE_DOSSIER' using errcode = 'P0001';
    end if;
    if c.contrat_valide_le is null or c.statut in ('annulee','livree') then
      raise exception 'GBS_AVENANT_INUTILE: commande non signée (modifiez-la directement) ou terminée' using errcode = 'P0001';
    end if;
    -- Chaque ligne modifiée ou ajoutée est contrôlée ; les lignes non citées restent inchangées.
    for l in select value from jsonb_array_elements(new.lignes) loop
      if jsonb_typeof(l) <> 'object' or (select count(*) from jsonb_object_keys(l) k
           where k not in ('ligne_id','article_id','quantite','prix_unitaire')) > 0
         or jsonb_typeof(l -> 'quantite') <> 'number' or jsonb_typeof(l -> 'prix_unitaire') <> 'number'
         or (l ->> 'quantite')::numeric <= 0 or (l ->> 'quantite')::numeric > 1e9
         or (l ->> 'prix_unitaire')::numeric < 0 or (l ->> 'prix_unitaire')::numeric > 1e9
         or coalesce(l ->> 'article_id', '') !~ '^[0-9a-f-]{36}$'
         or not exists (select 1 from gbs.articles a where a.id = (l ->> 'article_id')::uuid)
         or (l ? 'ligne_id' and jsonb_typeof(l -> 'ligne_id') <> 'null'
             and (coalesce(l ->> 'ligne_id', '') !~ '^[0-9a-f-]{36}$'
                  or not exists (select 1 from gbs.lignes_commande x where x.id = (l ->> 'ligne_id')::uuid
                                   and x.commande_id = new.commande_id))) then
        raise exception 'GBS_AVENANT_LIGNE_INVALIDE' using errcode = '22023';
      end if;
    end loop;
    if (select count(*) from jsonb_array_elements(new.lignes) e where e ->> 'ligne_id' is not null)
       <> (select count(distinct e ->> 'ligne_id') from jsonb_array_elements(new.lignes) e where e ->> 'ligne_id' is not null) then
      raise exception 'GBS_AVENANT_LIGNE_INVALIDE: une ligne citée deux fois' using errcode = '22023';
    end if;
    if new.statut = 'brouillon' then
      new.montant_avant := c.montant_marchandise;
      select coalesce(sum(case when e.value is null then x.montant
                               else round((e.value ->> 'quantite')::numeric * (e.value ->> 'prix_unitaire')::numeric, 2) end), 0)
        into apres
        from gbs.lignes_commande x
        left join lateral (select value from jsonb_array_elements(new.lignes) where value ->> 'ligne_id' = x.id::text) e on true
       where x.commande_id = new.commande_id;
      select apres + coalesce(sum(round((value ->> 'quantite')::numeric * (value ->> 'prix_unitaire')::numeric, 2)), 0)
        into apres from jsonb_array_elements(new.lignes) where coalesce(value ->> 'ligne_id', '') = '';
      new.montant_apres := apres;
    end if;
    if new.montant_apres is distinct from new.montant_avant and not ('prix' = any(new.objets) or 'quantite' = any(new.objets)) then
      raise exception 'GBS_AVENANT_OBJET: un changement de montant exige l''objet « prix » ou « quantité »' using errcode = '22023';
    end if;
  else
    new.montant_avant := null; new.montant_apres := null;
  end if;
  return new;
end $$;
create trigger avenants_regles before insert or update on gbs.avenants
  for each row execute function gbs_private.trg_avenant();

alter table gbs.avenants enable row level security;
grant select, insert, update on gbs.avenants to authenticated;
create policy avenants_lecture on gbs.avenants for select using (
  gbs_private.has_role('admin','achats_chine','hub_afrique','comptable') and gbs_private.dossier_visible(dossier_id));
create policy avenants_creation on gbs.avenants for insert with check (
  gbs_private.has_role('admin','achats_chine','hub_afrique') and gbs_private.dossier_visible(dossier_id));
create policy avenants_maj on gbs.avenants for update using (
  gbs_private.has_role('admin','achats_chine','hub_afrique') and gbs_private.dossier_visible(dossier_id))
  with check (gbs_private.has_role('admin','achats_chine','hub_afrique') and gbs_private.dossier_visible(dossier_id));

-- Validation interne : administratrice ou validateur délégué, jamais l'auteur (quatre yeux).
create or replace function gbs.valider_avenant(p_avenant uuid, p_decision text, p_motif text default null)
returns gbs.avenants language plpgsql security definer set search_path = '' as $$
declare v gbs.avenants;
begin
  select * into v from gbs.avenants where id = p_avenant for update;
  perform gbs_private.exiger(v.id is not null and gbs_private.est_validateur() and gbs_private.dossier_visible(v.dossier_id),
                             'GBS_VALIDATION_ADMIN');
  if v.cree_par = auth.uid() then
    raise exception 'GBS_QUATRE_YEUX: l''auteur d''un avenant ne peut pas le valider' using errcode = 'P0001';
  end if;
  if v.statut <> 'brouillon' or p_decision not in ('valide','refuse') then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if p_decision = 'refuse' then perform gbs_private.motif(p_motif); end if;
  perform gbs_private.rpc('avenant');
  update gbs.avenants set statut = p_decision, valide_par = auth.uid(), valide_le = now(),
         motif_refus = case when p_decision = 'refuse' then p_motif end
   where id = p_avenant returning * into v;
  perform gbs_private.rpc('');
  return v;
end $$;

-- Signature : l'administratrice enregistre l'avenant signé ; prix et planning sont
-- alors mis à jour en une seule transaction.
create or replace function gbs.signer_avenant(p_avenant uuid, p_document text, p_signe_le date)
returns gbs.avenants language plpgsql security definer set search_path = '' as $$
declare v gbs.avenants; d gbs.dossiers; l jsonb; prev text; pays text; c gbs.commandes;
begin
  perform gbs_private.exiger(gbs_private.is_admin(), 'GBS_VALIDATION_ADMIN');
  select * into v from gbs.avenants where id = p_avenant for update;
  if v.id is null or v.statut <> 'valide' then
    raise exception 'GBS_AVENANT_NON_VALIDE: validation interne requise avant la signature' using errcode = 'P0001';
  end if;
  if p_document is null or p_document !~ ('^' || v.dossier_id::text || '/[0-9a-f-]{36}\.(pdf|png|jpg|webp)$')
     or p_signe_le is null or p_signe_le > current_date or p_signe_le < v.valide_le::date then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  select * into d from gbs.dossiers where id = v.dossier_id for update;
  prev := coalesce(current_setting('gbs.rpc', true), '');

  -- 1. Prix : les lignes de la commande prennent les nouvelles valeurs.
  if v.commande_id is not null then
    select * into c from gbs.commandes where id = v.commande_id for update;
    if c.montant_marchandise is distinct from v.montant_avant then
      raise exception 'GBS_AVENANT_PERIME: la commande a changé depuis la rédaction de l''avenant' using errcode = 'P0001';
    end if;
    perform gbs_private.rpc('appliquer_avenant');
    for l in select value from jsonb_array_elements(v.lignes) loop
      if coalesce(l ->> 'ligne_id', '') = '' then
        insert into gbs.lignes_commande (commande_id, article_id, quantite, prix_unitaire)
        values (v.commande_id, (l ->> 'article_id')::uuid, (l ->> 'quantite')::numeric, (l ->> 'prix_unitaire')::numeric);
      else
        update gbs.lignes_commande set article_id = (l ->> 'article_id')::uuid, quantite = (l ->> 'quantite')::numeric,
               prix_unitaire = (l ->> 'prix_unitaire')::numeric
         where id = (l ->> 'ligne_id')::uuid;
      end if;
    end loop;
    if v.impact_jours <> 0 and c.date_livraison_promise is not null then
      update gbs.commandes set date_livraison_promise =
             gbs_private.decaler_jours_ouvres('CN', c.date_livraison_promise, v.impact_jours)
       where id = v.commande_id;
    end if;
  end if;

  -- 2. Planning : dates prévues des phases non terminées décalées en jours ouvrés.
  if v.impact_jours <> 0 then
    update gbs.dossier_phases f set
      prevue_debut = case when f.prevue_debut is null or f.statut <> 'non_commencee' then f.prevue_debut
                          else gbs_private.decaler_jours_ouvres(gbs_private.pays_calendrier(f.responsable_id, d.pays), f.prevue_debut, v.impact_jours) end,
      prevue_fin = case when f.prevue_fin is null then null
                        else gbs_private.decaler_jours_ouvres(gbs_private.pays_calendrier(f.responsable_id, d.pays), f.prevue_fin, v.impact_jours) end
     where f.dossier_id = v.dossier_id and f.statut not in ('complete','validee');
  end if;

  perform gbs_private.rpc('avenant');
  update gbs.avenants set statut = 'signe', document_chemin = p_document, signe_le = p_signe_le,
         applique_par = auth.uid(), applique_le = now()
   where id = p_avenant returning * into v;
  perform gbs_private.rpc(prev);
  return v;
end $$;

-- Les lignes figées après signature ne bougent que par un avenant signé.
create or replace function gbs_private.trg_ligne_commande() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c gbs.commandes;
begin
  select * into c from gbs.commandes where id = coalesce(new.commande_id, old.commande_id);
  if c.contrat_valide_le is not null and (tg_op = 'DELETE'
       or coalesce(current_setting('gbs.rpc', true), '') <> 'appliquer_avenant') then
    raise exception 'GBS_DOCUMENT_SIGNE: lignes figées après signature ; passez par un avenant' using errcode = 'P0001';
  end if;
  if tg_op <> 'DELETE' then new.dossier_id := c.dossier_id; return new; end if;
  return old;
end $$;

-- Le recalcul du montant restaure le drapeau de l'appelant (avenant compris).
create or replace function gbs_private.trg_ligne_commande_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cid uuid := coalesce(new.commande_id, old.commande_id);
        prev text := coalesce(current_setting('gbs.rpc', true), '');
begin
  perform gbs_private.rpc('recalcul_commande');
  update gbs.commandes c set
    montant_marchandise = coalesce((select sum(montant) from gbs.lignes_commande where commande_id = cid), 0),
    sur_mesure = c.sur_mesure or exists (select 1 from gbs.lignes_commande where commande_id = cid and sur_mesure)
  where c.id = cid;
  perform gbs_private.rpc(prev);
  return null;
end $$;

-- -----------------------------------------------------------------------------
-- Demande et relance des pièces manquantes.
-- -----------------------------------------------------------------------------
alter table gbs.pieces
  add column demandee_a text check (demandee_a in ('client','fournisseur','transitaire','equipe')),
  add column demandee_le date,
  add column demandee_par uuid references gbs.profils(id),
  add column relances int not null default 0 check (relances between 0 and 1000),
  add column derniere_relance date;

alter table gbs.taches add column piece_id uuid references gbs.pieces(id);
create unique index taches_piece_ouverte on gbs.taches (piece_id) where piece_id is not null and statut in ('a_faire','en_cours');

insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('piece.delai_relance_jours', '3', date '2026-01-01',
   'Jours ouvrés entre deux relances d''une pièce demandée — valeur de départ, à confirmer par la fondatrice'),
  ('piece.delai_blocage_jours', '10', date '2026-01-01',
   'Jours ouvrés après la demande au-delà desquels la pièce manquante devient un point bloquant — à confirmer');

-- La demande d'une pièce est tracée ; une pièce de l'équipe devient une tâche.
create or replace function gbs.demander_piece(p_piece uuid, p_a text, p_assigne uuid default null)
returns gbs.pieces language plpgsql security definer set search_path = '' as $$
declare p gbs.pieces; d gbs.dossiers;
begin
  select * into p from gbs.pieces where id = p_piece for update;
  perform gbs_private.exiger(p.id is not null and gbs_private.has_role('admin','achats_chine','hub_afrique')
                             and gbs_private.dossier_visible(p.dossier_id));
  if p_a not in ('client','fournisseur','transitaire','equipe') or (p_a = 'equipe' and p_assigne is null) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if p.statut not in ('manquante','refusee','expiree') then
    raise exception 'GBS_PIECE_DEJA_FOURNIE' using errcode = 'P0001';
  end if;
  select * into d from gbs.dossiers where id = p.dossier_id;
  update gbs.pieces set demandee_a = p_a, demandee_le = current_date, demandee_par = auth.uid(),
         relances = 0, derniere_relance = null
   where id = p_piece returning * into p;
  if p_a = 'equipe' and not exists (select 1 from gbs.taches t where t.piece_id = p.id and t.statut in ('a_faire','en_cours')) then
    insert into gbs.taches (dossier_id, phase, libelle, assigne_a, piece_id, echeance)
    values (p.dossier_id, p.phase, left('Fournir la pièce : ' || p.libelle, 300), p_assigne, p.id,
            gbs_private.ajouter_jours_ouvres(gbs_private.pays_calendrier(p_assigne, d.pays), current_date,
                                             gbs_private.param_num('piece.delai_relance_jours')::int));
  end if;
  return p;
end $$;

-- Tâche planifiée : relance des pièces demandées et passage en point bloquant au-delà du délai.
-- Sans messagerie ni page de suivi client à ce stade, la relance prend la forme d'une
-- tâche confiée au responsable de la phase (à défaut, au chef de dossier).
create or replace function gbs.relancer_pieces()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; delai_relance int; delai_blocage int; pays text; resp uuid;
        n_relances int := 0; n_points int := 0; ecoules int;
begin
  perform gbs_private.exiger(gbs_private.is_admin() or coalesce(auth.role(), '') = 'service_role');
  perform pg_catalog.pg_advisory_xact_lock(7323);
  delai_relance := gbs_private.param_num('piece.delai_relance_jours')::int;
  delai_blocage := gbs_private.param_num('piece.delai_blocage_jours')::int;
  for r in select p.*, d.pays as dossier_pays, d.chef_id, f.responsable_id as phase_responsable
             from gbs.pieces p join gbs.dossiers d on d.id = p.dossier_id
             left join gbs.dossier_phases f on f.dossier_id = p.dossier_id and f.phase = p.phase
            where d.statut = 'ouvert' and p.demandee_le is not null
              and p.statut in ('manquante','refusee','expiree')
            order by p.demandee_le, p.id for update of p loop
    resp := coalesce(r.phase_responsable, r.chef_id);
    pays := gbs_private.pays_calendrier(resp, r.dossier_pays);
    -- Relance
    if gbs_private.jours_ouvres_entre(pays, coalesce(r.derniere_relance, r.demandee_le), current_date) >= delai_relance then
      update gbs.pieces set relances = relances + 1, derniere_relance = current_date where id = r.id;
      n_relances := n_relances + 1;
      if resp is not null and r.demandee_a <> 'equipe'
         and not exists (select 1 from gbs.taches t where t.piece_id = r.id and t.statut in ('a_faire','en_cours')) then
        insert into gbs.taches (dossier_id, phase, libelle, assigne_a, piece_id, echeance)
        values (r.dossier_id, r.phase,
                left('Relancer ' || case r.demandee_a when 'client' then 'le client' when 'fournisseur' then 'le fournisseur'
                     else 'le transitaire' end || ' : ' || r.libelle, 300),
                resp, r.id, current_date);
      end if;
    end if;
    -- Point bloquant
    ecoules := gbs_private.jours_ouvres_entre(pays, r.demandee_le, current_date);
    if ecoules >= delai_blocage and resp is not null
       and not exists (select 1 from gbs.points_bloquants b where b.piece_id = r.id and b.resolu_le is null) then
      insert into gbs.points_bloquants (dossier_id, description, categorie, responsable_id, echeance, piece_id)
      values (r.dossier_id, left('Pièce manquante depuis ' || ecoules || ' jours ouvrés : ' || r.libelle, 2000),
              case r.demandee_a when 'client' then 'client' when 'fournisseur' then 'fournisseur'
                   when 'transitaire' then 'logistique' else 'documents' end,
              resp, gbs_private.ajouter_jours_ouvres(pays, current_date, 2), r.id);
      n_points := n_points + 1;
    end if;
  end loop;
  return jsonb_build_object('relances', n_relances, 'points_bloquants', n_points);
end $$;

-- Une pièce reçue clôt la tâche de relance associée.
create or replace function gbs_private.trg_piece_recue() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.statut in ('recue','a_verifier','validee') and old.statut is distinct from new.statut then
    update gbs.taches set statut = 'faite' where piece_id = new.id and statut in ('a_faire','en_cours');
  end if;
  return null;
end $$;
create trigger pieces_recue after update on gbs.pieces
  for each row execute function gbs_private.trg_piece_recue();

revoke execute on function gbs.valider_avenant(uuid, text, text), gbs.signer_avenant(uuid, text, date),
  gbs.demander_piece(uuid, text, uuid), gbs.relancer_pieces(),
  gbs_private.decaler_jours_ouvres(text, date, int), gbs_private.trg_avenant(), gbs_private.trg_piece_recue() from public;
grant execute on function gbs.valider_avenant(uuid, text, text), gbs.signer_avenant(uuid, text, date),
  gbs.demander_piece(uuid, text, uuid), gbs.relancer_pieces() to authenticated;
grant execute on function gbs.relancer_pieces() to service_role;
grant execute on all functions in schema gbs_private to authenticated, service_role;
