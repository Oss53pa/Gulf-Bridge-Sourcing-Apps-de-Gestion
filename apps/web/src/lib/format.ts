// Formats selon la langue (section 7) : le code ISO 4217 accompagne toujours le montant.
// fr : 1 000 000 XOF · en : XOF 1,000,000 · zh : 1,000,000 XOF
export type Langue = 'fr' | 'en' | 'zh';
export type Devise = 'XOF' | 'XAF' | 'USD' | 'CNY' | 'EUR';

export const decimales = (d: string) => (d === 'XOF' || d === 'XAF' ? 0 : 2);

export function nombre(v: number | string | null | undefined, langue: Langue, dec = 0): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return '—';
  const fixe = Math.abs(n).toFixed(dec);
  const [ent, frac] = fixe.split('.');
  const sep = langue === 'fr' ? ' ' : ',';
  const groupe = ent.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const signe = n < 0 ? '-' : '';
  return signe + groupe + (frac ? (langue === 'fr' ? ',' : '.') + frac : '');
}

export function montant(v: number | string | null | undefined, devise: string, langue: Langue): string {
  if (v === null || v === undefined || v === '') return '—';
  const s = nombre(v, langue, decimales(devise));
  return langue === 'en' ? `${devise} ${s}` : `${s} ${devise}`;
}

/** Montant compact pour les KPI : 48,6 M (XOF). */
export function compact(v: number | string | null | undefined, langue: Langue): string {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1e9) return nombre(n / 1e9, langue, 1) + (langue === 'zh' ? ' B' : ' Md');
  if (Math.abs(n) >= 1e6) return nombre(n / 1e6, langue, 1) + ' M';
  if (Math.abs(n) >= 1e4) return nombre(n / 1e3, langue, 0) + ' k';
  return nombre(n, langue, 0);
}

const LOCALES: Record<Langue, string> = { fr: 'fr-FR', en: 'en-GB', zh: 'zh-CN' };

/** Horodatage stocké en UTC, affiché dans le fuseau de l'utilisateur. */
export function dateHeure(iso: string | null | undefined, langue: Langue, fuseau: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALES[langue], {
    timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

export function date(iso: string | null | undefined, langue: Langue): string {
  if (!iso) return '—';
  const [y, m, j] = iso.slice(0, 10).split('-');
  if (!y || !m || !j) return '—';
  return langue === 'fr' ? `${j}/${m}/${y}` : `${y}-${m}-${j}`;
}

export function pourcent(v: number | string | null | undefined, langue: Langue, dec = 1): string {
  if (v === null || v === undefined) return '—';
  const s = nombre(Number(v) * 100, langue, dec);
  return langue === 'fr' ? `${s} %` : `${s}%`;
}

/** Jour courant pour la barre supérieure : « jeu. 09.10.2026 », dans le fuseau de l'utilisateur. */
export function jourCourt(maintenant: Date, langue: Langue, fuseau: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat(LOCALES[langue], {
    timeZone: fuseau, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(maintenant).map((x) => [x.type, x.value]));
  return langue === 'zh' ? `${p.year}-${p.month}-${p.day} ${p.weekday}` : `${p.weekday} ${p.day}.${p.month}.${p.year}`;
}
