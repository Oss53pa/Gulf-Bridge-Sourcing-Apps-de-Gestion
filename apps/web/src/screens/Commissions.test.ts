import { describe, expect, it } from 'vitest';
import { celluleCsv } from './Commissions';

describe('Export CSV des commissions', () => {
  it('double les guillemets et neutralise les formules à l’ouverture dans un tableur', () => {
    expect(celluleCsv('Agent "Gabon"')).toBe('"Agent ""Gabon"""');
    expect(celluleCsv('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(celluleCsv('-2+3')).toBe('"\'-2+3"');
    expect(celluleCsv(null)).toBe('""');
    expect(celluleCsv(90000)).toBe('"90000"');
  });
});
