// Alerte « fermeture d'usine » : même définition pour le compteur de l'en-tête et l'écran Alertes.
// Une commande en cours dont la production chevauche une fermeture non passée qui commence
// dans l'horizon paramétré (ou est déjà en cours). Lecture réservée par la base aux achats et à l'administratrice.
import { supabase } from './supabase';

export interface CommandeTouchee {
  fermeture_id: string; motif: string; du: string; au: string; commande_id: string; commande_reference: string; dossier_id: string;
  dossier_reference: string; fournisseur: string; statut: string; debut_production: string; livraison_promise: string; jours_chevauches: number;
  en_alerte: boolean;
}

export const ROLES_FERMETURES = ['admin', 'achats_chine'];

/** L'horizon d'alerte est un paramètre daté appliqué par la base (fermetures.horizon_alerte_jours). */
export function fermeturesEnAlerte(rows: CommandeTouchee[]) {
  return rows.filter((x) => x.en_alerte);
}

/** Lit les commandes touchées ; un refus de droits rend une liste vide. */
export async function lireCommandesFermetures(): Promise<{ rows: CommandeTouchee[]; erreur: boolean }> {
  const r = await supabase.rpc('commandes_fermetures');
  if (r.error) return { rows: [], erreur: r.error.code !== '42501' };
  return { rows: (r.data ?? []) as CommandeTouchee[], erreur: false };
}

/** Commandes signées ou en production sans date de livraison promise : ni pénalité de retard ni alerte de
 *  fermeture ne peuvent les suivre. Même définition pour le compteur de l'en-tête et l'écran Alertes. */
export interface CommandeSansDate { id: string; reference: string | null; statut: string; contrat_signe_le: string | null; dossiers: { reference: string } | null }
export async function lireCommandesSansDate(): Promise<{ rows: CommandeSansDate[]; erreur: boolean }> {
  const r = await supabase.from('commandes').select('id, reference, statut, contrat_signe_le, dossiers(reference)')
    .in('statut', ['contrat_signe', 'en_production']).is('date_livraison_promise', null).limit(200);
  if (r.error) return { rows: [], erreur: r.error.code !== '42501' };
  return { rows: (r.data ?? []) as unknown as CommandeSansDate[], erreur: false };
}
