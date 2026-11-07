-- Lot 1, M2 : vérification des clients avant ouverture d'une affaire (identité,
-- immatriculation, bénéficiaires effectifs, solvabilité, listes de sanctions), contrôle
-- refait chaque année et à chaque changement d'actionnaire. La décision reste réservée à
-- l'administratrice, à quatre yeux ; le statut du client ne se pose plus à la main.

insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('client.verification_validite_mois', '12', date '2026-01-01', 'Contrôle du client refait chaque année (cahier des charges, M2)'),
  ('client.verification_alerte_jours', '30', date '2026-01-01', 'Alerte avant l''échéance de la vérification d''un client');

-- -----------------------------------------------------------------------------
-- Bénéficiaires effectifs : historique conservé (sortie datée, jamais de suppression).
-- -----------------------------------------------------------------------------
create table gbs.beneficiaires_effectifs (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references gbs.clients(id),
  nom           text not null check (length(nom) between 2 and 200),
  nationalite   char(2) check (nationalite ~ '^[A-Z]{2}$'),
  pourcentage   numeric(5,2) not null check (pourcentage > 0 and pourcentage <= 100),
  fonction      text check (length(fonction) <= 120),
  entree_le     date not null default current_date,
  sortie_le     date,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check (sortie_le is null or sortie_le >= entree_le)
);
create index on gbs.beneficiaires_effectifs (client_id);
create trigger be_touch before update on gbs.beneficiaires_effectifs for each row execute function gbs_private.trg_touch();
create trigger be_cree before insert on gbs.beneficiaires_effectifs for each row execute function gbs_private.trg_cree_par();
create trigger be_audit after insert or update or delete on gbs.beneficiaires_effectifs for each row execute function gbs_private.trg_audit();
create trigger be_nodel before delete on gbs.beneficiaires_effectifs for each row execute function gbs_private.trg_no_delete();

-- Un changement d'actionnaire périme la vérification : le client repasse « non vérifié ».
create or replace function gbs_private.trg_beneficiaire() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select coalesce(sum(b.pourcentage), 0) from gbs.beneficiaires_effectifs b
       where b.client_id = new.client_id and b.sortie_le is null and b.id <> new.id)
     + (case when new.sortie_le is null then new.pourcentage else 0 end) > 100 then
    raise exception 'GBS_BENEFICIAIRES_DEPASSENT_100' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and new.client_id <> old.client_id then
    raise exception 'GBS_ACCES_REFUSE' using errcode = '42501';
  end if;
  -- Seul un changement d'actionnariat (entrée, sortie, part, identité) périme la vérification.
  if tg_op = 'INSERT' or (new.nom, new.nationalite, new.pourcentage, new.sortie_le)
                         is distinct from (old.nom, old.nationalite, old.pourcentage, old.sortie_le) then
    update gbs.clients set verification_statut = 'non_verifie'
     where id = new.client_id and verification_statut in ('verifie','en_cours');
    update gbs.verifications_clients set statut = 'perimee'
     where client_id = new.client_id and statut in ('en_cours','validee');
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Vérifications : cinq contrôles, chacun avec son résultat, sa source et sa date.
-- -----------------------------------------------------------------------------
create table gbs.verifications_clients (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references gbs.clients(id),
  controles     jsonb not null default '{}'::jsonb,
  statut        text not null default 'en_cours' check (statut in ('en_cours','validee','refusee','perimee')),
  statuee_par   uuid references gbs.profils(id),
  statuee_le    timestamptz,
  valide_jusqu_au date,
  motif         text check (length(motif) <= 1000),
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid
);
create index on gbs.verifications_clients (client_id);
create unique index verifications_une_en_cours on gbs.verifications_clients (client_id) where statut = 'en_cours';
create trigger vc_touch before update on gbs.verifications_clients for each row execute function gbs_private.trg_touch();
create trigger vc_cree before insert on gbs.verifications_clients for each row execute function gbs_private.trg_cree_par();
create trigger vc_audit after insert or update or delete on gbs.verifications_clients for each row execute function gbs_private.trg_audit();
create trigger vc_nodel before delete on gbs.verifications_clients for each row execute function gbs_private.trg_no_delete();

create or replace function gbs_private.controles_valides(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb;
begin
  if jsonb_typeof(p) <> 'object' then return false; end if;
  for k, v in select * from jsonb_each(p) loop
    if k not in ('identite','immatriculation','beneficiaires_effectifs','solvabilite','sanctions')
       or jsonb_typeof(v) <> 'object'
       or (select count(*) from jsonb_object_keys(v) x where x not in ('resultat','source','verifie_le','commentaire')) > 0
       or coalesce(v ->> 'resultat', '') not in ('conforme','non_conforme','a_verifier')
       or length(coalesce(v ->> 'source', '')) not between 2 and 200
       or coalesce(v ->> 'verifie_le', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or (v ? 'commentaire' and (jsonb_typeof(v -> 'commentaire') <> 'string' or length(v ->> 'commentaire') > 1000)) then
      return false;
    end if;
    if (v ->> 'verifie_le')::date > current_date then return false; end if;
  end loop;
  return true;
end $$;

create or replace function gbs_private.trg_verification_client() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not gbs_private.controles_valides(new.controles) then
    raise exception 'GBS_CONTROLES_INVALIDES' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    new.statut := 'en_cours'; new.statuee_par := null; new.statuee_le := null; new.valide_jusqu_au := null; new.motif := null;
    update gbs.clients set verification_statut = 'en_cours'
     where id = new.client_id and verification_statut <> 'verifie';
  else
    if new.client_id <> old.client_id then raise exception 'GBS_ACCES_REFUSE' using errcode = '42501'; end if;
    if (new.statut, new.statuee_par, new.statuee_le, new.valide_jusqu_au, new.motif)
       is distinct from (old.statut, old.statuee_par, old.statuee_le, old.valide_jusqu_au, old.motif)
       and coalesce(current_setting('gbs.rpc', true), '') <> 'statuer_verification_client'
       and not (new.statut = 'perimee' and current_user not in ('authenticated','anon')) then
      raise exception 'GBS_VALIDATION_RPC' using errcode = 'P0001';
    end if;
    if old.statut <> 'en_cours' and new.controles is distinct from old.controles then
      raise exception 'GBS_VERIFICATION_CLOSE' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
alter function gbs_private.trg_verification_client() security invoker;
create trigger vc_regles before insert or update on gbs.verifications_clients
  for each row execute function gbs_private.trg_verification_client();
-- Déclaré ici : la fonction vise gbs.verifications_clients.
create trigger be_regles before insert or update on gbs.beneficiaires_effectifs
  for each row execute function gbs_private.trg_beneficiaire();

-- Le statut « vérifié » ou « refusé » d'un client ne se pose plus à la main, même par
-- l'administratrice : il découle d'une vérification statuée.
create or replace function gbs_private.trg_client_verif() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.verification_statut in ('verifie','refuse'))
     or (tg_op = 'UPDATE' and (new.verification_statut, new.verification_date)
                               is distinct from (old.verification_statut, old.verification_date)
         and new.verification_statut in ('verifie','refuse')) then
    if current_user in ('authenticated','anon') and not gbs_private.is_admin() then
      raise exception 'GBS_VALIDATION_ADMIN: la vérification du client est statuée par l''administratrice'
        using errcode = '42501';
    end if;
    if current_user in ('authenticated','anon') and coalesce(current_setting('gbs.rpc', true), '') <> 'statuer_verification_client' then
      raise exception 'GBS_VALIDATION_RPC: le statut découle d''une vérification statuée' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
alter function gbs_private.trg_client_verif() security invoker;

-- Décision de l'administratrice : validée si les cinq contrôles sont conformes et au
-- moins un bénéficiaire effectif est enregistré ; refus motivé ; jamais par l'auteur.
create or replace function gbs.statuer_verification_client(p_verification uuid, p_decision text, p_motif text default null)
returns gbs.verifications_clients language plpgsql security definer set search_path = '' as $$
declare v gbs.verifications_clients; k text; validite int;
begin
  select * into v from gbs.verifications_clients where id = p_verification for update;
  perform gbs_private.exiger(v.id is not null and gbs_private.is_admin(), 'GBS_VALIDATION_ADMIN');
  if v.cree_par = auth.uid() then raise exception 'GBS_QUATRE_YEUX' using errcode = 'P0001'; end if;
  if v.statut <> 'en_cours' or p_decision not in ('validee','refusee') then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if p_decision = 'validee' then
    foreach k in array array['identite','immatriculation','beneficiaires_effectifs','solvabilite','sanctions'] loop
      if coalesce(v.controles -> k ->> 'resultat', '') <> 'conforme' then
        raise exception 'GBS_CONTROLE_NON_CONFORME: %', k using errcode = 'P0001';
      end if;
    end loop;
    if not exists (select 1 from gbs.beneficiaires_effectifs b where b.client_id = v.client_id and b.sortie_le is null) then
      raise exception 'GBS_BENEFICIAIRES_MANQUANTS' using errcode = 'P0001';
    end if;
  else
    perform gbs_private.motif(p_motif);
  end if;
  validite := gbs_private.param_num('client.verification_validite_mois')::int;
  perform gbs_private.rpc('statuer_verification_client');
  update gbs.verifications_clients set statut = p_decision, statuee_par = auth.uid(), statuee_le = now(),
         valide_jusqu_au = case when p_decision = 'validee' then (current_date + make_interval(months => validite))::date end,
         motif = p_motif
   where id = p_verification returning * into v;
  update gbs.clients set verification_statut = case when p_decision = 'validee' then 'verifie' else 'refuse' end,
         verification_date = current_date
   where id = v.client_id;
  perform gbs_private.rpc('');
  return v;
end $$;

-- Clients dont la vérification arrive à échéance (ou est échue) : à refaire.
create or replace function gbs.clients_a_reverifier()
returns table (client_id uuid, raison_sociale text, verification_date date, echeance date)
language plpgsql stable security definer set search_path = '' as $$
declare mois int; alerte int;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','hub_afrique','agent_pays'));
  mois := gbs_private.param_num('client.verification_validite_mois')::int;
  alerte := gbs_private.param_num('client.verification_alerte_jours')::int;
  return query
    select c.id, c.raison_sociale, c.verification_date, (c.verification_date + make_interval(months => mois))::date
      from gbs.clients c
     where c.verification_statut = 'verifie' and c.archive_le is null and gbs_private.client_visible(c.id)
       and (c.verification_date + make_interval(months => mois))::date <= current_date + alerte
     order by 4;
end $$;

-- -----------------------------------------------------------------------------
-- Droits : données personnelles des bénéficiaires visibles des seuls rôles qui suivent le client.
-- -----------------------------------------------------------------------------
alter table gbs.beneficiaires_effectifs enable row level security;
alter table gbs.verifications_clients enable row level security;
grant select, insert, update on gbs.beneficiaires_effectifs, gbs.verifications_clients to authenticated;
create policy be_lecture on gbs.beneficiaires_effectifs for select using (
  gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.client_visible(client_id));
create policy be_ecriture on gbs.beneficiaires_effectifs for insert with check (
  gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.client_visible(client_id));
create policy be_maj on gbs.beneficiaires_effectifs for update using (
  gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.client_visible(client_id))
  with check (gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.client_visible(client_id));
create policy vc_lecture on gbs.verifications_clients for select using (
  gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.client_visible(client_id));
create policy vc_ecriture on gbs.verifications_clients for insert with check (
  gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.client_visible(client_id));
create policy vc_maj on gbs.verifications_clients for update using (
  gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.client_visible(client_id) and statut = 'en_cours')
  with check (gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.client_visible(client_id));

revoke execute on function gbs.statuer_verification_client(uuid, text, text), gbs.clients_a_reverifier(),
  gbs_private.trg_beneficiaire(), gbs_private.controles_valides(jsonb), gbs_private.trg_verification_client() from public;
grant execute on function gbs.statuer_verification_client(uuid, text, text), gbs.clients_a_reverifier() to authenticated;
grant execute on all functions in schema gbs_private to authenticated, service_role;
