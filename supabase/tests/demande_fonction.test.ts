// M1, lot 1 : contrôles de la fonction serveur gbs-demande (logique pure).
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { empreinteIp, lireDemande, signatureValide, TAILLE_FICHIER_MAX } from '../functions/_shared/demande';

const SECRET = 's'.repeat(40);
const signer = (ts: string, corps: string) => createHmac('sha256', SECRET).update(`${ts}.${corps}`).digest('hex');
const base = { raison_sociale: 'Clinique Les Palmiers', email: 'direction@palmiers.ci', pays: 'CI', consentement: true };
const b64 = (o: number[]) => Buffer.from(Uint8Array.from(o)).toString('base64');
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31];

describe('fonction gbs-demande : signature et entrées', () => {
  it('signature HMAC du corps et de l’horodatage, à ±5 minutes, secret d’au moins 32 caractères', async () => {
    const maintenant = 1_800_000_000_000;
    const ts = String(maintenant / 1000);
    const corps = JSON.stringify(base);
    expect(await signatureValide(SECRET, ts, corps, signer(ts, corps), maintenant)).toBe(true);
    expect(await signatureValide(SECRET, ts, corps + ' ', signer(ts, corps), maintenant)).toBe(false);
    expect(await signatureValide(SECRET, ts, corps, signer(ts, corps), maintenant + 301_000)).toBe(false);
    expect(await signatureValide('court', ts, corps, createHmac('sha256', 'court').update(`${ts}.${corps}`).digest('hex'), maintenant)).toBe(false);
    expect(await signatureValide(SECRET, ts, corps, null, maintenant)).toBe(false);
    expect(await signatureValide(SECRET, 'abc', corps, signer(ts, corps), maintenant)).toBe(false);
  });

  it('corps strict : champs inconnus, consentement absent, pays ou page invalides refusés', () => {
    expect(lireDemande(base)?.champs).toEqual(base);
    expect(lireDemande({ ...base, statut: 'converti' })).toBeNull();
    expect(lireDemande({ ...base, consentement: 'oui' })).toBeNull();
    expect(lireDemande({ ...base, pays: 'ci' })).toBeNull();
    expect(lireDemande({ ...base, page_origine: 'javascript:alert(1)' })).toBeNull();
    expect(lireDemande({ ...base, message: 'x'.repeat(4001) })).toBeNull();
    expect(lireDemande({ ...base, email: null })).toBeNull();
    expect(lireDemande({ ...base, ip_client: '<script>' })).toBeNull();
    expect(lireDemande([base])).toBeNull();
  });

  it('fichiers : 3 au plus, type vérifié sur les octets, taille bornée', () => {
    expect(lireDemande({ ...base, fichiers: [{ contenu: b64(PDF) }] })?.fichiers[0].ext).toBe('pdf');
    expect(lireDemande({ ...base, fichiers: [{ contenu: b64([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]) }] })).toBeNull();
    expect(lireDemande({ ...base, fichiers: [{ contenu: b64(PDF), nom: '../../x.pdf' }] })).toBeNull();
    expect(lireDemande({ ...base, fichiers: Array(4).fill({ contenu: b64(PDF) }) })).toBeNull();
    expect(lireDemande({ ...base, fichiers: [{ contenu: Buffer.alloc(TAILLE_FICHIER_MAX + 3, 0x25).toString('base64') }] })).toBeNull();
  });

  it('empreinte de l’adresse : stable, non réversible, dépendante du secret', async () => {
    const a = await empreinteIp(SECRET, '41.202.1.9');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await empreinteIp(SECRET, '41.202.1.9')).toBe(a);
    expect(await empreinteIp('t'.repeat(40), '41.202.1.9')).not.toBe(a);
  });
});
