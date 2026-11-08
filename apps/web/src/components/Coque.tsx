import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { ECRANS, MODULES, ecranCourant, type Ecran } from '../lib/droits';
import { dateHeure, jourCourt, type Langue } from '../lib/format';
import { Sommaire } from './Sommaire';
import { Gloses } from './Gloses';

/** Glyphe du bouton Sommaire : quatre carrés, le dernier en bronze (maquette). */
function GlypheSommaire() {
  return (
    <span aria-hidden="true" className="glyphe-sommaire">
      <i /><i /><i /><i className="bronze" />
    </span>
  );
}

/** Bande de sections du module courant : sections numérotées (segment foncé), puis les écrans de la section active. */
function BandeSections({ ecran }: { ecran: Ecran }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { profil } = useAuth();
  const role = profil?.role;
  const module = MODULES.find((m) => m.id === ecran.module);
  if (!module || !role) return null;
  const ouvrables = (section: string) => ECRANS.filter((e) => e.module === module.id && e.section === section && e.chemin && e.roles.includes(role));
  const sections = module.sections.filter((s) => ouvrables(s).length > 0);
  const liens = ouvrables(ecran.section);
  return (
    <nav className="bande no-print" aria-label={t('modules.' + module.id)}>
      {sections.length > 0 && (
        <div className="bande-sections" role="group" aria-label={t('coque.sections')}>
          {sections.map((s, i) => (
            <button key={s} aria-current={s === ecran.section ? 'true' : undefined}
              onClick={() => { const cible = ouvrables(s)[0]; if (cible && s !== ecran.section) nav(cible.chemin); }}>
              <span className="num">{String(i + 1).padStart(2, '0')}</span>{t('sections.' + s)}
            </button>
          ))}
        </div>
      )}
      {liens.length > 0 && <span className="bande-sep" aria-hidden="true" />}
      <div className="bande-liens" role="group" aria-label={t('coque.ecrans_section')}>
        {liens.map((e) => (
          <button key={e.id} aria-current={e.id === ecran.id ? 'page' : undefined} onClick={() => nav(e.chemin)}>{t('ecrans.' + e.id)}</button>
        ))}
      </div>
    </nav>
  );
}

export function Coque({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const loc = useLocation();
  const { profil, societes, societeActive, setSocieteActive, langue, setLangue, deconnexion, fuseau } = useAuth();
  const [sommaire, setSommaire] = useState(false);
  const [q, setQ] = useState('');
  const [alertes, setAlertes] = useState<number | null>(null);
  const [synchro, setSynchro] = useState<string | null>(null);
  const [enLigne, setEnLigne] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  const ecran = ecranCourant(loc.pathname);
  const mesSocietes = societes.filter((s) => profil?.role === 'admin' || profil?.societes.includes(s.id));
  const societe = societes.find((s) => s.id === societeActive);

  // Société : la pastille fait défiler les entités (vue consolidée, puis chaque société autorisée).
  const suivante = () => {
    const ids = [null, ...mesSocietes.map((s) => s.id)];
    const i = ids.indexOf(societeActive);
    setSocieteActive(ids[(i + 1) % ids.length] ?? null);
  };

  useEffect(() => {
    let actif = true;
    const charger = async () => {
      const r = await supabase.rpc('tableau_de_bord', { p_societe: societeActive });
      if (!actif) return;
      if (!r.error && r.data) {
        const d = r.data as Record<string, number | null>;
        setAlertes((d.points_bloquants_escalades ?? 0) + (d.fne_en_attente ?? 0) + (d.factures_en_retard ?? 0)
          + (d.paiements_a_valider ?? 0) + (d.dd_expirant_60j ?? 0));
        setSynchro(new Date().toISOString());
      }
    };
    void charger();
    const id = window.setInterval(charger, 60_000);
    const on = () => setEnLigne(true); const off = () => setEnLigne(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { actif = false; window.clearInterval(id); window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [societeActive, loc.pathname]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); document.getElementById('gbs-recherche')?.focus(); return; }
      // Touche M : ouvre le Sommaire, sauf pendant une saisie.
      const cible = e.target as HTMLElement | null;
      if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey && cible
        && !/^(input|textarea|select)$/i.test(cible.tagName) && !cible.isContentEditable) { e.preventDefault(); setSommaire(true); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const rechercher = (e: React.FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (v.length < 2 || v.length > 80) return;
    nav(`/dossiers?q=${encodeURIComponent(v)}`);
  };

  return (
    <div className="app">
      <header className="topbar no-print">
        <button className="pill-ink" onClick={() => setSommaire(true)} aria-haspopup="dialog">
          <GlypheSommaire /> {t('coque.sommaire')}
        </button>
        <button className="tb-btn tb-retour" onClick={() => nav(-1)}>← {t('coque.retour')}</button>
        <span className="tb-titre">
          <span className="l1">{ecran ? t(`ecrans.${ecran.id}`) : ''}</span>
          <span className="l2">{jourCourt(new Date(), langue, fuseau)}</span>
        </span>
        <button className="tb-societe" onClick={suivante} title={t('coque.changer_societe')}>
          <span className="dot" aria-hidden="true" />{societe ? societe.raison_sociale : t('coque.consolide')}
        </button>
        <form className="tb-recherche" onSubmit={rechercher} role="search">
          <input id="gbs-recherche" placeholder={t('coque.rechercher')} value={q} maxLength={80}
            onChange={(e) => setQ(e.target.value)} aria-label={t('coque.rechercher')} />
          <kbd className="tb-kbd" aria-hidden="true">Ctrl K</kbd>
        </form>
        <div className="tb-langues" role="group" aria-label={t('coque.langue')}>
          {(['fr', 'en', 'zh'] as Langue[]).map((l) => (
            <button key={l} aria-pressed={langue === l} onClick={() => {
              setLangue(l);
              if (profil) void supabase.from('profils').update({ langue: l }).eq('id', profil.id);
            }}>{l === 'zh' ? '中文' : `${l.toUpperCase()} · 中文`}</button>
          ))}
        </div>
        <button className="tb-btn" onClick={() => nav('/tableau-de-bord')} aria-label={t('coque.alertes')}>
          {t('coque.alertes')} {alertes !== null && alertes > 0 && <span className="badge">{alertes}</span>}
        </button>
        <span className={'sync' + (enLigne ? '' : ' off')}>
          {enLigne ? t('coque.synchronise') : t('coque.hors_ligne')}{synchro ? ` · ${dateHeure(synchro, langue, fuseau).slice(-5)}` : ''}
        </span>
        <button className="tb-btn tb-large" onClick={() => window.print()}>{t('coque.imprimer')}</button>
        <button className="tb-btn" onClick={() => void deconnexion()} title={profil?.email}>{t('coque.deconnexion')}</button>
      </header>
      <div className="filet-nuit no-print" aria-hidden="true" />
      {ecran && <BandeSections ecran={ecran} />}
      <main className="main">{children}</main>
      {sommaire && <Sommaire onClose={() => setSommaire(false)} />}
      <Gloses />
    </div>
  );
}
