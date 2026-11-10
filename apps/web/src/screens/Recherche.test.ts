import { describe, expect, it } from 'vitest';
import { motifRecherche } from './Recherche';

describe('recherche globale', () => {
  it('neutralise les jokers du motif ilike', () => {
    expect(motifRecherche('Lagune')).toBe('%Lagune%');
    expect(motifRecherche('100%_x')).toBe('%100\\%\\_x%');
    expect(motifRecherche('a\\b')).toBe('%a\\\\b%');
  });
});
