// Assemblage du dossier qualité en un seul PDF, dans le navigateur : page de garde, sommaire
// selon le référentiel du client, une page de synthèse par section (données de la base),
// puis les documents joints (PDF recopiés page à page, images JPEG ou PNG intégrées).
// Polices standard (WinAnsi) : tout caractère non représentable est remplacé, jamais interprété.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export interface Piece { section: string; titre: string; octets: Uint8Array; type: 'pdf' | 'jpg' | 'png' }
export interface Section { code: string; titre: string; obligatoire: boolean; present: boolean; lignes: string[] }
export interface Contenu { titre: string; sousTitre: string[]; sections: Section[]; libelles: { sommaire: string; manquant: string; present: string; annexe: string; page: string } }

const ACCEPTES = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
/** Texte sûr pour une police standard : caractères de contrôle retirés, hors WinAnsi remplacés. */
export function texteSur(s: string): string {
  return Array.from(s.normalize('NFC')).map((c) => {
    const n = c.codePointAt(0) ?? 0;
    if (n === 9) return ' ';
    if (n < 32 || (n >= 127 && n < 160)) return '';
    if (n <= 255 || ACCEPTES.has(c)) return c;
    return '?';
  }).join('');
}

const A4: [number, number] = [595.28, 841.89];
const MARGE = 50;

function lignesCoupees(texte: string, police: PDFFont, taille: number, largeur: number): string[] {
  const sortie: string[] = [];
  for (const brut of texteSur(texte).split('\n')) {
    let ligne = '';
    for (const mot of brut.split(' ')) {
      const essai = ligne ? `${ligne} ${mot}` : mot;
      if (police.widthOfTextAtSize(essai, taille) <= largeur) { ligne = essai; continue; }
      if (ligne) sortie.push(ligne);
      ligne = mot;
      while (police.widthOfTextAtSize(ligne, taille) > largeur && ligne.length > 1) {
        let k = ligne.length - 1;
        while (k > 1 && police.widthOfTextAtSize(ligne.slice(0, k), taille) > largeur) k--;
        sortie.push(ligne.slice(0, k));
        ligne = ligne.slice(k);
      }
    }
    sortie.push(ligne);
  }
  return sortie;
}

class Redacteur {
  page!: PDFPage;
  y = 0;
  constructor(private doc: PDFDocument, private normal: PDFFont, private gras: PDFFont) { this.nouvelle(); }
  nouvelle() { this.page = this.doc.addPage(A4); this.y = A4[1] - MARGE; }
  ecrire(texte: string, taille = 10, gras = false, couleur = rgb(0.1, 0.1, 0.1)) {
    const police = gras ? this.gras : this.normal;
    for (const l of lignesCoupees(texte, police, taille, A4[0] - 2 * MARGE)) {
      if (this.y < MARGE + taille) this.nouvelle();
      this.page.drawText(l, { x: MARGE, y: this.y - taille, size: taille, font: police, color: couleur });
      this.y -= taille * 1.45;
    }
  }
  espace(h = 8) { this.y -= h; }
}

export async function assemblerDossierQualite(c: Contenu, pieces: Piece[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(texteSur(c.titre)); doc.setProducer('Gulf Bridge Sourcing'); doc.setCreator('Gulf Bridge Sourcing');
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const gras = await doc.embedFont(StandardFonts.HelveticaBold);
  const r = new Redacteur(doc, normal, gras);
  r.espace(120);
  r.ecrire(c.titre, 24, true);
  r.espace(10);
  for (const s of c.sousTitre) r.ecrire(s, 12);
  r.nouvelle();
  r.ecrire(c.libelles.sommaire, 16, true);
  r.espace();
  c.sections.forEach((s, i) => r.ecrire(`${i + 1}. ${s.titre} — ${s.present ? c.libelles.present : c.libelles.manquant}`, 11, false,
    s.obligatoire && !s.present ? rgb(0.7, 0.1, 0.1) : rgb(0.1, 0.1, 0.1)));
  for (const [i, s] of c.sections.entries()) {
    r.nouvelle();
    r.ecrire(`${i + 1}. ${s.titre}`, 16, true);
    r.espace();
    if (s.lignes.length === 0) r.ecrire(c.libelles.manquant, 11);
    for (const l of s.lignes) r.ecrire(l, 10);
    for (const p of pieces.filter((x) => x.section === s.code)) {
      if (p.type === 'pdf') {
        const src = await PDFDocument.load(p.octets, { ignoreEncryption: false });
        const pages = await doc.copyPages(src, src.getPageIndices());
        for (const pg of pages) doc.addPage(pg);
      } else {
        const img = p.type === 'jpg' ? await doc.embedJpg(p.octets) : await doc.embedPng(p.octets);
        const pg = doc.addPage(A4);
        const echelle = Math.min((A4[0] - 2 * MARGE) / img.width, (A4[1] - 2 * MARGE - 30) / img.height, 1);
        pg.drawText(texteSur(`${c.libelles.annexe} — ${p.titre}`).slice(0, 120), { x: MARGE, y: A4[1] - MARGE - 10, size: 10, font: normal });
        pg.drawImage(img, { x: MARGE, y: A4[1] - MARGE - 30 - img.height * echelle, width: img.width * echelle, height: img.height * echelle });
      }
    }
  }
  const total = doc.getPageCount();
  doc.getPages().forEach((pg, i) => pg.drawText(`${c.libelles.page} ${i + 1} / ${total}`, { x: A4[0] - MARGE - 60, y: 20, size: 8, font: normal, color: rgb(0.4, 0.4, 0.4) }));
  return doc.save();
}
