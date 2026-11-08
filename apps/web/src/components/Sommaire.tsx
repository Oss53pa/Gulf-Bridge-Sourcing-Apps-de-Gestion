import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { ECRANS, MODULES, TCODES, ecranCourant, normaliser, type Ecran, type Metier } from '../lib/droits';
import { useAuth } from '../lib/auth';

type Vue = 'volets' | 'mosaique';
const METIERS: ('tous' | Metier)[] = ['tous', 'direction', 'commercial', 'achats', 'logistique', 'finance', 'administration'];

function lire<T extends string>(cle: string, defaut: T, valides: readonly T[]): T {
  try { const v = localStorage.getItem(cle) as T | null; if (v && valides.includes(v)) return v; } catch { /* ignoré */ }
  return defaut;
}
function ecrire(cle: string, v: string) { try { localStorage.setItem(cle, v); } catch { /* ignoré */ } }
function lireEpingles(): string[] {
  try { const v = JSON.parse(localStorage.getItem('gbs-pins') ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && TCODES[x]) : []; } catch { return []; }
}

/**
 * Sommaire plein écran (remplace la barre latérale), repris de la maquette :
 * Volets (modules à gauche, écrans à droite) ou Mosaïque (tout sur une page), filtre Métier,
 * recherche par nom ou T-code, épingles, clavier (Ctrl K, ↑↓, Entrée, Échap).
 */
export function Sommaire({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const loc = useLocation();
  const { profil, societes, societeActive, setSocieteActive } = useAuth();
  const role = profil?.role ?? null;
  const courant = ecranCourant(loc.pathname);
  const [vue, setVue] = useState<Vue>(lire('gbs-som-view', 'volets', ['volets', 'mosaique'] as const));
  const [metier, setMetier] = useState<'tous' | Metier>(lire('gbs-som-met', 'tous', METIERS));
  const [q, setQ] = useState('');
  const [module, setModule] = useState<string>(courant?.module ?? MODULES[0].id);
  const [sel, setSel] = useState(-1);
  const [epingles, setEpingles] = useState<string[]>(lireEpingles());
  const [k, setK] = useState(1);
  const [sansMosaique, setSansMosaique] = useState(false);
  const racine = useRef<HTMLDivElement>(null);
  const recherche = useRef<HTMLInputElement>(null);

  useEffect(() => { ecrire('gbs-som-view', vue); }, [vue]);
  useEffect(() => { ecrire('gbs-som-met', metier); }, [metier]);
  useEffect(() => { ecrire('gbs-pins', JSON.stringify(epingles)); }, [epingles]);
  useEffect(() => { const id = window.setTimeout(() => recherche.current?.focus(), 30); return () => window.clearTimeout(id); }, []);

  const autorises = useMemo(() => ECRANS.filter((e) => role && e.roles.includes(role)), [role]);
  const modulesTous = MODULES.filter((m) => autorises.some((e) => e.module === m.id));
  const numero = (id: string) => String(modulesTous.findIndex((m) => m.id === id) + 1).padStart(2, '0');
  const modules = modulesTous.filter((m) => metier === 'tous' || m.metier.includes(metier));
  const n = normaliser(q.trim());
  const correspond = (e: Ecran) => !n || normaliser(t(`ecrans.${e.id}`)).includes(n) || normaliser(t(`modules.${e.module}`)).includes(n)
    || normaliser(TCODES[e.id] ?? '').includes(n);
  const ecransDe = (m: string) => autorises.filter((e) => e.module === m);
  const resultats = modules.flatMap((m) => ecransDe(m.id)).filter((e) => e.chemin && correspond(e));
  const moduleVolet = modules.some((m) => m.id === module) ? module : (modules[0]?.id ?? '');

  const ouvrir = (e: Ecran) => { if (!e.chemin) return; onClose(); nav(e.chemin); };
  const basculerEpingle = (id: string) => setEpingles((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const mesSocietes = societes.filter((s) => profil?.role === 'admin' || profil?.societes.includes(s.id));
  const societeSuivante = () => {
    const ids = [null, ...mesSocietes.map((s) => s.id)];
    setSocieteActive(ids[(ids.indexOf(societeActive) + 1) % ids.length] ?? null);
  };
  const societe = societes.find((s) => s.id === societeActive);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); recherche.current?.focus(); return; }
      if (!n) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!resultats.length) return;
        setSel((s) => (s < 0 ? 0 : (s + (e.key === 'ArrowDown' ? 1 : -1) + resultats.length) % resultats.length));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const exact = resultats.find((x) => normaliser(TCODES[x.id] ?? '') === n);
        const cible = exact ?? resultats[Math.max(0, sel)];
        if (cible) ouvrir(cible);
      }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  });

  // La mosaïque doit tenir sans défiler : on resserre l'échelle (--k), puis on bascule en Volets si besoin.
  const mosaique = vue === 'mosaique' && !sansMosaique && typeof window !== 'undefined' && window.innerWidth > 640;
  useLayoutEffect(() => {
    const el = racine.current; if (!el) return;
    let kk = 1; el.style.setProperty('--k', '1');
    const deborde = () => [...el.querySelectorAll<HTMLElement>('.som-mos,.som-ml,.som-vr,.som-corps')].some((x) => x.scrollHeight > x.clientHeight + 1);
    while (deborde() && kk > 0.5) { kk = Math.round((kk - 0.05) * 100) / 100; el.style.setProperty('--k', String(kk)); }
    setK(kk);
    if (mosaique && deborde()) setSansMosaique(true);
  }, [vue, metier, q, moduleVolet, mosaique, i18n.language, epingles.length]);
  useEffect(() => {
    const r = () => setSansMosaique(false);
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, []);

  const ligne = (e: Ecran) => {
    const actif = courant?.id === e.id;
    const visible = correspond(e);
    const futur = !e.chemin;
    const choisi = n && resultats[sel] === e;
    const epingle = epingles.includes(e.id);
    return (
      <div key={e.id} className={'som-row' + (actif ? ' on' : '') + (visible ? '' : ' off') + (futur ? ' futur' : '') + (choisi ? ' sel' : '')}>
        <button type="button" className="som-go" aria-current={actif ? 'page' : undefined} disabled={futur} tabIndex={visible && !futur ? 0 : -1}
          title={futur ? t('sommaire.lot', { n: e.lot }) : undefined} onClick={() => ouvrir(e)}>
          <span className="som-cd">{TCODES[e.id]}</span>
          <span className="som-lb">{t(`ecrans.${e.id}`)}{futur ? <span className="som-lot"> · {t('sommaire.lot', { n: e.lot })}</span> : null}</span>
          {actif && <span className="som-sq" aria-hidden="true" />}
          {choisi && <span className="som-ent" aria-hidden="true">↵</span>}
        </button>
        {!futur && (
          <button type="button" className="som-pin" aria-pressed={epingle} tabIndex={visible ? 0 : -1}
            aria-label={`${epingle ? t('sommaire.desepingler') : t('sommaire.epingler')} ${t(`ecrans.${e.id}`)}`} onClick={() => basculerEpingle(e.id)}>
            {epingle ? '◆' : '◇'}
          </button>
        )}
      </div>
    );
  };

  const aucun = n && resultats.length === 0;
  const jour = new Intl.DateTimeFormat(i18n.language === 'zh' ? 'zh-CN' : i18n.language === 'en' ? 'en-GB' : 'fr-FR',
    { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
  const pins = epingles.map((id) => ECRANS.find((e) => e.id === id)).filter((e): e is Ecran => Boolean(e && e.chemin && role && e.roles.includes(role)));

  return (
    <div ref={racine} className={'som' + (k <= 0.7 ? ' serre' : '')} role="dialog" aria-modal="true" aria-label={t('sommaire.titre')}>
      <div className="som-w">
        <div className="som-top">
          <img src="/gbs-logo.png" alt="Gulf Bridge Sourcing" className="som-logo" />
          <span className="som-sit">{t('sommaire.situation')} <b>{jour}</b></span>
          <label className="som-srch">
            <input ref={recherche} type="search" aria-label={t('sommaire.rechercher')} placeholder={t('sommaire.recherche_code')}
              value={q} maxLength={60} onChange={(e) => { setQ(e.target.value); setSel(e.target.value.trim() ? 0 : -1); }} />
            <span className="som-kbd nu">Ctrl K</span>
          </label>
          <div className="som-seg" role="group" aria-label={t('sommaire.vue')}>
            <button type="button" aria-pressed={!mosaique} onClick={() => { setVue('volets'); }}>{t('sommaire.volets')}</button>
            <button type="button" aria-pressed={mosaique} disabled={sansMosaique} title={sansMosaique ? t('sommaire.trop_petit') : undefined}
              onClick={() => { setSansMosaique(false); setVue('mosaique'); }}>{t('sommaire.mosaique')}</button>
          </div>
          <button type="button" className="som-x" onClick={onClose} aria-label={t('sommaire.fermer')}>
            {t('sommaire.fermer_court')} <span className="som-kbd">{t('sommaire.echap')}</span>
          </button>
        </div>
        <div className="som-hr" />
        <div className="som-met">
          <span className="som-lab">{t('sommaire.metier')}</span>
          <div className="som-mg" role="group" aria-label={t('sommaire.metier')}>
            {METIERS.map((m) => <button key={m} type="button" aria-pressed={metier === m} onClick={() => setMetier(m)}>{t(`metiers.${m}`)}</button>)}
          </div>
        </div>
        <div className="som-corps">
          {aucun && (
            <div className="som-none" role="status"><strong>{t('sommaire.aucun_ecran', { q })}</strong><span className="sec">{t('sommaire.essayez')}</span></div>
          )}
          {mosaique ? (
            <div className="som-mos">
              {modules.map((m, i) => {
                const liste = ecransDe(m.id);
                const ici = liste.some((e) => e.id === courant?.id);
                const touche = liste.some(correspond);
                return (
                  <section key={m.id} className={'som-tile' + (liste.length > 4 ? ' w2' : '') + (ici ? ' cur' : '') + (n && !touche ? ' dim' : '')}
                    style={{ animationDelay: `${i * 25}ms` }}>
                    <h3><button type="button" tabIndex={-1} onClick={() => { const e = liste.find((x) => x.chemin); if (e) ouvrir(e); }}>{t(`modules.${m.id}`)}</button></h3>
                    <div className="som-rows">{liste.map(ligne)}</div>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="som-vol">
              <nav className="som-ml" aria-label={t('sommaire.modules')}>
                {modules.map((m) => {
                  const touche = ecransDe(m.id).some(correspond);
                  return (
                    <button key={m.id} type="button" className={'som-mi' + (n && !touche ? ' dim' : '')} aria-current={!n && m.id === moduleVolet}
                      onClick={() => { setModule(m.id); setQ(''); setSel(-1); }}>
                      <small>{numero(m.id)}</small><span>{t(`modules.${m.id}`)}</span>
                      {m.id === courant?.module && <span className="som-here" aria-label={t('sommaire.en_cours')} />}
                    </button>
                  );
                })}
              </nav>
              <div className="som-vr" key={n ? 'q' : moduleVolet}>
                {n ? modules.filter((m) => ecransDe(m.id).some(correspond)).map((m) => (
                  <div key={m.id} className="som-vg">
                    <h4><small>{numero(m.id)}</small><span>{t(`modules.${m.id}`)}</span></h4>
                    <div className="som-vl">{ecransDe(m.id).filter(correspond).map(ligne)}</div>
                  </div>
                )) : moduleVolet ? (
                  <>
                    <h2 className="som-vt"><small>{numero(moduleVolet)}</small><span>{t(`modules.${moduleVolet}`)}</span></h2>
                    <div className="som-vl">{ecransDe(moduleVolet).map(ligne)}</div>
                  </>
                ) : null}
              </div>
            </div>
          )}
        </div>
        <div className="som-hr" />
        <div className="som-foot">
          <span className="som-grp">
            <span className="som-lab">{t('sommaire.societe')}</span>
            <button type="button" className="som-chip" onClick={societeSuivante}>
              <span className="som-pt" aria-hidden="true" />{societe ? societe.raison_sociale : t('coque.consolide')} ↻
            </button>
          </span>
          <span className="som-grp">
            <span className="som-lab">{t('sommaire.epingles')}</span>
            {pins.length === 0 ? <span className="mute">{t('sommaire.aucun_epingle')}</span> : pins.slice(0, 4).map((e) => (
              <button key={e.id} type="button" className="som-chip" onClick={() => ouvrir(e)}>◆ {t(`ecrans.${e.id}`)}</button>
            ))}
            {pins.length > 4 && <span className="mute">+{pins.length - 4}</span>}
          </span>
          <span className="som-sc" aria-hidden="true">
            <span><span className="som-kbd">Ctrl K</span>{t('sommaire.rac_rechercher')}</span>
            <span><span className="som-kbd">↑↓</span>{t('sommaire.rac_naviguer')}</span>
            <span><span className="som-kbd">{t('sommaire.entree')}</span>{t('sommaire.rac_ouvrir')}</span>
            <span><span className="som-kbd">M</span>{t('sommaire.rac_sommaire')}</span>
            <span><span className="som-kbd">{t('sommaire.echap')}</span>{t('sommaire.rac_fermer')}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
