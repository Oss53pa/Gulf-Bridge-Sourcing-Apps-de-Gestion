-- =============================================================================
-- Lot 0 — Droits appliqués en base, ligne par ligne (section 2, section 10).
-- Aucun accès anonyme. Un compte interne sans double facteur (AAL2) n'a aucun
-- droit : private.role() renvoie null. Les portails client, fournisseur et
-- transitaire (lots 1 et 2) n'ont encore accès à aucune table.
-- =============================================================================

-- Accès anonyme : aucun.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;

revoke all on all tables in schema public from authenticated;
revoke execute on all functions in schema public from public;
grant usage on schema public to authenticated;

-- Fonctions privées : exécutables par les rôles connectés (elles vérifient elles-mêmes les droits).
grant execute on all functions in schema private to authenticated, service_role;

-- RLS partout. Les fonctions SECURITY DEFINER (propriétaire postgres) appliquent
-- elles-mêmes les contrôles de droits avant toute écriture.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Rôles internes (avec double facteur)
create or replace function private.interne() returns boolean
language sql stable as $$
  select private.has_role('admin','achats_chine','hub_afrique','agent_pays','inspecteur','comptable')
$$;

-- ------------------------------------------------------------------ Socle
grant select on public.societes, public.parametres, public.taux_change, public.modeles_dossier,
                public.pieces_modele, public.series_factures to authenticated;
grant insert on public.parametres, public.taux_change to authenticated;
grant insert, update on public.societes, public.modeles_dossier, public.pieces_modele to authenticated;
grant select, update on public.profils to authenticated;
grant select on public.journal_audit to authenticated;

create policy societes_lecture on public.societes for select using (private.interne());
create policy societes_admin on public.societes for all using (private.is_admin()) with check (private.is_admin());
create policy parametres_lecture on public.parametres for select using (private.interne());
create policy parametres_admin on public.parametres for insert with check (private.is_admin());
create policy taux_lecture on public.taux_change for select using (private.interne());
create policy taux_ecriture on public.taux_change for insert with check (private.has_role('admin','comptable'));
create policy modeles_lecture on public.modeles_dossier for select using (private.interne());
create policy modeles_admin on public.modeles_dossier for all using (private.is_admin()) with check (private.is_admin());
create policy pieces_modele_lecture on public.pieces_modele for select using (private.interne());
create policy pieces_modele_admin on public.pieces_modele for all using (private.is_admin()) with check (private.is_admin());
create policy series_lecture on public.series_factures for select using (private.has_role('admin','comptable','hub_afrique'));

-- Profils : chacun lit le sien ; les internes lisent l'annuaire de l'équipe.
create policy profils_soi on public.profils for select using (id = auth.uid());
create policy profils_equipe on public.profils for select using (private.interne());
create policy profils_maj_soi on public.profils for update using (id = auth.uid()) with check (id = auth.uid());
create policy profils_admin on public.profils for update using (private.is_admin()) with check (private.is_admin());

create policy audit_lecture on public.journal_audit for select using (private.has_role('admin','comptable'));

-- ------------------------------------------------------------------ Tiers
grant select, insert, update on public.clients, public.contacts, public.fournisseurs, public.comptes_paiement,
  public.due_diligences, public.articles to authenticated;
grant select on public.registre_presentations to authenticated;

create or replace function private.client_visible(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case private.role()
    when 'admin' then true
    when 'achats_chine' then true
    when 'hub_afrique' then exists (select 1 from public.clients c where c.id = p_client and private.societe_ok(c.societe_id))
    when 'comptable' then exists (select 1 from public.clients c where c.id = p_client and private.societe_ok(c.societe_id))
    when 'agent_pays' then exists (select 1 from public.clients c where c.id = p_client and c.pays = (private.profil()).pays)
    else false end
$$;

-- Visibilité d'un client à partir de ses colonnes (valable pour la ligne insérée).
create or replace function private.client_visible_cols(p_societe uuid, p_pays text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case private.role()
    when 'admin' then true
    when 'achats_chine' then true
    when 'hub_afrique' then private.societe_ok(p_societe)
    when 'comptable' then private.societe_ok(p_societe)
    when 'agent_pays' then p_pays = (private.profil()).pays
    else false end
$$;

create policy clients_lecture on public.clients for select using (private.client_visible_cols(societe_id, pays));
create policy clients_creation on public.clients for insert with check (
  private.is_admin()
  or (private.has_role('hub_afrique') and private.societe_ok(societe_id))
  or (private.has_role('agent_pays') and pays = (private.profil()).pays and agent_id = auth.uid()));
create policy clients_maj on public.clients for update using (
  private.is_admin() or (private.has_role('hub_afrique','agent_pays') and private.client_visible_cols(societe_id, pays)))
  with check (private.is_admin() or (private.has_role('hub_afrique','agent_pays') and private.client_visible_cols(societe_id, pays)));

-- La vérification d'un client n'est statuée que par l'administratrice.
create or replace function private.trg_client_verif() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.verification_statut in ('verifie','refuse'))
     or (tg_op = 'UPDATE' and (new.verification_statut, new.verification_date)
                               is distinct from (old.verification_statut, old.verification_date)
         and new.verification_statut in ('verifie','refuse')) then
    if not private.is_admin() and current_user in ('authenticated','anon') then
      raise exception 'GBS_VALIDATION_ADMIN: la vérification du client est statuée par l''administratrice'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
alter function private.trg_client_verif() security invoker;
create trigger clients_verif before insert or update on public.clients
  for each row execute function private.trg_client_verif();

create policy contacts_lecture on public.contacts for select using (
  (client_id is not null and private.client_visible(client_id))
  or (fournisseur_id is not null and private.has_role('admin','achats_chine')));
create policy contacts_ecriture on public.contacts for insert with check (
  (client_id is not null and private.has_role('admin','hub_afrique','agent_pays') and private.client_visible(client_id))
  or (fournisseur_id is not null and private.has_role('admin','achats_chine')));
create policy contacts_maj on public.contacts for update using (
  (client_id is not null and private.has_role('admin','hub_afrique','agent_pays') and private.client_visible(client_id))
  or (fournisseur_id is not null and private.has_role('admin','achats_chine')));

-- Fournisseurs : jamais visibles du Hub Afrique, des agents pays, des clients.
create policy fournisseurs_lecture on public.fournisseurs for select using (private.has_role('admin','achats_chine','comptable'));
create policy fournisseurs_ecriture on public.fournisseurs for insert with check (private.has_role('admin','achats_chine'));
create policy fournisseurs_maj on public.fournisseurs for update using (private.has_role('admin','achats_chine'))
  with check (private.has_role('admin','achats_chine'));

-- Coordonnées de paiement : administratrice et achats Chine uniquement.
create policy comptes_lecture on public.comptes_paiement for select using (private.has_role('admin','achats_chine'));
create policy comptes_ecriture on public.comptes_paiement for insert with check (private.has_role('admin','achats_chine'));
create policy comptes_maj on public.comptes_paiement for update using (private.has_role('admin','achats_chine'))
  with check (private.has_role('admin','achats_chine'));

create policy dd_lecture on public.due_diligences for select using (private.has_role('admin','achats_chine'));
create policy dd_ecriture on public.due_diligences for insert with check (private.has_role('admin','achats_chine'));
create policy dd_maj on public.due_diligences for update using (private.has_role('admin','achats_chine') and statut = 'en_cours')
  with check (private.has_role('admin','achats_chine'));

create policy articles_lecture on public.articles for select using (private.interne());
create policy articles_ecriture on public.articles for insert with check (private.has_role('admin','achats_chine'));
create policy articles_maj on public.articles for update using (private.has_role('admin','achats_chine'));

create policy registre_lecture on public.registre_presentations for select using (private.has_role('admin','achats_chine'));

-- ------------------------------------------------------------------ Dossiers
grant select, insert, update on public.dossiers, public.points_bloquants to authenticated;
grant select, update on public.dossier_phases to authenticated;
grant select, update on public.pieces to authenticated;
grant insert on public.pieces to authenticated;
grant select on public.v_completude to authenticated;

create policy dossiers_lecture on public.dossiers for select using (private.dossier_visible_cols(id, societe_id, pays));
create policy dossiers_creation on public.dossiers for insert with check (
  private.is_admin()
  or (private.has_role('hub_afrique') and private.societe_ok(societe_id))
  or (private.has_role('agent_pays') and private.client_visible(client_id)));
create policy dossiers_maj on public.dossiers for update using (
  private.has_role('admin','hub_afrique','agent_pays') and private.dossier_visible_cols(id, societe_id, pays))
  with check (private.has_role('admin','hub_afrique','agent_pays') and private.dossier_visible_cols(id, societe_id, pays));

create policy phases_lecture on public.dossier_phases for select using (private.dossier_visible(dossier_id));
create policy phases_maj on public.dossier_phases for update using (
  private.has_role('admin','achats_chine','hub_afrique') and private.dossier_visible(dossier_id));

create policy pieces_lecture on public.pieces for select using (private.dossier_visible(dossier_id));
create policy pieces_ajout on public.pieces for insert with check (
  private.has_role('admin','achats_chine','hub_afrique') and private.dossier_visible(dossier_id) and statut = 'manquante');
create policy pieces_maj on public.pieces for update using (
  private.has_role('admin','achats_chine','hub_afrique') and private.dossier_visible(dossier_id));

create policy blocages_lecture on public.points_bloquants for select using (private.dossier_visible(dossier_id));
create policy blocages_ecriture on public.points_bloquants for insert with check (
  private.has_role('admin','achats_chine','hub_afrique','agent_pays') and private.dossier_visible(dossier_id));
create policy blocages_maj on public.points_bloquants for update using (
  private.has_role('admin','achats_chine','hub_afrique','agent_pays') and private.dossier_visible(dossier_id));

-- ------------------------------------------------------------------ Achats et qualité
grant select, insert, update on public.consultations_fournisseurs, public.offres, public.devis, public.commandes,
  public.inspections, public.constats, public.non_conformites to authenticated;
grant select, insert, update, delete on public.lignes_commande to authenticated;
grant select, insert on public.consultation_invites to authenticated;
grant select on public.derogations, public.v_comparatif_offres to authenticated;

create policy rfq_tous on public.consultations_fournisseurs for all using (private.has_role('admin','achats_chine'))
  with check (private.has_role('admin','achats_chine'));
create policy invites_tous on public.consultation_invites for all using (private.has_role('admin','achats_chine'))
  with check (private.has_role('admin','achats_chine'));
create policy offres_tous on public.offres for all using (private.has_role('admin','achats_chine'))
  with check (private.has_role('admin','achats_chine'));

-- Devis : pas les achats (ils ne voient pas les marges ni la facturation client).
create policy devis_lecture on public.devis for select using (
  private.has_role('admin','hub_afrique','agent_pays','comptable') and private.dossier_visible(dossier_id));
create policy devis_ecriture on public.devis for insert with check (
  private.has_role('admin','hub_afrique','agent_pays') and private.dossier_visible(dossier_id) and statut = 'brouillon');
create policy devis_maj on public.devis for update using (
  private.has_role('admin','hub_afrique','agent_pays') and private.dossier_visible(dossier_id))
  with check (private.has_role('admin','hub_afrique','agent_pays') and private.dossier_visible(dossier_id)
              and statut in ('brouillon','envoye','refuse','accepte','remplace'));

-- Commandes : prix fournisseurs détaillés réservés à l'administratrice, aux achats et à la comptabilité.
create policy commandes_lecture on public.commandes for select using (
  private.has_role('admin','achats_chine') or (private.has_role('comptable') and private.dossier_visible(dossier_id)));
create policy commandes_ecriture on public.commandes for insert with check (private.has_role('admin','achats_chine'));
create policy commandes_maj on public.commandes for update using (private.has_role('admin','achats_chine'))
  with check (private.has_role('admin','achats_chine'));
create policy lignes_cmd_tous on public.lignes_commande for all using (private.has_role('admin','achats_chine'))
  with check (private.has_role('admin','achats_chine'));
create policy lignes_cmd_compta on public.lignes_commande for select using (private.has_role('comptable') and private.dossier_visible(dossier_id));

create policy derogations_lecture on public.derogations for select using (private.has_role('admin','achats_chine','comptable'));

-- Inspections : l'inspecteur ne voit que ses missions.
create policy insp_lecture on public.inspections for select using (
  private.has_role('admin','achats_chine') or (private.has_role('inspecteur') and inspecteur_id = auth.uid()));
create policy insp_creation on public.inspections for insert with check (private.has_role('admin','achats_chine'));
create policy insp_maj on public.inspections for update using (
  private.has_role('admin','achats_chine') or (private.has_role('inspecteur') and inspecteur_id = auth.uid()))
  with check (private.has_role('admin','achats_chine') or (private.has_role('inspecteur') and inspecteur_id = auth.uid()));

create or replace function private.inspection_mienne(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('admin','achats_chine')
      or (private.has_role('inspecteur') and exists (select 1 from public.inspections i where i.id = p and i.inspecteur_id = auth.uid()))
$$;
create policy constats_tous on public.constats for all using (private.inspection_mienne(inspection_id))
  with check (private.inspection_mienne(inspection_id));
create policy nc_lecture on public.non_conformites for select using (
  private.has_role('admin','achats_chine') or (inspection_id is not null and private.inspection_mienne(inspection_id)));
create policy nc_ecriture on public.non_conformites for insert with check (
  private.has_role('admin','achats_chine') or (inspection_id is not null and private.inspection_mienne(inspection_id)));
create policy nc_maj on public.non_conformites for update using (private.has_role('admin','achats_chine'));

-- L'inspecteur ne change pas lui-même la commande, les NQA ni le statut de validation.
create or replace function private.trg_inspecteur_limite() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.role() = 'inspecteur' then
    if (new.commande_id, new.dossier_id, new.type, new.inspecteur_id, new.taille_lot, new.niveau,
        new.nqa_critique, new.nqa_majeur, new.nqa_mineur, new.decision, new.validee_par)
       is distinct from (old.commande_id, old.dossier_id, old.type, old.inspecteur_id, old.taille_lot, old.niveau,
        old.nqa_critique, old.nqa_majeur, old.nqa_mineur, old.decision, old.validee_par)
       or new.statut not in ('planifiee','realisee') then
      raise exception 'GBS_ACCES_REFUSE' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger inspections_inspecteur before update on public.inspections
  for each row execute function private.trg_inspecteur_limite();

-- ------------------------------------------------------------------ Logistique
grant select, insert, update on public.expeditions to authenticated;
grant select, insert on public.expedition_commandes, public.expedition_etapes to authenticated;

create policy exp_lecture on public.expeditions for select using (
  private.has_role('admin','achats_chine') or (private.has_role('hub_afrique','agent_pays') and private.dossier_visible(dossier_id)));
create policy exp_ecriture on public.expeditions for insert with check (private.has_role('admin','achats_chine'));
create policy exp_maj on public.expeditions for update using (private.has_role('admin','achats_chine'));
create policy exp_cmd_tous on public.expedition_commandes for all using (private.has_role('admin','achats_chine'))
  with check (private.has_role('admin','achats_chine'));
create policy etapes_lecture on public.expedition_etapes for select using (
  private.has_role('admin','achats_chine') or (private.has_role('hub_afrique','agent_pays') and private.dossier_visible(dossier_id)));
create policy etapes_ecriture on public.expedition_etapes for insert with check (
  private.has_role('admin','achats_chine') or (private.has_role('hub_afrique') and private.dossier_visible(dossier_id)));

-- ------------------------------------------------------------------ Finance
grant select, insert, update on public.factures to authenticated;
grant select, insert, update, delete on public.lignes_facture to authenticated;
grant select, insert on public.encaissements to authenticated;
grant select, insert on public.paiements_fournisseurs to authenticated;
grant select on public.partages, public.releves_valides, public.v_releve_flux to authenticated;
grant select, insert, update on public.echeances_projet to authenticated;

create or replace function private.facture_visible(p_societe uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin()
      or (private.has_role('comptable') and private.societe_ok(p_societe))
      or (private.has_role('hub_afrique') and private.societe_ok(p_societe)
          and (select code from public.societes where id = p_societe) = 'GBS_CI')
$$;

create policy factures_lecture on public.factures for select using (private.facture_visible(societe_id));
create policy factures_creation on public.factures for insert with check (private.peut_facturer(societe_id));
create policy factures_maj on public.factures for update using (private.peut_facturer(societe_id))
  with check (private.peut_facturer(societe_id));
create policy lignes_fact_lecture on public.lignes_facture for select using (
  exists (select 1 from public.factures f where f.id = facture_id and private.facture_visible(f.societe_id)));
create policy lignes_fact_ecriture on public.lignes_facture for all using (
  exists (select 1 from public.factures f where f.id = facture_id and private.peut_facturer(f.societe_id)))
  with check (exists (select 1 from public.factures f where f.id = facture_id and private.peut_facturer(f.societe_id)));

create policy enc_lecture on public.encaissements for select using (
  exists (select 1 from public.factures f where f.id = facture_id and private.facture_visible(f.societe_id)));
create policy enc_ecriture on public.encaissements for insert with check (
  exists (select 1 from public.factures f where f.id = facture_id and private.peut_facturer(f.societe_id)));

-- Paiements fournisseurs : préparés par les achats ; le Hub ne voit que les instructions
-- de paiement des dossiers ivoiriens en achat accompagné.
create policy pay_lecture on public.paiements_fournisseurs for select using (
  private.has_role('admin','achats_chine','comptable')
  or (private.has_role('hub_afrique') and flux = 'instruction_client' and statut in ('valide','confirme_client')
      and exists (select 1 from public.dossiers d where d.id = dossier_id and d.pays = 'CI' and private.dossier_visible(d.id))));
create policy pay_ecriture on public.paiements_fournisseurs for insert with check (private.has_role('admin','achats_chine'));

create policy partages_lecture on public.partages for select using (
  private.has_role('admin','comptable')
  or (private.has_role('hub_afrique') and (du_par = 'GBS_CI' or du_a = 'GBS_CI'))
  or (private.has_role('agent_pays') and agent_id = auth.uid()));
create policy releves_lecture on public.releves_valides for select using (private.has_role('admin','comptable','hub_afrique'));

-- ------------------------------------------------------------------ Fonctions exposées
grant execute on function
  public.audit_verifier(), public.plan_echantillonnage(int, text, numeric, numeric, numeric),
  public.calcul_commission(uuid), public.changer_statut_commande(uuid, text, text),
  public.valider_mandat(uuid, text, date), public.calculer_devis(uuid), public.valider_contrat(uuid, text, text, date),
  public.valider_approbation(uuid, text), public.deroger(uuid, text, text, uuid, uuid),
  public.valider_inspection(uuid, text, text), public.changer_statut_expedition(uuid, text),
  public.demander_verification_compte(uuid), public.verifier_compte(uuid), public.valider_paiement(uuid),
  public.executer_paiement(uuid, text, text), public.refuser_paiement(uuid, text),
  public.valider_due_diligence(uuid, text, text), public.agreer_fournisseur(uuid),
  public.deposer_piece(uuid, text, text), public.statuer_piece(uuid, text, text), public.avancer_phase(uuid, text),
  public.escalader_points_bloquants(), public.emettre_facture(uuid), public.certifier_fne(uuid, text, text),
  public.annuler_facture(uuid, text), public.facturer_commission(uuid, int), public.valider_releve(date),
  public.generer_factures_intragroupe(date), public.dossier_fob(uuid), public.tableau_de_bord(uuid),
  public.admin_definir_profil(uuid, text, uuid[], text, boolean, boolean), public.facturer_echeance(uuid, int)
to authenticated;
grant execute on function public.escalader_points_bloquants() to service_role;
