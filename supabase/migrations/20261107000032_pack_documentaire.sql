-- Lot 1, M9 : pack documentaire banque et douane par expédition, et contrôle du projet de
-- connaissement avant émission.
-- * Pack : pour une expédition, la liste des pièces attendues par la banque et le transitaire
--   du client (facture, colisage, connaissement, certificat d'inspection — selon la lettre de
--   crédit le cas échéant —, certificat d'origine, conformité, bordereau de suivi, référence
--   de domiciliation), leur état et leurs fichiers ; complet quand toutes les obligatoires
--   sont là. Le téléchargement en un seul fichier se fait dans le navigateur, par URL signée.
-- * Projet de connaissement : données saisies du projet, rapprochées de l'expédition (ports,
--   conteneurs, plombs), des commandes (poids net) et de la lettre de crédit (expéditeur,
--   ports, date de chargement) ; contrôle conservé, non modifiable ; s'il est conforme, la
--   pièce « projet de connaissement validé » est validée avec le projet joint.

create table gbs.controles_connaissement (
  id            uuid primary key default gen_random_uuid(),
  expedition_id uuid not null references gbs.expeditions(id),
  dossier_id    uuid not null references gbs.dossiers(id),
  document      text not null check (length(document) <= 400),
  donnees       jsonb not null,
  ecarts        jsonb not null,
  conforme      boolean not null,
  controle_par  uuid not null references gbs.profils(id),
  controle_le   timestamptz not null default now()
);
create index on gbs.controles_connaissement (expedition_id, controle_le);

create or replace function gbs_private.trg_controle_connaissement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('gbs.rpc', true), '') <> 'connaissement' then
    raise exception 'GBS_VALIDATION_RPC' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger controles_connaissement_regles before insert on gbs.controles_connaissement
  for each row execute function gbs_private.trg_controle_connaissement();
create trigger controles_connaissement_audit after insert on gbs.controles_connaissement
  for each row execute function gbs_private.trg_audit();
create trigger controles_connaissement_immuable before update or delete on gbs.controles_connaissement
  for each row execute function gbs_private.trg_immuable();

-- Lettre de crédit d'une expédition : celle d'une commande transportée (la plus récente).
create or replace function gbs_private.lc_expedition(p_expedition uuid) returns gbs.lettres_credit
language sql stable security definer set search_path = '' as $$
  select l.* from gbs.lettres_credit l join gbs.expedition_commandes x on x.commande_id = l.commande_id
   where x.expedition_id = p_expedition order by l.cree_le desc limit 1
$$;

-- -----------------------------------------------------------------------------
-- Pack documentaire
-- -----------------------------------------------------------------------------
create or replace function gbs.pack_documentaire(p_expedition uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare e gbs.expeditions; d gbs.dossiers; l gbs.lettres_credit; el jsonb := '[]'::jsonb; p record; k text;
        cert gbs.certificats_lc; dangereux boolean; ordre int := 0; present boolean;
        codes text[] := array['facture_commerciale','liste_colisage','connaissement','certificat_inspection','certificat_origine',
                              'conformite_pays','bordereau_suivi','client_domiciliation','marchandises_dangereuses','attestation_assurance'];
begin
  select * into e from gbs.expeditions where id = p_expedition;
  perform gbs_private.exiger(e.id is not null and gbs_private.has_role('admin','achats_chine','hub_afrique','comptable')
                             and gbs_private.dossier_visible(e.dossier_id));
  select * into d from gbs.dossiers where id = e.dossier_id;
  l := gbs_private.lc_expedition(p_expedition);
  dangereux := exists (select 1 from gbs.expedition_commandes x join gbs.lignes_commande lc on lc.commande_id = x.commande_id
                        join gbs.articles a on a.id = lc.article_id where x.expedition_id = e.id and a.dangereux);
  foreach k in array codes loop
    ordre := ordre + 1;
    -- Certificat d'inspection : avec lettre de crédit, celui émis selon le crédit.
    if k = 'certificat_inspection' and l.id is not null then
      select * into cert from gbs.certificats_lc c where c.lettre_credit_id = l.id
        and (c.expedition_id = e.id or c.expedition_id is null) order by c.expedition_id nulls last, c.cree_le desc limit 1;
      el := el || jsonb_build_object('ordre', ordre, 'code', k, 'obligatoire', true, 'present', cert.id is not null,
              'certificat_lc_id', cert.id, 'numero', cert.numero, 'selon_lc', true);
      continue;
    end if;
    -- Pièce propre à l'expédition, sinon pièce du dossier (toutes phases).
    select pc.statut, pc.document_chemin, pc.libelle, pc.obligatoire into p from gbs.pieces pc
     where pc.dossier_id = d.id and pc.code = k and (pc.expedition_id = e.id or pc.expedition_id is null)
     order by pc.expedition_id nulls last limit 1;
    if k = 'client_domiciliation' then
      present := d.reference_domiciliation is not null or (p.document_chemin is not null and p.statut in ('recue','a_verifier','validee'));
      el := el || jsonb_build_object('ordre', ordre, 'code', k, 'obligatoire', d.mode_financier = 'accompagne', 'present', present,
              'reference', d.reference_domiciliation, 'chemin', case when p.statut in ('recue','a_verifier','validee') then p.document_chemin end);
      continue;
    end if;
    present := p.document_chemin is not null and p.statut in ('recue','a_verifier','validee');
    el := el || jsonb_build_object('ordre', ordre, 'code', k,
            'obligatoire', case when k = 'marchandises_dangereuses' then dangereux
                                when k = 'attestation_assurance' then false
                                else coalesce(p.obligatoire, true) end,
            'present', present, 'statut', p.statut, 'chemin', case when present then p.document_chemin end);
  end loop;
  return jsonb_build_object('expedition', e.reference, 'dossier', d.reference, 'lettre_credit', l.reference,
    'complet', not exists (select 1 from jsonb_array_elements(el) x where (x ->> 'obligatoire')::boolean and not (x ->> 'present')::boolean),
    'elements', el);
end $$;

-- -----------------------------------------------------------------------------
-- Contrôle du projet de connaissement
-- -----------------------------------------------------------------------------
create or replace function gbs.controler_projet_connaissement(p_expedition uuid, p_donnees jsonb, p_document text)
returns gbs.controles_connaissement language plpgsql security definer set search_path = '' as $$
declare e gbs.expeditions; l gbs.lettres_credit; ec jsonb := '[]'::jsonb; r gbs.controles_connaissement; net numeric;
        brut numeric; cont text[]; plo text[];
        cles text[] := array['expediteur','destinataire','notifier','port_chargement','port_dechargement','date_chargement',
                             'conteneurs','plombs','nombre_colis','poids_brut_kg','volume_m3','description'];
begin
  select * into e from gbs.expeditions where id = p_expedition for update;
  perform gbs_private.exiger(e.id is not null and gbs_private.has_role('admin','achats_chine') and gbs_private.dossier_visible(e.dossier_id));
  -- Données strictes : clés connues, textes bornés, listes de 50 au plus, nombres positifs.
  if jsonb_typeof(p_donnees) <> 'object' or exists (select 1 from jsonb_object_keys(p_donnees) k where not k = any(cles))
     or exists (select 1 from jsonb_each(p_donnees) x where x.key in ('expediteur','destinataire','notifier','description')
                and (jsonb_typeof(x.value) <> 'string' or length(x.value #>> '{}') > 1000))
     or exists (select 1 from jsonb_each(p_donnees) x where x.key in ('port_chargement','port_dechargement')
                and (jsonb_typeof(x.value) <> 'string' or length(x.value #>> '{}') > 80))
     or exists (select 1 from jsonb_each(p_donnees) x where x.key in ('conteneurs','plombs')
                and (jsonb_typeof(x.value) <> 'array' or jsonb_array_length(x.value) > 50
                     or exists (select 1 from jsonb_array_elements(x.value) v where jsonb_typeof(v) <> 'string' or length(v #>> '{}') not between 4 and 20)))
     or exists (select 1 from jsonb_each(p_donnees) x where x.key in ('nombre_colis','poids_brut_kg','volume_m3')
                and (jsonb_typeof(x.value) <> 'number' or (x.value #>> '{}')::numeric <= 0 or (x.value #>> '{}')::numeric > 1e8))
     or (p_donnees ? 'date_chargement' and (jsonb_typeof(p_donnees -> 'date_chargement') <> 'string'
                                           or (p_donnees ->> 'date_chargement') !~ '^\d{4}-\d{2}-\d{2}$')) then
    raise exception 'GBS_PARAMETRES_INVALIDES' using errcode = '22023';
  end if;
  if p_document is null or not gbs_private.photos_valides(e.dossier_id, array[p_document]) then
    raise exception 'GBS_DOCUMENTS_INVALIDES' using errcode = '22023';
  end if;
  -- Expédition : ports, conteneurs, plombs.
  if e.port_depart is not null and p_donnees ? 'port_chargement' and lower(trim(p_donnees ->> 'port_chargement')) <> lower(trim(e.port_depart)) then
    ec := ec || jsonb_build_object('code', 'port_chargement', 'projet', p_donnees ->> 'port_chargement', 'reference', e.port_depart);
  end if;
  if e.port_arrivee is not null and p_donnees ? 'port_dechargement' and lower(trim(p_donnees ->> 'port_dechargement')) <> lower(trim(e.port_arrivee)) then
    ec := ec || jsonb_build_object('code', 'port_dechargement', 'projet', p_donnees ->> 'port_dechargement', 'reference', e.port_arrivee);
  end if;
  select coalesce(array_agg(upper(trim(v)) order by upper(trim(v))), '{}') into cont from jsonb_array_elements_text(coalesce(p_donnees -> 'conteneurs', '[]')) v;
  select coalesce(array_agg(upper(trim(v)) order by upper(trim(v))), '{}') into plo from jsonb_array_elements_text(coalesce(p_donnees -> 'plombs', '[]')) v;
  if cardinality(e.conteneurs) > 0 and cont is distinct from (select array_agg(upper(trim(v)) order by upper(trim(v))) from unnest(e.conteneurs) v) then
    ec := ec || jsonb_build_object('code', 'conteneurs', 'projet', to_jsonb(cont), 'reference', to_jsonb(e.conteneurs));
  end if;
  if cardinality(e.plombs) > 0 and plo is distinct from (select array_agg(upper(trim(v)) order by upper(trim(v))) from unnest(e.plombs) v) then
    ec := ec || jsonb_build_object('code', 'plombs', 'projet', to_jsonb(plo), 'reference', to_jsonb(e.plombs));
  end if;
  -- Commandes : le poids brut déclaré ne peut être inférieur au poids net des articles.
  select sum(lc.quantite * a.poids_kg) into net from gbs.expedition_commandes x join gbs.lignes_commande lc on lc.commande_id = x.commande_id
    join gbs.articles a on a.id = lc.article_id where x.expedition_id = e.id and a.poids_kg is not null;
  brut := (p_donnees ->> 'poids_brut_kg')::numeric;
  if net is not null and brut is not null and brut < net then
    ec := ec || jsonb_build_object('code', 'poids_inferieur_net', 'projet', brut, 'reference', round(net, 3));
  end if;
  -- Lettre de crédit : expéditeur = bénéficiaire, ports, date de chargement.
  l := gbs_private.lc_expedition(p_expedition);
  if l.id is not null then
    if p_donnees ? 'expediteur' and position(lower(trim(l.beneficiaire)) in lower(p_donnees ->> 'expediteur')) = 0 then
      ec := ec || jsonb_build_object('code', 'expediteur_lc', 'projet', p_donnees ->> 'expediteur', 'reference', l.beneficiaire);
    end if;
    if l.port_chargement is not null and p_donnees ? 'port_chargement' and lower(trim(p_donnees ->> 'port_chargement')) <> lower(trim(l.port_chargement)) then
      ec := ec || jsonb_build_object('code', 'port_chargement_lc', 'projet', p_donnees ->> 'port_chargement', 'reference', l.port_chargement);
    end if;
    if l.port_dechargement is not null and p_donnees ? 'port_dechargement' and lower(trim(p_donnees ->> 'port_dechargement')) <> lower(trim(l.port_dechargement)) then
      ec := ec || jsonb_build_object('code', 'port_dechargement_lc', 'projet', p_donnees ->> 'port_dechargement', 'reference', l.port_dechargement);
    end if;
    if p_donnees ? 'date_chargement' and (p_donnees ->> 'date_chargement')::date > l.derniere_date_expedition then
      ec := ec || jsonb_build_object('code', 'date_chargement_lc', 'projet', p_donnees ->> 'date_chargement', 'reference', l.derniere_date_expedition);
    end if;
  end if;
  perform set_config('gbs.rpc', 'connaissement', true);
  insert into gbs.controles_connaissement (expedition_id, dossier_id, document, donnees, ecarts, conforme, controle_par)
  values (e.id, e.dossier_id, p_document, p_donnees, ec, jsonb_array_length(ec) = 0, auth.uid())
  returning * into r;
  if r.conforme then
    perform set_config('gbs.rpc', 'systeme', true);
    update gbs.pieces set statut = 'validee', document_chemin = p_document
     where dossier_id = e.dossier_id and code = 'projet_connaissement' and (expedition_id = e.id or expedition_id is null)
       and statut <> 'validee';
  end if;
  perform set_config('gbs.rpc', '', true);
  return r;
end $$;

alter table gbs.controles_connaissement enable row level security;
grant select on gbs.controles_connaissement to authenticated;
create policy controles_connaissement_lecture on gbs.controles_connaissement for select using (
  gbs_private.has_role('admin','achats_chine','hub_afrique','comptable') and gbs_private.dossier_visible(dossier_id));

revoke execute on function gbs.pack_documentaire(uuid), gbs.controler_projet_connaissement(uuid, jsonb, text),
  gbs_private.lc_expedition(uuid), gbs_private.trg_controle_connaissement() from public;
grant execute on function gbs.pack_documentaire(uuid), gbs.controler_projet_connaissement(uuid, jsonb, text) to authenticated;
grant execute on all functions in schema gbs_private to authenticated, service_role;
