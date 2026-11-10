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

interface Colisage { id: string; caisses: number; poids_brut_kg: number; volume_m3: number; remarque: string | null; statut: string; cree_le: string; motif_refus: string | null }

/** Fiche commande (équipe) : listes de colisage déclarées par le fournisseur ; validation ou refus motivé. */
export function ColisageCommande({ commandeId, traiter }: { commandeId: string; traiter: boolean }) {
  const { t } = useTranslation();
  const { langue, fuseau } = useAuth();
  const l = useAsync(async () => ok(await supabase.from('colisages').select('id, caisses, poids_brut_kg, volume_m3, remarque, statut, cree_le, motif_refus')
    .eq('commande_id', commandeId).neq('statut', 'remplacee').order('cree_le', { ascending: false }).limit(50)) as Colisage[], [commandeId]);
  const a = useAction();
  const [motif, setMotif] = useState('');
  const statuer = async (c: Colisage, valider: boolean) => {
    const v = z.object({ p_colisage: z.string().uuid(), p_valider: z.boolean(), p_motif: z.string().trim().min(5).max(1000).nullable() }).strict()
      .safeParse({ p_colisage: c.id, p_valider: valider, p_motif: valider ? null : motif });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('traiter_colisage', v.data)))) { setMotif(''); void l.recharger(); }
  };
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="section-titre">{t('colisage.titre')}</span>
      <Bandeau type="err">{l.erreur ?? a.erreur}</Bandeau>
      {(l.data ?? []).length === 0 ? <Vide>{t('colisage.aucun')}</Vide> : (l.data ?? []).map((c) => (
        <div key={c.id} className="ligne-montant">
          <span>{t('colisage.resume', { c: c.caisses, kg: Number(c.poids_brut_kg).toLocaleString(langue), m3: Number(c.volume_m3).toLocaleString(langue) })}
            <br /><span className="mute">{dateHeure(c.cree_le, langue, fuseau)}{c.remarque ? ` · ${c.remarque}` : ''}{c.motif_refus ? ` · ${c.motif_refus}` : ''}</span></span>
          <span className="actions">
            <Statut statut={c.statut === 'validee' ? 'ok' : c.statut === 'refusee' ? 'err' : 'att'} libelle={t(`colisage.statuts.${c.statut}`)} />
            {traiter && c.statut === 'declaree' && <>
              <Bouton petit variante="primaire" disabled={a.enCours} onClick={() => void statuer(c, true)}>{t('colisage.valider')}</Bouton>
              <input aria-label={t('banque.motif')} placeholder={t('banque.motif')} maxLength={1000} value={motif} onChange={(e) => setMotif(e.target.value)} />
              <Bouton petit disabled={a.enCours || motif.trim().length < 5} onClick={() => void statuer(c, false)}>{t('clients.refuser')}</Bouton></>}
          </span>
        </div>))}
    </section>
  );
}

/** Portail fournisseur : déclaration de la liste de colisage d'une commande. */
export function DeclarerColisage({ commandeId, reference, onClose, onFait }: { commandeId: string; reference: string; onClose: () => void; onFait: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [f, setF] = useState({ caisses: '', poids: '', volume: '', remarque: '' });
  const n = (x: string) => Number(x.replace(/\s/g, '').replace(',', '.'));
  const envoyer = async () => {
    const v = z.object({ caisses: z.number().int().min(1).max(100000), poids_brut_kg: z.number().positive().max(10000000), volume_m3: z.number().positive().max(100000),
      remarque: z.string().trim().max(500).nullable() }).strict()
      .refine((x) => x.poids_brut_kg / x.volume_m3 >= 1 && x.poids_brut_kg / x.volume_m3 <= 3000 && x.volume_m3 / x.caisses <= 100)
      .safeParse({ caisses: n(f.caisses), poids_brut_kg: n(f.poids), volume_m3: n(f.volume), remarque: f.remarque.trim() || null });
    if (!v.success) { a.setErreur(t('colisage.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('declarer_colisage', { p_commande: commandeId, p: v.data })))) onFait();
  };
  return (
    <Tiroir titre={`${t('colisage.declarer')} · ${reference}`} onClose={onClose}>
      <Bandeau>{t('colisage.aide_fournisseur')}</Bandeau>
      <div className="grille3">
        <Champ label={t('colisage.caisses')}><input inputMode="numeric" value={f.caisses} onChange={(e) => setF({ ...f, caisses: e.target.value })} /></Champ>
        <Champ label={t('colisage.poids')}><input inputMode="decimal" value={f.poids} onChange={(e) => setF({ ...f, poids: e.target.value })} /></Champ>
        <Champ label={t('colisage.volume')}><input inputMode="decimal" value={f.volume} onChange={(e) => setF({ ...f, volume: e.target.value })} /></Champ>
      </div>
      <Champ label={t('colisage.remarque')}><textarea rows={2} maxLength={500} value={f.remarque} onChange={(e) => setF({ ...f, remarque: e.target.value })} /></Champ>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void envoyer()}>{t('avancement.envoyer')}</Bouton>
    </Tiroir>
  );
}
