// Alerte « fermeture d'usine » : même définition pour le compteur de l'en-tête et l'écran Alertes.
// Une commande en cours dont la production chevauche une fermeture non passée qui commence
// dans 60 jours au plus (ou est déjà en cours). Lecture réservée par la base aux achats et à l'administratrice.
import { supabase } from './supabase';

export interface CommandeTouchee {
  fermeture_id: string; motif: string; du: string; au: string; commande_id: string; commande_reference: string; dossier_id: string;
  dossier_reference: string; fournisseur: string; statut: string; debut_production: string; livraison_promise: string; jours_chevauches: number;
}

export const ROLES_FERMETURES = ['admin', 'achats_chine'];
export const HORIZON_FERMETURES_JOURS = 60;

export function fermeturesEnAlerte(rows: CommandeTouchee[], auj = new Date().toISOString().slice(0, 10)) {
  const limite = new Date(Date.parse(auj) + HORIZON_FERMETURES_JOURS * 86400000).toISOString().slice(0, 10);
  return rows.filter((x) => x.au >= auj && x.du <= limite);
}

/** Lit les commandes touchées ; un refus de droits rend une liste vide. */
export async function lireCommandesFermetures(): Promise<{ rows: CommandeTouchee[]; erreur: boolean }> {
  const r = await supabase.rpc('commandes_fermetures');
  if (r.error) return { rows: [], erreur: r.error.code !== '42501' };
  return { rows: (r.data ?? []) as CommandeTouchee[], erreur: false };
}
