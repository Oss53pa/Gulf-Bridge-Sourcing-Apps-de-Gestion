// Types des principales tables (miroir du dictionnaire des données, section 6).
import type { Role } from './droits';

export interface Profil {
  id: string; nom: string; email: string; langue: 'fr' | 'en' | 'zh'; fuseau: string; role: Role | null;
  societes: string[]; pays: string | null; delegue_validation: boolean; actif: boolean; telephone?: string | null;
}
export interface Societe { id: string; code: 'GBS_CI' | 'GBS_CN'; raison_sociale: string; pays: string; devise: string; date_creation: string; fne: boolean; }
export interface Client {
  id: string; reference: string | null; societe_id: string; raison_sociale: string; pays: string; devise: string;
  segment: string | null; specialite: string | null; conditions_paiement: string | null; origine: string; agent_id: string | null;
  verification_statut: string; verification_date: string | null; langue: string; cree_le: string;
}
export interface Fournisseur {
  id: string; reference: string | null; raison_sociale_en: string; raison_sociale_zh: string | null; uscc: string | null;
  ville: string | null; categories: string[]; statut_agrement: string; agree_le: string | null; note: number | null;
  engagement_non_commission_le: string | null; apporte_par_client: boolean;
}
export interface Compte {
  id: string; fournisseur_id: string; type: string; titulaire: string; devise: string; banque: string | null; numero: string;
  swift: string | null; verifie: boolean; verification_demandee_par: string | null; verifie_par: string | null; verifie_le: string | null;
}
export interface DueDiligence {
  id: string; reference: string | null; fournisseur_id: string; niveau: string; grille: { critere: string; poids: number; note: number; commentaire?: string }[];
  note: number | null; conclusion: string | null; statut: string; realisee_le: string | null; valide_jusqu_au: string | null;
}
export interface Dossier {
  id: string; reference: string; intitule: string; societe_id: string; client_id: string; modele: string; mode_financier: string;
  specialite: string | null; pays: string; priorite: string; ouvert_le: string; date_ouverture_site: string | null;
  statut: string; phase_courante: string; chef_id: string | null; lettre_credit: boolean; reference_domiciliation: string | null;
  forfait_consultation_ht: number | null; forfait_projet_ht: number | null; taux_commission_projet: number | null; cadre_id: string | null;
  besoin?: string | null; quantite_besoin?: string | null;
}
export interface Phase {
  id: string; dossier_id: string; phase: string; ordre: number; statut: string; reelle_debut: string | null; reelle_fin: string | null;
  responsable_id: string | null; attente_tiers: string | null;
}
export interface Piece {
  id: string; dossier_id: string; phase: string; code: string; libelle: string; obligatoire: boolean; statut: string;
  fournie_par: string | null; document_chemin: string | null; statut_le: string | null; commentaire: string | null;
  demandee_a?: string | null; demandee_le?: string | null; relances?: number; statut_par?: string | null;
}
export interface PointBloquant {
  id: string; dossier_id: string; description: string; categorie: string; impact_jours: number | null; echeance: string;
  resolu_le: string | null; escalade_le: string | null; resolution: string | null; responsable_id: string | null;
}
export interface Devis {
  id: string; dossier_id: string; version: number; reference: string; incoterm: string; statut: string; langue: string;
  jours_inspection_production: number; jours_inspection_expedition: number; renonciation_inspection_production: string | null;
  calcul: Record<string, any> | null; commission_ht: number | null; accepte_le: string | null; mandat_valide_le: string | null;
}
export interface Commande {
  id: string; reference: string; dossier_id: string; fournisseur_id: string; incoterm: string; lieu: string; devise: string;
  montant_marchandise: number; fret: number | null; assurance: number | null; frais_jusqu_a_bord: number | null; fob_montant: number;
  sur_mesure: boolean; statut: string; contrat_document: string | null; contrat_mode: string | null; contrat_signe_le: string | null;
  contrat_valide_le: string | null; approbation_document: string | null; approbation_valide_le: string | null;
  date_livraison_promise: string | null; transfert_risque: string | null; livraison_reelle_le?: string | null;
}
export interface LigneCommande { id: string; commande_id: string; article_id: string; quantite: number; prix_unitaire: number; montant: number; sur_mesure: boolean; reassort: boolean; }
export interface Article {
  id: string; reference: string; designation: string; designation_zh: string | null; categorie: string; unite: string; code_sh: string;
  poids_kg: number | null; volume_m3: number | null; dangereux: boolean; classe_danger: string | null; certificats: string[];
}
export interface Inspection {
  id: string; reference: string; dossier_id: string; commande_id: string | null; type: string; inspecteur_id: string | null;
  date_prevue: string | null; date_realisee: string | null; lieu: string | null; produit: string | null; taille_lot: number; niveau: string;
  nqa_critique: number; nqa_majeur: number; nqa_mineur: number; plan: Record<string, { lettre: string; n: number; ac: number; re: number }> | null;
  defauts_critiques: number; defauts_majeurs: number; defauts_mineurs: number; decision_proposee: string | null; decision: string | null;
  statut: string; conclusion: string | null; validee_le: string | null;
}
export interface Constat { id: string; inspection_id: string; ordre: number; point: string; exigence: string | null; mesure: string | null; resultat: string; gravite: string | null; nombre: number; commentaire: string | null; }
export interface NonConformite { id: string; reference: string; inspection_id: string | null; gravite: string; description: string; correction: string | null; delai: string | null; statut: string; }
export interface Expedition {
  id: string; reference: string; dossier_id: string; mode: string; transitaire: string | null; conteneurs: string[]; plombs: string[];
  port_depart: string | null; port_arrivee: string | null; pays_destination: string; navire: string | null; type_connaissement: string | null;
  numero_connaissement: string | null; etd: string | null; eta: string | null; jours_franchise: number | null; bordereau_reference: string | null;
  fds_document: string | null; declaration_imdg_document: string | null; un38_3_document: string | null; statut: string;
}
export interface Etape { id: string; expedition_id: string; etape: string; lieu: string | null; survenue_le: string; commentaire: string | null; }
export interface Facture {
  id: string; numero: string | null; societe_id: string; client_id: string | null; societe_dest_id: string | null; dossier_id: string | null;
  type: string; tranche: number | null; objet: string; devise: string; langue: string; date_emission: string | null; echeance: string | null;
  montant_ht: number; tva_taux: number; tva: number; retenue_taux: number; retenue: number; ttc: number; net_a_payer: number;
  statut: string; fne_requise: boolean; fne_numero: string | null; fne_qr: string | null; encaisse: number; recapitulatif: Record<string, number> | null;
  prix_apres_retenue: boolean; marge_ht: number | null;
}
export interface LigneFacture { id: string; facture_id: string; libelle: string; service: string | null; quantite: number; prix_unitaire: number; montant: number; ordre: number; }
export interface Paiement {
  id: string; reference: string; commande_id: string; dossier_id: string; nature: string; flux: string; canal: string; compte_id: string;
  montant: number; devise: string; statut: string; prepare_par: string; prepare_le: string; valide_par: string | null; valide_le: string | null;
  reference_transaction: string | null; justificatif: string | null; motif_refus: string | null;
}
export interface Parametre { id: string; cle: string; valeur: unknown; date_effet: string; commentaire: string | null; cree_le: string; }
export interface Audit { id: number; horodatage: string; utilisateur: string | null; action: string; table_nom: string; ligne_id: string | null; dossier_id: string | null; motif: string | null; empreinte: string; avant: unknown; apres: unknown; }
export interface TableauDeBord {
  montants_visibles: boolean; ca_mois_xof: number | null; a_encaisser_xof: number | null; factures_en_retard: number; fne_en_attente: number;
  fob_en_production_xof: number | null; commandes_en_production: number; dossiers_ouverts: number; points_bloquants_ouverts: number;
  points_bloquants_escalades: number; pieces_manquantes: number; paiements_a_valider: number | null; dd_expirant_60j: number | null;
}
