import { describe, expect, it } from 'vitest';
import { adresseClient, CHEMIN_DOCUMENT, Limiteur, lireJeton } from '../functions/_shared/suivi';

const jeton = 'a'.repeat(43);

describe('fonction serveur de suivi : entrées et limitation de débit', () => {
  it('corps strict : exactement { jeton } au bon format', () => {
    expect(lireJeton({ jeton })).toBe(jeton);
    expect(lireJeton({ jeton, autre: 1 })).toBeNull();
    expect(lireJeton({ jeton: 'a'.repeat(42) })).toBeNull();
    expect(lireJeton({ jeton: `${'a'.repeat(42)}'` })).toBeNull();
    expect(lireJeton([jeton])).toBeNull();
    expect(lireJeton(null)).toBeNull();
  });

  it('adresse du client : première adresse, format contrôlé', () => {
    expect(adresseClient(new Headers({ 'x-forwarded-for': '41.202.1.9, 10.0.0.1' }))).toBe('41.202.1.9');
    expect(adresseClient(new Headers({ 'cf-connecting-ip': '2001:db8::1' }))).toBe('2001:db8::1');
    expect(adresseClient(new Headers({ 'x-forwarded-for': '<script>' }))).toBe('inconnue');
    expect(adresseClient(new Headers())).toBe('inconnue');
  });

  it('chemins de documents : dossier, nom régénéré, extension autorisée', () => {
    const ok = '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.pdf';
    expect(CHEMIN_DOCUMENT.test(ok)).toBe(true);
    expect(CHEMIN_DOCUMENT.test('../secret/x.pdf')).toBe(false);
    expect(CHEMIN_DOCUMENT.test(ok.replace('.pdf', '.html'))).toBe(false);
  });

  it('limite par fenêtre et mémoire bornée', () => {
    const l = new Limiteur(2, 60_000, 3);
    expect([l.autorise('a', 0), l.autorise('a', 1), l.autorise('a', 2)]).toEqual([true, true, false]);
    expect(l.autorise('a', 60_000)).toBe(true); // nouvelle fenêtre
    for (const k of ['b', 'c', 'd', 'e']) l.autorise(k, 60_001);
    expect(l.nombre).toBeLessThanOrEqual(3);
  });
});
