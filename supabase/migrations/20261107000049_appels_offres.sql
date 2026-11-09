-- M24 (lot 2) : appels d'offres clients et préqualification (section Appels d'offres du module
-- Commercial ; maquette « Appels d'offres » AOF et fiche d'appel d'offres).
-- * Un appel d'offres : donneur d'ordre, objet, procédure, date limite, valeur estimée, société qui
--   répond. Liste des pièces administratives et des offres pré-remplie à la création, complétable.
-- * Le dépôt exige toutes les pièces prêtes ; après dépôt, plus aucune pièce ne change.
-- * Le résultat (gagné, perdu, abandonné) clôt l'appel d'offres ; motif obligatoire s'il est perdu ou
--   abandonné : il sert aux réponses suivantes.
-- * Questions au donneur d'ordre et réponses reçues, datées.
-- * Accès : administratrice et Hub Afrique, sur les sociétés de leur profil. Écritures par fonctions
--   uniquement (aucun droit d'écriture directe), toutes journalisées ; aucune suppression.

create table gbs.appels_offres (
  id              uuid primary key default gen_random_uuid(),
  reference       text unique check (reference ~ '^AO-[0-9]{4}-[0-9]{2,4}$'),
  societe_id      uuid not null references gbs.societes(id),
  client_id       uuid references gbs.clients(id),
  donneur_ordre   text not null check (length(trim(donneur_ordre)) between 2 and 200),
  objet           text not null check (length(trim(objet)) between 2 and 300),
  nature          text not null default 'appel_offres' check (nature in ('appel_offres','prequalification')),
  procedure       text not null default 'ouvert' check (procedure in ('ouvert','restreint','consultation','referencement')),
  date_limite     date not null,
  valeur_estimee  numeric(16,0) check (valeur_estimee between 0 and 100000000000),
  devise          char(3) not null default 'XOF' check (devise in ('XOF','XAF','USD')),
  statut          text not null default 'en_preparation' check (statut in ('en_preparation','depose','gagne','perdu','abandonne')),
  motif_resultat  text check (length(motif_resultat) <= 1000),
  depose_le       timestamptz,
  resultat_le     timestamptz,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid
);
create index on gbs.appels_offres (statut, date_limite);

create table gbs.appels_offres_pieces (
  id        uuid primary key default gen_random_uuid(),
  ao_id     uuid not null references gbs.appels_offres(id),
  libelle   text not null check (length(trim(libelle)) between 2 and 200),
  ordre     int not null default 100,
  prete     boolean not null default false,
  prete_le  timestamptz,
  prete_par uuid,
  cree_le timestamptz not null default now(), cree_par uuid
);
create index on gbs.appels_offres_pieces (ao_id, ordre);

create table gbs.appels_offres_questions (
  id          uuid primary key default gen_random_uuid(),
  ao_id       uuid not null references gbs.appels_offres(id),
  question    text not null check (length(trim(question)) between 3 and 1000),
  reponse     text check (length(reponse) <= 2000),
  posee_le    timestamptz not null default now(),
  repondue_le timestamptz,
  cree_par uuid
);
create index on gbs.appels_offres_questions (ao_id, posee_le);

create or replace function gbs_private.ao_visible(p_societe uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select gbs_private.has_role('admin','hub_afrique') and gbs_private.societe_ok(p_societe)
$$;

alter table gbs.appels_offres enable row level security;
alter table gbs.appels_offres_pieces enable row level security;
alter table gbs.appels_offres_questions enable row level security;
grant select on gbs.appels_offres, gbs.appels_offres_pieces, gbs.appels_offres_questions to authenticated;
create policy ao_lecture on gbs.appels_offres for select using (gbs_private.ao_visible(societe_id));
create policy ao_pieces_lecture on gbs.appels_offres_pieces for select
  using (exists (select 1 from gbs.appels_offres a where a.id = ao_id and gbs_private.ao_visible(a.societe_id)));
create policy ao_questions_lecture on gbs.appels_offres_questions for select
  using (exists (select 1 from gbs.appels_offres a where a.id = ao_id and gbs_private.ao_visible(a.societe_id)));

-- Écriture directe interdite, même pour le rôle de service, hors fonctions dédiées (drapeau gbs.rpc).
create or replace function gbs_private.trg_ao_rpc() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'appel_offres' then
    raise exception 'GBS_VALIDATION_RPC: les appels d''offres se modifient par les fonctions dédiées' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger appels_offres_rpc before insert or update on gbs.appels_offres for each row execute function gbs_private.trg_ao_rpc();
create trigger appels_offres_pieces_rpc before insert or update on gbs.appels_offres_pieces for each row execute function gbs_private.trg_ao_rpc();
create trigger appels_offres_questions_rpc before insert or update on gbs.appels_offres_questions for each row execute function gbs_private.trg_ao_rpc();
create trigger appels_offres_touch before update on gbs.appels_offres for each row execute function gbs_private.trg_touch();
create trigger appels_offres_cree before insert on gbs.appels_offres for each row execute function gbs_private.trg_cree_par();
create trigger appels_offres_pieces_cree before insert on gbs.appels_offres_pieces for each row execute function gbs_private.trg_cree_par();
create trigger appels_offres_questions_cree before insert on gbs.appels_offres_questions for each row execute function gbs_private.trg_cree_par();
create trigger appels_offres_audit after insert or update on gbs.appels_offres for each row execute function gbs_private.trg_audit();
create trigger appels_offres_pieces_audit after insert or update on gbs.appels_offres_pieces for each row execute function gbs_private.trg_audit();
create trigger appels_offres_questions_audit after insert or update on gbs.appels_offres_questions for each row execute function gbs_private.trg_audit();
create trigger appels_offres_nodel before delete on gbs.appels_offres for each row execute function gbs_private.trg_no_delete();
create trigger appels_offres_pieces_nodel before delete on gbs.appels_offres_pieces for each row execute function gbs_private.trg_no_delete();
create trigger appels_offres_questions_nodel before delete on gbs.appels_offres_questions for each row execute function gbs_private.trg_no_delete();

-- Appel d'offres modifiable (en préparation) et visible : sinon refus.
create or replace function gbs_private.ao_modifiable(p_ao uuid) returns gbs.appels_offres
language plpgsql security definer set search_path = '' as $$
declare a gbs.appels_offres;
begin
  select * into a from gbs.appels_offres where id = p_ao for update;
  perform gbs_private.exiger(a.id is not null and gbs_private.ao_visible(a.societe_id));
  if a.statut <> 'en_preparation' then raise exception 'GBS_AO_CLOS' using errcode = 'P0001'; end if;
  return a;
end $$;

create or replace function gbs.creer_appel_offres(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a gbs.appels_offres; n int; cles text[] := array['societe_id','client_id','donneur_ordre','objet','nature','procedure',
        'date_limite','valeur_estimee','devise','pieces'];
        lib text; i int := 0;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','hub_afrique'));
  if jsonb_typeof(p) <> 'object' or exists (select 1 from jsonb_object_keys(p) k where not k = any(cles))
     or (p ? 'pieces' and (jsonb_typeof(p -> 'pieces') <> 'array' or jsonb_array_length(p -> 'pieces') > 30)) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform gbs_private.exiger(gbs_private.societe_ok((p ->> 'societe_id')::uuid));
  if (p ->> 'date_limite')::date < current_date then raise exception 'GBS_DATE_INVALIDE' using errcode = '22023'; end if;
  if p ->> 'client_id' is not null and not exists (select 1 from gbs.clients c where c.id = (p ->> 'client_id')::uuid) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(7349);
  select coalesce(max(substring(reference from '-([0-9]+)$')::int), 0) + 1 into n
    from gbs.appels_offres where reference like 'AO-' || extract(year from now())::int || '-%';
  perform gbs_private.rpc('appel_offres');
  insert into gbs.appels_offres (reference, societe_id, client_id, donneur_ordre, objet, nature, procedure, date_limite, valeur_estimee, devise)
  values ('AO-' || extract(year from now())::int || '-' || lpad(n::text, 2, '0'), (p ->> 'societe_id')::uuid,
          nullif(p ->> 'client_id', '')::uuid, trim(p ->> 'donneur_ordre'), trim(p ->> 'objet'),
          coalesce(nullif(p ->> 'nature', ''), 'appel_offres'), coalesce(nullif(p ->> 'procedure', ''), 'ouvert'),
          (p ->> 'date_limite')::date, (p ->> 'valeur_estimee')::numeric, coalesce(nullif(p ->> 'devise', ''), 'XOF'))
  returning * into a;
  for lib in select jsonb_array_elements_text(coalesce(p -> 'pieces', '[]'::jsonb)) loop
    i := i + 1;
    insert into gbs.appels_offres_pieces (ao_id, libelle, ordre) values (a.id, trim(lib), i);
  end loop;
  perform gbs_private.rpc('');
  return a.id;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
               or numeric_value_out_of_range or check_violation or not_null_violation then
  raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

create or replace function gbs.ajouter_piece_appel_offres(p_ao uuid, p_libelle text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a gbs.appels_offres := gbs_private.ao_modifiable(p_ao); r uuid;
begin
  if p_libelle is null or length(trim(p_libelle)) not between 2 and 200 then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  if (select count(*) from gbs.appels_offres_pieces where ao_id = a.id) >= 30 then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  perform gbs_private.rpc('appel_offres');
  insert into gbs.appels_offres_pieces (ao_id, libelle, ordre)
  values (a.id, trim(p_libelle), (select coalesce(max(ordre), 0) + 1 from gbs.appels_offres_pieces where ao_id = a.id)) returning id into r;
  perform gbs_private.rpc('');
  return r;
end $$;

create or replace function gbs.marquer_piece_appel_offres(p_piece uuid, p_prete boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare ao uuid;
begin
  select ao_id into ao from gbs.appels_offres_pieces where id = p_piece;
  perform gbs_private.ao_modifiable(ao);
  if p_prete is null then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  perform gbs_private.rpc('appel_offres');
  update gbs.appels_offres_pieces set prete = p_prete,
         prete_le = case when p_prete then now() end, prete_par = case when p_prete then auth.uid() end
   where id = p_piece;
  perform gbs_private.rpc('');
end $$;

create or replace function gbs.poser_question_appel_offres(p_ao uuid, p_question text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a gbs.appels_offres := gbs_private.ao_modifiable(p_ao); r uuid;
begin
  if p_question is null or length(trim(p_question)) not between 3 and 1000 then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  perform gbs_private.rpc('appel_offres');
  insert into gbs.appels_offres_questions (ao_id, question) values (a.id, trim(p_question)) returning id into r;
  perform gbs_private.rpc('');
  return r;
end $$;

create or replace function gbs.repondre_question_appel_offres(p_question uuid, p_reponse text) returns void
language plpgsql security definer set search_path = '' as $$
declare q gbs.appels_offres_questions; a gbs.appels_offres;
begin
  select * into q from gbs.appels_offres_questions where id = p_question;
  select * into a from gbs.appels_offres where id = q.ao_id;
  perform gbs_private.exiger(a.id is not null and gbs_private.ao_visible(a.societe_id));
  if p_reponse is null or length(trim(p_reponse)) not between 1 and 2000 then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  if q.repondue_le is not null then raise exception 'GBS_DEJA_REPONDU' using errcode = 'P0001'; end if;
  perform gbs_private.rpc('appel_offres');
  update gbs.appels_offres_questions set reponse = trim(p_reponse), repondue_le = now() where id = p_question;
  perform gbs_private.rpc('');
end $$;

create or replace function gbs.deposer_appel_offres(p_ao uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a gbs.appels_offres := gbs_private.ao_modifiable(p_ao); manque int;
begin
  select count(*) into manque from gbs.appels_offres_pieces where ao_id = a.id and not prete;
  if manque > 0 or not exists (select 1 from gbs.appels_offres_pieces where ao_id = a.id) then
    raise exception 'GBS_AO_PIECES_MANQUANTES: %', manque using errcode = 'P0001';
  end if;
  if a.date_limite < current_date then raise exception 'GBS_AO_DATE_DEPASSEE' using errcode = 'P0001'; end if;
  perform gbs_private.rpc('appel_offres');
  update gbs.appels_offres set statut = 'depose', depose_le = now() where id = a.id;
  perform gbs_private.rpc('');
end $$;

create or replace function gbs.resultat_appel_offres(p_ao uuid, p_statut text, p_motif text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare a gbs.appels_offres;
begin
  select * into a from gbs.appels_offres where id = p_ao for update;
  perform gbs_private.exiger(a.id is not null and gbs_private.ao_visible(a.societe_id));
  if p_statut not in ('gagne','perdu','abandonne') or length(coalesce(p_motif, '')) > 1000 then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if a.statut in ('gagne','perdu','abandonne') then raise exception 'GBS_AO_CLOS' using errcode = 'P0001'; end if;
  if p_statut in ('gagne','perdu') and a.statut <> 'depose' then raise exception 'GBS_AO_NON_DEPOSE' using errcode = 'P0001'; end if;
  if p_statut in ('perdu','abandonne') and length(trim(coalesce(p_motif, ''))) < 3 then
    raise exception 'GBS_MOTIF_OBLIGATOIRE' using errcode = 'P0001';
  end if;
  perform gbs_private.rpc('appel_offres');
  update gbs.appels_offres set statut = p_statut, motif_resultat = nullif(trim(p_motif), ''), resultat_le = now() where id = a.id;
  perform gbs_private.rpc('');
end $$;

-- ao_visible reste exécutable par authenticated : les règles de lecture l’appellent.
revoke all on function gbs_private.ao_modifiable(uuid), gbs_private.trg_ao_rpc() from public, anon, authenticated;
revoke all on function gbs.creer_appel_offres(jsonb), gbs.ajouter_piece_appel_offres(uuid, text), gbs.marquer_piece_appel_offres(uuid, boolean),
  gbs.poser_question_appel_offres(uuid, text), gbs.repondre_question_appel_offres(uuid, text), gbs.deposer_appel_offres(uuid),
  gbs.resultat_appel_offres(uuid, text, text) from public, anon;
grant execute on function gbs.creer_appel_offres(jsonb), gbs.ajouter_piece_appel_offres(uuid, text), gbs.marquer_piece_appel_offres(uuid, boolean),
  gbs.poser_question_appel_offres(uuid, text), gbs.repondre_question_appel_offres(uuid, text), gbs.deposer_appel_offres(uuid),
  gbs.resultat_appel_offres(uuid, text, text) to authenticated;
