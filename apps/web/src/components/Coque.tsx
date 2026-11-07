import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { ECRANS } from '../lib/droits';
import { dateHeure, type Langue } from '../lib/format';
import { Sommaire } from './Sommaire';

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

  const ecran = ECRANS.filter((e) => e.chemin && loc.pathname.startsWith(e.chemin)).sort((a, b) => b.chemin.length - a.chemin.length)[0];
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); document.getElementById('gbs-recherche')?.focus(); }
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
          <span aria-hidden="true">▦</span> {t('coque.sommaire')}
        </button>
        <button className="pill" onClick={() => nav(-1)}>← {t('coque.retour')}</button>
        <span className="titre">{ecran ? t(`ecrans.${ecran.id}`) : ''}</span>
        <button className="pill" onClick={suivante} title={t('coque.changer_societe')}>
          <span className="dot" aria-hidden="true" />{societe ? societe.raison_sociale : t('coque.consolide')}
        </button>
        <form onSubmit={rechercher} style={{ flex: 1, maxWidth: 420, display: 'flex' }}>
          <input id="gbs-recherche" className="search" style={{ maxWidth: 'none' }} placeholder={t('coque.rechercher')}
            value={q} maxLength={80} onChange={(e) => setQ(e.target.value)} aria-label={t('coque.rechercher')} />
        </form>
        <div className="seg" role="group" aria-label={t('coque.langue')}>
          {(['fr', 'en', 'zh'] as Langue[]).map((l) => (
            <button key={l} aria-pressed={langue === l} onClick={() => {
              setLangue(l);
              if (profil) void supabase.from('profils').update({ langue: l }).eq('id', profil.id);
            }}>{l === 'zh' ? '中文' : l.toUpperCase()}</button>
          ))}
        </div>
        <button className="pill" onClick={() => nav('/tableau-de-bord')} aria-label={t('coque.alertes')}>
          {t('coque.alertes')} {alertes !== null && alertes > 0 && <span className="badge">{alertes}</span>}
        </button>
        <span className={'sync' + (enLigne ? '' : ' off')}>
          {enLigne ? t('coque.synchronise') : t('coque.hors_ligne')}{synchro ? ` · ${dateHeure(synchro, langue, fuseau).slice(-5)}` : ''}
        </span>
        <button className="pill" onClick={() => void deconnexion()} title={profil?.email}>{t('coque.deconnexion')}</button>
      </header>
      <main className="main">{children}</main>
      {sommaire && <Sommaire onClose={() => setSommaire(false)} />}
    </div>
  );
}
