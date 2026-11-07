-- =============================================================================
-- Lot 0 — Droits appliqués en base, ligne par ligne (section 2, section 10).
-- Aucun accès anonyme. Un compte interne sans double facteur (AAL2) n'a aucun
-- droit : gbs_private.role() renvoie null. Les portails client, fournisseur et
-- transitaire (lots 1 et 2) n'ont encore accès à aucune table.
-- =============================================================================

-- Accès anonyme : aucun.
revoke all on all tables in schema gbs from anon;
revoke all on all functions in schema gbs from anon;
revoke all on all sequences in schema gbs from anon;
alter default privileges in schema gbs revoke all on tables from anon;
alter default privileges in schema gbs revoke all on functions from anon;

revoke all on all tables in schema gbs from authenticated;
revoke execute on all functions in schema gbs from public;
grant usage on schema gbs to authenticated, service_role;

-- Fonctions privées : exécutables par les rôles connectés (elles vérifient elles-mêmes les droits).
grant execute on all functions in schema gbs_private to authenticated, service_role;

-- RLS partout. Les fonctions SECURITY DEFINER (propriétaire postgres) appliquent
-- elles-mêmes les contrôles de droits avant toute écriture.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'gbs' loop
    execute format('alter table gbs.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Rôles internes (avec double facteur)
create or replace function gbs_private.interne() returns boolean
language sql stable as $$
  select gbs_private.has_role('admin','achats_chine','hub_afrique','agent_pays','inspecteur','comptable')
$$;

-- ------------------------------------------------------------------ Socle
grant select on gbs.societes, gbs.parametres, gbs.taux_change, gbs.modeles_dossier,
                gbs.pieces_modele, gbs.series_factures to authenticated;
grant insert on gbs.parametres, gbs.taux_change to authenticated;
grant insert, update on gbs.societes, gbs.modeles_dossier, gbs.pieces_modele to authenticated;
grant select, update on gbs.profils to authenticated;
grant select on gbs.journal_audit to authenticated;

create policy societes_lecture on gbs.societes for select using (gbs_private.interne());
create policy societes_admin on gbs.societes for all using (gbs_private.is_admin()) with check (gbs_private.is_admin());
create policy parametres_lecture on gbs.parametres for select using (gbs_private.interne());
create policy parametres_admin on gbs.parametres for insert with check (gbs_private.is_admin());
create policy taux_lecture on gbs.taux_change for select using (gbs_private.interne());
create policy taux_ecriture on gbs.taux_change for insert with check (gbs_private.has_role('admin','comptable'));
create policy modeles_lecture on gbs.modeles_dossier for select using (gbs_private.interne());
create policy modeles_admin on gbs.modeles_dossier for all using (gbs_private.is_admin()) with check (gbs_private.is_admin());
create policy pieces_modele_lecture on gbs.pieces_modele for select using (gbs_private.interne());
create policy pieces_modele_admin on gbs.pieces_modele for all using (gbs_private.is_admin()) with check (gbs_private.is_admin());
create policy series_lecture on gbs.series_factures for select using (gbs_private.has_role('admin','comptable','hub_afrique'));

-- Profils : chacun lit le sien ; les internes lisent l'annuaire de l'équipe.
create policy profils_soi on gbs.profils for select using (id = auth.uid());
create policy profils_equipe on gbs.profils for select using (gbs_private.interne());
create policy profils_maj_soi on gbs.profils for update using (id = auth.uid()) with check (id = auth.uid());
create policy profils_admin on gbs.profils for update using (gbs_private.is_admin()) with check (gbs_private.is_admin());

create policy audit_lecture on gbs.journal_audit for select using (gbs_private.has_role('admin','comptable'));

-- ------------------------------------------------------------------ Tiers
grant select, insert, update on gbs.clients, gbs.contacts, gbs.fournisseurs, gbs.comptes_paiement,
  gbs.due_diligences, gbs.articles to authenticated;
grant select on gbs.registre_presentations to authenticated;

create or replace function gbs_private.client_visible(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case gbs_private.role()
    when 'admin' then true
    when 'achats_chine' then true
    when 'hub_afrique' then exists (select 1 from gbs.clients c where c.id = p_client and gbs_private.societe_ok(c.societe_id))
    when 'comptable' then exists (select 1 from gbs.clients c where c.id = p_client and gbs_private.societe_ok(c.societe_id))
    when 'agent_pays' then exists (select 1 from gbs.clients c where c.id = p_client and c.pays = (gbs_private.profil()).pays)
    else false end
$$;

-- Visibilité d'un client à partir de ses colonnes (valable pour la ligne insérée).
create or replace function gbs_private.client_visible_cols(p_societe uuid, p_pays text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case gbs_private.role()
    when 'admin' then true
    when 'achats_chine' then true
    when 'hub_afrique' then gbs_private.societe_ok(p_societe)
    when 'comptable' then gbs_private.societe_ok(p_societe)
    when 'agent_pays' then p_pays = (gbs_private.profil()).pays
    else false end
$$;

create policy clients_lecture on gbs.clients for select using (gbs_private.client_visible_cols(societe_id, pays));
create policy clients_creation on gbs.clients for insert with check (
  gbs_private.is_admin()
  or (gbs_private.has_role('hub_afrique') and gbs_private.societe_ok(societe_id))
  or (gbs_private.has_role('agent_pays') and pays = (gbs_private.profil()).pays and agent_id = auth.uid()));
create policy clients_maj on gbs.clients for update using (
  gbs_private.is_admin() or (gbs_private.has_role('hub_afrique','agent_pays') and gbs_private.client_visible_cols(societe_id, pays)))
  with check (gbs_private.is_admin() or (gbs_private.has_role('hub_afrique','agent_pays') and gbs_private.client_visible_cols(societe_id, pays)));

-- La vérification d'un client n'est statuée que par l'administratrice.
create or replace function gbs_private.trg_client_verif() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.verification_statut in ('verifie','refuse'))
     or (tg_op = 'UPDATE' and (new.verification_statut, new.verification_date)
                               is distinct from (old.verification_statut, old.verification_date)
         and new.verification_statut in ('verifie','refuse')) then
    if not gbs_private.is_admin() and current_user in ('authenticated','anon') then
      raise exception 'GBS_VALIDATION_ADMIN: la vérification du client est statuée par l''administratrice'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
alter function gbs_private.trg_client_verif() security invoker;
create trigger clients_verif before insert or update on gbs.clients
  for each row execute function gbs_private.trg_client_verif();

create policy contacts_lecture on gbs.contacts for select using (
  (client_id is not null and gbs_private.client_visible(client_id))
  or (fournisseur_id is not null and gbs_private.has_role('admin','achats_chine')));
create policy contacts_ecriture on gbs.contacts for insert with check (
  (client_id is not null and gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.client_visible(client_id))
  or (fournisseur_id is not null and gbs_private.has_role('admin','achats_chine')));
create policy contacts_maj on gbs.contacts for update using (
  (client_id is not null and gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.client_visible(client_id))
  or (fournisseur_id is not null and gbs_private.has_role('admin','achats_chine')));

-- Fournisseurs : jamais visibles du Hub Afrique, des agents pays, des clients.
create policy fournisseurs_lecture on gbs.fournisseurs for select using (gbs_private.has_role('admin','achats_chine','comptable'));
create policy fournisseurs_ecriture on gbs.fournisseurs for insert with check (gbs_private.has_role('admin','achats_chine'));
create policy fournisseurs_maj on gbs.fournisseurs for update using (gbs_private.has_role('admin','achats_chine'))
  with check (gbs_private.has_role('admin','achats_chine'));

-- Coordonnées de paiement : administratrice et achats Chine uniquement.
create policy comptes_lecture on gbs.comptes_paiement for select using (gbs_private.has_role('admin','achats_chine'));
create policy comptes_ecriture on gbs.comptes_paiement for insert with check (gbs_private.has_role('admin','achats_chine'));
create policy comptes_maj on gbs.comptes_paiement for update using (gbs_private.has_role('admin','achats_chine'))
  with check (gbs_private.has_role('admin','achats_chine'));

create policy dd_lecture on gbs.due_diligences for select using (gbs_private.has_role('admin','achats_chine'));
create policy dd_ecriture on gbs.due_diligences for insert with check (gbs_private.has_role('admin','achats_chine'));
create policy dd_maj on gbs.due_diligences for update using (gbs_private.has_role('admin','achats_chine') and statut = 'en_cours')
  with check (gbs_private.has_role('admin','achats_chine'));

create policy articles_lecture on gbs.articles for select using (gbs_private.interne());
create policy articles_ecriture on gbs.articles for insert with check (gbs_private.has_role('admin','achats_chine'));
create policy articles_maj on gbs.articles for update using (gbs_private.has_role('admin','achats_chine'));

create policy registre_lecture on gbs.registre_presentations for select using (gbs_private.has_role('admin','achats_chine'));

-- ------------------------------------------------------------------ Dossiers
grant select, insert, update on gbs.dossiers, gbs.points_bloquants to authenticated;
grant select, update on gbs.dossier_phases to authenticated;
grant select, update on gbs.pieces to authenticated;
grant insert on gbs.pieces to authenticated;
grant select on gbs.v_completude to authenticated;

create policy dossiers_lecture on gbs.dossiers for select using (gbs_private.dossier_visible_cols(id, societe_id, pays));
create policy dossiers_creation on gbs.dossiers for insert with check (
  gbs_private.is_admin()
  or (gbs_private.has_role('hub_afrique') and gbs_private.societe_ok(societe_id))
  or (gbs_private.has_role('agent_pays') and gbs_private.client_visible(client_id)));
create policy dossiers_maj on gbs.dossiers for update using (
  gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.dossier_visible_cols(id, societe_id, pays))
  with check (gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.dossier_visible_cols(id, societe_id, pays));

create policy phases_lecture on gbs.dossier_phases for select using (gbs_private.dossier_visible(dossier_id));
create policy phases_maj on gbs.dossier_phases for update using (
  gbs_private.has_role('admin','achats_chine','hub_afrique') and gbs_private.dossier_visible(dossier_id));

create policy pieces_lecture on gbs.pieces for select using (gbs_private.dossier_visible(dossier_id));
create policy pieces_ajout on gbs.pieces for insert with check (
  gbs_private.has_role('admin','achats_chine','hub_afrique') and gbs_private.dossier_visible(dossier_id) and statut = 'manquante');
create policy pieces_maj on gbs.pieces for update using (
  gbs_private.has_role('admin','achats_chine','hub_afrique') and gbs_private.dossier_visible(dossier_id));

create policy blocages_lecture on gbs.points_bloquants for select using (gbs_private.dossier_visible(dossier_id));
create policy blocages_ecriture on gbs.points_bloquants for insert with check (
  gbs_private.has_role('admin','achats_chine','hub_afrique','agent_pays') and gbs_private.dossier_visible(dossier_id));
create policy blocages_maj on gbs.points_bloquants for update using (
  gbs_private.has_role('admin','achats_chine','hub_afrique','agent_pays') and gbs_private.dossier_visible(dossier_id));

-- ------------------------------------------------------------------ Achats et qualité
grant select, insert, update on gbs.consultations_fournisseurs, gbs.offres, gbs.devis, gbs.commandes,
  gbs.inspections, gbs.constats, gbs.non_conformites to authenticated;
grant select, insert, update, delete on gbs.lignes_commande to authenticated;
grant select, insert on gbs.consultation_invites to authenticated;
grant select on gbs.derogations, gbs.v_comparatif_offres to authenticated;

create policy rfq_tous on gbs.consultations_fournisseurs for all using (gbs_private.has_role('admin','achats_chine'))
  with check (gbs_private.has_role('admin','achats_chine'));
create policy invites_tous on gbs.consultation_invites for all using (gbs_private.has_role('admin','achats_chine'))
  with check (gbs_private.has_role('admin','achats_chine'));
create policy offres_tous on gbs.offres for all using (gbs_private.has_role('admin','achats_chine'))
  with check (gbs_private.has_role('admin','achats_chine'));

-- Devis : pas les achats (ils ne voient pas les marges ni la facturation client).
create policy devis_lecture on gbs.devis for select using (
  gbs_private.has_role('admin','hub_afrique','agent_pays','comptable') and gbs_private.dossier_visible(dossier_id));
create policy devis_ecriture on gbs.devis for insert with check (
  gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.dossier_visible(dossier_id) and statut = 'brouillon');
create policy devis_maj on gbs.devis for update using (
  gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.dossier_visible(dossier_id))
  with check (gbs_private.has_role('admin','hub_afrique','agent_pays') and gbs_private.dossier_visible(dossier_id)
              and statut in ('brouillon','envoye','refuse','accepte','remplace'));

-- Commandes : prix fournisseurs détaillés réservés à l'administratrice, aux achats et à la comptabilité.
create policy commandes_lecture on gbs.commandes for select using (
  gbs_private.has_role('admin','achats_chine') or (gbs_private.has_role('comptable') and gbs_private.dossier_visible(dossier_id)));
create policy commandes_ecriture on gbs.commandes for insert with check (gbs_private.has_role('admin','achats_chine'));
create policy commandes_maj on gbs.commandes for update using (gbs_private.has_role('admin','achats_chine'))
  with check (gbs_private.has_role('admin','achats_chine'));
create policy lignes_cmd_tous on gbs.lignes_commande for all using (gbs_private.has_role('admin','achats_chine'))
  with check (gbs_private.has_role('admin','achats_chine'));
create policy lignes_cmd_compta on gbs.lignes_commande for select using (gbs_private.has_role('comptable') and gbs_private.dossier_visible(dossier_id));

create policy derogations_lecture on gbs.derogations for select using (gbs_private.has_role('admin','achats_chine','comptable'));

-- Inspections : l'inspecteur ne voit que ses missions.
create policy insp_lecture on gbs.inspections for select using (
  gbs_private.has_role('admin','achats_chine') or (gbs_private.has_role('inspecteur') and inspecteur_id = auth.uid()));
create policy insp_creation on gbs.inspections for insert with check (gbs_private.has_role('admin','achats_chine'));
create policy insp_maj on gbs.inspections for update using (
  gbs_private.has_role('admin','achats_chine') or (gbs_private.has_role('inspecteur') and inspecteur_id = auth.uid()))
  with check (gbs_private.has_role('admin','achats_chine') or (gbs_private.has_role('inspecteur') and inspecteur_id = auth.uid()));

create or replace function gbs_private.inspection_mienne(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select gbs_private.has_role('admin','achats_chine')
      or (gbs_private.has_role('inspecteur') and exists (select 1 from gbs.inspections i where i.id = p and i.inspecteur_id = auth.uid()))
$$;
create policy constats_tous on gbs.constats for all using (gbs_private.inspection_mienne(inspection_id))
  with check (gbs_private.inspection_mienne(inspection_id));
create policy nc_lecture on gbs.non_conformites for select using (
  gbs_private.has_role('admin','achats_chine') or (inspection_id is not null and gbs_private.inspection_mienne(inspection_id)));
create policy nc_ecriture on gbs.non_conformites for insert with check (
  gbs_private.has_role('admin','achats_chine') or (inspection_id is not null and gbs_private.inspection_mienne(inspection_id)));
create policy nc_maj on gbs.non_conformites for update using (gbs_private.has_role('admin','achats_chine'));

-- L'inspecteur ne change pas lui-même la commande, les NQA ni le statut de validation.
create or replace function gbs_private.trg_inspecteur_limite() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if gbs_private.role() = 'inspecteur' then
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
create trigger inspections_inspecteur before update on gbs.inspections
  for each row execute function gbs_private.trg_inspecteur_limite();

-- ------------------------------------------------------------------ Logistique
grant select, insert, update on gbs.expeditions to authenticated;
grant select, insert on gbs.expedition_commandes, gbs.expedition_etapes to authenticated;

create policy exp_lecture on gbs.expeditions for select using (
  gbs_private.has_role('admin','achats_chine') or (gbs_private.has_role('hub_afrique','agent_pays') and gbs_private.dossier_visible(dossier_id)));
create policy exp_ecriture on gbs.expeditions for insert with check (gbs_private.has_role('admin','achats_chine'));
create policy exp_maj on gbs.expeditions for update using (gbs_private.has_role('admin','achats_chine'));
create policy exp_cmd_tous on gbs.expedition_commandes for all using (gbs_private.has_role('admin','achats_chine'))
  with check (gbs_private.has_role('admin','achats_chine'));
create policy etapes_lecture on gbs.expedition_etapes for select using (
  gbs_private.has_role('admin','achats_chine') or (gbs_private.has_role('hub_afrique','agent_pays') and gbs_private.dossier_visible(dossier_id)));
create policy etapes_ecriture on gbs.expedition_etapes for insert with check (
  gbs_private.has_role('admin','achats_chine') or (gbs_private.has_role('hub_afrique') and gbs_private.dossier_visible(dossier_id)));

-- ------------------------------------------------------------------ Finance
grant select, insert, update on gbs.factures to authenticated;
grant select, insert, update, delete on gbs.lignes_facture to authenticated;
grant select, insert on gbs.encaissements to authenticated;
grant select, insert on gbs.paiements_fournisseurs to authenticated;
grant select on gbs.partages, gbs.releves_valides, gbs.v_releve_flux to authenticated;
grant select, insert, update on gbs.echeances_projet to authenticated;

create or replace function gbs_private.facture_visible(p_societe uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select gbs_private.is_admin()
      or (gbs_private.has_role('comptable') and gbs_private.societe_ok(p_societe))
      or (gbs_private.has_role('hub_afrique') and gbs_private.societe_ok(p_societe)
          and (select code from gbs.societes where id = p_societe) = 'GBS_CI')
$$;

create policy factures_lecture on gbs.factures for select using (gbs_private.facture_visible(societe_id));
create policy factures_creation on gbs.factures for insert with check (gbs_private.peut_facturer(societe_id));
create policy factures_maj on gbs.factures for update using (gbs_private.peut_facturer(societe_id))
  with check (gbs_private.peut_facturer(societe_id));
create policy lignes_fact_lecture on gbs.lignes_facture for select using (
  exists (select 1 from gbs.factures f where f.id = facture_id and gbs_private.facture_visible(f.societe_id)));
create policy lignes_fact_ecriture on gbs.lignes_facture for all using (
  exists (select 1 from gbs.factures f where f.id = facture_id and gbs_private.peut_facturer(f.societe_id)))
  with check (exists (select 1 from gbs.factures f where f.id = facture_id and gbs_private.peut_facturer(f.societe_id)));

create policy enc_lecture on gbs.encaissements for select using (
  exists (select 1 from gbs.factures f where f.id = facture_id and gbs_private.facture_visible(f.societe_id)));
create policy enc_ecriture on gbs.encaissements for insert with check (
  exists (select 1 from gbs.factures f where f.id = facture_id and gbs_private.peut_facturer(f.societe_id)));

-- Paiements fournisseurs : préparés par les achats ; le Hub ne voit que les instructions
-- de paiement des dossiers ivoiriens en achat accompagné.
create policy pay_lecture on gbs.paiements_fournisseurs for select using (
  gbs_private.has_role('admin','achats_chine','comptable')
  or (gbs_private.has_role('hub_afrique') and flux = 'instruction_client' and statut in ('valide','confirme_client')
      and exists (select 1 from gbs.dossiers d where d.id = dossier_id and d.pays = 'CI' and gbs_private.dossier_visible(d.id))));
create policy pay_ecriture on gbs.paiements_fournisseurs for insert with check (gbs_private.has_role('admin','achats_chine'));

create policy partages_lecture on gbs.partages for select using (
  gbs_private.has_role('admin','comptable')
  or (gbs_private.has_role('hub_afrique') and (du_par = 'GBS_CI' or du_a = 'GBS_CI'))
  or (gbs_private.has_role('agent_pays') and agent_id = auth.uid()));
create policy releves_lecture on gbs.releves_valides for select using (gbs_private.has_role('admin','comptable','hub_afrique'));

-- ------------------------------------------------------------------ Fonctions exposées
grant execute on function
  gbs.audit_verifier(), gbs.plan_echantillonnage(int, text, numeric, numeric, numeric),
  gbs.calcul_commission(uuid), gbs.changer_statut_commande(uuid, text, text),
  gbs.valider_mandat(uuid, text, date), gbs.calculer_devis(uuid), gbs.valider_contrat(uuid, text, text, date),
  gbs.valider_approbation(uuid, text), gbs.deroger(uuid, text, text, uuid, uuid),
  gbs.valider_inspection(uuid, text, text), gbs.changer_statut_expedition(uuid, text),
  gbs.demander_verification_compte(uuid), gbs.verifier_compte(uuid), gbs.valider_paiement(uuid),
  gbs.executer_paiement(uuid, text, text), gbs.refuser_paiement(uuid, text),
  gbs.valider_due_diligence(uuid, text, text), gbs.agreer_fournisseur(uuid),
  gbs.deposer_piece(uuid, text, text), gbs.statuer_piece(uuid, text, text), gbs.avancer_phase(uuid, text),
  gbs.escalader_points_bloquants(), gbs.emettre_facture(uuid), gbs.certifier_fne(uuid, text, text),
  gbs.annuler_facture(uuid, text), gbs.facturer_commission(uuid, int), gbs.valider_releve(date),
  gbs.generer_factures_intragroupe(date), gbs.dossier_fob(uuid), gbs.tableau_de_bord(uuid),
  gbs.admin_definir_profil(uuid, text, uuid[], text, boolean, boolean), gbs.facturer_echeance(uuid, int)
to authenticated;
grant execute on function gbs.escalader_points_bloquants() to service_role;
