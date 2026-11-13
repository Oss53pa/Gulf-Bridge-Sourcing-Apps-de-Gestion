import { describe, expect, it } from 'vitest';
import { detecter, retirerMetadonnees, UUID } from '../functions/_shared/fichiers';

const o = (...b: number[]) => new Uint8Array(b);

describe('fonction serveur de dépôt : type vérifié sur les octets', () => {
  it('accepte PDF, PNG, JPEG, WebP', () => {
    expect(detecter(o(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31))?.mime).toBe('application/pdf');
    expect(detecter(o(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))?.mime).toBe('image/png');
    expect(detecter(o(0xff, 0xd8, 0xff, 0xe1))?.mime).toBe('image/jpeg');
    expect(detecter(o(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))?.mime).toBe('image/webp');
  });
  it('refuse exécutable, HTML, SVG, ZIP et fichier tronqué', () => {
    expect(detecter(o(0x4d, 0x5a))).toBeNull();
    expect(detecter(o(0x3c, 0x68, 0x74, 0x6d, 0x6c))).toBeNull();
    expect(detecter(o(0x3c, 0x73, 0x76, 0x67))).toBeNull();
    expect(detecter(o(0x50, 0x4b, 0x03, 0x04))).toBeNull();
    expect(detecter(o(0x25, 0x50))).toBeNull();
    expect(detecter(o(0x52, 0x49, 0x46, 0x46))).toBeNull();
  });
  it('identifiant de dossier : UUID strict', () => {
    expect(UUID.test('dddddddd-0000-4000-8000-000000000001')).toBe(true);
    expect(UUID.test('../../etc/passwd')).toBe(false);
  });
});

const contient = (b: Uint8Array, texte: string) => Buffer.from(b).includes(Buffer.from(texte, 'latin1'));
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const ascii = (t: string) => [...t].map((c) => c.charCodeAt(0));

describe('fonction serveur de dépôt : métadonnées des images retirées', () => {
  it('JPEG : EXIF (GPS), IPTC et commentaire retirés ; JFIF et données de l’image conservés', () => {
    const exif = [...ascii('Exif'), 0, 0, ...ascii('GPS 4.123,9.456 Foshan')];
    const jpeg = o(0xff, 0xd8,
      0xff, 0xe0, 0, 16, ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,          // APP0
      0xff, 0xe1, 0, exif.length + 2, ...exif,                                       // APP1 EXIF
      0xff, 0xed, 0, 6, ...ascii('IPTC'),                                            // APP13
      0xff, 0xfe, 0, 7, ...ascii('usine'),                                           // COM
      0xff, 0xda, 0, 4, 1, 2, 0x11, 0x22, 0x33, 0xff, 0xd9);                         // SOS + données + EOI
    const r = retirerMetadonnees(jpeg, 'jpg')!;
    expect(contient(r, 'GPS')).toBe(false);
    expect(contient(r, 'IPTC')).toBe(false);
    expect(contient(r, 'usine')).toBe(false);
    expect(contient(r, 'JFIF')).toBe(true);
    expect([...r.slice(-7)]).toEqual([1, 2, 0x11, 0x22, 0x33, 0xff, 0xd9]);
    expect(detecter(r)?.ext).toBe('jpg');
  });

  it('PNG : blocs de texte, EXIF et date retirés ; IHDR, IDAT, IEND conservés', () => {
    const bloc = (type: string, data: number[]) => [...be32(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
    const png = o(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...bloc('IHDR', new Array(13).fill(1)),
      ...bloc('tEXt', ascii('Author\0Usine Foshan')), ...bloc('eXIf', ascii('GPS')), ...bloc('IDAT', [7, 7, 7]), ...bloc('IEND', []));
    const r = retirerMetadonnees(png, 'png')!;
    expect(contient(r, 'Foshan')).toBe(false);
    expect(contient(r, 'eXIf')).toBe(false);
    expect(contient(r, 'IHDR') && contient(r, 'IDAT') && contient(r, 'IEND')).toBe(true);
  });

  it('WebP : EXIF et XMP retirés, indicateurs VP8X effacés, taille RIFF recalculée', () => {
    const bloc = (id: string, data: number[]) => [...ascii(id), ...le32(data.length), ...data, ...(data.length & 1 ? [0] : [])];
    const corps = [...ascii('WEBP'), ...bloc('VP8X', [0x0c, 0, 0, 0, 1, 0, 0, 1, 0, 0]), ...bloc('VP8 ', [9, 9, 9, 9]),
      ...bloc('EXIF', ascii('GPS Foshan')), ...bloc('XMP ', ascii('<x>auteur</x>'))];
    const webp = o(...ascii('RIFF'), ...le32(corps.length), ...corps);
    const r = retirerMetadonnees(webp, 'webp')!;
    expect(contient(r, 'Foshan') || contient(r, 'auteur')).toBe(false);
    expect(r[20] & 0x0c).toBe(0);                                   // drapeaux EXIF et XMP de VP8X
    expect(r[4] | (r[5] << 8) | (r[6] << 16)).toBe(r.length - 8);   // taille RIFF
    expect(detecter(r)?.ext).toBe('webp');
  });

  it('fichier mal formé : refusé (null) ; PDF inchangé', () => {
    expect(retirerMetadonnees(o(0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff), 'jpg')).toBeNull();
    expect(retirerMetadonnees(o(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 99, 0x49, 0x48), 'png')).toBeNull();
    const pdf = o(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31);
    expect(retirerMetadonnees(pdf, 'pdf')).toBe(pdf);
  });
});
