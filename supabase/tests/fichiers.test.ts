import { describe, expect, it } from 'vitest';
import { detecter, UUID } from '../functions/_shared/fichiers';

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
