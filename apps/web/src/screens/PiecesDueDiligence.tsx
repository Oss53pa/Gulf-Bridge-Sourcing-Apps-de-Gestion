// Lot 1, M17 niveau 1 et M16 : pièces de due diligence déposées par le fournisseur par lien sécurisé
// (page publique, en mandarin par défaut) et, pour les achats, lien, lecture et décision sur chaque pièce.
// Le fichier est vérifié par la fonction serveur (type sur les octets, taille, nom régénéré).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { dateHeure, type Langue } from '../lib/format';
import { urlSignee } from '../lib/fichiers';
import { Bandeau, Bouton, Champ, Chargement, Statut, Vide } from '../components/ui';

export const TYPES_PIECES = ['licence_commerciale', 'licence_export', 'certificat_qualite', 'certification_produit', 'rapport_audit',
  'references_clients', 'attestation_bancaire', 'beneficiaires_effectifs', 'declaration_ethique', 'autre'] as const;
const TAILLE_MAX = 10 * 1024 * 1024;
// Heure affichée au fournisseur : celle de son propre appareil.
const FUSEAU = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
const STATUT = { recue: 'info', acceptee: 'ok', refusee: 'err' } as const;

interface Dossier { reference: string | null; niveau: string; fournisseur: string; expire_le: string;
  pieces: { type: string; libelle: string | null; depose_le: string; statut: keyof typeof STATUT; motif_refus: string | null; empreinte: string }[] }

async function codeFonction(e: unknown): Promise<string> {
  try {
    const c = (e as { context?: Response }).context;
    const j = c ? await c.json() as { erreur?: string } : null;
    return j?.erreur && /^GBS_[A-Z_]+$/.test(j.erreur) ? j.erreur : 'GBS_ERREUR';
  } catch { return 'GBS_ERREUR'; }
}

/** Page publique : le fournisseur voit les pièces attendues, dépose ses fichiers et suit leur statut. */
export function PageDueDiligence() {
  const { t, i18n } = useTranslation();
  const jeton = window.location.hash.replace(/^#/, '');
  const [d, setD] = useState<Dossier | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [type, setType] = useState<string>('licence_commerciale');
  const [libelle, setLibelle] = useState('');
  const [fichier, setFichier] = useState<File | null>(null);
  const langue = i18n.language as Langue;

  const charger = async () => {
    const r = await supabase.functions.invoke('gbs-fournisseur', { body: { action: 'lire_dd', jeton } });
    if (r.error) { setErreur(await codeFonction(r.error)); return; }
    setD(r.data as Dossier); setErreur(null);
  };
  useEffect(() => {
    if (i18n.language === 'fr') void i18n.changeLanguage('zh');
    if (!/^[A-Za-z0-9_-]{43}$/.test(jeton)) { setErreur('GBS_LIEN_INVALIDE'); return; }
    void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jeton]);

  const deposer = async () => {
    setMessage(null);
    if (!fichier || fichier.size === 0 || fichier.size > TAILLE_MAX) { setErreur('GBS_FICHIER_TAILLE'); return; }
    const form = new FormData();
    form.append('action', 'deposer_piece'); form.append('jeton', jeton); form.append('type', type);
    if (libelle.trim()) form.append('libelle', libelle.trim().slice(0, 200));
    form.append('fichier', fichier);
    setEnvoi(true);
    const r = await supabase.functions.invoke('gbs-fournisseur', { body: form });
    setEnvoi(false);
    if (r.error) { setErreur(await codeFonction(r.error)); return; }
    setFichier(null); setLibelle(''); setMessage(t('dd_lien.depose_ok')); await charger();
  };

  const langues = (
    <div className="actions" style={{ justifyContent: 'flex-end' }}>
      {(['zh', 'en', 'fr'] as const).map((l) => <Bouton key={l} petit variante={i18n.language === l ? 'primaire' : undefined} onClick={() => void i18n.changeLanguage(l)}>{l.toUpperCase()}</Bouton>)}
    </div>
  );
  if (!d) {
    return <main className="screen" style={{ maxWidth: 760, margin: '0 auto' }}>{langues}
      {erreur ? <><h1>{t('dd_lien.titre')}</h1><Bandeau type="err">{t(`erreurs.${erreur}`, { defaultValue: t('erreurs.generique') })}</Bandeau></> : <Chargement />}</main>;
  }
  return (
    <main className="screen" style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {langues}
      <header>
        <div className="surtitre">{d.reference ?? ''} · {d.fournisseur}</div>
        <h1>{t('dd_lien.titre')}</h1>
        <p className="mute">{t('dd_lien.expire', { date: dateHeure(d.expire_le, langue, FUSEAU) })}</p>
      </header>
      <Bandeau type="err">{erreur ? t(`erreurs.${erreur}`, { defaultValue: t('erreurs.generique') }) : null}</Bandeau>
      <Bandeau type="ok">{message}</Bandeau>
      <p>{t('dd_lien.aide')}</p>
      <section>
        <div className="section-titre">{t('dd_lien.pieces_attendues')}</div>
        <table className="t"><tbody>{TYPES_PIECES.filter((x) => x !== 'autre').map((x) => {
          const p = d.pieces.filter((y) => y.type === x).at(-1);
          return <tr key={x}><td>{t(`dd_lien.types.${x}`)}</td>
            <td>{p ? <Statut statut={STATUT[p.statut]} libelle={t(`dd_lien.statuts.${p.statut}`)} /> : <span className="mute">{t('dd_lien.manquante')}</span>}
              {p?.motif_refus && <div className="mute">{p.motif_refus}</div>}</td></tr>;
        })}</tbody></table>
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="section-titre">{t('dd_lien.deposer')}</div>
        <Champ label={t('dd_lien.type')}><select value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES_PIECES.map((x) => <option key={x} value={x}>{t(`dd_lien.types.${x}`)}</option>)}</select></Champ>
        <Champ label={t('dd_lien.libelle')}><input maxLength={200} value={libelle} onChange={(e) => setLibelle(e.target.value)} /></Champ>
        <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" aria-label={t('dd_lien.fichier')} onChange={(e) => setFichier(e.target.files?.[0] ?? null)} />
        <p className="mute">{t('dd_lien.formats')}</p>
        <Bouton variante="primaire" disabled={envoi || !fichier} onClick={() => void deposer()}>{t('dd_lien.envoyer')}</Bouton>
      </section>
      {d.pieces.length > 0 && (
        <section>
          <div className="section-titre">{t('dd_lien.recues')}</div>
          <table className="t"><tbody>{d.pieces.map((p, i) => (
            <tr key={i}><td>{t(`dd_lien.types.${p.type}`)}{p.libelle && <div className="mute">{p.libelle}</div>}</td>
              <td className="ref">{dateHeure(p.depose_le, langue, FUSEAU)}</td>
              <td><Statut statut={STATUT[p.statut]} libelle={t(`dd_lien.statuts.${p.statut}`)} /></td></tr>))}</tbody></table>
        </section>
      )}
    </main>
  );
}

interface Piece { id: string; type: string; libelle: string | null; chemin: string; taille: number; canal: string; depose_le: string;
  statut: keyof typeof STATUT; motif_refus: string | null }

/** Panneau des achats sous une due diligence en cours : lien de dépôt, pièces reçues, décision. */
export function PiecesDd({ ddId, enCours }: { ddId: string; enCours: boolean }) {
  const { t } = useTranslation();
  const { langue, fuseau } = useAuth();
  const p = useAsync(async () => ok(await supabase.from('pieces_due_diligence').select('*').eq('due_diligence_id', ddId).order('depose_le')) as Piece[], [ddId]);
  const a = useAction();
  const [url, setUrl] = useState<string | null>(null);
  const [motifs, setMotifs] = useState<Record<string, string>>({});
  const creer = async () => {
    let r: { jeton: string } | null = null;
    if (await a.executer(async () => { r = ok(await supabase.rpc('creer_lien_due_diligence', { p_dd: ddId })) as { jeton: string }; })) {
      setUrl(`${window.location.origin}/due-diligence#${r!.jeton}`);
    }
  };
  const statuer = async (x: Piece, statut: 'acceptee' | 'refusee') => {
    const motif = statut === 'refusee' ? z.string().trim().min(5).max(1000).safeParse(motifs[x.id] ?? '') : null;
    if (motif && !motif.success) { a.setErreur(t('erreurs.GBS_MOTIF_OBLIGATOIRE')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('statuer_piece_due_diligence', { p_piece: x.id, p_statut: statut, p_motif: motif?.data ?? null })))) void p.recharger();
  };
  const voir = async (x: Piece) => { const u = await urlSignee(x.chemin); if (u) window.open(u, '_blank', 'noopener,noreferrer'); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 8 }}>
      <Bandeau type="err">{p.erreur ?? a.erreur}</Bandeau>
      {url && <Bandeau type="ok">{t('dd_lien.lien_cree')}<div style={{ wordBreak: 'break-all' }}><code>{url}</code></div>
        <Bouton petit onClick={() => void navigator.clipboard?.writeText(url)}>{t('plis.copier')}</Bouton></Bandeau>}
      {enCours && <Bouton petit disabled={a.enCours} onClick={() => void creer()}>{t('dd_lien.creer_lien')}</Bouton>}
      {(p.data ?? []).length === 0 ? <Vide>{t('dd_lien.aucune_piece')}</Vide> : (
        <table className="t"><tbody>{(p.data ?? []).map((x) => (
          <tr key={x.id}><td>{t(`dd_lien.types.${x.type}`)}{x.libelle && <div className="mute">{x.libelle}</div>}
              <div className="mute">{dateHeure(x.depose_le, langue, fuseau)} · {t(`dd_lien.canaux.${x.canal}`)}</div></td>
            <td><Statut statut={STATUT[x.statut]} libelle={t(`dd_lien.statuts.${x.statut}`)} />{x.motif_refus && <div className="mute">{x.motif_refus}</div>}</td>
            <td className="num"><span className="actions" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Bouton petit onClick={() => void voir(x)}>{t('commun.voir')}</Bouton>
              {enCours && x.statut === 'recue' && <>
                <Bouton petit onClick={() => void statuer(x, 'acceptee')}>{t('dd_lien.accepter')}</Bouton>
                <input placeholder={t('dd_lien.motif_refus')} aria-label={t('dd_lien.motif_refus')} maxLength={1000} value={motifs[x.id] ?? ''}
                  onChange={(e) => setMotifs({ ...motifs, [x.id]: e.target.value })} style={{ width: 160 }} />
                <Bouton petit variante="danger" onClick={() => void statuer(x, 'refusee')}>{t('dd_lien.refuser')}</Bouton></>}
            </span></td></tr>))}</tbody></table>
      )}
    </div>
  );
}
