-- M3 : consultations des clients (section Affaires du module Commercial ; maquette « Consultations » CNS).
-- Une consultation est la phase « consultation » d'un dossier : pas de table en double. Son étape est
-- déduite des faits déjà enregistrés, dans l'ordre de la maquette :
--   demande reçue → forfait facturé → forfait réglé → cahier des charges en rédaction
--   → cahier des charges validé → sourcing lancé (phase de consultation validée).
-- Forfait au projet (équipement d'un site) : le forfait de consultation ne s'applique pas ; l'étape
-- « forfait » est alors considérée comme acquise.
-- Réservée aux rôles commerciaux et à la comptabilité (le forfait est un prix client) ; jamais aux
-- achats ni à l'inspection. Lecture seule, visibilité des dossiers inchangée.

-- Besoin exprimé par le client au formulaire de demande (le cahier des charges signé reste une pièce).
alter table gbs.dossiers
  add column besoin text check (length(besoin) <= 4000),
  add column quantite_besoin text check (length(quantite_besoin) <= 120);

create or replace function gbs.consultations_clients()
returns table (dossier_id uuid, reference text, intitule text, client_id uuid, client text, client_verifie boolean,
               modele text, segment text, pays text, ouvert_le date, forfait_ht numeric, devise text,
               facture_id uuid, facture_numero text, facture_statut text, cdc_statut text, pieces_jointes int, etape text, rang int,
               phase_courante text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform gbs_private.exiger(gbs_private.has_role('admin','hub_afrique','agent_pays','comptable'));
  return query
  with c as (
    select d.id, d.reference, d.intitule, d.client_id, cl.raison_sociale, cl.verification_statut = 'verifie' as verifie,
           d.modele, d.segment, d.pays, d.ouvert_le, d.forfait_consultation_ht, s.devise, d.phase_courante,
           f.statut as phase_statut,
           (select x.id from gbs.factures x where x.dossier_id = d.id and x.type = 'forfait_consultation'
             and x.statut <> 'annulee' order by x.date_emission desc nulls last limit 1) as fac_id,
           (select x.numero from gbs.factures x where x.dossier_id = d.id and x.type = 'forfait_consultation'
             and x.statut <> 'annulee' order by x.date_emission desc nulls last limit 1) as fac_numero,
           (select x.statut from gbs.factures x where x.dossier_id = d.id and x.type = 'forfait_consultation'
             and x.statut <> 'annulee' order by x.date_emission desc nulls last limit 1) as fac_statut,
           (select p.statut from gbs.pieces p where p.dossier_id = d.id and p.phase = 'consultation'
             and p.code = 'client_cdc_signe' limit 1) as cdc,
           (select count(*)::int from gbs.pieces p where p.dossier_id = d.id and p.phase = 'consultation'
             and p.document_chemin is not null) as pj
      from gbs.dossiers d
      join gbs.clients cl on cl.id = d.client_id
      join gbs.societes s on s.id = d.societe_id
      join gbs.dossier_phases f on f.dossier_id = d.id and f.phase = 'consultation'
     where d.statut in ('ouvert','suspendu') and gbs_private.dossier_visible(d.id)
  ), e as (
    select c.*,
           c.modele = 'equipement_site' or c.fac_statut = 'payee' as forfait_regle,
           c.fac_statut in ('en_attente_fne','emise','partiellement_payee') as forfait_facture
      from c
  )
  select e.id, e.reference, e.intitule, e.client_id, e.raison_sociale, e.verifie, e.modele, e.segment, e.pays::text, e.ouvert_le,
         e.forfait_consultation_ht::numeric, e.devise::text, e.fac_id, e.fac_numero, e.fac_statut, coalesce(e.cdc, 'manquante'), e.pj,
         x.etape, x.rang, e.phase_courante
    from e cross join lateral (select
      case when e.phase_statut in ('complete','validee') then 'sourcing_lance'
           when e.forfait_regle and e.cdc = 'validee' then 'cdc_valide'
           when e.forfait_regle and e.cdc in ('recue','a_verifier','refusee') then 'cdc_redaction'
           when e.forfait_regle then 'forfait_regle'
           when e.forfait_facture then 'forfait_facture'
           else 'demande_recue' end as etape) y
    cross join lateral (select y.etape, array_position(array['demande_recue','forfait_facture','forfait_regle','cdc_redaction',
                                'cdc_valide','sourcing_lance'], y.etape) as rang) x
   order by x.rang, e.ouvert_le desc
   limit 500;
end $$;

revoke all on function gbs.consultations_clients() from public, anon;
grant execute on function gbs.consultations_clients() to authenticated;
