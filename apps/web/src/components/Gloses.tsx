import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Affichage bilingue de la maquette (« FR · 中文 », « EN · 中文 ») : le libellé chinois est ajouté en glose
 * à côté des libellés d'interface (boutons, onglets, en-têtes de colonnes, statuts, titres de section).
 * La glose est posée en attribut data-gen et rendue en CSS (::after) : le texte d'origine, les données
 * saisies et les documents générés ne sont jamais modifiés. Inactif quand l'interface est en chinois.
 */
const CIBLES = [
  'button', 'th', '[role="tab"]', '.surtitre', '.statut', '.section-titre', '.tb-titre .l1', '.kpi .lib',
  '.som-lb', '.som-mi span', '.som-vt span', '.som-vg h4 span', '.som-tile h3 button', '.champ > span', 'h2',
].join(',');
const PREFIXE = /^[^\p{L}\p{N}]+/u;          // flèches, glyphes : « ← Retour »
const SUFFIXE = /\s*(?:·\s*[\d\s]+|\(\d+\))$/u; // compteurs : « À arbitrer · 4 »

function aplatir(o: unknown, prefixe = '', sortie: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) aplatir(v, prefixe ? `${prefixe}.${k}` : k, sortie);
  else if (typeof o === 'string') sortie[prefixe] = o;
  return sortie;
}
const cle = (s: string) => s.replace(PREFIXE, '').trim().replace(/\s+/g, ' ').toLowerCase();

function texteDirect(el: Element): string {
  let s = '';
  el.childNodes.forEach((n) => { if (n.nodeType === Node.TEXT_NODE) s += n.textContent ?? ''; });
  return s.trim();
}

export function Gloses() {
  const { i18n } = useTranslation();
  useEffect(() => {
    const langue = i18n.language;
    const nettoyer = () => document.querySelectorAll('[data-gen]').forEach((el) => el.removeAttribute('data-gen'));
    if (langue === 'zh') { nettoyer(); return; }
    const source = aplatir(i18n.getResourceBundle(langue, 'translation'));
    const zh = aplatir(i18n.getResourceBundle('zh', 'translation'));
    const table = new Map<string, string>();
    for (const [k, v] of Object.entries(source)) {
      const z = zh[k];
      if (!z || v.includes('{{') || z.includes('{{') || v.length > 60 || z === v) continue;
      const c = cle(v);
      if (c && !table.has(c)) table.set(c, z);
    }
    const appliquer = () => {
      document.querySelectorAll(CIBLES).forEach((el) => {
        const brut = texteDirect(el);
        const g = brut ? (table.get(cle(brut)) ?? table.get(cle(brut.replace(SUFFIXE, '')))) : undefined;
        if (g) { if (el.getAttribute('data-gen') !== g) el.setAttribute('data-gen', g); }
        else if (el.hasAttribute('data-gen')) el.removeAttribute('data-gen');
      });
    };
    let prevu = 0;
    const planifier = () => { if (!prevu) prevu = window.requestAnimationFrame(() => { prevu = 0; appliquer(); }); };
    appliquer();
    const obs = new MutationObserver(planifier);
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => { obs.disconnect(); if (prevu) window.cancelAnimationFrame(prevu); };
  }, [i18n, i18n.language]);
  return null;
}
