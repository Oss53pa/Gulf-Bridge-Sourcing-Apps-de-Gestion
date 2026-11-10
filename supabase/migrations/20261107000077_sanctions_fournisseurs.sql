-- Fournisseurs : bénéficiaires effectifs et contrôle des sanctions refait à chaque revue annuelle
-- (cahier des charges M16, lot 1 ; données du fournisseur, section des tiers).
-- * Bénéficiaires effectifs du fournisseur : historique conservé (sortie datée, jamais de suppression),
--   total des parts en cours au plus 100 %. Tout changement d'actionnariat périme le dernier contrôle.
-- * Contrôle des sanctions : listes consultées, source, date, résultat (aucune correspondance, correspondance
--   écartée avec justification, correspondance confirmée) ; les bénéficiaires contrôlés sont figés dans le
--   contrôle. Saisie par l'administratrice ou les achats Chine ; un contrôle ne se modifie pas.
-- * Validation d'une due diligence (agrément puis revue annuelle) : exige au moins un bénéficiaire effectif
--   et un contrôle valide de moins de « due_diligence.sanctions_fraicheur_jours », sans correspondance
--   confirmée. Une correspondance confirmée suspend l'agrément du fournisseur.

insert into gbs.parametres_definitions (cle, type, minimum, maximum, validateur, module, libelle) values
  ('due_diligence.sanctions_fraicheur_jours', 'entier', 1, 365, null, 'achats', 'Contrôle des sanctions : ancienneté maximale à la validation d''une due diligence (jours)');
insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('due_diligence.sanctions_fraicheur_jours', '30', date '2026-01-01', 'Contrôle des sanctions refait à chaque revue annuelle (M16)');

-- ----------------------------------------------------------------------------- bénéficiaires effectifs
create table gbs.beneficiaires_fournisseurs (
  id             uuid primary key default gen_random_uuid(),
  fournisseur_id uuid not null references gbs.fournisseurs(id),
  nom            text not null check (length(nom) between 2 and 200),
  nom_zh         text check (length(nom_zh) <= 100),
  nationalite    char(2) check (nationalite ~ '^[A-Z]{2}$'),
  pourcentage    numeric(5,2) not null check (pourcentage > 0 and pourcentage <= 100),
  fonction       text check (length(fonction) <= 120),
  entree_le      date not null default current_date,
  sortie_le      date,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid,
  check (sortie_le is null or sortie_le >= entree_le)
);
create index on gbs.beneficiaires_fournisseurs (fournisseur_id);

create table gbs.controles_sanctions (
  id             uuid primary key default gen_random_uuid(),
  fournisseur_id uuid not null references gbs.fournisseurs(id),
  realise_le     date not null check (realise_le <= current_date),
  listes         text[] not null check (cardinality(listes) between 1 and 6
                   and listes <@ array['onu','ue','ofac','royaume_uni','france','chine']::text[]),
  source         text not null check (length(source) between 2 and 200),
  beneficiaires  jsonb not null check (jsonb_typeof(beneficiaires) = 'array'),
  resultat       text not null check (resultat in ('aucune_correspondance','correspondance_ecartee','correspondance_confirmee')),
  justification  text check (length(justification) <= 2000),
  preuve         text check (preuve ~ '^[A-Za-z0-9/_.-]+$' and length(preuve) <= 400 and preuve !~ '\.\.'),
  statut         text not null default 'valide' check (statut in ('valide','perime')),
  realise_par    uuid not null references gbs.profils(id),
  cree_le        timestamptz not null default clock_timestamp(),
  check (resultat = 'aucune_correspondance' or coalesce(length(justification), 0) >= 10)
);
create index on gbs.controles_sanctions (fournisseur_id, cree_le);

create or replace function gbs_private.trg_beneficiaire_fournisseur() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.fournisseur_id <> old.fournisseur_id then
    raise exception 'GBS_ACCES_REFUSE' using errcode = '42501';
  end if;
  if (select coalesce(sum(b.pourcentage), 0) from gbs.beneficiaires_fournisseurs b
       where b.fournisseur_id = new.fournisseur_id and b.sortie_le is null and b.id <> new.id)
     + (case when new.sortie_le is null then new.pourcentage else 0 end) > 100 then
    raise exception 'GBS_BENEFICIAIRES_DEPASSENT_100' using errcode = '22023';
  end if;
  -- Un changement d'actionnariat périme le contrôle des sanctions en vigueur.
  if tg_op = 'INSERT' or (new.nom, new.nom_zh, new.nationalite, new.pourcentage, new.sortie_le)
                         is distinct from (old.nom, old.nom_zh, old.nationalite, old.pourcentage, old.sortie_le) then
    perform gbs_private.rpc('controle_sanctions');
    update gbs.controles_sanctions set statut = 'perime' where fournisseur_id = new.fournisseur_id and statut = 'valide';
    perform gbs_private.rpc('');
  end if;
  return new;
end $$;

create or replace function gbs_private.trg_controle_sanctions() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'controle_sanctions' then
    raise exception 'GBS_VALIDATION_RPC: le contrôle des sanctions passe par les fonctions dédiées' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'statut') is distinct from (to_jsonb(old) - 'statut') then
    raise exception 'GBS_VALIDATION_RPC: un contrôle ne se modifie pas' using errcode = 'P0001';
  end if;
  return new;
end $$;

alter table gbs.beneficiaires_fournisseurs enable row level security;
alter table gbs.controles_sanctions enable row level security;
grant select, insert, update on gbs.beneficiaires_fournisseurs to authenticated;
grant select on gbs.controles_sanctions to authenticated;
create trigger bf_touch before update on gbs.beneficiaires_fournisseurs for each row execute function gbs_private.trg_touch();
create trigger bf_cree before insert on gbs.beneficiaires_fournisseurs for each row execute function gbs_private.trg_cree_par();
create trigger bf_regles before insert or update on gbs.beneficiaires_fournisseurs for each row execute function gbs_private.trg_beneficiaire_fournisseur();
create trigger bf_audit after insert or update on gbs.beneficiaires_fournisseurs for each row execute function gbs_private.trg_audit();
create trigger bf_nodel before delete on gbs.beneficiaires_fournisseurs for each row execute function gbs_private.trg_no_delete();
create trigger cs_rpc before insert or update on gbs.controles_sanctions for each row execute function gbs_private.trg_controle_sanctions();
create trigger cs_audit after insert or update on gbs.controles_sanctions for each row execute function gbs_private.trg_audit();
create trigger cs_nodel before delete on gbs.controles_sanctions for each row execute function gbs_private.trg_no_delete();
create policy bf_lecture on gbs.beneficiaires_fournisseurs for select using (gbs_private.has_role('admin','achats_chine','comptable'));
create policy bf_ecriture on gbs.beneficiaires_fournisseurs for insert with check (gbs_private.has_role('admin','achats_chine'));
create policy bf_maj on gbs.beneficiaires_fournisseurs for update using (gbs_private.has_role('admin','achats_chine')) with check (gbs_private.has_role('admin','achats_chine'));
create policy cs_lecture on gbs.controles_sanctions for select using (gbs_private.has_role('admin','achats_chine','comptable'));

-- ----------------------------------------------------------------------------- contrôle
create or replace function gbs.enregistrer_controle_sanctions(p_fournisseur uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r uuid; be jsonb; res text;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine'));
  if not exists (select 1 from gbs.fournisseurs where id = p_fournisseur) or jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) k where k not in ('realise_le','listes','source','resultat','justification','preuve'))
     or coalesce(jsonb_typeof(p -> 'realise_le'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'listes'), '') <> 'array'
     or coalesce(jsonb_typeof(p -> 'source'), '') <> 'string' or coalesce(jsonb_typeof(p -> 'resultat'), '') <> 'string'
     or (p ? 'justification' and jsonb_typeof(p -> 'justification') not in ('string','null'))
     or (p ? 'preuve' and jsonb_typeof(p -> 'preuve') not in ('string','null'))
     or exists (select 1 from jsonb_array_elements(p -> 'listes') x where jsonb_typeof(x) <> 'string')
     or (select count(distinct x) from jsonb_array_elements_text(p -> 'listes') x) <> jsonb_array_length(p -> 'listes') then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('nom', b.nom, 'nom_zh', b.nom_zh, 'nationalite', b.nationalite, 'pourcentage', b.pourcentage) order by b.pourcentage desc), '[]'::jsonb)
    into be from gbs.beneficiaires_fournisseurs b where b.fournisseur_id = p_fournisseur and b.sortie_le is null;
  if jsonb_array_length(be) = 0 then raise exception 'GBS_BENEFICIAIRES_REQUIS' using errcode = 'P0001'; end if;
  res := p ->> 'resultat';
  perform gbs_private.rpc('controle_sanctions');
  update gbs.controles_sanctions set statut = 'perime' where fournisseur_id = p_fournisseur and statut = 'valide';
  insert into gbs.controles_sanctions (fournisseur_id, realise_le, listes, source, beneficiaires, resultat, justification, preuve, realise_par)
  values (p_fournisseur, (p ->> 'realise_le')::date, (select array_agg(x) from jsonb_array_elements_text(p -> 'listes') x), trim(p ->> 'source'),
          be, res, nullif(trim(p ->> 'justification'), ''), nullif(p ->> 'preuve', ''), auth.uid())
  returning id into r;
  perform gbs_private.rpc('');
  -- Correspondance confirmée : l'agrément est suspendu (journalisé).
  if res = 'correspondance_confirmee' then
    perform gbs_private.rpc('agreer_fournisseur');
    update gbs.fournisseurs set statut_agrement = 'suspendu' where id = p_fournisseur and statut_agrement in ('agree','sous_surveillance','en_evaluation','candidat');
    perform gbs_private.rpc('');
    perform gbs_private.journaliser('fournisseur_suspendu_sanctions', 'fournisseurs', p_fournisseur::text, null, null,
      jsonb_build_object('controle', r), trim(p ->> 'justification'));
  end if;
  return r;
exception
  when check_violation or not_null_violation or invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
end $$;

-- ----------------------------------------------------------------------------- validation d'une due diligence
create or replace function gbs.valider_due_diligence(p_dd uuid, p_statut text, p_conclusion text default null)
returns gbs.due_diligences language plpgsql security definer set search_path = '' as $$
declare x gbs.due_diligences; mois int;
begin
  perform gbs_private.exiger(gbs_private.is_admin(), 'GBS_VALIDATION_ADMIN');
  if p_statut not in ('validee','refusee') or length(p_conclusion) > 4000 then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  select * into x from gbs.due_diligences where id = p_dd for update;
  if x.statut <> 'en_cours' then raise exception 'GBS_DD_DEJA_STATUEE' using errcode = 'P0001'; end if;
  if jsonb_array_length(x.grille) = 0 then raise exception 'GBS_GRILLE_VIDE' using errcode = 'P0001'; end if;
  if p_statut = 'validee' then
    if not exists (select 1 from gbs.beneficiaires_fournisseurs b where b.fournisseur_id = x.fournisseur_id and b.sortie_le is null) then
      raise exception 'GBS_BENEFICIAIRES_REQUIS' using errcode = 'P0001';
    end if;
    if not exists (select 1 from gbs.controles_sanctions c where c.fournisseur_id = x.fournisseur_id and c.statut = 'valide'
                    and c.resultat <> 'correspondance_confirmee'
                    and c.realise_le >= current_date - gbs_private.param_num('due_diligence.sanctions_fraicheur_jours')::int) then
      raise exception 'GBS_SANCTIONS_REQUISES' using errcode = 'P0001';
    end if;
  end if;
  mois := gbs_private.param_num('due_diligence.validite_mois')::int;
  perform gbs_private.rpc('valider_due_diligence');
  update gbs.due_diligences set statut = p_statut, conclusion = coalesce(p_conclusion, conclusion),
         realisee_le = coalesce(realisee_le, current_date),
         valide_jusqu_au = case when p_statut = 'validee'
                                then (coalesce(realisee_le, current_date) + make_interval(months => mois))::date end,
         validee_par = auth.uid()
   where id = p_dd returning * into x;
  perform gbs_private.rpc('');
  return x;
end $$;

revoke all on function gbs_private.trg_beneficiaire_fournisseur(), gbs_private.trg_controle_sanctions() from public, anon, authenticated;
revoke all on function gbs.enregistrer_controle_sanctions(uuid, jsonb) from public, anon;
grant execute on function gbs.enregistrer_controle_sanctions(uuid, jsonb) to authenticated;
