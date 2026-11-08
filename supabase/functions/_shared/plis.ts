// Logique pure des plis fermés, partagée par la fonction serveur gbs-fournisseur et testée
// sous Node : validation stricte de l'offre, chiffrement AES-256-GCM, empreinte du contenu.

export const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CPT', 'CIF', 'CIP'] as const;
export const DEVISES = ['USD', 'CNY'] as const;
const CHAMPS_CG: Record<string, (v: unknown) => boolean> = {
  puissance_kw: (v) => nombre(v, 0, 100000),
  heures_an: (v) => nombre(v, 0, 8784),
  duree_vie_ans: (v) => nombre(v, 0.01, 50),
  entretien_heures_an: (v) => nombre(v, 0, 10000),
  pieces_cout_an: (v) => nombre(v, 0, 1e10),
  pieces_disponibles_ans: (v) => nombre(v, 0, 50),
  delai_pieces_jours: (v) => nombre(v, 0, 365),
  sav_afrique: (v) => typeof v === 'string' && v.trim().length >= 2 && v.length <= 200,
};
export const CHAMPS_COUT_GLOBAL = Object.keys(CHAMPS_CG);

function nombre(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}
const montant = (v: unknown, min = 0) => nombre(v, min, 1e12) && Math.round(v * 100) === v * 100;
const entier = (v: unknown, min: number, max: number) => nombre(v, min, max) && Number.isInteger(v);
const texte = (v: unknown, min: number, max: number) => typeof v === 'string' && v.trim().length >= min && v.length <= max;
const propre = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();

export interface Offre {
  incoterm: string; lieu: string; devise: string; montant: number; fret?: number; assurance?: number; frais_jusqu_a_bord?: number;
  delai_jours: number; conditions_paiement?: string; garantie_mois: number; cout_global: Record<string, number | string>; commentaire?: string;
}

/** Offre du formulaire : champs connus seulement, types et bornes contrôlés ; null si refusée. */
export function lireOffre(corps: unknown): { offre: Offre; complet: boolean } | null {
  if (typeof corps !== 'object' || corps === null || Array.isArray(corps)) return null;
  const o = corps as Record<string, unknown>;
  const permis = ['incoterm', 'lieu', 'devise', 'montant', 'fret', 'assurance', 'frais_jusqu_a_bord', 'delai_jours', 'conditions_paiement',
    'garantie_mois', 'cout_global', 'commentaire'];
  if (Object.keys(o).some((k) => !permis.includes(k))) return null;
  if (!INCOTERMS.includes(o.incoterm as never) || !DEVISES.includes(o.devise as never)) return null;
  if (!texte(o.lieu, 2, 120) || !montant(o.montant, 0.01) || !entier(o.delai_jours, 0, 730) || !entier(o.garantie_mois, 0, 240)) return null;
  for (const k of ['fret', 'assurance', 'frais_jusqu_a_bord']) if (o[k] !== undefined && !montant(o[k])) return null;
  if (o.conditions_paiement !== undefined && !texte(o.conditions_paiement, 0, 200)) return null;
  if (o.commentaire !== undefined && !texte(o.commentaire, 0, 2000)) return null;
  const cg = o.cout_global ?? {};
  if (typeof cg !== 'object' || cg === null || Array.isArray(cg)) return null;
  const cgo = cg as Record<string, unknown>;
  for (const [k, v] of Object.entries(cgo)) if (!CHAMPS_CG[k] || !CHAMPS_CG[k](v)) return null;
  const offre: Offre = {
    incoterm: o.incoterm as string, lieu: propre(o.lieu as string), devise: o.devise as string, montant: o.montant as number,
    delai_jours: o.delai_jours as number, garantie_mois: o.garantie_mois as number,
    cout_global: Object.fromEntries(Object.entries(cgo).map(([k, v]) => [k, typeof v === 'string' ? propre(v) : v])) as Record<string, number | string>,
  };
  for (const k of ['fret', 'assurance', 'frais_jusqu_a_bord'] as const) if (o[k] !== undefined) offre[k] = o[k] as number;
  if (typeof o.conditions_paiement === 'string' && propre(o.conditions_paiement)) offre.conditions_paiement = propre(o.conditions_paiement);
  if (typeof o.commentaire === 'string' && propre(o.commentaire)) offre.commentaire = propre(o.commentaire);
  // Réponse incomplète : il manque une donnée de coût global (section 4 ter).
  return { offre, complet: CHAMPS_COUT_GLOBAL.every((k) => k in offre.cout_global) };
}

const b64 = (o: Uint8Array) => btoa(String.fromCharCode(...o));
const deb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const hex = (o: ArrayBuffer) => [...new Uint8Array(o)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Clé AES-256 : 32 octets en base64 (secret GBS_PLIS_CLE) ; null si absente ou mal formée. */
export async function cle(secret: string | undefined): Promise<CryptoKey | null> {
  if (!secret || !/^[A-Za-z0-9+/]{43}=$/.test(secret)) return null;
  const brut = deb64(secret);
  if (brut.length !== 32) return null;
  return crypto.subtle.importKey('raw', brut, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Contenu du pli : un sel aléatoire empêche de retrouver l'offre par essais sur l'empreinte. */
export function contenuPli(offre: Offre): string {
  return JSON.stringify({ sel: hex(crypto.getRandomValues(new Uint8Array(16)).buffer), ...offre });
}

export async function empreinte(contenu: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(contenu)));
}

export async function chiffrer(k: CryptoKey, contenu: string): Promise<{ chiffre: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(contenu));
  return { chiffre: b64(new Uint8Array(c)), iv: b64(iv) };
}

/** Déchiffre ; null si la clé, le vecteur ou le pli ne correspondent pas (GCM authentifie). */
export async function dechiffrer(k: CryptoKey, chiffre: string, iv: string): Promise<string | null> {
  try {
    const c = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deb64(iv) }, k, deb64(chiffre));
    return new TextDecoder().decode(c);
  } catch {
    return null;
  }
}

/** Corps public : { action, jeton, ... } ; seules les actions et champs prévus sont admis. */
export type Demande =
  | { action: 'lire'; jeton: string }
  | { action: 'repondre'; jeton: string; offre: unknown }
  | { action: 'question'; jeton: string; question: string };
export function lireDemande(corps: unknown): Demande | null {
  if (typeof corps !== 'object' || corps === null || Array.isArray(corps)) return null;
  const o = corps as Record<string, unknown>;
  if (typeof o.jeton !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(o.jeton)) return null;
  const cles = Object.keys(o).sort().join(',');
  if (o.action === 'lire' && cles === 'action,jeton') return { action: 'lire', jeton: o.jeton };
  if (o.action === 'repondre' && cles === 'action,jeton,offre') return { action: 'repondre', jeton: o.jeton, offre: o.offre };
  if (o.action === 'question' && cles === 'action,jeton,question' && texte(o.question, 5, 2000)) {
    return { action: 'question', jeton: o.jeton, question: propre(o.question as string) };
  }
  return null;
}
