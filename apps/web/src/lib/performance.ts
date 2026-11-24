// Indicateurs de performance des fournisseurs (M4, lot 2) : calculés par la base (gbs.performance_fournisseurs)
// sur une fenêtre glissante paramétrée, limités aux dossiers visibles de l'utilisateur. Lecture seule.
import { supabase } from './supabase';

export interface Performance {
  fournisseur_id: string; fenetre_du: string;
  livraisons: number; a_l_heure: number; completes: number; completes_controlees: number; otif: number;
  taux_otif: number | null; retard_moyen_jours: number | null;
  unites_inspectees: number; defauts: number; ppm: number | null; inspections: number;
  invitations: number; reponses: number; taux_reponse: number | null; delai_reponse_heures: number | null;
  nc_ouvertes: number; nc_critiques_ouvertes: number; en_alerte: boolean; motifs_alerte: ('livraison' | 'defauts' | 'nc_critique')[];
}

/** Rôles autorisés par la base (les autres reçoivent un refus). */
export const ROLES_PERFORMANCE = ['admin', 'achats_chine', 'hub_afrique'];

/** Un fournisseur précis, ou tous ; un refus de droits rend une liste vide sans erreur affichée. */
export async function lirePerformances(fournisseur?: string): Promise<{ rows: Performance[]; erreur: string | null }> {
  const r = await supabase.rpc('performance_fournisseurs', fournisseur ? { p_fournisseur: fournisseur } : {});
  if (r.error) return { rows: [], erreur: r.error.code === '42501' ? null : r.error.message };
  return { rows: (r.data ?? []) as Performance[], erreur: null };
}
