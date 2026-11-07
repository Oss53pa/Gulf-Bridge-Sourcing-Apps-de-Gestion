-- =============================================================================
-- Lot 0 (compléments) — Accord-cadre : forfait mensuel facturé automatiquement
-- chaque mois par la société qui contracte, alerte 60 jours avant l'échéance.
-- Annulation d'un dossier par le client : montants dus selon la phase atteinte,
-- avoirs émis automatiquement. Cahier des charges : section 5.
-- =============================================================================

-- Émission sans contrôle de droits : réservée aux fonctions qui ont déjà vérifié.
create or replace function gbs_private.emettre_facture_interne(p_facture uuid)
returns gbs.factures language plpgsql security definer set search_path = '' as $$
declare f gbs.factures; s gbs.societes; v_serie text; an int; num int; larg int;
begin
  select * into f from gbs.factures where id = p_facture for update;
  if f.statut <> 'brouillon' then raise exception 'GBS_FACTURE_DEJA_EMISE' using errcode = 'P0001'; end if;
  if f.montant_ht = 0 then raise exception 'GBS_FACTURE_VIDE' using errcode = 'P0001'; end if;
  if f.type <> 'avoir' and f.montant_ht < 0 then raise exception 'GBS_MONTANT_NEGATIF' using errcode = 'P0001'; end if;
  if f.type = 'avoir' and f.montant_ht > 0 then raise exception 'GBS_AVOIR_POSITIF' using errcode = 'P0001'; end if;
  select * into s from gbs.societes where id = f.societe_id;
  an := extract(year from current_date)::int;
  v_serie := case when f.type = 'avoir' then 'AV'
                  when f.type = 'intragroupe' then 'IG'
                  when s.code = 'GBS_CI' then 'FNE'
                  when f.devise = 'CNY' then 'FP'
                  else 'EX' end;
  insert into gbs.series_factures (societe_id, serie, annee, largeur)
  values (s.id, v_serie, an, case when s.code = 'GBS_CI' then 5 else 4 end)
  on conflict do nothing;
  update gbs.series_factures set dernier = dernier + 1
   where societe_id = s.id and serie = v_serie and annee = an
  returning dernier, largeur into num, larg;
  perform gbs_private.rpc('emettre_facture');
  update gbs.factures set
    numero = case when s.code = 'GBS_CI' then v_serie || '-' || an || '-' || lpad(num::text, larg, '0')
                  else 'GBS-' || v_serie || '-' || an || '-' || lpad(num::text, larg, '0') end,
    date_emission = current_date,
    echeance = coalesce(echeance, current_date + 30),
    statut = case when fne_requise then 'en_attente_fne' else 'emise' end
   where id = p_facture returning * into f;
  perform gbs_private.rpc('');
  return f;
end $$;

create or replace function gbs.emettre_facture(p_facture uuid)
returns gbs.factures language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  select societe_id into sid from gbs.factures where id = p_facture;
  perform gbs_private.exiger(gbs_private.peut_facturer(sid));
  return gbs_private.emettre_facture_interne(p_facture);
end $$;

-- Montant en XOF converti dans la devise de facturation, arrondi à ses décimales.
create or replace function gbs_private.depuis_xof(p_xof numeric, p_devise text, p_date date)
returns numeric language sql stable as $$
  select round(p_xof / gbs_private.taux_xof(p_devise, p_date), case when p_devise in ('XOF','XAF') then 0 else 2 end)
$$;

create or replace function gbs_private.devise_facturation(p_societe text, p_pays_client text)
returns text language sql immutable as $$
  select case when p_societe = 'GBS_CI' then case when p_pays_client in ('GA','CM') then 'XAF' else 'XOF' end
              else 'USD' end
$$;

-- -----------------------------------------------------------------------------
-- Accord-cadre : mensualités
-- -----------------------------------------------------------------------------
create table gbs.mensualites_cadre (
  dossier_id  uuid not null references gbs.dossiers(id),
  mois        date not null check (extract(day from mois) = 1),
  facture_id  uuid not null references gbs.factures(id),
  cree_le     timestamptz not null default now(),
  primary key (dossier_id, mois)
);
create trigger mensualites_audit after insert on gbs.mensualites_cadre for each row execute function gbs_private.trg_audit();
create trigger mensualites_immuable before update or delete on gbs.mensualites_cadre for each row execute function gbs_private.trg_immuable();
alter table gbs.mensualites_cadre enable row level security;
grant select on gbs.mensualites_cadre to authenticated;
create policy mensualites_lecture on gbs.mensualites_cadre for select using (
  gbs_private.has_role('admin','hub_afrique','comptable') and gbs_private.dossier_visible(dossier_id));

-- Facture le forfait mensuel de chaque accord-cadre actif sur le mois. Idempotente :
-- un mois déjà facturé n'est jamais refacturé. À planifier le 1er de chaque mois.
create or replace function gbs.facturer_mensualites_cadre(p_mois date default current_date)
returns int language plpgsql security definer set search_path = '' as $$
declare m date := date_trunc('month', p_mois)::date; fin date := (date_trunc('month', p_mois) + interval '1 month - 1 day')::date;
        k record; s gbs.societes; dev text; f gbs.factures; n int := 0;
begin
  perform gbs_private.exiger(gbs_private.is_admin() or coalesce(auth.role(), '') = 'service_role');
  for k in
    select d.*, c.pays as client_pays, c.langue as client_langue
    from gbs.dossiers d join gbs.clients c on c.id = d.client_id
    where d.modele = 'accord_cadre' and d.statut = 'ouvert'
      and d.cadre_debut <= fin and d.cadre_fin >= m
      and not exists (select 1 from gbs.mensualites_cadre x where x.dossier_id = d.id and x.mois = m)
    order by d.reference
  loop
    select * into s from gbs.societes where code = gbs_private.societe_facturante(k.client_pays, 'accord_cadre', m);
    dev := gbs_private.devise_facturation(s.code, k.client_pays);
    insert into gbs.factures (societe_id, client_id, dossier_id, type, objet, devise, langue)
    values (s.id, k.client_id, k.id, 'accord_cadre',
            'Forfait mensuel d''accord-cadre — ' || to_char(m, 'YYYY-MM') || ' — ' || k.reference, dev, k.client_langue)
    returning * into f;
    insert into gbs.lignes_facture (facture_id, libelle, service, dossier_ref, prix_unitaire)
    values (f.id, 'Forfait mensuel ' || to_char(m, 'YYYY-MM'), 'S10', k.id, gbs_private.depuis_xof(k.forfait_mensuel_ht, dev, m));
    perform gbs_private.emettre_facture_interne(f.id);
    insert into gbs.mensualites_cadre (dossier_id, mois, facture_id) values (k.id, m, f.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Accords-cadres arrivant à échéance (alerte 60 jours avant, paramétrable).
create or replace function gbs.cadres_a_echeance()
returns table (dossier_id uuid, reference text, client text, cadre_fin date, jours_restants int)
language plpgsql stable security definer set search_path = '' as $$
declare j int;
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','hub_afrique','agent_pays','comptable'));
  j := coalesce((gbs_private.param('accord_cadre.alerte_jours') #>> '{}')::int, 60);
  return query
    select d.id, d.reference, c.raison_sociale, d.cadre_fin, (d.cadre_fin - current_date)::int
    from gbs.dossiers d join gbs.clients c on c.id = d.client_id
    where d.modele = 'accord_cadre' and d.statut = 'ouvert'
      and d.cadre_fin between current_date and current_date + j
      and gbs_private.dossier_visible(d.id)
    order by d.cadre_fin;
end $$;

insert into gbs.parametres (cle, valeur, date_effet, commentaire) values
  ('accord_cadre.alerte_jours', '60', date '2026-01-01', 'Alerte avant l''échéance d''un accord-cadre');

-- -----------------------------------------------------------------------------
-- Annulation d'un dossier par le client (section 5, « Annulation par le client »)
--   avant la signature du contrat fournisseur : forfait acquis, aucune commission ;
--   après la signature, avant la production : la première moitié reste acquise ;
--   après le début de la production : la commission totale est due.
-- Les frais engagés (jours d'inspection, déplacements, échantillons) sont refacturés
-- au coût par une facture séparée : leur saisie relève des coûts par dossier (lot 1).
-- -----------------------------------------------------------------------------
create or replace function gbs_private.emettre_avoir(p_facture uuid, p_motif text)
returns gbs.factures language plpgsql security definer set search_path = '' as $$
declare o gbs.factures; a gbs.factures;
begin
  select * into o from gbs.factures where id = p_facture;
  insert into gbs.factures (societe_id, client_id, dossier_id, type, objet, devise, langue, avoir_de)
  values (o.societe_id, o.client_id, o.dossier_id, 'avoir', left('Avoir sur ' || o.numero || ' — ' || p_motif, 300),
          o.devise, o.langue, o.id)
  returning * into a;
  insert into gbs.lignes_facture (facture_id, libelle, service, dossier_ref, prix_unitaire)
  values (a.id, left('Annulation de ' || o.numero, 300), 'S3', o.dossier_id, -o.montant_ht);
  return gbs_private.emettre_facture_interne(a.id);
end $$;

create or replace function gbs.annuler_dossier(p_dossier uuid, p_motif text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d gbs.dossiers; phase text; contrat boolean; production boolean; f gbs.factures;
        avoirs text[] := '{}'; annulees text[] := '{}'; factures text[] := '{}'; prev text;
begin
  perform gbs_private.exiger(gbs_private.is_admin(), 'GBS_ANNULATION_ADMIN');
  perform gbs_private.motif(p_motif);
  select * into d from gbs.dossiers where id = p_dossier for update;
  if d.id is null then raise exception 'GBS_DOSSIER_INCONNU' using errcode = 'P0002'; end if;
  if d.statut <> 'ouvert' then raise exception 'GBS_DOSSIER_FERME' using errcode = 'P0001'; end if;

  contrat := exists (select 1 from gbs.commandes where dossier_id = p_dossier and contrat_valide_le is not null);
  production := exists (select 1 from gbs.commandes where dossier_id = p_dossier
                        and statut in ('en_production','production_terminee','expediee','livree'));
  phase := case when production then 'apres_production' when contrat then 'avant_production' else 'avant_contrat' end;

  if d.mode_financier = 'accompagne' then
    -- Factures de commission non dues : annulées si non parties, sinon compensées par un avoir.
    for f in select * from gbs.factures where dossier_id = p_dossier and type = 'commission'
             and statut <> 'annulee' order by tranche loop
      if phase = 'avant_contrat' or (phase = 'avant_production' and f.tranche = 2) then
        if f.statut in ('brouillon','en_attente_fne') then
          perform gbs_private.rpc('annuler_facture');
          update gbs.factures set statut = 'annulee' where id = f.id;
          perform gbs_private.rpc('');
          annulees := annulees || coalesce(f.numero, 'brouillon');
        else
          avoirs := avoirs || (gbs_private.emettre_avoir(f.id, p_motif)).numero;
        end if;
      elsif f.statut = 'brouillon' then
        factures := factures || (gbs_private.emettre_facture_interne(f.id)).numero;
      end if;
    end loop;
    -- Commission due mais pas encore facturée
    if phase in ('avant_production','apres_production') and not exists (
         select 1 from gbs.factures where dossier_id = p_dossier and type = 'commission' and tranche = 1
         and statut <> 'annulee') then
      f := gbs.facturer_commission(p_dossier, 1);
      factures := factures || (gbs_private.emettre_facture_interne(f.id)).numero;
    end if;
    if phase = 'apres_production' and not exists (
         select 1 from gbs.factures where dossier_id = p_dossier and type = 'commission' and tranche = 2
         and statut <> 'annulee') then
      f := gbs.facturer_commission(p_dossier, 2);
      factures := factures || (gbs_private.emettre_facture_interne(f.id)).numero;
    end if;
  end if;

  -- Commandes non expédiées annulées ; le dossier passe au statut « annulé ».
  prev := coalesce(current_setting('gbs.rpc', true), '');
  perform gbs_private.rpc('changer_statut_commande');
  update gbs.commandes set statut = 'annulee', annule_le = now()
   where dossier_id = p_dossier and statut not in ('expediee','livree','annulee');
  perform gbs_private.rpc('avancer_phase');
  update gbs.dossiers set statut = 'annule', annule_le = now() where id = p_dossier;
  perform gbs_private.rpc(prev);

  return jsonb_build_object('phase_atteinte', phase, 'avoirs', to_jsonb(avoirs),
    'factures_emises', to_jsonb(factures), 'brouillons_annules', to_jsonb(annulees),
    'frais_engages', 'à refacturer au coût par une facture séparée');
end $$;

grant execute on function gbs.facturer_mensualites_cadre(date), gbs.cadres_a_echeance(),
  gbs.annuler_dossier(uuid, text) to authenticated;
grant execute on function gbs.facturer_mensualites_cadre(date) to service_role;
grant execute on all functions in schema gbs_private to authenticated, service_role;
