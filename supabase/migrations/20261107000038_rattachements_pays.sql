-- Rattachement d'un pays client à la société qui contracte : jusqu'ici en dur (Gabon et
-- Cameroun à GBS Chine, les autres à GBS Côte d'Ivoire), désormais une règle datée.
-- * Table dédiée plutôt qu'un paramètre JSON : la société est une clé étrangère, donc
--   toujours une société existante, sans validateur à ajouter au registre.
-- * Ajout seulement (jamais modifiée ni supprimée), réservée à l'administratrice, journalisée.
-- * La règle en vigueur à la date de conversion s'applique ; un pays sans règle suit « defaut ».
-- * Les autres usages des pays (routage vers l'agent pays, devise XAF de la zone CEMAC,
--   bordereau de suivi des cargaisons) sont des règles distinctes, inchangées ici.

create table gbs.rattachements_pays (
  id          uuid primary key default gen_random_uuid(),
  pays        text not null check (pays ~ '^[A-Z]{2}$' or pays = 'defaut'),
  societe_id  uuid not null references gbs.societes(id),
  date_effet  date not null check (date_effet >= date '2026-01-01'),
  commentaire text check (length(commentaire) <= 500),
  cree_le timestamptz not null default now(), cree_par uuid,
  unique (pays, date_effet)
);

do $$
begin
  execute 'create trigger rattachements_cree before insert on gbs.rattachements_pays for each row execute function gbs_private.trg_cree_par()';
  execute 'create trigger rattachements_audit after insert on gbs.rattachements_pays for each row execute function gbs_private.trg_audit()';
  execute 'create trigger rattachements_immuable before update or delete on gbs.rattachements_pays for each row execute function gbs_private.trg_immuable()';
end $$;

insert into gbs.rattachements_pays (pays, societe_id, date_effet, commentaire)
select x.pays, s.id, date '2026-01-01', x.commentaire
  from (values ('GA', 'GBS_CN', 'Clients du Gabon : contrat avec GBS Chine'),
               ('CM', 'GBS_CN', 'Clients du Cameroun : contrat avec GBS Chine'),
               ('defaut', 'GBS_CI', 'Autres pays : contrat avec GBS Côte d''Ivoire')) as x(pays, code, commentaire)
  join gbs.societes s on s.code = x.code;

-- Société de rattachement d'un pays à une date : règle du pays, sinon règle par défaut.
create or replace function gbs_private.societe_rattachement(p_pays text, p_date date) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.societe_id from gbs.rattachements_pays r
   where r.pays in (p_pays, 'defaut') and r.date_effet <= p_date
   order by (r.pays = p_pays) desc, r.date_effet desc limit 1
$$;

-- Conversion d'un prospect : société et devise selon le pays, toutes deux paramétrées.
create or replace function gbs.convertir_prospect(p_prospect uuid)
returns gbs.clients language plpgsql security definer set search_path = '' as $$
declare p gbs.prospects; c gbs.clients; soc uuid; dev text; carte jsonb;
begin
  select * into p from gbs.prospects where id = p_prospect for update;
  perform gbs_private.exiger(p.id is not null and gbs_private.prospect_visible_cols(p.pays));
  if p.statut in ('converti','perdu') then raise exception 'GBS_PROSPECT_CLOS' using errcode = 'P0001'; end if;
  if p.premier_contact_le is null then
    raise exception 'GBS_PREMIER_CONTACT_REQUIS: enregistrez d''abord le premier contact' using errcode = 'P0001';
  end if;
  soc := gbs_private.societe_rattachement(p.pays, current_date);
  if soc is null or not exists (select 1 from gbs.societes s where s.id = soc and s.date_creation <= current_date) then
    raise exception 'GBS_RATTACHEMENT_MANQUANT: aucune société en activité pour ce pays' using errcode = 'P0001';
  end if;
  carte := gbs_private.param('prospect.devise_par_pays');
  dev := coalesce(carte ->> p.pays, carte ->> 'defaut', 'USD');
  insert into gbs.clients (societe_id, raison_sociale, pays, devise, segment, specialite, origine, agent_id, langue)
  values (soc, trim(p.raison_sociale), p.pays, dev, p.segment, p.specialite,
          case when p.agent_id is not null then 'agent_pays' else 'direct' end, p.agent_id, p.langue)
  returning * into c;
  if p.contact_nom is not null then
    insert into gbs.contacts (client_id, nom, fonction, email, telephone)
    values (c.id, left(p.contact_nom, 120), p.contact_fonction, p.email, p.telephone);
  end if;
  perform set_config('gbs.rpc', 'prospect', true);
  update gbs.prospects set statut = 'converti', client_id = c.id, prochaine_relance = null where id = p_prospect;
  perform set_config('gbs.rpc', '', true);
  update gbs.taches set statut = 'faite' where prospect_id = p_prospect and statut in ('a_faire','en_cours');
  return c;
end $$;

alter table gbs.rattachements_pays enable row level security;
grant select, insert on gbs.rattachements_pays to authenticated;
create policy rattachements_lecture on gbs.rattachements_pays for select using (gbs_private.interne());
create policy rattachements_creation on gbs.rattachements_pays for insert with check (gbs_private.is_admin());

revoke execute on function gbs_private.societe_rattachement(text, date) from public;
grant execute on all functions in schema gbs_private to authenticated, service_role;
