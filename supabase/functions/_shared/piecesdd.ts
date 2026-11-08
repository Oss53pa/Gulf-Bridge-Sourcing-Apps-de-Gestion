// Logique pure du dépôt des pièces de due diligence par lien, partagée par la fonction serveur
// gbs-fournisseur et testée sous Node : champs du formulaire, type de pièce, taille.

export const TYPES_PIECES = ['licence_commerciale', 'licence_export', 'certificat_qualite', 'certification_produit', 'rapport_audit',
  'references_clients', 'attestation_bancaire', 'beneficiaires_effectifs', 'declaration_ethique', 'autre'] as const;
export const TAILLE_PIECE_MAX = 10 * 1024 * 1024;
const JETON = /^[A-Za-z0-9_-]{43}$/;

/** Champs du dépôt : jeton, type connu, libellé facultatif borné, un seul fichier non vide et borné. */
export function lireDepotPiece(champs: { jeton: unknown; type: unknown; libelle: unknown; taille: unknown; cles: string[] }):
  { jeton: string; type: string; libelle: string | null } | null {
  const permis = ['action', 'jeton', 'type', 'libelle', 'fichier'];
  if (champs.cles.some((k) => !permis.includes(k)) || new Set(champs.cles).size !== champs.cles.length) return null;
  if (typeof champs.jeton !== 'string' || !JETON.test(champs.jeton)) return null;
  if (typeof champs.type !== 'string' || !TYPES_PIECES.includes(champs.type as never)) return null;
  if (champs.libelle !== null && champs.libelle !== undefined && (typeof champs.libelle !== 'string' || champs.libelle.length > 200)) return null;
  if (typeof champs.taille !== 'number' || champs.taille <= 0 || champs.taille > TAILLE_PIECE_MAX) return null;
  const lib = typeof champs.libelle === 'string' ? champs.libelle.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() : '';
  return { jeton: champs.jeton, type: champs.type, libelle: lib || null };
}
