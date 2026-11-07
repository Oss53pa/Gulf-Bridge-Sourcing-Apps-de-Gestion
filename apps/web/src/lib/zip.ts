// Archive ZIP minimale (méthode « stockée », sans compression), assemblée dans le navigateur :
// aucune dépendance, aucun envoi à un service tiers. Noms d'entrée contrôlés par l'appelant
// (codes de pièces), jamais un nom de fichier fourni par un utilisateur.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(o: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < o.length; i++) c = TABLE[(c ^ o[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const NOM_ENTREE = /^[a-z0-9_-]{1,80}\.(pdf|png|jpg|webp|txt)$/;

export interface Entree { nom: string; octets: Uint8Array }

export function creerZip(entrees: Entree[], date = new Date(2026, 0, 1)): Uint8Array {
  const enc = new TextEncoder();
  const dosTemps = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  const locaux: Uint8Array[] = [];
  const centraux: Uint8Array[] = [];
  let decalage = 0;
  for (const e of entrees) {
    if (!NOM_ENTREE.test(e.nom)) throw new Error('nom');
    const nom = enc.encode(e.nom);
    const crc = crc32(e.octets);
    const l = new DataView(new ArrayBuffer(30));
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0, true); l.setUint16(8, 0, true);
    l.setUint16(10, dosTemps, true); l.setUint16(12, dosDate, true); l.setUint32(14, crc, true);
    l.setUint32(18, e.octets.length, true); l.setUint32(22, e.octets.length, true); l.setUint16(26, nom.length, true); l.setUint16(28, 0, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0, true); c.setUint16(10, 0, true);
    c.setUint16(12, dosTemps, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
    c.setUint32(20, e.octets.length, true); c.setUint32(24, e.octets.length, true); c.setUint16(28, nom.length, true);
    c.setUint32(42, decalage, true);
    locaux.push(new Uint8Array(l.buffer), nom, e.octets);
    centraux.push(new Uint8Array(c.buffer), nom);
    decalage += 30 + nom.length + e.octets.length;
  }
  const tailleCentrale = centraux.reduce((s, x) => s + x.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, entrees.length, true); fin.setUint16(10, entrees.length, true);
  fin.setUint32(12, tailleCentrale, true); fin.setUint32(16, decalage, true);
  const parts = [...locaux, ...centraux, new Uint8Array(fin.buffer)];
  const total = parts.reduce((s, x) => s + x.length, 0);
  const sortie = new Uint8Array(total);
  let p = 0;
  for (const x of parts) { sortie.set(x, p); p += x.length; }
  return sortie;
}
