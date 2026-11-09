-- Échanges : messagerie interne, client et fournisseur (lot 1 ; maquettes « Messagerie » des portails).
-- Sans traduction automatique (service externe et clé à décider).
-- * Fil de discussion : rattaché à un dossier (fil client ou fil interne) ou à une commande (fil
--   fournisseur), avec un sujet et une catégorie. Un message ne se modifie ni ne se supprime.
-- * Qui voit quoi :
--   - fil interne : l'équipe qui voit le dossier, jamais un compte externe ;
--   - fil client : l'équipe qui voit le dossier et les comptes de ce client ;
--   - fil fournisseur : l'administratrice et les achats Chine qui voient le dossier, et les comptes de
--     ce fournisseur ; jamais le client.
-- * Limitation de débit : nombre de messages par utilisateur et par heure, paramétré.

insert into gbs.parametres_definitions (cle, type, minimum, maximum, validateur, module, libelle) values
  ('messagerie.max_messages_heure', 'entier', 1, 1000, null, 'echanges', 'Messages envoyés au plus par utilisateur et par heure');
insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('messagerie.max_messages_heure', '30', date '2026-01-01', 'Limite anti-abus des points d''entrée de la messagerie');

create table gbs.fils_messages (
  id            uuid primary key default gen_random_uuid(),
  audience      text not null check (audience in ('interne','client','fournisseur')),
  dossier_id    uuid not null references gbs.dossiers(id),
  commande_id   uuid references gbs.commandes(id),
  sujet         text not null check (length(trim(sujet)) between 3 and 200),
  categorie     text not null default 'autre' check (categorie in ('technique','qualite','expedition','factures','autre')),
  dernier_message_le timestamptz not null default now(),
  cree_le timestamptz not null default now(), cree_par uuid,
  check ((audience = 'fournisseur') = (commande_id is not null))
);
create index on gbs.fils_messages (dossier_id);
create index on gbs.fils_messages (commande_id) where commande_id is not null;

create table gbs.messages (
  id         uuid primary key default gen_random_uuid(),
  fil_id     uuid not null references gbs.fils_messages(id),
  auteur_id  uuid not null references gbs.profils(id),
  corps      text not null check (length(trim(corps)) between 1 and 4000),
  -- Heure exacte d'écriture (et non celle de la transaction) : ordre des messages toujours déterministe.
  cree_le    timestamptz not null default clock_timestamp()
);
create index on gbs.messages (fil_id, cree_le);
create index on gbs.messages (auteur_id, cree_le);

-- Visibilité d'un fil pour l'utilisateur connecté (même règle pour la lecture et l'écriture).
create or replace function gbs_private.fil_visible(p_fil uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from gbs.fils_messages f join gbs.dossiers d on d.id = f.dossier_id
     where f.id = p_fil and d.statut <> 'annule' and (
       (gbs_private.interne() and gbs_private.dossier_visible(d.id)
          and (f.audience <> 'fournisseur' or gbs_private.has_role('admin','achats_chine')))
       or (f.audience = 'client' and d.client_id = gbs_private.mon_client())
       or (f.audience = 'fournisseur' and exists (select 1 from gbs.commandes k where k.id = f.commande_id and k.fournisseur_id = gbs_private.mon_fournisseur()))))
$$;

create or replace function gbs_private.trg_messagerie_rpc() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'messagerie' then
    raise exception 'GBS_VALIDATION_RPC: la messagerie s''utilise par ses fonctions dédiées' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'messages' then
    raise exception 'GBS_VALIDATION_RPC: un message envoyé ne se modifie pas' using errcode = 'P0001';
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['fils_messages','messages'] loop
    execute format('alter table gbs.%I enable row level security', t);
    execute format('grant select on gbs.%I to authenticated', t);
    execute format('create trigger %I before insert or update on gbs.%I for each row execute function gbs_private.trg_messagerie_rpc()', t || '_rpc', t);
    execute format('create trigger %I after insert on gbs.%I for each row execute function gbs_private.trg_audit()', t || '_audit', t);
    execute format('create trigger %I before delete on gbs.%I for each row execute function gbs_private.trg_no_delete()', t || '_nodel', t);
  end loop;
end $$;
create trigger fils_messages_cree before insert on gbs.fils_messages for each row execute function gbs_private.trg_cree_par();
create policy fils_messages_lecture on gbs.fils_messages for select using (gbs_private.fil_visible(id));
create policy messages_lecture on gbs.messages for select using (gbs_private.fil_visible(fil_id));

-- Limitation de débit commune aux deux points d'entrée.
create or replace function gbs_private.verifier_debit_messages() returns void
language plpgsql security definer set search_path = '' as $$
declare n int; maxi int := gbs_private.param_num('messagerie.max_messages_heure', current_date)::int;
begin
  perform pg_advisory_xact_lock(hashtext('gbs.messages.' || auth.uid()::text));
  select count(*) into n from gbs.messages where auteur_id = auth.uid() and cree_le > now() - interval '1 hour';
  if n >= maxi then raise exception 'GBS_TROP_DE_MESSAGES' using errcode = 'P0001'; end if;
end $$;

create or replace function gbs.envoyer_message(p_fil uuid, p_corps text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r uuid;
begin
  perform gbs_private.exiger(auth.uid() is not null and gbs_private.fil_visible(p_fil));
  if p_corps is null or length(trim(p_corps)) not between 1 and 4000 then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform gbs_private.verifier_debit_messages();
  perform gbs_private.rpc('messagerie');
  insert into gbs.messages (fil_id, auteur_id, corps) values (p_fil, auth.uid(), trim(p_corps)) returning id into r;
  update gbs.fils_messages set dernier_message_le = clock_timestamp() where id = p_fil;
  perform gbs_private.rpc('');
  return r;
end $$;

-- Nouveau fil avec son premier message. Un compte externe ne crée que des fils de son audience.
create or replace function gbs.creer_fil(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r uuid; aud text; d uuid; k uuid; cli uuid := gbs_private.mon_client(); frn uuid := gbs_private.mon_fournisseur();
begin
  if jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) x where x not in ('audience','dossier_id','commande_id','sujet','categorie','message'))
     or coalesce(jsonb_typeof(p -> 'audience'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'sujet'), '') <> 'string'
     or coalesce(jsonb_typeof(p -> 'message'), '') <> 'string'
     or (p ? 'categorie' and jsonb_typeof(p -> 'categorie') <> 'string')
     or (p ? 'dossier_id' and jsonb_typeof(p -> 'dossier_id') not in ('string','null'))
     or (p ? 'commande_id' and jsonb_typeof(p -> 'commande_id') not in ('string','null'))
     or length(trim(p ->> 'message')) not between 1 and 4000 then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  aud := p ->> 'audience'; d := nullif(p ->> 'dossier_id', '')::uuid; k := nullif(p ->> 'commande_id', '')::uuid;
  if aud = 'fournisseur' then
    select x.dossier_id into d from gbs.commandes x where x.id = k;
  end if;
  -- Droit de créer selon le profil.
  perform gbs_private.exiger(d is not null and (
    (gbs_private.interne() and gbs_private.dossier_visible(d) and (aud <> 'fournisseur' or gbs_private.has_role('admin','achats_chine')))
    or (cli is not null and aud = 'client' and exists (select 1 from gbs.dossiers x where x.id = d and x.client_id = cli and x.statut <> 'annule'))
    or (frn is not null and aud = 'fournisseur' and exists (select 1 from gbs.commandes x where x.id = k and x.fournisseur_id = frn))));
  perform gbs_private.verifier_debit_messages();
  perform gbs_private.rpc('messagerie');
  insert into gbs.fils_messages (audience, dossier_id, commande_id, sujet, categorie)
  values (aud, d, case when aud = 'fournisseur' then k end, trim(p ->> 'sujet'), coalesce(p ->> 'categorie', 'autre')) returning id into r;
  insert into gbs.messages (fil_id, auteur_id, corps) values (r, auth.uid(), trim(p ->> 'message'));
  perform gbs_private.rpc('');
  return r;
exception
  when check_violation or not_null_violation or invalid_text_representation or foreign_key_violation then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

-- Fils visibles, du plus récent au plus ancien, avec le dernier message (sans lire les tables internes).
create or replace function gbs.mes_fils(p_limite int default 100)
returns table (id uuid, audience text, sujet text, categorie text, reference text, dernier_message_le timestamptz, dernier_auteur text, dernier_extrait text)
language sql stable security definer set search_path = '' as $$
  select f.id, f.audience, f.sujet, f.categorie,
         case when f.audience = 'fournisseur' then (select k.reference from gbs.commandes k where k.id = f.commande_id)
              else (select d.reference from gbs.dossiers d where d.id = f.dossier_id) end,
         f.dernier_message_le,
         (select p.nom from gbs.messages m join gbs.profils p on p.id = m.auteur_id where m.fil_id = f.id order by m.cree_le desc limit 1),
         (select left(m.corps, 160) from gbs.messages m where m.fil_id = f.id order by m.cree_le desc limit 1)
    from gbs.fils_messages f
   where gbs_private.fil_visible(f.id)
   order by f.dernier_message_le desc
   limit least(greatest(coalesce(p_limite, 100), 1), 500)
$$;

create or replace function gbs.messages_du_fil(p_fil uuid)
returns table (id uuid, auteur text, moi boolean, interne boolean, corps text, cree_le timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.fil_visible(p_fil));
  return query select m.id, p.nom, m.auteur_id = auth.uid(), p.role not in ('client','fournisseur','transitaire'), m.corps, m.cree_le
    from gbs.messages m join gbs.profils p on p.id = m.auteur_id where m.fil_id = p_fil order by m.cree_le limit 1000;
end $$;

revoke all on function gbs_private.trg_messagerie_rpc(), gbs_private.verifier_debit_messages() from public, anon, authenticated;
revoke all on function gbs.envoyer_message(uuid, text), gbs.creer_fil(jsonb), gbs.mes_fils(int), gbs.messages_du_fil(uuid) from public, anon;
grant execute on function gbs.envoyer_message(uuid, text), gbs.creer_fil(jsonb), gbs.mes_fils(int), gbs.messages_du_fil(uuid) to authenticated;
-- Utilisée dans les règles de lecture : exécutable par authenticated.
grant execute on function gbs_private.fil_visible(uuid) to authenticated;
