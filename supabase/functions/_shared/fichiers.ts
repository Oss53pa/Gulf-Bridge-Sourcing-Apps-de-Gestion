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
