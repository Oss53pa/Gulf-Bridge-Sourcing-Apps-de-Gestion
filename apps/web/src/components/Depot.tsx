import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { deposer, FichierRefuse } from '../lib/fichiers';
import { messageErreur } from '../lib/erreurs';
import { Bouton } from './ui';

/** Dépose un document (PDF ou image) dans le dossier et renvoie son chemin. */
export function Depot({ dossierId, valeur, onChange }: { dossierId: string; valeur: string | null; onChange: (chemin: string) => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  const [etat, setEtat] = useState<string | null>(null);
  const surFichier = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setEtat(t('depot.envoi'));
    try {
      const r = await deposer(dossierId, f);
      onChange(r.chemin);
      setEtat(null);
    } catch (err) {
      setEtat(err instanceof FichierRefuse ? t(err.message === 'type' ? 'erreurs.GBS_FICHIER_TYPE' : 'erreurs.GBS_FICHIER_TAILLE') : messageErreur(err));
    }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <input ref={ref} type="file" hidden accept="application/pdf,image/png,image/jpeg,image/webp" onChange={surFichier} />
      <Bouton petit onClick={() => ref.current?.click()}>{valeur ? t('depot.remplacer') : t('depot.choisir')}</Bouton>
      <span className="mute">{etat ?? (valeur ? t('depot.depose') : t('depot.aucun'))}</span>
    </div>
  );
}
