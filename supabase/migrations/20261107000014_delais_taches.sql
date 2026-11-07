-- Lot 1, M23 : délais en jours ouvrés avec alertes, attente d'un tiers, tâches,
-- « mes tâches » et délégation en cas d'absence (cahier des charges, section 4 bis).

-- -----------------------------------------------------------------------------
-- Calendrier des jours fériés et des jours ouvrés exceptionnels par pays.
-- La Chine fait travailler certains samedis ou dimanches autour des congés
-- officiels : ces jours sont saisis avec la nature « ouvre ».
-- -----------------------------------------------------------------------------
create table gbs.calendrier (
  pays      char(2) not null check (pays in ('CN','CI','GA','CM')),
  jour      date not null check (jour between date '2020-01-01' and date '2100-12-31'),
  nature    text not null check (nature in ('ferie','ouvre')),
  libelle   text not null check (length(libelle) between 2 and 120),
  confirme  boolean not null default false,
  source    text check (length(source) <= 200),
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  primary key (pays, jour)
);
create trigger calendrier_touch before update on gbs.calendrier for each row execute function gbs_private.trg_touch();
create trigger calendrier_cree before insert on gbs.calendrier for each row execute function gbs_private.trg_cree_par();
create trigger calendrier_audit after insert or update or delete on gbs.calendrier for each row execute function gbs_private.trg_audit();
alter table gbs.calendrier enable row level security;
grant select, insert, update, delete on gbs.calendrier to authenticated;
create policy calendrier_lecture on gbs.calendrier for select using (gbs_private.interne());
create policy calendrier_admin on gbs.calendrier for all using (gbs_private.is_admin()) with check (gbs_private.is_admin());

-- Dimanche de Pâques (algorithme grégorien anonyme, Meeus/Jones/Butcher).
create or replace function gbs_private.paques(p_annee int) returns date
language plpgsql immutable set search_path = '' as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int;
begin
  a := p_annee % 19; b := p_annee / 100; c := p_annee % 100; d := b / 4; e := b % 4;
  f := (b + 8) / 25; g := (b - f + 1) / 3; h := (19 * a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  return make_date(p_annee, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
end $$;

-- Proposition de calendrier 2026-2030 pour les jours fériés à date fixe et ceux
-- liés à Pâques. Tout est « à confirmer » par l'administratrice. Les fêtes
-- musulmanes (dates annoncées chaque année) et le calendrier officiel chinois
-- (congés et jours ouvrés de compensation publiés chaque année) sont à saisir.
insert into gbs.calendrier (pays, jour, nature, libelle, source)
select x.pays, x.jour, 'ferie', x.libelle, 'Proposition initiale — à confirmer par l''administratrice'
from (
  select f.pays, make_date(y, f.mois, f.jour) as jour, f.libelle
  from generate_series(2026, 2030) y
  cross join (values
    ('CI', 1, 1, 'Jour de l''an'), ('CI', 5, 1, 'Fête du travail'), ('CI', 8, 7, 'Fête de l''indépendance'),
    ('CI', 8, 15, 'Assomption'), ('CI', 11, 1, 'Toussaint'), ('CI', 11, 15, 'Journée nationale de la paix'),
    ('CI', 12, 25, 'Noël'),
    ('CM', 1, 1, 'Jour de l''an'), ('CM', 2, 11, 'Fête de la jeunesse'), ('CM', 5, 1, 'Fête du travail'),
    ('CM', 5, 20, 'Fête nationale'), ('CM', 8, 15, 'Assomption'), ('CM', 12, 25, 'Noël'),
    ('GA', 1, 1, 'Jour de l''an'), ('GA', 4, 17, 'Journée des droits de la femme'), ('GA', 5, 1, 'Fête du travail'),
    ('GA', 8, 15, 'Assomption'), ('GA', 8, 16, 'Fête de l''indépendance'), ('GA', 8, 17, 'Fête de l''indépendance'),
    ('GA', 11, 1, 'Toussaint'), ('GA', 12, 25, 'Noël')
  ) as f (pays, mois, jour, libelle)
  union all
  select p.pays, gbs_private.paques(y) + p.decalage, p.libelle
  from generate_series(2026, 2030) y
  cross join (values
    ('CI', 1, 'Lundi de Pâques'), ('CI', 39, 'Ascension'), ('CI', 50, 'Lundi de Pentecôte'),
    ('CM', -2, 'Vendredi saint'), ('CM', 39, 'Ascension'),
    ('GA', 1, 'Lundi de Pâques'), ('GA', 50, 'Lundi de Pentecôte')
  ) as p (pays, decalage, libelle)
) x
on conflict (pays, jour) do nothing;

create or replace function gbs_private.est_ouvre(p_pays text, p_jour date) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select c.nature = 'ouvre' from gbs.calendrier c where c.pays = p_pays and c.jour = p_jour),
    extract(isodow from p_jour) < 6)
$$;

-- Jours ouvrés dans l'intervalle ]p_debut, p_fin] (0 si p_fin <= p_debut).
create or replace function gbs_private.jours_ouvres_entre(p_pays text, p_debut date, p_fin date) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from generate_series(p_debut + 1, p_fin, interval '1 day') j
  where p_fin > p_debut and gbs_private.est_ouvre(p_pays, j::date)
$$;

-- Date atteinte après p_n jours ouvrés à partir de p_debut (p_debut exclu).
create or replace function gbs_private.ajouter_jours_ouvres(p_pays text, p_debut date, p_n int) returns date
language plpgsql stable security definer set search_path = '' as $$
declare j date := p_debut; reste int := greatest(coalesce(p_n, 0), 0);
begin
  if reste > 3650 then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023'; end if;
  while reste > 0 loop
    j := j + 1;
    if gbs_private.est_ouvre(p_pays, j) then reste := reste - 1; end if;
  end loop;
  return j;
end $$;

-- -----------------------------------------------------------------------------
-- Délais cibles par modèle et par phase (valeurs à définir par la fondatrice).
-- -----------------------------------------------------------------------------
create table gbs.delais_cibles (
  modele       text not null references gbs.modeles_dossier(code),
  phase        text not null check (phase in ('consultation','verification','mise_en_concurrence','devis_mandat',
                 'contrat','approbation_technique','production','inspection','expedition','livraison','cloture')),
  jours_ouvres int not null check (jours_ouvres between 1 and 365),
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  primary key (modele, phase)
);
create trigger delais_touch before update on gbs.delais_cibles for each row execute function gbs_private.trg_touch();
create trigger delais_cree before insert on gbs.delais_cibles for each row execute function gbs_private.trg_cree_par();
create trigger delais_audit after insert or update or delete on gbs.delais_cibles for each row execute function gbs_private.trg_audit();
alter table gbs.delais_cibles enable row level security;
grant select, insert, update, delete on gbs.delais_cibles to authenticated;
create policy delais_lecture on gbs.delais_cibles for select using (gbs_private.interne());
create policy delais_admin on gbs.delais_cibles for all using (gbs_private.is_admin()) with check (gbs_private.is_admin());

insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('delai.seuil_alerte', '0.8', date '2026-01-01', 'Voyant orange à partir de cette part du délai cible consommée');

-- -----------------------------------------------------------------------------
-- Attente d'un tiers : l'horloge interne s'arrête, le délai externe est mesuré.
-- -----------------------------------------------------------------------------
alter table gbs.dossier_phases
  add column attente_tiers text check (attente_tiers in ('client','fournisseur','transporteur','autre'));

create table gbs.phase_attentes (
  id          uuid primary key default gen_random_uuid(),
  phase_id    uuid not null references gbs.dossier_phases(id),
  dossier_id  uuid not null references gbs.dossiers(id),
  tiers       text not null check (tiers in ('client','fournisseur','transporteur','autre')),
  debut       date not null,
  fin         date,
  cree_le timestamptz not null default now(), cree_par uuid,
  check (fin is null or fin >= debut)
);
create unique index phase_attentes_ouverte on gbs.phase_attentes (phase_id) where fin is null;
create trigger attentes_cree before insert on gbs.phase_attentes for each row execute function gbs_private.trg_cree_par();
create trigger attentes_audit after insert or update or delete on gbs.phase_attentes for each row execute function gbs_private.trg_audit();
create trigger attentes_nodel before delete on gbs.phase_attentes for each row execute function gbs_private.trg_no_delete();
alter table gbs.phase_attentes enable row level security;
grant select on gbs.phase_attentes to authenticated;
create policy attentes_lecture on gbs.phase_attentes for select using (
  gbs_private.interne() and gbs_private.dossier_visible(dossier_id));

-- Tenue automatique des périodes d'attente au changement de statut d'une phase.
create or replace function gbs_private.trg_phase_attente() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.statut = 'attente_tiers' and new.attente_tiers is null then
    raise exception 'GBS_TIERS_REQUIS: précisez le tiers attendu' using errcode = '22023';
  end if;
  if new.statut <> 'attente_tiers' then new.attente_tiers := null; end if;
  if old.statut = 'attente_tiers' and (new.statut <> 'attente_tiers' or new.attente_tiers is distinct from old.attente_tiers) then
    update gbs.phase_attentes set fin = current_date where phase_id = new.id and fin is null;
  end if;
  if new.statut = 'attente_tiers' and (old.statut <> 'attente_tiers' or new.attente_tiers is distinct from old.attente_tiers) then
    insert into gbs.phase_attentes (phase_id, dossier_id, tiers, debut)
    values (new.id, new.dossier_id, new.attente_tiers, current_date);
  end if;
  return new;
end $$;
create trigger phases_attente before update on gbs.dossier_phases
  for each row execute function gbs_private.trg_phase_attente();

-- La première phase naît « en cours » : sa date de début réelle est la date
-- d'ouverture du dossier (sans elle, aucun délai n'était mesurable).
create or replace function gbs_private.trg_phase_debut() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.statut = 'en_cours' and new.reelle_debut is null then
    select d.ouvert_le into new.reelle_debut from gbs.dossiers d where d.id = new.dossier_id;
  end if;
  return new;
end $$;
create trigger phases_debut before insert on gbs.dossier_phases
  for each row execute function gbs_private.trg_phase_debut();
update gbs.dossier_phases f set reelle_debut = d.ouvert_le
  from gbs.dossiers d where d.id = f.dossier_id and f.statut <> 'non_commencee' and f.reelle_debut is null;

-- Pays dont le calendrier s'applique à une phase : celui de la personne qui doit
-- agir (agent pays : son pays ; sinon le pays de sa société), à défaut le dossier.
create or replace function gbs_private.pays_calendrier(p_responsable uuid, p_pays_dossier text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select coalesce(p.pays, (select s.pays from gbs.societes s where s.id = p.societes[1]))
       from gbs.profils p where p.id = p_responsable),
    p_pays_dossier)
$$;

-- État des délais de chaque phase d'un dossier.
create or replace function gbs.etat_delais(p_dossier uuid)
returns table (phase text, ordre int, statut text, responsable_id uuid, pays_calendrier text,
               debut date, fin date, cible int, jours_internes int, jours_externes int,
               echeance date, voyant text)
language plpgsql stable security definer set search_path = '' as $$
declare d gbs.dossiers; ph record; seuil numeric; total int; ext int; jusqua date;
begin
  perform gbs_private.exiger(gbs_private.interne() and gbs_private.dossier_visible(p_dossier));
  select * into d from gbs.dossiers where id = p_dossier;
  seuil := gbs_private.param_num('delai.seuil_alerte');
  for ph in select p.*, c.jours_ouvres from gbs.dossier_phases p
              left join gbs.delais_cibles c on c.modele = d.modele and c.phase = p.phase
             where p.dossier_id = p_dossier order by p.ordre loop
    phase := ph.phase; ordre := ph.ordre; statut := ph.statut; responsable_id := ph.responsable_id;
    pays_calendrier := gbs_private.pays_calendrier(ph.responsable_id, d.pays);
    debut := ph.reelle_debut; fin := ph.reelle_fin; cible := ph.jours_ouvres;
    jours_internes := null; jours_externes := null; echeance := null; voyant := null;
    if ph.reelle_debut is not null then
      jusqua := coalesce(ph.reelle_fin, current_date);
      total := gbs_private.jours_ouvres_entre(pays_calendrier, ph.reelle_debut, jusqua);
      select coalesce(sum(gbs_private.jours_ouvres_entre(pays_calendrier, a.debut, least(coalesce(a.fin, jusqua), jusqua))), 0)
        into ext from gbs.phase_attentes a where a.phase_id = ph.id;
      jours_externes := ext;
      jours_internes := greatest(total - ext, 0);
      if cible is not null then
        echeance := gbs_private.ajouter_jours_ouvres(pays_calendrier, ph.reelle_debut, cible + ext);
        voyant := case when jours_internes > cible then 'rouge'
                       when jours_internes >= ceil(cible * seuil) then 'orange'
                       else 'vert' end;
      end if;
    end if;
    return next;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Tâches et « mes tâches ».
-- -----------------------------------------------------------------------------
create table gbs.taches (
  id          uuid primary key default gen_random_uuid(),
  dossier_id  uuid references gbs.dossiers(id),
  phase       text check (phase in ('consultation','verification','mise_en_concurrence','devis_mandat',
                'contrat','approbation_technique','production','inspection','expedition','livraison','cloture')),
  libelle     text not null check (length(libelle) between 3 and 300),
  details     text check (length(details) <= 2000),
  assigne_a   uuid not null references gbs.profils(id),
  echeance    date,
  statut      text not null default 'a_faire' check (statut in ('a_faire','en_cours','faite','annulee')),
  faite_le    timestamptz,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check (phase is null or dossier_id is not null)
);
create index taches_assigne on gbs.taches (assigne_a) where statut in ('a_faire','en_cours');
create trigger taches_touch before update on gbs.taches for each row execute function gbs_private.trg_touch();
create trigger taches_cree before insert on gbs.taches for each row execute function gbs_private.trg_cree_par();
create trigger taches_audit after insert or update or delete on gbs.taches for each row execute function gbs_private.trg_audit();
create trigger taches_nodel before delete on gbs.taches for each row execute function gbs_private.trg_no_delete();

create or replace function gbs_private.trg_tache() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from gbs.profils p where p.id = new.assigne_a and p.actif
                   and p.role in ('admin','achats_chine','hub_afrique','agent_pays','inspecteur','comptable')) then
    raise exception 'GBS_ASSIGNE_INVALIDE: la tâche doit être confiée à un membre actif de l''équipe' using errcode = '22023';
  end if;
  if new.statut = 'faite' and (tg_op = 'INSERT' or old.statut <> 'faite') then new.faite_le := now(); end if;
  if new.statut <> 'faite' then new.faite_le := null; end if;
  if tg_op = 'UPDATE' and current_user in ('authenticated','anon') and not gbs_private.is_admin()
     and old.cree_par is distinct from auth.uid()
     and (new.dossier_id, new.phase, new.libelle, new.details, new.assigne_a, new.echeance)
         is distinct from (old.dossier_id, old.phase, old.libelle, old.details, old.assigne_a, old.echeance) then
    raise exception 'GBS_ACCES_REFUSE: seul l''auteur ou l''administratrice modifie la tâche' using errcode = '42501';
  end if;
  return new;
end $$;
alter function gbs_private.trg_tache() security invoker;
create trigger taches_regles before insert or update on gbs.taches
  for each row execute function gbs_private.trg_tache();

alter table gbs.taches enable row level security;
grant select, insert, update on gbs.taches to authenticated;
create policy taches_lecture on gbs.taches for select using (
  gbs_private.interne() and (assigne_a = auth.uid() or cree_par = auth.uid() or gbs_private.is_admin()
    or (dossier_id is not null and gbs_private.dossier_visible(dossier_id)
        and gbs_private.has_role('achats_chine','hub_afrique','agent_pays'))));
create policy taches_creation on gbs.taches for insert with check (
  gbs_private.interne() and (dossier_id is null or gbs_private.dossier_visible(dossier_id)));
create policy taches_maj on gbs.taches for update using (
  gbs_private.interne() and (assigne_a = auth.uid() or cree_par = auth.uid() or gbs_private.is_admin()))
  with check (gbs_private.interne());

-- « Mes tâches » : tâches confiées, phases en alerte, points bloquants et pièces
-- obligatoires manquantes de la phase en cours dont la personne a la charge.
create or replace function gbs.mes_taches()
returns table (nature text, objet_id uuid, dossier_id uuid, dossier_reference text, libelle text,
               echeance date, urgence int)
language plpgsql stable security definer set search_path = '' as $$
declare moi uuid := auth.uid(); ph record; e record;
begin
  perform gbs_private.exiger(gbs_private.interne());
  return query
    select 'tache'::text, t.id, t.dossier_id, d.reference, t.libelle, t.echeance,
           case when t.echeance < current_date then 1 when t.echeance <= current_date + 2 then 2 else 3 end
      from gbs.taches t left join gbs.dossiers d on d.id = t.dossier_id
     where t.assigne_a = moi and t.statut in ('a_faire','en_cours');
  return query
    select 'point_bloquant'::text, b.id, b.dossier_id, d.reference, b.description, b.echeance,
           case when b.echeance < current_date then 1 when b.echeance <= current_date + 2 then 2 else 3 end
      from gbs.points_bloquants b join gbs.dossiers d on d.id = b.dossier_id
     where b.responsable_id = moi and b.resolu_le is null;
  return query
    select 'piece'::text, p.id, p.dossier_id, d.reference, p.libelle, null::date, 2
      from gbs.pieces p join gbs.dossiers d on d.id = p.dossier_id
      join gbs.dossier_phases f on f.dossier_id = d.id and f.phase = d.phase_courante
     where d.statut = 'ouvert' and p.phase = d.phase_courante and p.obligatoire
       and p.statut in ('manquante','refusee','expiree')
       and coalesce(f.responsable_id, d.chef_id) = moi;
  for ph in select d.id, d.reference, d.phase_courante from gbs.dossiers d
              join gbs.dossier_phases f on f.dossier_id = d.id and f.phase = d.phase_courante
             where d.statut = 'ouvert' and coalesce(f.responsable_id, d.chef_id) = moi loop
    select * into e from gbs.etat_delais(ph.id) x where x.phase = ph.phase_courante;
    if e.voyant in ('orange','rouge') then
      nature := 'delai'; objet_id := ph.id; dossier_id := ph.id; dossier_reference := ph.reference;
      libelle := ph.phase_courante; echeance := e.echeance; urgence := case when e.voyant = 'rouge' then 1 else 2 end;
      return next;
    end if;
  end loop;
end $$;

-- Phases en alerte (orange ou rouge) des dossiers ouverts visibles.
create or replace function gbs.alertes_delais()
returns table (dossier_id uuid, dossier_reference text, phase text, responsable_id uuid,
               cible int, jours_internes int, echeance date, voyant text)
language plpgsql stable security definer set search_path = '' as $$
declare d record; e record;
begin
  perform gbs_private.exiger(gbs_private.interne());
  for d in select x.id, x.reference, x.phase_courante from gbs.dossiers x
            where x.statut = 'ouvert' and gbs_private.dossier_visible(x.id) order by x.reference loop
    select * into e from gbs.etat_delais(d.id) y where y.phase = d.phase_courante;
    if e.voyant in ('orange','rouge') then
      dossier_id := d.id; dossier_reference := d.reference; phase := d.phase_courante;
      responsable_id := e.responsable_id; cible := e.cible; jours_internes := e.jours_internes;
      echeance := e.echeance; voyant := e.voyant;
      return next;
    end if;
  end loop;
end $$;

-- Continuité en cas d'absence : les tâches ouvertes et les phases en cours d'une
-- personne passent à une autre, sans perte d'historique (journal d'audit).
create or replace function gbs.deleguer(p_de uuid, p_a uuid, p_motif text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n_taches int; n_phases int; n_points int;
begin
  perform gbs_private.exiger(gbs_private.is_admin() or (gbs_private.interne() and p_de = auth.uid()));
  perform gbs_private.motif(p_motif);
  if p_de = p_a or not exists (select 1 from gbs.profils where id = p_a and actif
       and role in ('admin','achats_chine','hub_afrique','agent_pays','inspecteur','comptable')) then
    raise exception 'GBS_ASSIGNE_INVALIDE' using errcode = '22023';
  end if;
  update gbs.taches set assigne_a = p_a where assigne_a = p_de and statut in ('a_faire','en_cours');
  get diagnostics n_taches = row_count;
  update gbs.dossier_phases f set responsable_id = p_a
    from gbs.dossiers d where d.id = f.dossier_id and d.statut = 'ouvert'
     and f.responsable_id = p_de and f.statut not in ('complete','validee');
  get diagnostics n_phases = row_count;
  update gbs.points_bloquants set responsable_id = p_a where responsable_id = p_de and resolu_le is null;
  get diagnostics n_points = row_count;
  return jsonb_build_object('taches', n_taches, 'phases', n_phases, 'points_bloquants', n_points);
end $$;

revoke execute on function gbs.etat_delais(uuid), gbs.mes_taches(), gbs.alertes_delais(), gbs.deleguer(uuid, uuid, text),
  gbs_private.paques(int), gbs_private.est_ouvre(text, date), gbs_private.jours_ouvres_entre(text, date, date),
  gbs_private.ajouter_jours_ouvres(text, date, int), gbs_private.pays_calendrier(uuid, text),
  gbs_private.trg_phase_attente(), gbs_private.trg_phase_debut(), gbs_private.trg_tache() from public;
grant execute on function gbs.etat_delais(uuid), gbs.mes_taches(), gbs.alertes_delais(), gbs.deleguer(uuid, uuid, text)
  to authenticated;
grant execute on all functions in schema gbs_private to authenticated, service_role;
