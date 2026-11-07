import { supabase } from './supabase';

// Dépôt d'un fichier : type vérifié sur les premiers octets, taille bornée, nom régénéré.
// Le bucket « documents » est privé (URL signées) et restreint les types MIME côté serveur.
export const TAILLE_MAX = 25 * 1024 * 1024;

const SIGNATURES: { ext: string; mime: string; octets: number[] }[] = [
  { ext: 'pdf', mime: 'application/pdf', octets: [0x25, 0x50, 0x44, 0x46] },
  { ext: 'png', mime: 'image/png', octets: [0x89, 0x50, 0x4e, 0x47] },
  { ext: 'jpg', mime: 'image/jpeg', octets: [0xff, 0xd8, 0xff] },
];

function lire(b: Blob): Promise<ArrayBuffer> {
  if (typeof b.arrayBuffer === 'function') return b.arrayBuffer();
  return new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result as ArrayBuffer); r.onerror = () => ko(r.error); r.readAsArrayBuffer(b); });
}

export async function detecterType(f: Blob): Promise<{ ext: string; mime: string } | null> {
  const b = new Uint8Array(await lire(f.slice(0, 12)));
  for (const s of SIGNATURES) if (s.octets.every((o, i) => b[i] === o)) return { ext: s.ext, mime: s.mime };
  // WebP : « RIFF » .... « WEBP »
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

export async function empreinte(f: Blob): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', await lire(f));
  return Array.from(new Uint8Array(h)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

export class FichierRefuse extends Error {}

/** Dépose le fichier dans le dossier et renvoie son chemin et son empreinte SHA-256. */
export async function deposer(dossierId: string, f: File): Promise<{ chemin: string; empreinte: string }> {
  if (f.size === 0 || f.size > TAILLE_MAX) throw new FichierRefuse('taille');
  const type = await detecterType(f);
  if (!type) throw new FichierRefuse('type');
  const chemin = `${dossierId}/${crypto.randomUUID()}.${type.ext}`;
  const r = await supabase.storage.from('documents').upload(chemin, f, { contentType: type.mime, upsert: false });
  if (r.error) throw r.error;
  return { chemin, empreinte: await empreinte(f) };
}

/** URL signée de courte durée (aucun fichier public). */
export async function urlSignee(chemin: string): Promise<string | null> {
  const r = await supabase.storage.from('documents').createSignedUrl(chemin, 300);
  return r.data?.signedUrl ?? null;
}
