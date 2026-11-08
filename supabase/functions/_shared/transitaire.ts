// Logique pure du formulaire du transitaire, partagée par la fonction serveur gbs-transitaire et
// testée sous Node : actions et champs admis, formats des étapes, dates et conteneurs.

export const ETAPES = ['remise_transporteur', 'depart_port', 'transbordement', 'arrivee_port', 'dechargement', 'mise_a_disposition', 'livraison', 'autre'] as const;
export const TYPES_DOCUMENTS = ['projet_connaissement', 'connaissement', 'lta', 'liste_colisage', 'certificat_origine', 'photos_chargement',
  'bordereau_suivi', 'declaration_douane', 'mainlevee', 'autre'] as const;
export const TAILLE_DOCUMENT_MAX = 10 * 1024 * 1024;
const JETON = /^[A-Za-z0-9_-]{43}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const propre = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
const texte = (v: unknown, max: number) => v === undefined || v === null || (typeof v === 'string' && v.length <= max);

export type DemandeTransitaire =
  | { action: 'lire'; jeton: string }
  | { action: 'etape'; jeton: string; etape: string; lieu: string | null; survenue_le: string; commentaire: string | null }
  | { action: 'maj'; jeton: string; champs: Record<string, string | string[]> };

/** Corps JSON du transitaire : actions et champs prévus seulement ; null si refusé. */
export function lireDemandeTransitaire(corps: unknown, maintenant = Date.now()): DemandeTransitaire | null {
  if (typeof corps !== 'object' || corps === null || Array.isArray(corps)) return null;
  const o = corps as Record<string, unknown>;
  if (typeof o.jeton !== 'string' || !JETON.test(o.jeton)) return null;
  const cles = Object.keys(o).sort().join(',');
  if (o.action === 'lire') return cles === 'action,jeton' ? { action: 'lire', jeton: o.jeton } : null;
  if (o.action === 'etape') {
    if (Object.keys(o).some((k) => !['action', 'jeton', 'etape', 'lieu', 'survenue_le', 'commentaire'].includes(k))) return null;
    if (!ETAPES.includes(o.etape as never) || !texte(o.lieu, 120) || !texte(o.commentaire, 1000) || typeof o.survenue_le !== 'string') return null;
    const t = Date.parse(o.survenue_le);
    if (!Number.isFinite(t) || t > maintenant + 3_600_000 || t < maintenant - 180 * 86_400_000) return null;
    return { action: 'etape', jeton: o.jeton, etape: o.etape as string, survenue_le: new Date(t).toISOString(),
      lieu: typeof o.lieu === 'string' && propre(o.lieu) ? propre(o.lieu) : null,
      commentaire: typeof o.commentaire === 'string' && propre(o.commentaire) ? propre(o.commentaire) : null };
  }
  if (o.action === 'maj') {
    if (cles !== 'action,champs,jeton' || typeof o.champs !== 'object' || o.champs === null || Array.isArray(o.champs)) return null;
    const c = o.champs as Record<string, unknown>;
    const champs: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(c)) {
      if (k === 'conteneurs' || k === 'plombs') {
        if (!Array.isArray(v) || v.length > 50) return null;
        const re = k === 'conteneurs' ? /^[A-Z]{4}[0-9]{7}$/ : /^[A-Za-z0-9-]{3,30}$/;
        const l = v.map((x) => (typeof x === 'string' ? x.trim().toUpperCase().replace(/\s/g, '') : ''));
        if (l.some((x) => !re.test(x))) return null;
        champs[k] = l;
      } else if (k === 'etd' || k === 'eta' || k === 'date_mainlevee') {
        if (typeof v !== 'string' || !DATE.test(v)) return null;
        champs[k] = v;
      } else if (k === 'navire' || k === 'numero_connaissement') {
        if (typeof v !== 'string' || propre(v).length < 2 || v.length > (k === 'navire' ? 120 : 60)) return null;
        champs[k] = propre(v);
      } else return null;
    }
    return Object.keys(champs).length ? { action: 'maj', jeton: o.jeton, champs } : null;
  }
  return null;
}

/** Champs du dépôt d'un document (formulaire multipart). */
export function lireDepotDocument(champs: { jeton: unknown; type: unknown; libelle: unknown; taille: unknown; cles: string[] }):
  { jeton: string; type: string; libelle: string | null } | null {
  if (champs.cles.some((k) => !['action', 'jeton', 'type', 'libelle', 'fichier'].includes(k)) || new Set(champs.cles).size !== champs.cles.length) return null;
  if (typeof champs.jeton !== 'string' || !JETON.test(champs.jeton)) return null;
  if (typeof champs.type !== 'string' || !TYPES_DOCUMENTS.includes(champs.type as never)) return null;
  if (!texte(champs.libelle, 200)) return null;
  if (typeof champs.taille !== 'number' || champs.taille <= 0 || champs.taille > TAILLE_DOCUMENT_MAX) return null;
  const lib = typeof champs.libelle === 'string' ? propre(champs.libelle) : '';
  return { jeton: champs.jeton, type: champs.type, libelle: lib || null };
}
