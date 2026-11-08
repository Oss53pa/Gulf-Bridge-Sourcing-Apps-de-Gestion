-- Lot 1, M32 : dossier qualité de fin de fabrication, assemblé en PDF au format du client final.
-- * Traçabilité : numéros de série relevés par ligne de commande (inspection ou achats).
-- * Liste de contrôle propre à chaque client : sections exigées, dans l'ordre de son
--   référentiel, avec son intitulé et sa référence ; à défaut, liste standard.
-- * gbs.dossier_qualite() rassemble, section par section, ce que le dossier contient :
--   certificats, rapports d'inspection et d'essais, non-conformités closes, approbation
--   technique, numéros de série, due diligence et engagement éthique du fournisseur,
--   réception ; dit ce qui manque. L'assemblage PDF se fait dans le navigateur (URL signées).
-- * Remise : l'émission du dossier est tracée ; la pièce « dossier qualité remis » de la
--   clôture est alors reçue.

create table gbs.numeros_serie (
  id               uuid primary key default gen_random_uuid(),
  dossier_id       uuid not null references gbs.dossiers(id),
  commande_id      uuid not null references gbs.commandes(id),
  ligne_commande_id uuid not null references gbs.lignes_commande(id),
  numero           text not null check (numero ~ '^[A-Za-z0-9][A-Za-z0-9./_-]{0,79}$'),
  inspection_id    uuid references gbs.inspections(id),
  cree_le timestamptz not null default now(), cree_par uuid,
  unique (ligne_commande_id, numero)
);

create table gbs.listes_qualite_client (
  client_id   uuid primary key references gbs.clients(id),
  intitule    text not null check (length(trim(intitule)) between 3 and 200),
  reference   text check (length(reference) <= 80),
  sections    jsonb not null,
  cree_le timestamptz not null default now(), cree_par uuid,
  modifie_le timestamptz not null default now(), modifie_par uuid
);

create table gbs.dossiers_qualite_emis (
  id          uuid primary key default gen_random_uuid(),
  dossier_id  uuid not null references gbs.dossiers(id),
  version     int not null,
  sections    jsonb not null,
  complet     boolean not null,
  emis_par    uuid not null references gbs.profils(id),
  emis_le     timestamptz not null default now(),
  unique (dossier_id, version)
);

insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('qualite.sections_standard',
   '[{"code":"certificats","obligatoire":true},{"code":"rapports_inspection","obligatoire":true},{"code":"essais","obligatoire":false},{"code":"non_conformites","obligatoire":false},{"code":"approbation","obligatoire":false},{"code":"tracabilite","obligatoire":false},{"code":"due_diligence","obligatoire":true},{"code":"engagement_ethique","obligatoire":true},{"code":"reception","obligatoire":false}]',
   date '2026-01-01', 'Sections du dossier qualité quand le client n''a pas de référentiel propre');

create or replace function gbs_private.sections_qualite_valides(s jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(s) = 'array' and jsonb_array_length(s) between 1 and 20
     and not exists (
       select 1 from jsonb_array_elements(s) e
        where jsonb_typeof(e) <> 'object'
           or exists (select 1 from jsonb_object_keys(e) k where k not in ('code','obligatoire','libelle'))
           or coalesce(e ->> 'code', '') not in ('certificats','rapports_inspection','essais','non_conformites','approbation',
                                                 'tracabilite','due_diligence','engagement_ethique','reception')
           or jsonb_typeof(e -> 'obligatoire') is distinct from 'boolean'
           or length(coalesce(e ->> 'libelle', '')) > 120)
     and (select count(distinct e ->> 'code') from jsonb_array_elements(s) e) = jsonb_array_length(s)
$$;

create or replace function gbs_private.trg_liste_qualite() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not gbs_private.sections_qualite_valides(new.sections) then
    raise exception 'GBS_SECTIONS_INVALIDES' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger listes_qualite_regles before insert or update on gbs.listes_qualite_client
  for each row execute function gbs_private.trg_liste_qualite();

create or replace function gbs_private.trg_numero_serie() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l gbs.lignes_commande;
begin
  select * into l from gbs.lignes_commande where id = new.ligne_commande_id;
  if l.id is null then raise exception 'GBS_COMMANDE_INCONNUE' using errcode = '22023'; end if;
  new.commande_id := l.commande_id; new.dossier_id := l.dossier_id;
  if new.inspection_id is not null and not exists (select 1 from gbs.inspections i where i.id = new.inspection_id and i.commande_id = l.commande_id) then
    raise exception 'GBS_INSPECTION_INCONNUE' using errcode = '22023';
  end if;
  if (select count(*) from gbs.numeros_serie where ligne_commande_id = l.id) >= l.quantite then
    raise exception 'GBS_NUMEROS_EN_TROP: plus de numéros que d''unités commandées' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger numeros_serie_regles before insert on gbs.numeros_serie for each row execute function gbs_private.trg_numero_serie();

create or replace function gbs_private.trg_dossier_qualite_emis() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'dossier_qualite' then
    raise exception 'GBS_VALIDATION_RPC' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger dossiers_qualite_emis_regles before insert on gbs.dossiers_qualite_emis
  for each row execute function gbs_private.trg_dossier_qualite_emis();

do $$
begin
  execute 'create trigger numeros_serie_cree before insert on gbs.numeros_serie for each row execute function gbs_private.trg_cree_par()';
  execute 'create trigger numeros_serie_audit after insert or update or delete on gbs.numeros_serie for each row execute function gbs_private.trg_audit()';
  execute 'create trigger numeros_serie_immuable before update or delete on gbs.numeros_serie for each row execute function gbs_private.trg_immuable()';
  execute 'create trigger listes_qualite_touch before update on gbs.listes_qualite_client for each row execute function gbs_private.trg_touch()';
  execute 'create trigger listes_qualite_cree before insert on gbs.listes_qualite_client for each row execute function gbs_private.trg_cree_par()';
  execute 'create trigger listes_qualite_audit after insert or update or delete on gbs.listes_qualite_client for each row execute function gbs_private.trg_audit()';
  execute 'create trigger dossiers_qualite_emis_audit after insert on gbs.dossiers_qualite_emis for each row execute function gbs_private.trg_audit()';
  execute 'create trigger dossiers_qualite_emis_immuable before update or delete on gbs.dossiers_qualite_emis for each row execute function gbs_private.trg_immuable()';
end $$;

-- -----------------------------------------------------------------------------
-- Contenu du dossier qualité
-- -----------------------------------------------------------------------------
create or replace function gbs_private.contenu_dossier_qualite(p_dossier uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d gbs.dossiers; cl gbs.clients; lq gbs.listes_qualite_client; sec jsonb; s jsonb; out jsonb := '[]'::jsonb; items jsonb;
begin
  select * into d from gbs.dossiers where id = p_dossier;
  select * into cl from gbs.clients where id = d.client_id;
  select * into lq from gbs.listes_qualite_client where client_id = cl.id;
  sec := coalesce(lq.sections, gbs_private.param('qualite.sections_standard'));
  for s in select value from jsonb_array_elements(sec) loop
    items := case s ->> 'code'
      when 'certificats' then (select coalesce(jsonb_agg(jsonb_build_object('code', p.code, 'titre', p.libelle, 'chemin', p.document_chemin)
                                 order by p.phase, p.code), '[]')
                                 from gbs.pieces p where p.dossier_id = d.id and p.document_chemin is not null
                                  and p.statut in ('recue','a_verifier','validee')
                                  and p.code in ('certificat_inspection','certificat_origine','conformite_pays','certificats_produits'))
                          || (select coalesce(jsonb_agg(jsonb_build_object('code', 'certificat_lc', 'titre', c.numero, 'certificat_lc_id', c.id) order by c.cree_le), '[]')
                                from gbs.certificats_lc c where c.dossier_id = d.id)
      when 'rapports_inspection' then (select coalesce(jsonb_agg(jsonb_build_object('inspection_id', i.id, 'titre', i.reference, 'type', i.type,
                                         'date', i.date_realisee, 'decision', i.decision, 'taille_lot', i.taille_lot, 'niveau', i.niveau,
                                         'defauts', jsonb_build_array(i.defauts_critiques, i.defauts_majeurs, i.defauts_mineurs)) order by i.date_realisee), '[]')
                                         from gbs.inspections i where i.dossier_id = d.id and i.statut in ('validee','refusee'))
      when 'essais' then (select coalesce(jsonb_agg(jsonb_build_object('titre', e.protocole, 'date', e.date_essai, 'conforme', e.conforme,
                            'resultats', e.resultats, 'chemin', e.pv_document) order by e.date_essai), '[]')
                            from gbs.essais_usine e where e.dossier_id = d.id and e.statut = 'valide')
      when 'non_conformites' then (select coalesce(jsonb_agg(jsonb_build_object('titre', n.reference, 'gravite', n.gravite, 'description', n.description,
                                     'correction', n.preuve, 'statut', n.statut) order by n.cree_le), '[]')
                                     from gbs.non_conformites n where n.dossier_id = d.id)
      when 'approbation' then (select coalesce(jsonb_agg(jsonb_build_object('titre', 'v' || a.version || ' — ' || a.objet, 'signataire', a.signataire,
                                 'date', a.decision_le, 'chemin', a.document_signe) order by a.version), '[]')
                                 from gbs.approbations_techniques a where a.dossier_id = d.id and a.statut = 'approuvee')
      when 'tracabilite' then (select coalesce(jsonb_agg(jsonb_build_object('commande', c.reference, 'article', ar.designation, 'numero', s2.numero)
                                 order by c.reference, ar.designation, s2.numero), '[]')
                                 from gbs.numeros_serie s2 join gbs.commandes c on c.id = s2.commande_id
                                 join gbs.lignes_commande l on l.id = s2.ligne_commande_id join gbs.articles ar on ar.id = l.article_id
                                where s2.dossier_id = d.id)
      when 'due_diligence' then (select coalesce(jsonb_agg(jsonb_build_object('titre', x.reference, 'fournisseur', f.raison_sociale_en, 'note', x.note,
                                   'conclusion', x.conclusion, 'realisee_le', x.realisee_le, 'valide_jusqu_au', x.valide_jusqu_au) order by f.raison_sociale_en), '[]')
                                   from gbs.fournisseurs f
                                   join lateral (select * from gbs.due_diligences dd where dd.fournisseur_id = f.id and dd.statut = 'validee'
                                                 order by dd.realisee_le desc nulls last limit 1) x on true
                                  where f.id in (select fournisseur_id from gbs.commandes where dossier_id = d.id and statut <> 'annulee'))
      when 'engagement_ethique' then (select coalesce(jsonb_agg(jsonb_build_object('titre', f.raison_sociale_en, 'signe_le', f.engagement_non_commission_le,
                                        'chemin', case when f.engagement_document ~ ('^' || d.id::text || '/') then f.engagement_document end)
                                        order by f.raison_sociale_en), '[]')
                                        from gbs.fournisseurs f
                                       where f.engagement_non_commission_le is not null
                                         and f.id in (select fournisseur_id from gbs.commandes where dossier_id = d.id and statut <> 'annulee'))
      when 'reception' then (select coalesce(jsonb_agg(jsonb_build_object('titre', r.reference, 'date', r.date_reception, 'statut', r.statut,
                               'chemin', coalesce(r.pv_levee_document, r.pv_document)) order by r.date_reception), '[]')
                               from gbs.receptions r where r.dossier_id = d.id and r.statut in ('signee','definitive'))
      end;
    out := out || jsonb_build_object('code', s ->> 'code', 'libelle', s ->> 'libelle', 'obligatoire', (s ->> 'obligatoire')::boolean,
                                     'present', jsonb_array_length(items) > 0, 'elements', items);
  end loop;
  return jsonb_build_object('dossier', d.reference, 'intitule', d.intitule, 'client', cl.raison_sociale,
    'referentiel', coalesce(lq.intitule, 'Standard Gulf Bridge Sourcing'), 'reference_client', lq.reference,
    'complet', not exists (select 1 from jsonb_array_elements(out) x where (x ->> 'obligatoire')::boolean and not (x ->> 'present')::boolean),
    'sections', out);
end $$;

create or replace function gbs.dossier_qualite(p_dossier uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine','hub_afrique') and gbs_private.dossier_visible(p_dossier));
  return gbs_private.contenu_dossier_qualite(p_dossier);
end $$;

-- Émission : trace la version remise (sections et complétude) ; incomplet seulement par
-- l'administratrice avec motif ; la pièce de clôture « dossier qualité remis » est reçue.
create or replace function gbs.emettre_dossier_qualite(p_dossier uuid, p_motif text default null)
returns gbs.dossiers_qualite_emis language plpgsql security definer set search_path = '' as $$
declare c jsonb; v int; r gbs.dossiers_qualite_emis;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','achats_chine','hub_afrique') and gbs_private.dossier_visible(p_dossier));
  c := gbs_private.contenu_dossier_qualite(p_dossier);
  if not (c ->> 'complet')::boolean then
    perform gbs_private.exiger(gbs_private.is_admin(), 'GBS_DOSSIER_QUALITE_INCOMPLET');
    perform gbs_private.motif(p_motif);
  end if;
  perform pg_advisory_xact_lock(7334);
  select coalesce(max(version), 0) + 1 into v from gbs.dossiers_qualite_emis where dossier_id = p_dossier;
  perform set_config('gbs.rpc', 'dossier_qualite', true);
  insert into gbs.dossiers_qualite_emis (dossier_id, version, sections, complet, emis_par)
  values (p_dossier, v, c -> 'sections', (c ->> 'complet')::boolean, auth.uid()) returning * into r;
  perform set_config('gbs.rpc', 'systeme', true);
  update gbs.pieces set statut = 'recue' where dossier_id = p_dossier and code = 'dossier_qualite_remis' and statut in ('manquante','refusee');
  perform set_config('gbs.rpc', '', true);
  return r;
end $$;

-- -----------------------------------------------------------------------------
-- Droits
-- -----------------------------------------------------------------------------
alter table gbs.numeros_serie enable row level security;
alter table gbs.listes_qualite_client enable row level security;
alter table gbs.dossiers_qualite_emis enable row level security;
grant select, insert on gbs.numeros_serie, gbs.listes_qualite_client to authenticated;
grant update (intitule, reference, sections) on gbs.listes_qualite_client to authenticated;
grant select on gbs.dossiers_qualite_emis to authenticated;

create policy numeros_serie_lecture on gbs.numeros_serie for select using (
  (gbs_private.has_role('admin','achats_chine','hub_afrique') and gbs_private.dossier_visible(dossier_id))
  or (inspection_id is not null and gbs_private.inspection_mienne(inspection_id)));
create policy numeros_serie_ecriture on gbs.numeros_serie for insert with check (
  gbs_private.has_role('admin','achats_chine')
  or (inspection_id is not null and gbs_private.inspection_mienne(inspection_id)));
create policy listes_qualite_lecture on gbs.listes_qualite_client for select using (
  gbs_private.has_role('admin','achats_chine','hub_afrique') and gbs_private.client_visible(client_id));
create policy listes_qualite_ecriture on gbs.listes_qualite_client for insert with check (
  gbs_private.has_role('admin','hub_afrique') and gbs_private.client_visible(client_id));
create policy listes_qualite_maj on gbs.listes_qualite_client for update using (
  gbs_private.has_role('admin','hub_afrique') and gbs_private.client_visible(client_id));
create policy dossiers_qualite_lecture on gbs.dossiers_qualite_emis for select using (
  gbs_private.has_role('admin','achats_chine','hub_afrique') and gbs_private.dossier_visible(dossier_id));

revoke execute on function gbs.dossier_qualite(uuid), gbs.emettre_dossier_qualite(uuid, text),
  gbs_private.contenu_dossier_qualite(uuid), gbs_private.sections_qualite_valides(jsonb), gbs_private.trg_liste_qualite(),
  gbs_private.trg_numero_serie(), gbs_private.trg_dossier_qualite_emis() from public;
grant execute on function gbs.dossier_qualite(uuid), gbs.emettre_dossier_qualite(uuid, text) to authenticated;
grant execute on all functions in schema gbs_private to authenticated, service_role;
