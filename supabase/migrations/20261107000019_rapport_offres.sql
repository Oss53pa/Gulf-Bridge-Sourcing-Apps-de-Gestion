-- Lot 1, M5 : coût global des offres, grille pondérée et rapport automatique des
-- 3 offres analysées, présentées de façon anonyme (A, B, C), avec recommandation
-- argumentée et choix signé du client (cahier des charges, section 4 ter).
--
-- Paramètres locaux, jamais inventés : coût de l'énergie par pays
-- (cout_global.energie_xof_kwh.<pays>) et coût horaire de l'entretien sur place
-- (cout_global.entretien_xof_heure.<pays>) ; tant qu'ils manquent, le coût global
-- est marqué incomplet et l'analyse retombe sur le prix FOB.

alter table gbs.consultations_fournisseurs
  add column horizon_ans int check (horizon_ans between 1 and 30);
alter table gbs.offres
  add column note_paiement numeric(3,1) check (note_paiement between 0 and 5),
  add column note_capacite numeric(3,1) check (note_capacite between 0 and 5);

insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('cout_global.horizon_ans', '10', date '2026-01-01',
   'Horizon du coût global, ajustable par consultation — valeur de départ à confirmer par la fondatrice'),
  ('offre.grille', '{"prix":40,"technique":20,"delai":10,"due_diligence":10,"paiement":5,"garantie":10,"capacite":5}',
   date '2026-01-01', 'Pondération de la grille d''analyse des offres (total 100) — proposition à confirmer par la fondatrice');

-- Données de coût global déclarées par le fournisseur : schéma strict, champs connus seulement.
create or replace function gbs_private.trg_offre_cout_global() returns trigger
language plpgsql set search_path = '' as $$
declare k text; v jsonb;
begin
  if new.cout_global is null then return new; end if;
  if jsonb_typeof(new.cout_global) <> 'object' then
    raise exception 'GBS_COUT_GLOBAL_INVALIDE' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(new.cout_global) loop
    if not (case k
      when 'puissance_kw' then jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between 0 and 100000
      when 'heures_an' then jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between 0 and 8784
      when 'duree_vie_ans' then jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric > 0 and (v #>> '{}')::numeric <= 50
      when 'entretien_heures_an' then jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between 0 and 10000
      when 'pieces_cout_an' then jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between 0 and 1e10
      when 'pieces_disponibles_ans' then jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between 0 and 50
      when 'delai_pieces_jours' then jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between 0 and 365
      when 'sav_afrique' then jsonb_typeof(v) = 'string' and length(v #>> '{}') between 2 and 200
      else false end) then
      raise exception 'GBS_COUT_GLOBAL_INVALIDE: champ %', k using errcode = '22023';
    end if;
  end loop;
  return new;
end $$;
create trigger offres_cout_global before insert or update on gbs.offres
  for each row execute function gbs_private.trg_offre_cout_global();

-- Coût global d'une offre sur l'horizon : prix FOB + énergie + entretien + pièces, en FCFA.
create or replace function gbs_private.cout_global_offre(p_offre uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o gbs.offres; c gbs.consultations_fournisseurs; d gbs.dossiers; g jsonb; h int; manquants text[] := '{}';
        kwh numeric; heure numeric; energie numeric; entretien numeric; pieces numeric; k text;
begin
  select * into o from gbs.offres where id = p_offre;
  select * into c from gbs.consultations_fournisseurs where id = o.consultation_id;
  select * into d from gbs.dossiers where id = c.dossier_id;
  g := coalesce(o.cout_global, '{}'::jsonb);
  h := coalesce(c.horizon_ans, gbs_private.param_num('cout_global.horizon_ans')::int);
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
                              'prix_xof', o.fob_xof, 'total_xof', null);
  end if;
  energie := round((g ->> 'puissance_kw')::numeric * (g ->> 'heures_an')::numeric * h * kwh);
  entretien := round((g ->> 'entretien_heures_an')::numeric * h * heure);
  pieces := round(gbs_private.to_xof((g ->> 'pieces_cout_an')::numeric, o.devise, o.recu_le::date) * h);
  return jsonb_build_object('complet', true, 'manquants', '[]'::jsonb, 'horizon_ans', h,
    'prix_xof', o.fob_xof, 'energie_xof', energie, 'entretien_xof', entretien, 'pieces_xof', pieces,
    'total_xof', o.fob_xof + energie + entretien + pieces);
end $$;

-- Analyse : notes par critère (0 à 100), note pondérée, alertes, points forts et risques.
create or replace function gbs_private.analyse_offres(p_consultation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare grille jsonb; r record; res jsonb := '[]'::jsonb; cg jsonb; tous_complets boolean;
        min_prix numeric; min_cg numeric; min_delai numeric; max_garantie numeric; base numeric; notes jsonb;
        total numeric; forts text[]; risques text[]; poids numeric;
begin
  grille := gbs_private.param('offre.grille');
  select bool_and((gbs_private.cout_global_offre(o.id) ->> 'complet')::boolean) into tous_complets
    from gbs.offres o where o.consultation_id = p_consultation;
  select min(o.fob_xof), min(nullif(o.delai_jours, 0)), max(o.garantie_mois)
    into min_prix, min_delai, max_garantie from gbs.offres o where o.consultation_id = p_consultation;
  select min((gbs_private.cout_global_offre(o.id) ->> 'total_xof')::numeric) into min_cg
    from gbs.offres o where o.consultation_id = p_consultation;
  select sum((v #>> '{}')::numeric) into poids from jsonb_each(grille) as j(k, v);

  for r in select o.*, v.anormalement_basse, f.note as note_dd
             from gbs.offres o join gbs.v_comparatif_offres v on v.id = o.id
             join gbs.fournisseurs f on f.id = o.fournisseur_id
            where o.consultation_id = p_consultation loop
    cg := gbs_private.cout_global_offre(r.id);
    -- Le critère prix porte sur le coût global si toutes les offres l'ont, sinon sur le FOB.
    base := case when tous_complets then (cg ->> 'total_xof')::numeric else r.fob_xof end;
    notes := jsonb_build_object(
      'prix', case when base > 0 then round(100 * (case when tous_complets then min_cg else min_prix end) / base, 1) else 0 end,
      'technique', round(coalesce(r.note_technique, 0) * 20, 1),
      'delai', case when coalesce(r.delai_jours, 0) > 0 and min_delai is not null then round(100 * min_delai / r.delai_jours, 1) else 0 end,
      'due_diligence', coalesce(r.note_dd, 0),
      'paiement', round(coalesce(r.note_paiement, 0) * 20, 1),
      'garantie', case when coalesce(max_garantie, 0) > 0 then round(100 * coalesce(r.garantie_mois, 0) / max_garantie, 1) else 0 end,
      'capacite', round(coalesce(r.note_capacite, 0) * 20, 1));
    select round(sum((notes ->> k)::numeric * (v #>> '{}')::numeric) / nullif(poids, 0), 1) into total
      from jsonb_each(grille) as j(k, v);
    forts := '{}'; risques := '{}';
    if r.fob_xof = min_prix then forts := forts || 'prix_achat_le_plus_bas'::text; end if;
    if tous_complets and (cg ->> 'total_xof')::numeric = min_cg then forts := forts || 'cout_global_le_plus_bas'::text; end if;
    if r.garantie_mois is not null and r.garantie_mois = max_garantie then forts := forts || 'garantie_la_plus_longue'::text; end if;
    if r.delai_jours is not null and r.delai_jours = min_delai then forts := forts || 'delai_le_plus_court'::text; end if;
    if coalesce(r.note_dd, 0) >= 75 then forts := forts || 'due_diligence_solide'::text; end if;
    if r.anormalement_basse then risques := risques || 'offre_anormalement_basse'::text; end if;
    if not (cg ->> 'complet')::boolean then risques := risques || 'donnees_cout_global_incompletes'::text; end if;
    if coalesce(r.note_dd, 0) < 50 then risques := risques || 'due_diligence_faible'::text; end if;
    if r.delai_jours is not null and min_delai is not null and r.delai_jours > 1.5 * min_delai then risques := risques || 'delai_long'::text; end if;
    res := res || jsonb_build_array(jsonb_build_object(
      'offre_id', r.id, 'fournisseur_id', r.fournisseur_id, 'recu_le', r.recu_le, 'incoterm', r.incoterm,
      'devise', r.devise, 'montant', r.montant, 'fob_xof', r.fob_xof, 'delai_jours', r.delai_jours,
      'garantie_mois', r.garantie_mois, 'conditions_paiement', r.conditions_paiement, 'cout_global', cg,
      'notes', notes, 'note_totale', total, 'points_forts', to_jsonb(forts), 'risques', to_jsonb(risques)));
  end loop;
  return jsonb_build_object('critere_prix', case when tous_complets then 'cout_global' else 'fob' end,
                            'grille', grille, 'offres', res);
end $$;

-- -----------------------------------------------------------------------------
-- Rapports figés et choix du client.
-- -----------------------------------------------------------------------------
create table gbs.rapports_offres (
  id              uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references gbs.consultations_fournisseurs(id),
  dossier_id      uuid not null references gbs.dossiers(id),
  version         int not null check (version between 1 and 99),
  contenu         jsonb not null,           -- version présentée au client : lettres, sans identité
  correspondance  jsonb not null,           -- lettre -> offre : réservé aux achats et à l'administratrice
  choix_lettre    text check (choix_lettre ~ '^[A-Z]$'),
  choix_document  text check (length(choix_document) <= 400),
  choix_signe_le  date,
  choix_par       uuid references gbs.profils(id),
  cree_le timestamptz not null default now(), cree_par uuid,
  unique (consultation_id, version)
);
create trigger rapports_cree before insert on gbs.rapports_offres for each row execute function gbs_private.trg_cree_par();
create trigger rapports_audit after insert or update or delete on gbs.rapports_offres for each row execute function gbs_private.trg_audit();
create trigger rapports_nodel before delete on gbs.rapports_offres for each row execute function gbs_private.trg_no_delete();
create or replace function gbs_private.trg_rapport_fige() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.contenu, new.correspondance, new.version, new.consultation_id, new.dossier_id)
     is distinct from (old.contenu, old.correspondance, old.version, old.consultation_id, old.dossier_id)
     or (old.choix_lettre is not null and new.choix_lettre is distinct from old.choix_lettre)
     or coalesce(current_setting('gbs.rpc', true), '') <> 'choix_client' then
    raise exception 'GBS_RAPPORT_FIGE' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger rapports_fige before update on gbs.rapports_offres
  for each row execute function gbs_private.trg_rapport_fige();

alter table gbs.rapports_offres enable row level security;
-- Liste blanche de colonnes : la correspondance lettre -> fournisseur ne passe que par une fonction contrôlée.
grant select (id, consultation_id, dossier_id, version, contenu, choix_lettre, choix_document, choix_signe_le, choix_par, cree_le, cree_par)
  on gbs.rapports_offres to authenticated;
create policy rapports_lecture on gbs.rapports_offres for select using (
  gbs_private.has_role('admin','achats_chine','hub_afrique','agent_pays') and gbs_private.dossier_visible(dossier_id));

create or replace function gbs.generer_rapport_offres(p_consultation uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c gbs.consultations_fournisseurs; a jsonb; o jsonb; lettres text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        i int := 0; offres jsonb := '[]'::jsonb; corr jsonb := '{}'::jsonb; reco jsonb; moins_chere jsonb; v int; id_rapport uuid;
        explication jsonb := null; nb int;
begin
  select * into c from gbs.consultations_fournisseurs where id = p_consultation for update;
  perform gbs_private.exiger(c.id is not null and gbs_private.has_role('admin','achats_chine')
                             and gbs_private.dossier_visible(c.dossier_id));
  if now() < c.date_limite then
    raise exception 'GBS_PLI_FERME: le rapport s''établit après la date limite' using errcode = 'P0001';
  end if;
  a := gbs_private.analyse_offres(p_consultation);
  nb := jsonb_array_length(a -> 'offres');
  if nb = 0 then raise exception 'GBS_AUCUNE_OFFRE' using errcode = 'P0001'; end if;
  -- Les 3 meilleures notes pondérées, présentées A, B, C ; aucune identité de fournisseur.
  for o in select value from jsonb_array_elements(a -> 'offres')
            order by (value ->> 'note_totale')::numeric desc, (value ->> 'fob_xof')::numeric limit 3 loop
    i := i + 1;
    corr := corr || jsonb_build_object(substr(lettres, i, 1), o ->> 'offre_id');
    offres := offres || jsonb_build_array((o - 'offre_id' - 'fournisseur_id' - 'recu_le')
                                         || jsonb_build_object('lettre', substr(lettres, i, 1)));
  end loop;
  reco := offres -> 0;
  select value into moins_chere from jsonb_array_elements(offres) order by (value ->> 'fob_xof')::numeric limit 1;
  if (moins_chere ->> 'lettre') <> (reco ->> 'lettre') then
    explication := jsonb_build_object('lettre_moins_chere', moins_chere ->> 'lettre',
      'surcout_achat_xof', (reco ->> 'fob_xof')::numeric - (moins_chere ->> 'fob_xof')::numeric,
      'ecart_cout_global_xof', case when (reco -> 'cout_global' ->> 'complet')::boolean and (moins_chere -> 'cout_global' ->> 'complet')::boolean
                                    then (reco -> 'cout_global' ->> 'total_xof')::numeric - (moins_chere -> 'cout_global' ->> 'total_xof')::numeric end,
      'ecart_note', (reco ->> 'note_totale')::numeric - (moins_chere ->> 'note_totale')::numeric);
  end if;
  select coalesce(max(version), 0) + 1 into v from gbs.rapports_offres where consultation_id = p_consultation;
  insert into gbs.rapports_offres (consultation_id, dossier_id, version, contenu, correspondance)
  values (p_consultation, c.dossier_id, v, jsonb_build_object(
      'consultation', jsonb_build_object('reference', c.reference, 'objet', c.objet, 'quantite', c.quantite,
                                         'incoterm', c.incoterm_demande, 'date_limite', c.date_limite),
      'critere_prix', a -> 'critere_prix', 'grille', a -> 'grille',
      'offres_recues', nb, 'moins_de_trois_offres', nb < 3,
      'offres', offres, 'recommandation', reco ->> 'lettre', 'explication_prix', explication,
      'etabli_le', now()), corr)
  returning id into id_rapport;
  return id_rapport;
end $$;

create or replace function gbs.correspondance_rapport(p_rapport uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r gbs.rapports_offres;
begin
  select * into r from gbs.rapports_offres where id = p_rapport;
  perform gbs_private.exiger(r.id is not null and gbs_private.has_role('admin','achats_chine')
                             and gbs_private.dossier_visible(r.dossier_id));
  return (select jsonb_object_agg(k, jsonb_build_object('offre_id', v #>> '{}',
            'fournisseur', (select f.raison_sociale_en from gbs.offres o join gbs.fournisseurs f on f.id = o.fournisseur_id
                             where o.id = (v #>> '{}')::uuid)))
          from jsonb_each(r.correspondance) as j(k, v));
end $$;

-- Choix signé du client : l'offre retenue est marquée, la consultation attribuée.
create or replace function gbs.enregistrer_choix_client(p_rapport uuid, p_lettre text, p_document text, p_signe_le date)
returns gbs.rapports_offres language plpgsql security definer set search_path = '' as $$
declare r gbs.rapports_offres; offre uuid;
begin
  select * into r from gbs.rapports_offres where id = p_rapport for update;
  perform gbs_private.exiger(r.id is not null and gbs_private.has_role('admin','hub_afrique')
                             and gbs_private.dossier_visible(r.dossier_id));
  if r.choix_lettre is not null then raise exception 'GBS_CHOIX_DEJA_ENREGISTRE' using errcode = 'P0001'; end if;
  if exists (select 1 from gbs.rapports_offres x where x.consultation_id = r.consultation_id and x.version > r.version) then
    raise exception 'GBS_RAPPORT_REMPLACE: le choix porte sur la dernière version du rapport' using errcode = 'P0001';
  end if;
  offre := (r.correspondance ->> p_lettre)::uuid;
  if p_lettre is null or offre is null
     or p_document is null or p_document !~ ('^' || r.dossier_id::text || '/[0-9a-f-]{36}\.(pdf|png|jpg|webp)$')
     or p_signe_le is null or p_signe_le > current_date or p_signe_le < r.cree_le::date then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  perform gbs_private.rpc('choix_client');
  update gbs.rapports_offres set choix_lettre = p_lettre, choix_document = p_document, choix_signe_le = p_signe_le,
         choix_par = auth.uid() where id = p_rapport returning * into r;
  perform gbs_private.rpc('');
  update gbs.offres set retenue = (id = offre) where consultation_id = r.consultation_id;
  update gbs.consultations_fournisseurs set statut = 'attribuee' where id = r.consultation_id;
  return r;
end $$;

revoke execute on function gbs.generer_rapport_offres(uuid), gbs.correspondance_rapport(uuid),
  gbs.enregistrer_choix_client(uuid, text, text, date),
  gbs_private.trg_offre_cout_global(), gbs_private.cout_global_offre(uuid), gbs_private.analyse_offres(uuid),
  gbs_private.trg_rapport_fige() from public;
grant execute on function gbs.generer_rapport_offres(uuid), gbs.correspondance_rapport(uuid),
  gbs.enregistrer_choix_client(uuid, text, text, date) to authenticated;
grant execute on all functions in schema gbs_private to authenticated, service_role;
