import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export function Entete({ surtitre, titre, actions }: { surtitre: string; titre: ReactNode; actions?: ReactNode }) {
  return (
    <header className="entete">
      <div style={{ minWidth: 0 }}>
        <div className="surtitre">{surtitre}</div>
        <h1>{titre}</h1>
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: 'primaire' | 'danger'; petit?: boolean };
export function Bouton({ variante, petit, className, ...p }: BtnProps) {
  return <button type="button" {...p} className={['btn', variante, petit ? 'petit' : '', className].filter(Boolean).join(' ')} />;
}

export function Champ({ label, erreur, children }: { label: string; erreur?: string | null; children: ReactNode }) {
  return (
    <label className={'champ' + (erreur ? ' erreur' : '')}>
      <span>{label}</span>
      {children}
      {erreur && <span className="msg" role="alert">{erreur}</span>}
    </label>
  );
}

export interface Kpi { lib: string; val: ReactNode; sous?: ReactNode; texte?: boolean }
export function Kpis({ items }: { items: Kpi[] }) {
  return (
    <div className="kpis">
      {items.map((k) => (
        <div className="kpi" key={k.lib}>
          <span className="lib">{k.lib}</span>
          <span className={k.texte ? 'val texte' : 'val'}>{k.val}</span>
          {k.sous !== undefined && <span className="sous">{k.sous}</span>}
        </div>
      ))}
    </div>
  );
}

const CLASSES: Record<string, [string, string]> = {
  // [classe, glyphe]
  ok: ['ok', '✓'], err: ['err', '▲'], att: ['att', '◷'], info: ['info', '●'], neutre: ['neutre', '○'],
};
const STATUTS: Record<string, string> = {
  ok: 'ok', err: 'err', att: 'att', info: 'info',
  validee: 'ok', valide: 'ok', verifie: 'ok', agree: 'ok', payee: 'ok', emise: 'info', execute: 'ok', confirme_client: 'ok',
  livree: 'ok', expediee: 'ok', clos: 'ok', close: 'ok', recue: 'info', a_verifier: 'att', en_cours: 'info', ouvert: 'info',
  ouverte: 'att', manquante: 'err', refusee: 'err', refuse: 'err', expiree: 'err', bloquee: 'err', annulee: 'neutre', annule: 'neutre',
  suspendu: 'err', radie: 'err', sous_surveillance: 'att', candidat: 'neutre', en_evaluation: 'att', en_attente_fne: 'att',
  brouillon: 'neutre', prepare: 'att', partiellement_payee: 'att', en_production: 'info', contrat_signe: 'info', planifiee: 'neutre',
  realisee: 'att', non_commencee: 'neutre', attente_tiers: 'att', complete: 'ok', accepte: 'ok', envoye: 'info', remplace: 'neutre',
  preparation: 'neutre', remise_transporteur: 'info', en_transit: 'info', arrivee: 'info', mise_a_disposition: 'att',
  production_terminee: 'info', non_verifie: 'neutre', acceptee: 'ok', liberation: 'ok', refus: 'err', corrigee: 'att',
};
export function Statut({ statut, libelle }: { statut: string; libelle?: string }) {
  const { t } = useTranslation();
  const [cls, g] = CLASSES[STATUTS[statut] ?? 'neutre'];
  return (
    <span className={'statut ' + cls}>
      <span className="g" aria-hidden="true">{g}</span>
      {libelle ?? t(`statuts.${statut}`, { defaultValue: statut })}
    </span>
  );
}

export function Onglets<T extends string>({ items, actif, onChange }: { items: { id: T; lib: string }[]; actif: T; onChange: (id: T) => void }) {
  return (
    <div className="onglets" role="tablist">
      {items.map((o) => (
        <button key={o.id} role="tab" aria-selected={o.id === actif} onClick={() => onChange(o.id)}>{o.lib}</button>
      ))}
    </div>
  );
}

export function Vide({ children }: { children: ReactNode }) {
  return <div className="vide">{children}</div>;
}

export function Bandeau({ type, children }: { type?: 'err' | 'ok'; children: ReactNode }) {
  if (!children) return null;
  return <div className={'bandeau ' + (type ?? '')} role={type === 'err' ? 'alert' : 'status'}>{children}</div>;
}

export function Chargement() {
  const { t } = useTranslation();
  return <div className="mute" aria-busy="true">{t('commun.chargement')}</div>;
}

/** Superposition latérale (formulaires). Échap ferme. */
export function Tiroir({ titre, onClose, children }: { titre: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tiroir" role="dialog" aria-modal="true" aria-label={titre}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h2 style={{ fontSize: 22 }}>{titre}</h2>
          <Bouton petit onClick={onClose}>{t('commun.fermer')}</Bouton>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Cadre de tableau avec bouton « Plein écran ». */
export function CadreTableau({ titre, children, outils }: { titre?: string; children: ReactNode; outils?: ReactNode }) {
  const { t } = useTranslation();
  const [plein, setPlein] = useState(false);
  const barre = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flex: 'none' }}>
      <div className="section-titre">{titre}</div>
      <div className="actions">
        {outils}
        <Bouton petit onClick={() => setPlein(!plein)}>{plein ? t('commun.quitter_plein_ecran') : t('commun.plein_ecran')}</Bouton>
      </div>
    </div>
  );
  if (plein) {
    return (
      <div className="plein-ecran">
        {barre}
        <div className="cadre">{children}</div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0 }}>
      {barre}
      <div className="cadre">{children}</div>
    </div>
  );
}

export function AccesReserve() {
  const { t } = useTranslation();
  return (
    <div className="screen">
      <div className="reserve">
        <div className="surtitre">{t('acces.surtitre')}</div>
        <h1 style={{ fontSize: 28 }}>{t('acces.titre')}</h1>
        <p className="sec">{t('acces.texte')}</p>
      </div>
    </div>
  );
}

export function Jauge({ valeur }: { valeur: number }) {
  return <div className="jauge" role="progressbar" aria-valuenow={valeur} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${Math.max(0, Math.min(100, valeur))}%` }} /></div>;
}
