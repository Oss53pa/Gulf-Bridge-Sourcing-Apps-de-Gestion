-- Liste de colisage déclarée par le fournisseur (maquette « Espace fournisseur · expédition » :
-- caisses, poids brut, volume).
-- * Le fournisseur (compte en double facteur, commande à lui, production en cours ou terminée) déclare
--   le nombre de caisses, le poids brut (kg) et le volume (m3), avec une remarque facultative.
-- * Une seule déclaration en attente par commande : une nouvelle déclaration remplace celle en attente.
--   Les achats (admin, achats Chine) la valident ou la refusent avec un motif ; une déclaration validée
--   est figée et le fournisseur ne peut plus en déposer d'autre pour cette commande.
-- * Contrôle de vraisemblance en base : densité apparente entre 1 et 3 000 kg par m3, au plus
--   100 m3 par caisse ; sinon la déclaration est refusée à la saisie (erreur de frappe probable).
-- * Le document « Liste de colisage » du dossier reste la pièce qui fait foi pour la douane.

-- Limitation de débit des écritures des comptes externes (client, fournisseur) : compteur horaire par compte
-- et par action, seuil en paramètre daté. Sert aux fonctions des portails des migrations suivantes.
insert into gbs.parametres_definitions (cle, type, minimum, maximum, validateur, module, libelle) values
  ('portail.max_ecritures_heure', 'entier', 1, 10000, null, 'administration', 'Écritures au plus par compte externe, par action et par heure');
insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('portail.max_ecritures_heure', '60', date '2026-01-01', 'Limite anti-abus des portails client et fournisseur');

create table gbs.limites_debit (
  profil_id uuid not null references gbs.profils(id),
  action    text not null check (action ~ '^[a-z_]{2,40}$'),
  heure     timestamptz not null,
  nombre    int not null default 1,
  primary key (profil_id, action, heure)
);
alter table gbs.limites_debit enable row level security;   -- aucune règle : lecture et écriture par la fonction seule

create or replace function gbs_private.limiter(p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare n int; h timestamptz := date_trunc('hour', now());
begin
  if gbs_private.role() not in ('client','fournisseur') or auth.uid() is null then return; end if;
  delete from gbs.limites_debit where heure < now() - interval '2 days' and profil_id = auth.uid();
  insert into gbs.limites_debit (profil_id, action, heure) values (auth.uid(), p_action, h)
  on conflict (profil_id, action, heure) do update set nombre = gbs.limites_debit.nombre + 1 returning nombre into n;
  if n > gbs_private.param_num('portail.max_ecritures_heure')::int then
    raise exception 'GBS_TROP_DE_DEMANDES' using errcode = 'P0001';
  end if;
end $$;
revoke all on function gbs_private.limiter(text) from public, anon, authenticated;

create table gbs.colisages (
  id            uuid primary key default gen_random_uuid(),
  commande_id   uuid not null references gbs.commandes(id),
  dossier_id    uuid not null references gbs.dossiers(id),
  caisses       int not null check (caisses between 1 and 100000),
  poids_brut_kg numeric(12,2) not null check (poids_brut_kg > 0 and poids_brut_kg <= 10000000),
  volume_m3     numeric(10,3) not null check (volume_m3 > 0 and volume_m3 <= 100000),
  remarque      text check (length(remarque) <= 500),
  statut        text not null default 'declaree' check (statut in ('declaree','remplacee','validee','refusee')),
  auteur_id     uuid not null references gbs.profils(id),
  cree_le       timestamptz not null default clock_timestamp(),
  traitee_par   uuid references gbs.profils(id),
  traitee_le    timestamptz,
  motif_refus   text check (length(motif_refus) <= 1000),
  check (statut <> 'refusee' or motif_refus is not null),
  check (poids_brut_kg / volume_m3 between 1 and 3000),
  check (volume_m3 / caisses <= 100)
);
create index on gbs.colisages (commande_id, cree_le);
create unique index colisages_un_en_attente on gbs.colisages (commande_id) where statut = 'declaree';
create unique index colisages_un_valide on gbs.colisages (commande_id) where statut = 'validee';

create or replace function gbs_private.trg_colisage_rpc() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'colisage' then
    raise exception 'GBS_VALIDATION_RPC: la liste de colisage se déclare par les fonctions dédiées' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and old.statut <> 'declaree' then raise exception 'GBS_DEMANDE_TRAITEE' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'statut' - 'traitee_par' - 'traitee_le' - 'motif_refus')
                          is distinct from (to_jsonb(old) - 'statut' - 'traitee_par' - 'traitee_le' - 'motif_refus') then
    raise exception 'GBS_VALIDATION_RPC: une déclaration ne se modifie pas' using errcode = 'P0001';
  end if;
  return new;
end $$;

alter table gbs.colisages enable row level security;
grant select on gbs.colisages to authenticated;
create trigger colisages_rpc before insert or update on gbs.colisages for each row execute function gbs_private.trg_colisage_rpc();
create trigger colisages_audit after insert or update on gbs.colisages for each row execute function gbs_private.trg_audit();
create trigger colisages_nodel before delete on gbs.colisages for each row execute function gbs_private.trg_no_delete();
create policy colisages_lecture on gbs.colisages for select using (
  gbs_private.has_role('admin','achats_chine','hub_afrique','agent_pays','inspecteur') and gbs_private.dossier_visible(dossier_id));

-- Déclaration par le fournisseur : remplace la déclaration en attente ; refusée si une est déjà validée.
create or replace function gbs.declarer_colisage(p_commande uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare f uuid := gbs_private.mon_fournisseur(); k gbs.commandes; r uuid;
begin
  select * into k from gbs.commandes where id = p_commande for update;
  perform gbs_private.exiger(f is not null and k.id is not null and k.fournisseur_id = f
    and k.statut in ('en_production','production_terminee'));
  perform gbs_private.limiter('colisage');
  if jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) x where x not in ('caisses','poids_brut_kg','volume_m3','remarque'))
     or coalesce(jsonb_typeof(p -> 'caisses'), '') <> 'number' or coalesce(jsonb_typeof(p -> 'poids_brut_kg'), '') <> 'number'
     or coalesce(jsonb_typeof(p -> 'volume_m3'), '') <> 'number'
     or (p ? 'remarque' and jsonb_typeof(p -> 'remarque') not in ('string','null')) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if exists (select 1 from gbs.colisages c where c.commande_id = k.id and c.statut = 'validee') then
    raise exception 'GBS_COLISAGE_VALIDE' using errcode = 'P0001';
  end if;
  perform gbs_private.rpc('colisage');
  update gbs.colisages set statut = 'remplacee' where commande_id = k.id and statut = 'declaree';
  insert into gbs.colisages (commande_id, dossier_id, caisses, poids_brut_kg, volume_m3, remarque, auteur_id)
  values (k.id, k.dossier_id, (p ->> 'caisses')::int, (p ->> 'poids_brut_kg')::numeric, (p ->> 'volume_m3')::numeric,
          nullif(trim(p ->> 'remarque'), ''), auth.uid())
  returning id into r;
  perform gbs_private.rpc('');
  return r;
exception
  when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range or division_by_zero then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

-- Traitement par les achats : validation (figée) ou refus motivé.
create or replace function gbs.traiter_colisage(p_colisage uuid, p_valider boolean, p_motif text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c gbs.colisages;
begin
  select * into c from gbs.colisages where id = p_colisage;
  -- Même verrou que la déclaration (la commande), puis relecture : pas de course entre déclaration et validation.
  perform 1 from gbs.commandes where id = c.commande_id for update;
  select * into c from gbs.colisages where id = p_colisage for update;
  perform gbs_private.exiger(c.id is not null and gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(c.dossier_id));
  if p_valider is null then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  if c.statut <> 'declaree' then raise exception 'GBS_DEMANDE_TRAITEE' using errcode = 'P0001'; end if;
  if not p_valider then perform gbs_private.motif(p_motif); end if;
  perform gbs_private.rpc('colisage');
  update gbs.colisages set statut = case when p_valider then 'validee' else 'refusee' end, traitee_par = auth.uid(), traitee_le = now(),
         motif_refus = case when p_valider then null else trim(p_motif) end
   where id = c.id;
  perform gbs_private.rpc('');
end $$;

-- Portail fournisseur : ses déclarations par commande (le motif de refus interne n'est pas montré).
create or replace function gbs.mes_colisages() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f uuid := gbs_private.mon_fournisseur();
begin
  perform gbs_private.exiger(f is not null);
  return (select coalesce(jsonb_agg(jsonb_build_object('commande_id', c.commande_id, 'caisses', c.caisses, 'poids_brut_kg', c.poids_brut_kg,
            'volume_m3', c.volume_m3, 'statut', c.statut, 'cree_le', c.cree_le) order by c.cree_le desc), '[]'::jsonb)
            from gbs.colisages c join gbs.commandes k on k.id = c.commande_id
           where k.fournisseur_id = f and c.statut <> 'remplacee');
end $$;

revoke all on function gbs_private.trg_colisage_rpc() from public, anon, authenticated;
revoke all on function gbs.declarer_colisage(uuid, jsonb), gbs.traiter_colisage(uuid, boolean, text), gbs.mes_colisages() from public, anon;
grant execute on function gbs.declarer_colisage(uuid, jsonb), gbs.traiter_colisage(uuid, boolean, text), gbs.mes_colisages() to authenticated;
