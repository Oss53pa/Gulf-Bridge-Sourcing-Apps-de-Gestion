-- Lot 1, M6 : liste de pièces de rechange proposée au client dans le devis.
-- * Catalogue du fournisseur par dossier (achats) : pièces d'usure, de rechange et
--   stratégiques, prix fournisseur, durée de disponibilité, délai de livraison, quantité
--   recommandée. Réservé à l'administratrice et aux achats (prix fournisseurs détaillés).
-- * Lignes du devis : proposées depuis le catalogue par la fonction dédiée, au prix client
--   calculé par la base et figé : prix fournisseur en achat accompagné (le client paie le
--   fournisseur), prix fournisseur majoré en négoce (paramètre daté). Celui qui édite le
--   devis ajuste la quantité et note le choix du client, sans voir le catalogue.
-- * Devis signé : la liste ne change plus ; les prix et la disponibilité des pièces retenues
--   deviennent des engagements à reprendre dans le contrat fournisseur.

create table gbs.pieces_rechange (
  id                uuid primary key default gen_random_uuid(),
  dossier_id        uuid not null references gbs.dossiers(id),
  fournisseur_id    uuid not null references gbs.fournisseurs(id),
  designation       text not null check (length(trim(designation)) between 2 and 200),
  reference_fabricant text check (length(reference_fabricant) <= 80),
  criticite         text not null default 'rechange' check (criticite in ('usure','rechange','strategique')),
  prix_fournisseur  numeric(16,2) not null check (prix_fournisseur > 0),
  devise            char(3) not null check (devise in ('USD','CNY','EUR')),
  quantite_recommandee numeric(10,2) not null default 1 check (quantite_recommandee > 0 and quantite_recommandee <= 100000),
  disponibilite_ans int check (disponibilite_ans between 0 and 50),
  delai_jours       int check (delai_jours between 0 and 365),
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid
);
create index on gbs.pieces_rechange (dossier_id);

create table gbs.devis_pieces (
  id              uuid primary key default gen_random_uuid(),
  devis_id        uuid not null references gbs.devis(id),
  dossier_id      uuid not null references gbs.dossiers(id),
  piece_id        uuid not null references gbs.pieces_rechange(id),
  designation     text not null,
  reference_fabricant text,
  criticite       text not null,
  disponibilite_ans int,
  delai_jours     int,
  quantite        numeric(10,2) not null check (quantite > 0 and quantite <= 100000),
  prix_unitaire_client numeric(16,2) not null,
  devise          char(3) not null,
  montant         numeric(18,2) generated always as (round(quantite * prix_unitaire_client, 2)) stored,
  retenue_client  boolean not null default false,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  unique (devis_id, piece_id)
);

insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('negoce.marge_pieces', '0.25', date '2026-01-01', 'Marge du négoce sur les pièces de rechange proposées au devis — à confirmer par la fondatrice');

create or replace function gbs_private.trg_piece_rechange() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from gbs.commandes c where c.dossier_id = new.dossier_id and c.fournisseur_id = new.fournisseur_id)
     and not exists (select 1 from gbs.offres o join gbs.consultations_fournisseurs k on k.id = o.consultation_id
                      where k.dossier_id = new.dossier_id and o.fournisseur_id = new.fournisseur_id) then
    raise exception 'GBS_FOURNISSEUR_HORS_DOSSIER: le fournisseur n''a ni offre ni commande dans ce dossier' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and new.dossier_id <> old.dossier_id then raise exception 'GBS_PIECE_FIGEE' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger pieces_rechange_regles before insert or update on gbs.pieces_rechange
  for each row execute function gbs_private.trg_piece_rechange();

-- Devis encore modifiable : ni signé, ni accepté, ni remplacé.
create or replace function gbs_private.devis_modifiable(p_devis uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from gbs.devis v where v.id = p_devis and v.mandat_valide_le is null and v.statut in ('brouillon','envoye'))
$$;

create or replace function gbs_private.trg_devis_piece() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not gbs_private.devis_modifiable(coalesce(new.devis_id, old.devis_id)) then
    raise exception 'GBS_DOCUMENT_SIGNE: la liste des pièces d''un devis signé ne change plus' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' and coalesce(current_setting('gbs.rpc', true), '') <> 'pieces_devis' then
    raise exception 'GBS_VALIDATION_RPC: les pièces sont proposées par proposer_pieces_devis()' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.devis_id, new.dossier_id, new.piece_id, new.designation, new.reference_fabricant, new.criticite,
       new.disponibilite_ans, new.delai_jours, new.prix_unitaire_client, new.devise)
     is distinct from (old.devis_id, old.dossier_id, old.piece_id, old.designation, old.reference_fabricant, old.criticite,
       old.disponibilite_ans, old.delai_jours, old.prix_unitaire_client, old.devise) then
    raise exception 'GBS_MONTANTS_CALCULES: le prix client vient du catalogue' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger devis_pieces_regles before insert or update or delete on gbs.devis_pieces
  for each row execute function gbs_private.trg_devis_piece();

do $$
begin
  execute 'create trigger pieces_rechange_touch before update on gbs.pieces_rechange for each row execute function gbs_private.trg_touch()';
  execute 'create trigger pieces_rechange_cree before insert on gbs.pieces_rechange for each row execute function gbs_private.trg_cree_par()';
  execute 'create trigger pieces_rechange_audit after insert or update or delete on gbs.pieces_rechange for each row execute function gbs_private.trg_audit()';
  execute 'create trigger pieces_rechange_nodel before delete on gbs.pieces_rechange for each row execute function gbs_private.trg_no_delete()';
  execute 'create trigger devis_pieces_touch before update on gbs.devis_pieces for each row execute function gbs_private.trg_touch()';
  execute 'create trigger devis_pieces_cree before insert on gbs.devis_pieces for each row execute function gbs_private.trg_cree_par()';
  execute 'create trigger devis_pieces_audit after insert or update or delete on gbs.devis_pieces for each row execute function gbs_private.trg_audit()';
end $$;

-- Propose au devis les pièces du catalogue des fournisseurs du dossier, au prix client.
-- Les pièces déjà proposées sont conservées (quantité et choix du client inchangés).
create or replace function gbs.proposer_pieces_devis(p_devis uuid)
returns setof gbs.devis_pieces language plpgsql security definer set search_path = '' as $$
declare v gbs.devis; d gbs.dossiers; maj numeric;
begin
  select * into v from gbs.devis where id = p_devis;
  perform gbs_private.exiger(v.id is not null and gbs_private.has_role('admin','hub_afrique','agent_pays')
                             and gbs_private.dossier_visible(v.dossier_id));
  if not gbs_private.devis_modifiable(p_devis) then raise exception 'GBS_DOCUMENT_SIGNE' using errcode = 'P0001'; end if;
  select * into d from gbs.dossiers where id = v.dossier_id;
  maj := case when d.mode_financier = 'negoce' then gbs_private.param_num('negoce.marge_pieces', d.ouvert_le) else 0 end;
  perform set_config('gbs.rpc', 'pieces_devis', true);
  insert into gbs.devis_pieces (devis_id, dossier_id, piece_id, designation, reference_fabricant, criticite, disponibilite_ans,
                                delai_jours, quantite, prix_unitaire_client, devise)
  select v.id, v.dossier_id, p.id, p.designation, p.reference_fabricant, p.criticite, p.disponibilite_ans, p.delai_jours,
         p.quantite_recommandee, round(p.prix_fournisseur * (1 + maj), 2), p.devise
    from gbs.pieces_rechange p
   where p.dossier_id = v.dossier_id
  on conflict (devis_id, piece_id) do nothing;
  perform set_config('gbs.rpc', '', true);
  return query select * from gbs.devis_pieces where devis_id = p_devis
    order by case criticite when 'strategique' then 1 when 'rechange' then 2 else 3 end, designation;
end $$;

-- Engagements du fournisseur à reprendre au contrat : pièces retenues du devis accepté.
create or replace function gbs.engagements_pieces(p_dossier uuid)
returns table (fournisseur text, designation text, reference_fabricant text, quantite numeric, prix_fournisseur numeric,
               devise text, disponibilite_ans int, delai_jours int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(p_dossier));
  return query
  select f.raison_sociale_en, p.designation, p.reference_fabricant, dp.quantite, p.prix_fournisseur, p.devise::text, p.disponibilite_ans, p.delai_jours
    from gbs.devis_pieces dp
    join gbs.devis v on v.id = dp.devis_id and v.statut = 'accepte'
    join gbs.pieces_rechange p on p.id = dp.piece_id
    join gbs.fournisseurs f on f.id = p.fournisseur_id
   where dp.dossier_id = p_dossier and dp.retenue_client
   order by f.raison_sociale_en, p.designation;
end $$;

alter table gbs.pieces_rechange enable row level security;
alter table gbs.devis_pieces enable row level security;
grant select, insert on gbs.pieces_rechange to authenticated;
grant update (designation, reference_fabricant, criticite, prix_fournisseur, devise, quantite_recommandee, disponibilite_ans, delai_jours)
  on gbs.pieces_rechange to authenticated;
grant select, delete on gbs.devis_pieces to authenticated;
grant update (quantite, retenue_client) on gbs.devis_pieces to authenticated;

create policy pieces_rechange_lecture on gbs.pieces_rechange for select using (
  gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(dossier_id));
create policy pieces_rechange_ecriture on gbs.pieces_rechange for insert with check (
  gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(dossier_id));
create policy pieces_rechange_maj on gbs.pieces_rechange for update using (
  gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(dossier_id));
create policy devis_pieces_lecture on gbs.devis_pieces for select using (
  gbs_private.has_role('admin','hub_afrique','agent_pays','comptable') and gbs_private.dossier_visible(dossier_id));
create policy devis_pieces_maj on gbs.devis_pieces for update using (
  gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.dossier_visible(dossier_id));
create policy devis_pieces_suppression on gbs.devis_pieces for delete using (
  gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.dossier_visible(dossier_id));

revoke execute on function gbs.proposer_pieces_devis(uuid), gbs.engagements_pieces(uuid), gbs_private.devis_modifiable(uuid),
  gbs_private.trg_piece_rechange(), gbs_private.trg_devis_piece() from public;
grant execute on function gbs.proposer_pieces_devis(uuid), gbs.engagements_pieces(uuid) to authenticated;
grant execute on all functions in schema gbs_private to authenticated, service_role;
