import { describe, expect, it } from 'vitest';
import { dateHeure, montant, pourcent } from './format';

describe('formats trilingues (section 7)', () => {
  it('le code ISO accompagne toujours le montant, au format de la langue', () => {
    expect(montant(1000000, 'XOF', 'fr')).toBe('1 000 000 XOF');
    expect(montant(1000000, 'XOF', 'en')).toBe('XOF 1,000,000');
    expect(montant(1000000, 'XOF', 'zh')).toBe('1,000,000 XOF');
    expect(montant(1060, 'USD', 'fr')).toBe('1 060,00 USD');
    expect(montant(-250000, 'XAF', 'en')).toBe('XAF -250,000');
  });
  it('une date limite à 18 h à Abidjan s\'affiche à 2 h le lendemain à Guangzhou', () => {
    const iso = '2026-11-20T18:00:00Z'; // Abidjan = UTC+0
    expect(dateHeure(iso, 'fr', 'Africa/Abidjan')).toContain('18:00');
    expect(dateHeure(iso, 'fr', 'Asia/Shanghai')).toMatch(/21\/11\/2026.*02:00/);
  });
  it('pourcentages', () => {
    expect(pourcent(0.12, 'fr', 0)).toBe('12 %');
    expect(pourcent(0.045, 'en')).toBe('4.5%');
  });
});
