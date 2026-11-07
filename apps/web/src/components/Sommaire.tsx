import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ECRANS, MODULES, normaliser, type Metier } from '../lib/droits';
import { useAuth } from '../lib/auth';

type Vue = 'volets' | 'mosaique';
const METIERS: ('tous' | Metier)[] = ['tous', 'direction', 'commercial', 'achats', 'logistique', 'finance', 'administration'];

function lire<T extends string>(cle: string, defaut: T, valides: readonly T[]): T {
  try { const v = localStorage.getItem(cle) as T | null; if (v && valides.includes(v)) return v; } catch { /* ignoré */ }
  return defaut;
}
function ecrire(cle: string, v: string) { try { localStorage.setItem(cle, v); } catch { /* ignoré */ } }

/** Superposition plein écran qui remplace la barre latérale : Volets ou Mosaïque, filtre Métier, recherche, clavier. */
export function Sommaire({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { profil } = useAuth();
  const role = profil?.role ?? null;
  const [vue, setVue] = useState<Vue>(lire('gbs-som-view', 'volets', ['volets', 'mosaique'] as const));
  const [metier, setMetier] = useState<'tous' | Metier>(lire('gbs-som-met', 'tous', METIERS));
  const [q, setQ] = useState('');
  const [module, setModule] = useState<string>(MODULES[0].id);
  const [sel, setSel] = useState(0);
  const recherche = useRef<HTMLInputElement>(null);

  useEffect(() => { ecrire('gbs-som-view', vue); }, [vue]);
  useEffect(() => { ecrire('gbs-som-met', metier); }, [metier]);
  useEffect(() => { recherche.current?.focus(); }, []);

  const modules = MODULES.filter((m) => metier === 'tous' || m.metier.includes(metier));
  const visibles = useMemo(() => {
    const n = normaliser(q.trim());
    return ECRANS.filter((e) => role && e.roles.includes(role))
      .filter((e) => modules.some((m) => m.id === e.module))
      .filter((e) => !n || normaliser(t(`ecrans.${e.id}`)).includes(n) || normaliser(t(`modules.${e.module}`)).includes(n));
  }, [q, role, modules, t]);
  const ecransModule = q ? visibles : visibles.filter((e) => e.module === module);
  const ouvrables = ecransModule.filter((e) => e.lot === 0 && e.chemin);

  const ouvrir = (chemin: string) => { onClose(); nav(chemin); };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === '/' && document.activeElement !== recherche.current) { e.preventDefault(); recherche.current?.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, ouvrables.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
      else if (e.key === 'Enter' && ouvrables[sel]) { e.preventDefault(); ouvrir(ouvrables[sel].chemin); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  // Sur un téléphone très étroit, la Mosaïque bascule en Volets.
  const etroit = typeof window !== 'undefined' && window.innerWidth < 480;
  const vueEff = etroit ? 'volets' : vue;

  const carte = (e: (typeof ECRANS)[number]) => {
    const dispo = e.lot === 0 && Boolean(e.chemin);
    const i = ouvrables.indexOf(e);
    return (
      <button key={e.id} className="ecran" aria-disabled={!dispo} onClick={() => dispo && ouvrir(e.chemin)}
        style={i === sel && dispo ? { borderColor: 'var(--nuit)' } : undefined}>
        <span style={{ fontWeight: 500 }}>{t(`ecrans.${e.id}`)}</span>
        <span className="mute">{t(`modules.${e.module}`)}{dispo ? '' : ` · ${t('sommaire.lot', { n: e.lot })}`}</span>
      </button>
    );
  };

  return (
    <div className="sommaire" role="dialog" aria-modal="true" aria-label={t('sommaire.titre')}>
      <div className="barre">
        <button className="pill-ink" onClick={onClose}>{t('sommaire.fermer')}</button>
        <input ref={recherche} className="search" placeholder={t('sommaire.rechercher')} value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }} aria-label={t('sommaire.rechercher')} />
        <div className="seg" role="group" aria-label={t('sommaire.vue')}>
          <button aria-pressed={vue === 'volets'} onClick={() => setVue('volets')}>{t('sommaire.volets')}</button>
          <button aria-pressed={vue === 'mosaique'} onClick={() => setVue('mosaique')}>{t('sommaire.mosaique')}</button>
        </div>
        <select className="search" style={{ maxWidth: 200 }} value={metier} onChange={(e) => setMetier(e.target.value as typeof metier)}
          aria-label={t('sommaire.metier')}>
          {METIERS.map((m) => <option key={m} value={m}>{t(`metiers.${m}`)}</option>)}
        </select>
        <span className="mute" style={{ marginLeft: 'auto' }}><kbd>↑</kbd> <kbd>↓</kbd> <kbd>↵</kbd> <kbd>Échap</kbd> <kbd>/</kbd></span>
      </div>
      {vueEff === 'volets' ? (
        <div className="corps">
          <nav className="modules" aria-label={t('sommaire.modules')}>
            {modules.filter((m) => visibles.some((e) => e.module === m.id)).map((m) => (
              <button key={m.id} aria-current={!q && module === m.id} onClick={() => { setModule(m.id); setQ(''); setSel(0); }}>
                <span>{t(`modules.${m.id}`)}</span>
                <span className="mute">{visibles.filter((e) => e.module === m.id).length}</span>
              </button>
            ))}
          </nav>
          <div className="ecrans">{ecransModule.map(carte)}</div>
        </div>
      ) : (
        <div className="mosaique">
          {modules.filter((m) => visibles.some((e) => e.module === m.id)).map((m) => (
            <section key={m.id}>
              <div className="surtitre">{t(`modules.${m.id}`)}</div>
              {visibles.filter((e) => e.module === m.id).map((e) => (
                e.lot === 0 && e.chemin
                  ? <a key={e.id} onClick={() => ouvrir(e.chemin)} href={e.chemin} onClickCapture={(ev) => ev.preventDefault()}>{t(`ecrans.${e.id}`)}</a>
                  : <span key={e.id} className="mute" style={{ display: 'block', padding: '4px 0' }}>{t(`ecrans.${e.id}`)} · {t('sommaire.lot', { n: e.lot })}</span>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
