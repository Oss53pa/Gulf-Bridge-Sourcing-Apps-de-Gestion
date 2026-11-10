-- Après-vente : stock de pièces de rechange et réclamations de garantie (maquettes STK et SAV).
-- * Stock par site : référence, désignation, fabricant, seuil de réassort, coût unitaire moyen.
--   La quantité ne change que par mouvement (entrée, sortie), jamais par saisie directe ;
--   une sortie au-delà du stock est refusée ; le coût moyen est pondéré à chaque entrée.
-- * Réclamation : déclarée sur un dossier livré (équipement, défaut, urgence, fin de garantie),
--   recours au fabricant (ouvert, accepté, refusé avec motif), pièce réservée par une sortie de
--   stock tracée, intervention rattachée, clôture signée par le client (document du dossier).
--   Une réclamation close est figée.
-- * Accès : administratrice et Hub Afrique écrivent ; achats Chine lit et tient le recours
--   fabricant ; tout est limité aux dossiers visibles. Écritures par fonctions, journalisées ;
--   aucune suppression.

create table gbs.stock_articles (
  id                uuid primary key default gen_random_uuid(),
  site              text not null default 'Abidjan' check (length(trim(site)) between 2 and 60),
  reference         text not null unique check (reference ~ '^PR-[A-Z0-9-]{2,30}$'),
  designation       text not null check (length(trim(designation)) between 2 and 200),
  fournisseur_id    uuid references gbs.fournisseurs(id),
  quantite          numeric(10,2) not null default 0 check (quantite >= 0),
  seuil             numeric(10,2) not null default 0 check (seuil >= 0 and seuil <= 100000),
  cout_unitaire_xof numeric(14,0) not null default 0 check (cout_unitaire_xof >= 0 and cout_unitaire_xof <= 1e11),
  actif             boolean not null default true,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid
);

create table gbs.reclamations_sav (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique check (reference ~ '^SAV-[0-9]{4}-[0-9]{3,5}$'),
  dossier_id        uuid not null references gbs.dossiers(id),
  equipement        text not null check (length(trim(equipement)) between 2 and 200),
  numero_serie      text check (length(numero_serie) <= 80),
  defaut            text not null check (length(trim(defaut)) between 3 and 2000),
  urgent            boolean not null default false,
  fin_garantie      date,
  declaree_le       date not null default current_date,
  statut            text not null default 'declaree' check (statut in ('declaree','en_cours','cloturee')),
  recours           text not null default 'aucun' check (recours in ('aucun','ouvert','accepte','refuse')),
  recours_motif     text check (length(recours_motif) <= 1000),
  article_id        uuid references gbs.stock_articles(id),
  intervention_id   uuid references gbs.interventions(id),
  cloture_signataire text check (length(cloture_signataire) <= 120),
  cloture_document  text check (length(cloture_document) <= 400),
  cloturee_le       date,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check (statut <> 'cloturee' or (cloture_document is not null and cloturee_le is not null))
);
create index on gbs.reclamations_sav (dossier_id);

create table gbs.stock_mouvements (
  id                uuid primary key default gen_random_uuid(),
  article_id        uuid not null references gbs.stock_articles(id),
  sens              text not null check (sens in ('entree','sortie')),
  quantite          numeric(10,2) not null check (quantite > 0 and quantite <= 100000),
  cout_unitaire_xof numeric(14,0) check (cout_unitaire_xof >= 0 and cout_unitaire_xof <= 1e11),
  motif             text not null check (length(trim(motif)) between 3 and 300),
  reclamation_id    uuid references gbs.reclamations_sav(id),
  intervention_id   uuid references gbs.interventions(id),
  cree_le timestamptz not null default now(), cree_par uuid
);
create index on gbs.stock_mouvements (article_id, cree_le);

-- -----------------------------------------------------------------------------
-- Écritures par fonctions uniquement
-- -----------------------------------------------------------------------------
create or replace function gbs_private.trg_stock_sav_rpc() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'stock_sav' then
    raise exception 'GBS_VALIDATION_RPC: le stock et les réclamations se modifient par les fonctions dédiées' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    if tg_table_name = 'stock_mouvements' then
      raise exception 'GBS_VALIDATION_RPC: un mouvement de stock ne se modifie pas' using errcode = 'P0001';
    end if;
    if tg_table_name = 'reclamations_sav' then
      if to_jsonb(old) ->> 'statut' = 'cloturee' then raise exception 'GBS_RECLAMATION_CLOSE' using errcode = 'P0001'; end if;
    end if;
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['stock_articles','reclamations_sav','stock_mouvements'] loop
    execute format('alter table gbs.%I enable row level security', t);
    execute format('grant select on gbs.%I to authenticated', t);
    execute format('create trigger %I before insert or update on gbs.%I for each row execute function gbs_private.trg_stock_sav_rpc()', t || '_rpc', t);
    execute format('create trigger %I before insert on gbs.%I for each row execute function gbs_private.trg_cree_par()', t || '_cree', t);
    execute format('create trigger %I after insert or update on gbs.%I for each row execute function gbs_private.trg_audit()', t || '_audit', t);
    execute format('create trigger %I before delete on gbs.%I for each row execute function gbs_private.trg_no_delete()', t || '_nodel', t);
  end loop;
end $$;
create trigger stock_articles_touch before update on gbs.stock_articles for each row execute function gbs_private.trg_touch();
create trigger reclamations_sav_touch before update on gbs.reclamations_sav for each row execute function gbs_private.trg_touch();

-- Lecture : le stock est un référentiel interne de l'après-vente ; les réclamations suivent le dossier.
create policy stock_articles_lecture on gbs.stock_articles for select using (gbs_private.has_role('admin','hub_afrique','achats_chine'));
create policy stock_mouvements_lecture on gbs.stock_mouvements for select using (gbs_private.has_role('admin','hub_afrique','achats_chine'));
create policy reclamations_sav_lecture on gbs.reclamations_sav for select using (
  gbs_private.has_role('admin','hub_afrique','achats_chine') and gbs_private.dossier_visible(dossier_id));

-- -----------------------------------------------------------------------------
-- Stock
-- -----------------------------------------------------------------------------
create or replace function gbs.creer_article_stock(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r uuid;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','hub_afrique'));
  if jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) k where k not in ('site','reference','designation','fournisseur_id','seuil'))
     or coalesce(jsonb_typeof(p -> 'reference'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'designation'), '') <> 'string'
     or (p ? 'seuil' and jsonb_typeof(p -> 'seuil') <> 'number')
     or (p ? 'site' and jsonb_typeof(p -> 'site') <> 'string')
     or (p ? 'fournisseur_id' and jsonb_typeof(p -> 'fournisseur_id') not in ('string','null')) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform gbs_private.rpc('stock_sav');
  insert into gbs.stock_articles (site, reference, designation, fournisseur_id, seuil)
  values (coalesce(trim(p ->> 'site'), 'Abidjan'), upper(trim(p ->> 'reference')), trim(p ->> 'designation'),
          nullif(p ->> 'fournisseur_id', '')::uuid, coalesce((p ->> 'seuil')::numeric, 0))
  returning id into r;
  perform gbs_private.rpc('');
  return r;
exception
  when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range or foreign_key_violation then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  when unique_violation then
    raise exception 'GBS_REFERENCE_EXISTANTE' using errcode = 'P0001';
end $$;

-- Mouvement : verrouille l'article, refuse une sortie au-delà du stock, pondère le coût moyen à l'entrée.
create or replace function gbs_private.mouvement_stock(p_article uuid, p_sens text, p_quantite numeric, p_cout numeric, p_motif text,
  p_reclamation uuid default null, p_intervention uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a gbs.stock_articles; r uuid;
begin
  select * into a from gbs.stock_articles where id = p_article for update;
  if a.id is null or not a.actif or p_sens not in ('entree','sortie') or p_quantite is null or p_quantite <= 0 or p_quantite > 100000
     or length(trim(coalesce(p_motif, ''))) not between 3 and 300
     or (p_sens = 'entree' and (p_cout is null or p_cout < 0 or p_cout > 1e11)) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if p_sens = 'sortie' and p_quantite > a.quantite then
    raise exception 'GBS_STOCK_INSUFFISANT: % en stock', a.quantite using errcode = 'P0001';
  end if;
  perform gbs_private.rpc('stock_sav');
  insert into gbs.stock_mouvements (article_id, sens, quantite, cout_unitaire_xof, motif, reclamation_id, intervention_id)
  values (a.id, p_sens, p_quantite, case when p_sens = 'entree' then round(p_cout) else a.cout_unitaire_xof end, trim(p_motif), p_reclamation, p_intervention)
  returning id into r;
  update gbs.stock_articles set
    quantite = case when p_sens = 'entree' then quantite + p_quantite else quantite - p_quantite end,
    cout_unitaire_xof = case when p_sens = 'entree'
      then round((quantite * cout_unitaire_xof + p_quantite * p_cout) / (quantite + p_quantite)) else cout_unitaire_xof end
   where id = a.id;
  perform gbs_private.rpc('');
  return r;
end $$;

create or replace function gbs.mouvement_stock(p_article uuid, p_sens text, p_quantite numeric, p_motif text, p_cout numeric default null)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','hub_afrique'));
  return gbs_private.mouvement_stock(p_article, p_sens, p_quantite, p_cout, p_motif);
end $$;

create or replace function gbs.modifier_seuil_stock(p_article uuid, p_seuil numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','hub_afrique'));
  if p_seuil is null or p_seuil < 0 or p_seuil > 100000 or not exists (select 1 from gbs.stock_articles where id = p_article) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform gbs_private.rpc('stock_sav');
  update gbs.stock_articles set seuil = p_seuil where id = p_article;
  perform gbs_private.rpc('');
end $$;

-- -----------------------------------------------------------------------------
-- Réclamations
-- -----------------------------------------------------------------------------
create or replace function gbs_private.reclamation_modifiable(p_rec uuid, p_roles text[]) returns gbs.reclamations_sav
language plpgsql security definer set search_path = '' as $$
declare r gbs.reclamations_sav;
begin
  select * into r from gbs.reclamations_sav where id = p_rec for update;
  perform gbs_private.exiger(r.id is not null and gbs_private.role() = any (p_roles) and gbs_private.dossier_visible(r.dossier_id));
  if r.statut = 'cloturee' then raise exception 'GBS_RECLAMATION_CLOSE' using errcode = 'P0001'; end if;
  return r;
end $$;

create or replace function gbs.declarer_reclamation(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d uuid; n int; an int := extract(year from current_date)::int; r uuid;
begin
  if jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) k where k not in ('dossier_id','equipement','numero_serie','defaut','urgent','fin_garantie'))
     or coalesce(jsonb_typeof(p -> 'dossier_id'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'equipement'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'defaut'), '') <> 'string'
     or (p ? 'urgent' and jsonb_typeof(p -> 'urgent') <> 'boolean')
     or (p ? 'numero_serie' and jsonb_typeof(p -> 'numero_serie') not in ('string','null'))
     or (p ? 'fin_garantie' and jsonb_typeof(p -> 'fin_garantie') not in ('string','null')) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  d := (p ->> 'dossier_id')::uuid;
  perform gbs_private.exiger(gbs_private.has_role('admin','hub_afrique') and gbs_private.dossier_visible(d));
  -- Numérotation annuelle sans doublon sous concurrence.
  perform pg_advisory_xact_lock(hashtext('gbs.reclamations_sav'));
  select coalesce(max(substring(reference from '-([0-9]+)$')::int), 0) + 1 into n
    from gbs.reclamations_sav where reference like 'SAV-' || an || '-%';
  perform gbs_private.rpc('stock_sav');
  insert into gbs.reclamations_sav (reference, dossier_id, equipement, numero_serie, defaut, urgent, fin_garantie)
  values ('SAV-' || an || '-' || lpad(n::text, 3, '0'), d, trim(p ->> 'equipement'), nullif(trim(p ->> 'numero_serie'), ''),
          trim(p ->> 'defaut'), coalesce((p ->> 'urgent')::boolean, false), (p ->> 'fin_garantie')::date)
  returning id into r;
  perform gbs_private.rpc('');
  return r;
exception
  when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow or foreign_key_violation then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

-- Recours au fabricant : ouvert, puis accepté ou refusé (motif exigé pour le refus).
create or replace function gbs.recours_reclamation(p_rec uuid, p_etat text, p_motif text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r gbs.reclamations_sav := gbs_private.reclamation_modifiable(p_rec, array['admin','hub_afrique','achats_chine']);
begin
  if p_etat not in ('ouvert','accepte','refuse') or (p_etat = 'ouvert' and r.recours <> 'aucun')
     or (p_etat in ('accepte','refuse') and r.recours <> 'ouvert') then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if p_etat = 'refuse' then perform gbs_private.motif(p_motif); end if;
  perform gbs_private.rpc('stock_sav');
  update gbs.reclamations_sav set recours = p_etat, recours_motif = case when p_etat = 'refuse' then trim(p_motif) else recours_motif end,
         statut = 'en_cours' where id = r.id;
  perform gbs_private.rpc('');
end $$;

-- Pièce réservée : une unité sortie du stock, tracée sur la réclamation.
create or replace function gbs.reserver_piece_reclamation(p_rec uuid, p_article uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r gbs.reclamations_sav := gbs_private.reclamation_modifiable(p_rec, array['admin','hub_afrique']);
begin
  if r.article_id is not null then raise exception 'GBS_PIECE_DEJA_RESERVEE' using errcode = 'P0001'; end if;
  perform gbs_private.mouvement_stock(p_article, 'sortie', 1, null, 'Réservation ' || r.reference, r.id, null);
  perform gbs_private.rpc('stock_sav');
  update gbs.reclamations_sav set article_id = p_article, statut = 'en_cours' where id = r.id;
  perform gbs_private.rpc('');
end $$;

create or replace function gbs.lier_intervention_reclamation(p_rec uuid, p_intervention uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r gbs.reclamations_sav := gbs_private.reclamation_modifiable(p_rec, array['admin','hub_afrique']);
begin
  if not exists (select 1 from gbs.interventions i where i.id = p_intervention and i.dossier_id = r.dossier_id and i.statut <> 'annulee') then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform gbs_private.rpc('stock_sav');
  update gbs.reclamations_sav set intervention_id = p_intervention, statut = 'en_cours' where id = r.id;
  perform gbs_private.rpc('');
end $$;

-- Clôture : signataire du client et document signé rangé dans le dossier ; la réclamation est ensuite figée.
create or replace function gbs.cloturer_reclamation(p_rec uuid, p_signataire text, p_document text) returns void
language plpgsql security definer set search_path = '' as $$
declare r gbs.reclamations_sav := gbs_private.reclamation_modifiable(p_rec, array['admin','hub_afrique']);
begin
  if length(trim(coalesce(p_signataire, ''))) not between 2 and 120 or p_document is null
     or not gbs_private.photos_valides(r.dossier_id, array[p_document]) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if r.recours = 'ouvert' then raise exception 'GBS_RECOURS_OUVERT' using errcode = 'P0001'; end if;
  perform gbs_private.rpc('stock_sav');
  update gbs.reclamations_sav set statut = 'cloturee', cloture_signataire = trim(p_signataire), cloture_document = p_document,
         cloturee_le = current_date where id = r.id;
  perform gbs_private.rpc('');
end $$;

revoke all on function gbs_private.trg_stock_sav_rpc(), gbs_private.mouvement_stock(uuid, text, numeric, numeric, text, uuid, uuid),
  gbs_private.reclamation_modifiable(uuid, text[]) from public, anon, authenticated;
revoke all on function gbs.creer_article_stock(jsonb), gbs.mouvement_stock(uuid, text, numeric, text, numeric), gbs.modifier_seuil_stock(uuid, numeric),
  gbs.declarer_reclamation(jsonb), gbs.recours_reclamation(uuid, text, text), gbs.reserver_piece_reclamation(uuid, uuid),
  gbs.lier_intervention_reclamation(uuid, uuid), gbs.cloturer_reclamation(uuid, text, text) from public, anon;
grant execute on function gbs.creer_article_stock(jsonb), gbs.mouvement_stock(uuid, text, numeric, text, numeric), gbs.modifier_seuil_stock(uuid, numeric),
  gbs.declarer_reclamation(jsonb), gbs.recours_reclamation(uuid, text, text), gbs.reserver_piece_reclamation(uuid, uuid),
  gbs.lier_intervention_reclamation(uuid, uuid), gbs.cloturer_reclamation(uuid, text, text) to authenticated;
