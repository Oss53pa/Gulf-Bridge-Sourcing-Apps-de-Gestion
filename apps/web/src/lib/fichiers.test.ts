import { describe, expect, it } from 'vitest';
import { detecterType } from './fichiers';

const blob = (octets: number[]) => new Blob([new Uint8Array(octets)]);

describe('vérification du type sur les octets', () => {
  it('reconnaît PDF, PNG, JPEG, WebP', async () => {
    expect((await detecterType(blob([0x25, 0x50, 0x44, 0x46, 0x2d])))?.ext).toBe('pdf');
    expect((await detecterType(blob([0x89, 0x50, 0x4e, 0x47, 0x0d])))?.ext).toBe('png');
    expect((await detecterType(blob([0xff, 0xd8, 0xff, 0xe0])))?.ext).toBe('jpg');
    expect((await detecterType(blob([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])))?.ext).toBe('webp');
  });
  it('refuse un exécutable renommé en .pdf', async () => {
    expect(await detecterType(blob([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
    expect(await detecterType(blob([0x3c, 0x73, 0x76, 0x67]))).toBeNull(); // SVG refusé (script possible)
  });
});
