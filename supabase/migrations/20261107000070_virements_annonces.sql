-- Portail client : régler une facture (maquette « Espace client · factures » : coordonnées de virement,
-- puis « J'ai effectué le virement » avec la référence).
-- * Coordonnées : le compte bancaire de la société émettrice désigné « encaissement clients » pour la
--   devise de la facture. Seule l'administratrice désigne ce compte (journalisé) ; le numéro d'un compte
--   ne se modifie jamais (règle existante). Le portail montre ces coordonnées depuis la base : c'est la
--   parade à la fraude au faux changement de RIB par courriel.
-- * Annonce : référence du virement (obligatoire), date facultative. Une annonce n'enregistre aucun
--   encaissement : la comptabilité rapproche à réception des fonds, ou classe l'annonce sans suite.
-- * Une seule annonce en attente par facture ; cinq annonces au plus par facture.

alter table gbs.comptes_bancaires add column encaissement_clients boolean not null default false;
create unique index comptes_bancaires_un_encaissement on gbs.comptes_bancaires (societe_id, devise) where encaissement_clients and actif;

create or replace function gbs.designer_compte_encaissement(p_compte uuid, p_oui boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare c gbs.comptes_bancaires;
begin
  perform gbs_private.exiger(gbs_private.is_admin(), 'GBS_VALIDATION_ADMIN');
  select * into c from gbs.comptes_bancaires where id = p_compte for update;
  if c.id is null or p_oui is null or (p_oui and not c.actif) then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  perform gbs_private.rpc('compte_encaissement');
  if p_oui then
    update gbs.comptes_bancaires set encaissement_clients = false where societe_id = c.societe_id and devise = c.devise and id <> c.id and encaissement_clients;
  end if;
  update gbs.comptes_bancaires set encaissement_clients = p_oui where id = c.id;
  perform gbs_private.rpc('');
  perform gbs_private.journaliser('compte_encaissement_designe', 'comptes_bancaires', c.id::text, null,
    jsonb_build_object('encaissement_clients', c.encaissement_clients), jsonb_build_object('encaissement_clients', p_oui), null);
end $$;

-- La désignation ne passe que par la fonction : à la création comme en mise à jour, la colonne n'est posée
-- que sous le drapeau de designer_compte_encaissement (journalisé).
create or replace function gbs_private.trg_compte_encaissement() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'compte_encaissement'
     and ((tg_op = 'INSERT' and new.encaissement_clients) or (tg_op = 'UPDATE' and new.encaissement_clients is distinct from old.encaissement_clients)) then
    raise exception 'GBS_VALIDATION_RPC: le compte d''encaissement se désigne par designer_compte_encaissement()' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger comptes_bancaires_encaissement before insert or update on gbs.comptes_bancaires
  for each row execute function gbs_private.trg_compte_encaissement();
revoke all on function gbs_private.trg_compte_encaissement() from public, anon, authenticated;

create table gbs.annonces_virements (
  id             uuid primary key default gen_random_uuid(),
  facture_id     uuid not null references gbs.factures(id),
  client_id      uuid not null references gbs.clients(id),
  societe_id     uuid not null references gbs.societes(id),
  auteur_id      uuid not null references gbs.profils(id),
  reference      text not null check (reference ~ '^[A-Za-z0-9 ./_-]{3,80}$'),
  date_virement  date check (date_virement <= current_date),
  statut         text not null default 'annoncee' check (statut in ('annoncee','rapprochee','sans_suite')),
  traitee_par    uuid references gbs.profils(id),
  traitee_le     timestamptz,
  cree_le        timestamptz not null default clock_timestamp()
);
create index on gbs.annonces_virements (facture_id, cree_le);
create unique index annonces_une_en_attente on gbs.annonces_virements (facture_id) where statut = 'annoncee';

create or replace function gbs_private.trg_annonce_rpc() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'annonce_virement' then
    raise exception 'GBS_VALIDATION_RPC: les annonces de virement passent par les fonctions dédiées' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and old.statut <> 'annoncee' then raise exception 'GBS_DEMANDE_TRAITEE' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'statut' - 'traitee_par' - 'traitee_le') is distinct from (to_jsonb(old) - 'statut' - 'traitee_par' - 'traitee_le') then
    raise exception 'GBS_VALIDATION_RPC: une annonce ne se modifie pas' using errcode = 'P0001';
  end if;
  return new;
end $$;

alter table gbs.annonces_virements enable row level security;
grant select on gbs.annonces_virements to authenticated;
create trigger annonces_rpc before insert or update on gbs.annonces_virements for each row execute function gbs_private.trg_annonce_rpc();
create trigger annonces_audit after insert or update on gbs.annonces_virements for each row execute function gbs_private.trg_audit();
create trigger annonces_nodel before delete on gbs.annonces_virements for each row execute function gbs_private.trg_no_delete();
create policy annonces_lecture on gbs.annonces_virements for select using (gbs_private.finance() and gbs_private.societe_ok(societe_id));

create or replace function gbs.annoncer_virement(p_facture uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c uuid := gbs_private.mon_client(); f gbs.factures; r uuid;
begin
  select * into f from gbs.factures where id = p_facture for update;
  perform gbs_private.exiger(c is not null and f.id is not null and f.client_id = c and f.statut in ('emise','partiellement_payee')
    and exists (select 1 from gbs.dossiers d where d.id = f.dossier_id and d.client_id = c and d.statut <> 'annule'));
  if jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) k where k not in ('reference','date_virement'))
     or coalesce(jsonb_typeof(p -> 'reference'), '') <> 'string'
     or (p ? 'date_virement' and jsonb_typeof(p -> 'date_virement') not in ('string','null')) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if exists (select 1 from gbs.annonces_virements a where a.facture_id = f.id and a.statut = 'annoncee') then
    raise exception 'GBS_DEMANDE_EN_COURS' using errcode = 'P0001';
  end if;
  if (select count(*) from gbs.annonces_virements a where a.facture_id = f.id) >= 5 then
    raise exception 'GBS_TROP_DE_DEMANDES' using errcode = 'P0001';
  end if;
  perform gbs_private.rpc('annonce_virement');
  insert into gbs.annonces_virements (facture_id, client_id, societe_id, auteur_id, reference, date_virement)
  values (f.id, c, f.societe_id, auth.uid(), trim(p ->> 'reference'), nullif(p ->> 'date_virement', '')::date)
  returning id into r;
  perform gbs_private.rpc('');
  return r;
exception
  when check_violation or not_null_violation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

create or replace function gbs.traiter_annonce_virement(p_annonce uuid, p_statut text) returns void
language plpgsql security definer set search_path = '' as $$
declare a gbs.annonces_virements;
begin
  select * into a from gbs.annonces_virements where id = p_annonce for update;
  perform gbs_private.exiger(a.id is not null and gbs_private.finance() and gbs_private.societe_ok(a.societe_id));
  if p_statut is null or p_statut not in ('rapprochee','sans_suite') then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  if a.statut <> 'annoncee' then raise exception 'GBS_DEMANDE_TRAITEE' using errcode = 'P0001'; end if;
  perform gbs_private.rpc('annonce_virement');
  update gbs.annonces_virements set statut = p_statut, traitee_par = auth.uid(), traitee_le = now() where id = a.id;
  perform gbs_private.rpc('');
end $$;

-- Espace client : factures à régler, coordonnées d'encaissement et dernière annonce.
create or replace function gbs.espace_client_dossier(p_dossier uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c uuid := gbs_private.mon_client();
begin
  perform gbs_private.exiger(c is not null and exists (select 1 from gbs.dossiers d where d.id = p_dossier and d.client_id = c and d.statut <> 'annule'));
  return gbs_private.contenu_dossier_client(p_dossier) || jsonb_build_object(
    'production', gbs_private.production_qualite_client(p_dossier),
    'depots', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'libelle', p.libelle, 'phase', p.phase, 'statut', p.statut) order by p.phase, p.libelle), '[]'::jsonb)
               from gbs.pieces p join gbs.dossiers d on d.id = p.dossier_id
              where p.dossier_id = p_dossier and d.statut = 'ouvert' and p.fournie_par = 'client'
                and p.statut in ('manquante','refusee','expiree')),
    'reglements', (select coalesce(jsonb_agg(jsonb_build_object('facture_id', f.id, 'numero', f.numero, 'devise', f.devise,
                    'reste', f.net_a_payer - f.encaisse, 'echeance', f.echeance,
                    'coordonnees', (select jsonb_build_object('titulaire', s.raison_sociale, 'banque', b.banque, 'numero', b.numero)
                                      from gbs.comptes_bancaires b join gbs.societes s on s.id = b.societe_id
                                     where b.societe_id = f.societe_id and b.devise = f.devise and b.encaissement_clients and b.actif),
                    'annonce', (select jsonb_build_object('reference', a.reference, 'statut', a.statut, 'le', a.cree_le)
                                  from gbs.annonces_virements a where a.facture_id = f.id order by a.cree_le desc limit 1))
                    order by f.echeance nulls last), '[]'::jsonb)
                   from gbs.factures f where f.dossier_id = p_dossier and f.client_id = c and f.statut in ('emise','partiellement_payee')));
end $$;

revoke all on function gbs_private.trg_annonce_rpc() from public, anon, authenticated;
revoke all on function gbs.designer_compte_encaissement(uuid, boolean), gbs.annoncer_virement(uuid, jsonb), gbs.traiter_annonce_virement(uuid, text) from public, anon;
grant execute on function gbs.designer_compte_encaissement(uuid, boolean), gbs.annoncer_virement(uuid, jsonb), gbs.traiter_annonce_virement(uuid, text) to authenticated;
