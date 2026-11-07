import { describe, expect, it } from 'vitest';
import { crc32, creerZip } from './zip';

const enc = new TextEncoder();

describe('archive ZIP du pack documentaire', () => {
  it('CRC-32 de référence', () => {
    expect(crc32(enc.encode('123456789')).toString(16)).toBe('cbf43926');
  });

  it('structure : entêtes locaux, répertoire central, fin d’archive', () => {
    const z = creerZip([{ nom: '01_facture_commerciale.pdf', octets: enc.encode('%PDF-1.4 x') }, { nom: 'sommaire.txt', octets: enc.encode('Pack') }]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const fin = z.length - 22;
    expect(v.getUint32(fin, true)).toBe(0x06054b50);
    expect(v.getUint16(fin + 10, true)).toBe(2);
    const debutCentral = v.getUint32(fin + 16, true);
    expect(v.getUint32(debutCentral, true)).toBe(0x02014b50);
  });

  it('noms d’entrée contrôlés : ni chemin, ni caractère spécial', () => {
    expect(() => creerZip([{ nom: '../../etc/passwd.txt', octets: new Uint8Array() }])).toThrow();
    expect(() => creerZip([{ nom: 'facture.html', octets: new Uint8Array() }])).toThrow();
  });
});
