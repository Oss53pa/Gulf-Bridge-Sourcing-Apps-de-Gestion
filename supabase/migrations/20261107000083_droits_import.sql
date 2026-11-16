-- Lot 2 (référentiel articles, section 3 ; M5) : barème des droits et taxes à l'import, prix rendu dans le coût global.
-- * Barème par zone douanière (tarif extérieur commun de l'UEMOA pour la Côte d'Ivoire, de la CEMAC pour le Gabon
--   et le Cameroun) et par préfixe de code SH (chapitre à 2 chiffres jusqu'à la ligne nationale à 10 chiffres),
--   daté. Le préfixe le plus long l'emporte, puis la date d'effet la plus récente. Aucun taux n'est livré : chaque
--   ligne porte sa source (le transitaire qui l'a confirmée) ; sans ligne, les droits ne sont pas estimés.
-- * Une ligne en vigueur ne se modifie ni ne se supprime : on saisit une nouvelle ligne datée. Une ligne à venir
--   peut être corrigée ou retirée. Administratrice seulement ; lecture par l'équipe interne.
-- * Prix rendu d'une offre = valeur CAF (FOB + fret estimé + assurance de référence) + droits et taxes non
--   récupérables. Le fret est estimé une fois par consultation (même destination et même quantité pour toutes les
--   offres), à partir du devis du transitaire. La TVA à l'import est rendue à titre d'information et n'entre pas dans
--   le coût global : elle est récupérable pour un client assujetti.
-- * Le coût global reste « complet » selon les mêmes règles qu'avant (données du fournisseur, paramètres locaux) ;
--   le prix rendu s'y ajoute quand il est estimable, sinon le total reste sur la base FOB et l'estimation manquante
--   est signalée. Toutes les offres d'une consultation partagent article, pays et fret : la comparaison reste juste.

create or replace function gbs_private.zone_douaniere(p_pays text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_pays in ('BJ','BF','CI','GW','ML','NE','SN','TG') then 'UEMOA'
    when p_pays in ('CM','CF','CG','GA','GQ','TD') then 'CEMAC'
  end $$;

create table gbs.droits_import (
  id              uuid primary key default gen_random_uuid(),
  zone            text not null check (zone in ('UEMOA','CEMAC')),
  code_sh         text not null check (code_sh ~ '^[0-9]{2}([0-9]{2}){0,4}$'),
  date_effet      date not null check (date_effet >= date '2020-01-01'),
  droit_douane    numeric(6,4) not null check (droit_douane between 0 and 1),
  redevance_statistique numeric(6,4) not null default 0 check (redevance_statistique between 0 and 0.1),
  prelevements_communautaires numeric(6,4) not null default 0 check (prelevements_communautaires between 0 and 0.1),
  autres_taxes    numeric(6,4) not null default 0 check (autres_taxes between 0 and 1),
  tva             numeric(6,4) not null default 0 check (tva between 0 and 0.5),
  source          text not null check (length(btrim(source)) between 2 and 200),
  commentaire     text check (length(commentaire) <= 500),
  cree_le         timestamptz not null default now(), cree_par uuid,
  modifie_le      timestamptz not null default now(), modifie_par uuid,
  unique (zone, code_sh, date_effet)
);
alter table gbs.droits_import enable row level security;
create policy droits_import_lecture on gbs.droits_import for select using (gbs_private.interne());
grant select on gbs.droits_import to authenticated;

alter table gbs.consultations_fournisseurs
  add column article_id uuid references gbs.articles(id),
  add column fret_estime_xof numeric(16,0) check (fret_estime_xof between 0 and 1000000000000),
  add column fret_source text check (length(fret_source) <= 200);

-- Ligne du barème applicable : préfixe le plus long, puis date d'effet la plus récente à la date donnée.
create or replace function gbs_private.droits_applicables(p_zone text, p_code_sh text, p_date date default current_date)
returns gbs.droits_import language sql stable security definer set search_path = '' as $$
  select d.* from gbs.droits_import d
   where d.zone = p_zone and left(p_code_sh, length(d.code_sh)) = d.code_sh and d.date_effet <= p_date
   order by length(d.code_sh) desc, d.date_effet desc
   limit 1 $$;

-- Saisie (création, ou correction d'une ligne pas encore en vigueur) : champs connus seulement.
create or replace function gbs.droits_import_enregistrer(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; ancien gbs.droits_import; k text;
begin
  perform gbs_private.exiger(gbs_private.is_admin());
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = 'P0001'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('zone','code_sh','date_effet','droit_douane','redevance_statistique','prelevements_communautaires',
                 'autres_taxes','tva','source','commentaire') then
      raise exception 'GBS_PARAMETRES_INVALIDES: champ inconnu' using errcode = 'P0001';
    end if;
  end loop;
  select * into ancien from gbs.droits_import
   where zone = p ->> 'zone' and code_sh = p ->> 'code_sh' and date_effet = (p ->> 'date_effet')::date;
  if ancien.id is not null then
    if ancien.date_effet <= current_date then
      raise exception 'GBS_BAREME_EN_VIGUEUR: une ligne en vigueur ne se modifie pas, saisir une nouvelle date d''effet'
        using errcode = 'P0001';
    end if;
    update gbs.droits_import set
      droit_douane = (p ->> 'droit_douane')::numeric,
      redevance_statistique = coalesce((p ->> 'redevance_statistique')::numeric, 0),
      prelevements_communautaires = coalesce((p ->> 'prelevements_communautaires')::numeric, 0),
      autres_taxes = coalesce((p ->> 'autres_taxes')::numeric, 0),
      tva = coalesce((p ->> 'tva')::numeric, 0),
      source = btrim(p ->> 'source'), commentaire = nullif(btrim(p ->> 'commentaire'), ''),
      modifie_le = now(), modifie_par = auth.uid()
     where id = ancien.id returning id into v_id;
  else
    insert into gbs.droits_import (zone, code_sh, date_effet, droit_douane, redevance_statistique, prelevements_communautaires,
                                   autres_taxes, tva, source, commentaire, cree_par, modifie_par)
    values (p ->> 'zone', p ->> 'code_sh', (p ->> 'date_effet')::date, (p ->> 'droit_douane')::numeric,
            coalesce((p ->> 'redevance_statistique')::numeric, 0), coalesce((p ->> 'prelevements_communautaires')::numeric, 0),
            coalesce((p ->> 'autres_taxes')::numeric, 0), coalesce((p ->> 'tva')::numeric, 0),
            btrim(p ->> 'source'), nullif(btrim(p ->> 'commentaire'), ''), auth.uid(), auth.uid())
    returning id into v_id;
  end if;
  perform gbs_private.journaliser(case when ancien.id is null then 'bareme_droits_cree' else 'bareme_droits_corrige' end,
    'droits_import', v_id::text, null, to_jsonb(ancien), (select to_jsonb(d) from gbs.droits_import d where d.id = v_id));
  return v_id;
exception
  when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range
       or check_violation or not_null_violation then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = 'P0001';
end $$;

create or replace function gbs.droits_import_retirer(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d gbs.droits_import;
begin
  perform gbs_private.exiger(gbs_private.is_admin());
  select * into d from gbs.droits_import where id = p_id;
  if d.id is null then raise exception 'GBS_ACCES_REFUSE' using errcode = 'P0001'; end if;
  if d.date_effet <= current_date then
    raise exception 'GBS_BAREME_EN_VIGUEUR: une ligne en vigueur ne se supprime pas' using errcode = 'P0001';
  end if;
  delete from gbs.droits_import where id = p_id;
  perform gbs_private.journaliser('bareme_droits_retire', 'droits_import', p_id::text, null, to_jsonb(d), null);
end $$;

-- Prix rendu estimé d'une offre (montants en FCFA) ; « estime » faux et « manquants » renseignés sinon.
create or replace function gbs_private.prix_rendu_offre(p_offre uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o gbs.offres; c gbs.consultations_fournisseurs; d gbs.dossiers; a gbs.articles; b gbs.droits_import;
        zone text; manquants text[] := '{}'; maj numeric; prime numeric; assurance numeric; caf numeric; taux numeric; droits numeric;
begin
  select * into o from gbs.offres where id = p_offre;
  select * into c from gbs.consultations_fournisseurs where id = o.consultation_id;
  select * into d from gbs.dossiers where id = c.dossier_id;
  select * into a from gbs.articles where id = c.article_id;
  zone := gbs_private.zone_douaniere(d.pays);
  if a.id is null then manquants := manquants || 'article'::text; end if;
  if zone is null then manquants := manquants || ('zone_' || d.pays); end if;
  if c.fret_estime_xof is null then manquants := manquants || 'fret_estime'::text; end if;
  if a.id is not null and zone is not null then
    b := gbs_private.droits_applicables(zone, a.code_sh);
    if b.id is null then manquants := manquants || ('bareme_' || zone || '_' || a.code_sh); end if;
  end if;
  maj := gbs_private.param_num('assurance.majoration_valeur');
  prime := gbs_private.param_num('assurance.taux_prime');
  if cardinality(manquants) > 0 or o.fob_xof is null then
    return jsonb_build_object('estime', false, 'manquants', to_jsonb(manquants), 'zone', zone, 'code_sh', a.code_sh);
  end if;
  assurance := round((o.fob_xof + c.fret_estime_xof) * (1 + maj) * prime);
  caf := o.fob_xof + c.fret_estime_xof + assurance;
  taux := b.droit_douane + b.redevance_statistique + b.prelevements_communautaires + b.autres_taxes;
  droits := round(caf * taux);
  return jsonb_build_object('estime', true, 'manquants', '[]'::jsonb, 'zone', zone, 'code_sh', a.code_sh,
    'bareme_code_sh', b.code_sh, 'bareme_date_effet', b.date_effet, 'bareme_source', b.source,
    'fret_xof', c.fret_estime_xof, 'assurance_xof', assurance, 'caf_xof', caf, 'taux_droits', taux,
    'droits_xof', droits, 'rendu_xof', caf + droits, 'tva_import_xof', round((caf + droits) * b.tva));
end $$;

-- Coût global : même calcul qu'à la migration 19, prix rendu ajouté quand il est estimable.
create or replace function gbs_private.cout_global_offre(p_offre uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o gbs.offres; c gbs.consultations_fournisseurs; d gbs.dossiers; g jsonb; h int; manquants text[] := '{}';
        kwh numeric; heure numeric; energie numeric; entretien numeric; pieces numeric; k text; r jsonb; base numeric;
begin
  select * into o from gbs.offres where id = p_offre;
  select * into c from gbs.consultations_fournisseurs where id = o.consultation_id;
  select * into d from gbs.dossiers where id = c.dossier_id;
  g := coalesce(o.cout_global, '{}'::jsonb);
  h := coalesce(c.horizon_ans, gbs_private.param_num('cout_global.horizon_ans')::int);
  r := gbs_private.prix_rendu_offre(p_offre);
  base := case when (r ->> 'estime')::boolean then (r ->> 'rendu_xof')::numeric else o.fob_xof end;
  foreach k in array array['puissance_kw','heures_an','duree_vie_ans','entretien_heures_an','pieces_cout_an',
                           'pieces_disponibles_ans','sav_afrique','delai_pieces_jours'] loop
    if not g ? k then manquants := manquants || k; end if;
  end loop;
  kwh := (gbs_private.param('cout_global.energie_xof_kwh.' || d.pays) #>> '{}')::numeric;
  heure := (gbs_private.param('cout_global.entretien_xof_heure.' || d.pays) #>> '{}')::numeric;
  if kwh is null then manquants := manquants || ('parametre:energie_' || d.pays); end if;
  if heure is null then manquants := manquants || ('parametre:entretien_' || d.pays); end if;
  if cardinality(manquants) > 0 then
    return jsonb_build_object('complet', false, 'manquants', to_jsonb(manquants), 'horizon_ans', h,
                              'prix_xof', o.fob_xof, 'rendu', r, 'base_xof', base, 'total_xof', null);
  end if;
  energie := round((g ->> 'puissance_kw')::numeric * (g ->> 'heures_an')::numeric * h * kwh);
  entretien := round((g ->> 'entretien_heures_an')::numeric * h * heure);
  pieces := round(gbs_private.to_xof((g ->> 'pieces_cout_an')::numeric, o.devise, o.recu_le::date) * h);
  return jsonb_build_object('complet', true, 'manquants', '[]'::jsonb, 'horizon_ans', h,
    'prix_xof', o.fob_xof, 'rendu', r, 'base_xof', base, 'energie_xof', energie, 'entretien_xof', entretien, 'pieces_xof', pieces,
    'total_xof', base + energie + entretien + pieces);
end $$;

revoke all on function gbs_private.zone_douaniere(text), gbs_private.droits_applicables(text, text, date),
  gbs_private.prix_rendu_offre(uuid), gbs_private.cout_global_offre(uuid) from public, anon;
grant execute on function gbs_private.zone_douaniere(text), gbs_private.droits_applicables(text, text, date),
  gbs_private.prix_rendu_offre(uuid), gbs_private.cout_global_offre(uuid) to authenticated;
revoke all on function gbs.droits_import_enregistrer(jsonb), gbs.droits_import_retirer(uuid) from public, anon;
grant execute on function gbs.droits_import_enregistrer(jsonb), gbs.droits_import_retirer(uuid) to authenticated;

-- Lecture du prix rendu d'une offre pour l'écran de mise en concurrence (équipe achats).
create or replace function gbs.prix_rendu(p_offre uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o gbs.offres;
begin
  select * into o from gbs.offres where id = p_offre;
  perform gbs_private.exiger(o.id is not null and gbs_private.has_role('admin','achats_chine','hub_afrique','agent_pays')
                             and gbs_private.dossier_visible(o.dossier_id));
  return gbs_private.prix_rendu_offre(p_offre);
end $$;
revoke all on function gbs.prix_rendu(uuid) from public, anon;
grant execute on function gbs.prix_rendu(uuid) to authenticated;
