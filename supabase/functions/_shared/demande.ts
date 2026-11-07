// Logique pure de la réception des demandes du site web (fonction gbs-demande), testée sous Node.
// Le site web appelle depuis son serveur, avec une signature HMAC-SHA256 du corps et d'un
// horodatage (secret partagé GBS_SITE_SECRET, jamais exposé au navigateur).
import { detecter } from './fichiers.ts';

export const FENETRE_SECONDES = 300;
export const FICHIERS_MAX = 3;
export const TAILLE_FICHIER_MAX = 5 * 1024 * 1024;
export const CORPS_MAX = 22 * 1024 * 1024;

const CHAMPS: Record<string, number> = {
  raison_sociale: 200, contact_nom: 120, contact_fonction: 120, email: 254, telephone: 40, pays: 2,
  specialite: 40, segment: 80, message: 4000, page_origine: 500, langue: 2,
};

const enc = new TextEncoder();
async function hmac(secret: string, texte: string): Promise<string> {
  const cle = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cle, enc.encode(texte));
  return Array.from(new Uint8Array(sig)).map((x) => x.toString(16).padStart(2, '0')).join('');
}
function egal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Signature hexadécimale de « <horodatage>.<corps> », horodatage (secondes) à ±5 minutes. */
export async function signatureValide(secret: string, horodatage: string | null, corps: string, signature: string | null,
  maintenant = Date.now()): Promise<boolean> {
  if (!secret || secret.length < 32 || !horodatage || !/^\d{10}$/.test(horodatage) || !signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  if (Math.abs(maintenant / 1000 - Number(horodatage)) > FENETRE_SECONDES) return false;
  return egal(await hmac(secret, `${horodatage}.${corps}`), signature);
}

/** Empreinte de l'adresse du visiteur : jamais conservée en clair. */
export const empreinteIp = (secret: string, ip: string) => hmac(secret, `ip:${ip}`);

export interface Fichier { octets: Uint8Array; ext: string; mime: string }
export interface Demande { champs: Record<string, string | boolean | null>; fichiers: Fichier[]; ip: string | null }

function decoder(b64: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0 || b64.length > Math.ceil(TAILLE_FICHIER_MAX / 3) * 4) return null;
  const bin = atob(b64);
  const o = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
  return o;
}

/** Corps strict : champs connus, chaînes bornées, consentement vrai, 3 fichiers au plus (PDF ou image). */
export function lireDemande(corps: unknown): Demande | null {
  if (typeof corps !== 'object' || corps === null || Array.isArray(corps)) return null;
  const o = corps as Record<string, unknown>;
  const champs: Record<string, string | boolean | null> = {};
  for (const k of Object.keys(o)) {
    if (k === 'fichiers' || k === 'ip_client') continue;
    if (k === 'consentement') { if (o[k] !== true) return null; champs[k] = true; continue; }
    const max = CHAMPS[k];
    if (max === undefined) return null;
    const v = o[k];
    if (v === null) { champs[k] = null; continue; }
    if (typeof v !== 'string' || v.length > max) return null;
    champs[k] = v;
  }
  if (champs.consentement !== true || typeof champs.raison_sociale !== 'string' || typeof champs.pays !== 'string'
      || !/^[A-Z]{2}$/.test(champs.pays) || (!champs.email && !champs.telephone)) return null;
  if (typeof champs.page_origine === 'string' && !/^https:\/\/[^\s<>"']+$/.test(champs.page_origine)) return null;
  let ip: string | null = null;
  if (o.ip_client !== undefined) {
    if (typeof o.ip_client !== 'string' || !/^[0-9a-fA-F:.]{2,45}$/.test(o.ip_client)) return null;
    ip = o.ip_client;
  }
  const fichiers: Fichier[] = [];
  if (o.fichiers !== undefined) {
    if (!Array.isArray(o.fichiers) || o.fichiers.length > FICHIERS_MAX) return null;
    for (const f of o.fichiers) {
      if (typeof f !== 'object' || f === null || Object.keys(f).some((k) => k !== 'contenu') || typeof (f as { contenu: unknown }).contenu !== 'string') return null;
      const octets = decoder((f as { contenu: string }).contenu);
      if (!octets || octets.length === 0 || octets.length > TAILLE_FICHIER_MAX) return null;
      const type = detecter(octets);
      if (!type) return null;
      fichiers.push({ octets, ...type });
    }
  }
  return { champs, fichiers, ip };
}
