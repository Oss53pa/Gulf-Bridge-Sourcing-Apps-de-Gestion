// Contrôle du type d'un fichier sur ses premiers octets (jamais sur son nom ni
// sur le type déclaré par le navigateur). Module pur, partagé et testé sous Node.
export const TAILLE_MAX = 25 * 1024 * 1024;

const SIGNATURES: { ext: string; mime: string; octets: number[] }[] = [
  { ext: 'pdf', mime: 'application/pdf', octets: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { ext: 'png', mime: 'image/png', octets: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: 'jpg', mime: 'image/jpeg', octets: [0xff, 0xd8, 0xff] },
];

export function detecter(b: Uint8Array): { ext: string; mime: string } | null {
  for (const s of SIGNATURES) if (b.length >= s.octets.length && s.octets.every((o, i) => b[i] === o)) return { ext: s.ext, mime: s.mime };
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { ext: 'webp', mime: 'image/webp' };
  return null;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Retrait des métadonnées des images (position GPS, appareil, numéro de série, auteur, textes) avant stockage :
// une photo ne doit pas révéler un lieu ni une usine (négoce). Les données de l'image ne sont pas réencodées.
// Renvoie null si le fichier est mal formé : le dépôt est alors refusé plutôt que stocké avec ses métadonnées.
export function retirerMetadonnees(b: Uint8Array, ext: string): Uint8Array | null {
  if (ext === 'jpg') return jpegSansMeta(b);
  if (ext === 'png') return pngSansMeta(b);
  if (ext === 'webp') return webpSansMeta(b);
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const r = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { r.set(p, o); o += p.length; }
  return r;
}

// JPEG : segments jusqu'au début des données (SOS) ; APP1 (EXIF, XMP), APP13 (IPTC) et COM retirés.
function jpegSansMeta(b: Uint8Array): Uint8Array | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    let m = b[i + 1];
    while (m === 0xff && i + 2 < b.length) { i++; m = b[i + 1]; }            // octets de remplissage
    if (m === undefined) return null;
    if (m === 0xd9) { parts.push(b.subarray(i, i + 2)); return concat(parts); } // fin d'image sans données
    if (m >= 0xd0 && m <= 0xd7 || m === 0x01) { parts.push(b.subarray(i, i + 2)); i += 2; continue; }
    if (i + 4 > b.length) return null;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return null;
    if (m === 0xda) { parts.push(b.subarray(i)); return concat(parts); }    // SOS : le reste est l'image
    if (!(m === 0xe1 || m === 0xed || m === 0xfe)) parts.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return null;
}

// PNG : blocs de texte, EXIF et date retirés ; les autres blocs (et leur CRC) sont recopiés tels quels.
function pngSansMeta(b: Uint8Array): Uint8Array | null {
  if (b.length < 8) return null;
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  const retires = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
  let i = 8;
  while (i < b.length) {
    if (i + 12 > b.length) return null;
    const len = ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const fin = i + 12 + len;
    if (fin > b.length) return null;
    if (!retires.has(type)) parts.push(b.subarray(i, fin));
    i = fin;
    if (type === 'IEND') return concat(parts);
  }
  return null;
}

// WebP : blocs EXIF et XMP retirés, indicateurs correspondants effacés dans VP8X, taille RIFF recalculée.
function webpSansMeta(b: Uint8Array): Uint8Array | null {
  if (b.length < 12) return null;
  const parts: Uint8Array[] = [];
  let i = 12;
  while (i < b.length) {
    if (i + 8 > b.length) return null;
    const id = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    const len = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | ((b[i + 7] << 24) >>> 0);
    const fin = i + 8 + len + (len & 1);
    if (i + 8 + len > b.length) return null;
    if (id !== 'EXIF' && id !== 'XMP ') {
      const bloc = b.slice(i, Math.min(fin, b.length));
      if (id === 'VP8X' && len >= 1) bloc[8] &= ~0x0c;   // indicateurs EXIF (0x08) et XMP (0x04)
      parts.push(bloc);
    }
    i = fin;
  }
  const corps = concat(parts);
  const r = new Uint8Array(12 + corps.length);
  r.set(b.subarray(0, 12));
  const taille = 4 + corps.length;
  r[4] = taille & 0xff; r[5] = (taille >> 8) & 0xff; r[6] = (taille >> 16) & 0xff; r[7] = (taille >>> 24) & 0xff;
  r.set(corps, 12);
  return r;
}

// Taille annoncée d'un corps de requête : sans en-tête Content-Length (envoi par morceaux), le corps serait lu en
// entier avant tout contrôle ; on le refuse. « absente » → 411, « trop » (ou valeur illisible) → 413.
export function longueurCorps(entete: string | null, max: number): 'ok' | 'absente' | 'trop' {
  if (entete === null || entete === '') return 'absente';
  if (!/^\d{1,12}$/.test(entete)) return 'trop';
  return Number(entete) > max ? 'trop' : 'ok';
}
