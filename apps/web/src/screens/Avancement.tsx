// Avancement de la fabrication déclaré par le fournisseur : photos par lien signé (jamais publiques),
// suivi et publication au client par l'équipe, déclaration depuis le portail fournisseur.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { dateHeure } from '../lib/format';
import { deposerPhotoProduction, FichierRefuse, urlSignee } from '../lib/fichiers';
import { Bandeau, Bouton, Champ, Jauge as Barre, Statut, Tiroir, Vide } from '../components/ui';

/** Vignettes : chaque image est lue par une URL signée de courte durée (droit vérifié par le stockage). */
export function Vignettes({ chemins }: { chemins: string[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let vivant = true;
    void Promise.all(chemins.map(async (c) => [c, await urlSignee(c)] as const)).then((r) => {
      if (vivant) setUrls(Object.fromEntries(r.filter((x): x is readonly [string, string] => !!x[1])));
    });
    return () => { vivant = false; };
  }, [chemins.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!chemins.length) return null;
  return (
    <div className="vignettes">{chemins.map((c) => urls[c]
      ? <a key={c} href={urls[c]} target="_blank" rel="noopener noreferrer"><img src={urls[c]} alt="" loading="lazy" /></a>
      : <span key={c} className="vignette-vide" />)}</div>
  );
}

/** Avancement en pourcentage : jauge commune de l'application et valeur. */
export function Jauge({ pct }: { pct: number }) {
  return <div className="avt"><Barre valeur={pct} /><b>{pct} %</b></div>;
}

interface Declaration { id: string; pct: number; commentaire: string | null; cree_le: string; publie_le: string | null }

/** Fiche commande (équipe) : déclarations du fournisseur, photos, publication au client. */
export function AvancementCommande({ commandeId, publier }: { commandeId: string; publier: boolean }) {
  const { t } = useTranslation();
  const { langue, fuseau } = useAuth();
  const ds = useAsync(async () => ok(await supabase.from('avancements_production').select('id, pct, commentaire, cree_le, publie_le')
    .eq('commande_id', commandeId).order('cree_le', { ascending: false }).limit(100)) as Declaration[], [commandeId]);
  const ps = useAsync(async () => ok(await supabase.from('photos_production').select('chemin, avancement_id').eq('commande_id', commandeId).limit(500)) as
    { chemin: string; avancement_id: string | null }[], [commandeId]);
  const a = useAction();
  const basculer = async (d: Declaration) => {
    if (await a.executer(async () => ok(await supabase.rpc('publier_avancement_client', { p_avancement: d.id, p_publier: !d.publie_le })))) void ds.recharger();
  };
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span className="section-titre">{t('avancement.titre')}</span>
      <Bandeau type="err">{ds.erreur ?? ps.erreur ?? a.erreur}</Bandeau>
      {publier && <p className="mute" style={{ margin: 0 }}>{t('avancement.aide_publication')}</p>}
      {(ds.data ?? []).length === 0 ? <Vide>{t('avancement.aucun')}</Vide> : (ds.data ?? []).map((d) => (
        <div key={d.id} className="carte" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="liv-pv"><Jauge pct={d.pct} /><span className="actions">
            <Statut statut={d.publie_le ? 'ok' : 'neutre'} libelle={d.publie_le ? t('avancement.publie') : t('avancement.non_publie')} />
            {publier && <Bouton petit disabled={a.enCours} onClick={() => void basculer(d)}>{d.publie_le ? t('avancement.retirer') : t('avancement.publier')}</Bouton>}</span></div>
          <span className="mute">{dateHeure(d.cree_le, langue, fuseau)}{d.commentaire ? ` · ${d.commentaire}` : ''}</span>
          <Vignettes chemins={(ps.data ?? []).filter((p) => p.avancement_id === d.id).map((p) => p.chemin)} />
        </div>))}
    </section>
  );
}

/** Portail fournisseur : déclaration d'avancement avec photos (déposées une à une, contrôlées par le serveur). */
export function DeclarerAvancement({ commandeId, reference, actuel, onClose, onFait }:
  { commandeId: string; reference: string; actuel: number; onClose: () => void; onFait: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  const a = useAction();
  const [f, setF] = useState({ pct: String(actuel), commentaire: '' });
  const [envoyees, setEnvoyees] = useState(0);
  const [etat, setEtat] = useState<string | null>(null);
  const surFichiers = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fs = [...(e.target.files ?? [])].slice(0, 12);
    e.target.value = '';
    for (const x of fs) {
      setEtat(t('depot.envoi'));
      try { await deposerPhotoProduction(commandeId, x); setEnvoyees((n) => n + 1); setEtat(null); }
      catch (err) {
        const code = err instanceof FichierRefuse ? (err.message === 'type' ? 'GBS_FICHIER_TYPE' : 'GBS_FICHIER_TAILLE') : String((err as Error).message ?? '');
        setEtat(t(`erreurs.${code}`, { defaultValue: t('erreurs.generique') })); break;
      }
    }
  };
  const envoyer = async () => {
    const v = z.object({ p_commande: z.string().uuid(), p_pct: z.number().int().min(actuel).max(100), p_commentaire: z.string().trim().max(500).nullable() }).strict()
      .safeParse({ p_commande: commandeId, p_pct: Number(f.pct), p_commentaire: f.commentaire.trim() || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('declarer_avancement', v.data)))) onFait();
  };
  return (
    <Tiroir titre={`${t('avancement.declarer')} · ${reference}`} onClose={onClose}>
      <Bandeau>{t('avancement.aide_fournisseur')}</Bandeau>
      <Champ label={t('avancement.pct')}><input type="number" min={actuel} max={100} step={1} value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} /></Champ>
      <Champ label={t('avancement.commentaire')}><textarea rows={3} maxLength={500} value={f.commentaire} onChange={(e) => setF({ ...f, commentaire: e.target.value })} /></Champ>
      <input ref={ref} type="file" hidden multiple accept="image/png,image/jpeg,image/webp" onChange={(e) => void surFichiers(e)} />
      <div className="actions"><Bouton petit onClick={() => ref.current?.click()}>{t('avancement.ajouter_photos')}</Bouton>
        <span className="mute">{etat ?? t('avancement.photos_jointes', { n: envoyees })}</span></div>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void envoyer()}>{t('avancement.envoyer')}</Bouton>
    </Tiroir>
  );
}
