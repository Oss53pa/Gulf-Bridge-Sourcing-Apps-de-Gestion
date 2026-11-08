// Lot 1, M9 : formulaire du transitaire par lien sécurisé (page publique) et, pour l'équipe, lien,
// étapes à publier au client et documents déposés. Le jeton est placé après « # ».
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, dateHeure, type Langue } from '../lib/format';
import { urlSignee } from '../lib/fichiers';
import { Bandeau, Bouton, Champ, Chargement, Statut, Vide } from '../components/ui';

const ETAPES = ['remise_transporteur', 'depart_port', 'transbordement', 'arrivee_port', 'dechargement', 'mise_a_disposition', 'livraison', 'autre'] as const;
const TYPES = ['projet_connaissement', 'connaissement', 'lta', 'liste_colisage', 'certificat_origine', 'photos_chargement', 'bordereau_suivi',
  'declaration_douane', 'mainlevee', 'autre'] as const;
const FUSEAU = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const TAILLE_MAX = 10 * 1024 * 1024;

interface Formulaire {
  expedition: { reference: string; mode: string; statut: string; lieu_remise: string | null; port_depart: string | null; port_arrivee: string | null;
    pays_destination: string; navire: string | null; type_connaissement: string | null; numero_connaissement: string | null; conteneurs: string[];
    plombs: string[]; etd: string | null; eta: string | null; date_mainlevee: string | null };
  destinataire: string; expire_le: string;
  etapes: { etape: string; lieu: string | null; survenue_le: string; commentaire: string | null; source: string }[];
  documents: { type: string; libelle: string | null; depose_le: string; empreinte: string }[];
}

async function codeFonction(e: unknown): Promise<string> {
  try {
    const c = (e as { context?: Response }).context;
    const j = c ? await c.json() as { erreur?: string } : null;
    return j?.erreur && /^GBS_[A-Z_]+$/.test(j.erreur) ? j.erreur : 'GBS_ERREUR';
  } catch { return 'GBS_ERREUR'; }
}

/** Page publique du transitaire : son expédition, ses étapes, ses documents. */
export function PageTransitaire() {
  const { t, i18n } = useTranslation();
  const langue = i18n.language as Langue;
  const jeton = window.location.hash.replace(/^#/, '');
  const [d, setD] = useState<Formulaire | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [et, setEt] = useState({ etape: 'depart_port', lieu: '', survenue_le: '', commentaire: '' });
  const [tr, setTr] = useState({ navire: '', etd: '', eta: '', numero_connaissement: '', date_mainlevee: '', conteneurs: '', plombs: '' });
  const [doc, setDoc] = useState<{ type: string; libelle: string; fichier: File | null }>({ type: 'connaissement', libelle: '', fichier: null });

  const appeler = async (body: Record<string, unknown> | FormData) => {
    const r = await supabase.functions.invoke('gbs-transitaire', { body: body instanceof FormData ? body : { jeton, ...body } });
    if (r.error) throw new Error(await codeFonction(r.error));
    return r.data;
  };
  const charger = async () => {
    try {
      const x = await appeler({ action: 'lire' }) as Formulaire;
      setD(x); setErreur(null);
      setTr({ navire: x.expedition.navire ?? '', etd: x.expedition.etd ?? '', eta: x.expedition.eta ?? '', numero_connaissement: x.expedition.numero_connaissement ?? '',
        date_mainlevee: x.expedition.date_mainlevee ?? '', conteneurs: x.expedition.conteneurs.join(' '), plombs: x.expedition.plombs.join(' ') });
    } catch (e) { setErreur((e as Error).message); }
  };
  useEffect(() => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(jeton)) { setErreur('GBS_LIEN_INVALIDE'); return; }
    void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jeton]);

  const executer = async (fn: () => Promise<unknown>, ok: string) => {
    setMessage(null); setEnvoi(true);
    try { await fn(); setMessage(t(ok)); await charger(); } catch (e) { setErreur((e as Error).message); } finally { setEnvoi(false); }
  };
  const ajouterEtape = () => {
    const v = z.object({ etape: z.enum(ETAPES), survenue_le: z.string().min(10), lieu: z.string().max(120), commentaire: z.string().max(1000) }).safeParse(et);
    if (!v.success) { setErreur('GBS_PARAMETRES_INVALIDES'); return; }
    void executer(() => appeler({ action: 'etape', etape: et.etape, lieu: et.lieu || null, commentaire: et.commentaire || null,
      survenue_le: new Date(et.survenue_le).toISOString() }), 'transitaire.etape_ok').then(() => setEt({ ...et, lieu: '', survenue_le: '', commentaire: '' }));
  };
  const majTransport = () => {
    if (!d) return;
    const e = d.expedition;
    const liste = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
    const champs: Record<string, unknown> = {};
    if (tr.navire.trim() && tr.navire.trim() !== (e.navire ?? '')) champs.navire = tr.navire.trim();
    if (tr.numero_connaissement.trim() && tr.numero_connaissement.trim() !== (e.numero_connaissement ?? '')) champs.numero_connaissement = tr.numero_connaissement.trim();
    for (const k of ['etd', 'eta', 'date_mainlevee'] as const) if (tr[k] && tr[k] !== (e[k] ?? '')) champs[k] = tr[k];
    if (tr.conteneurs.trim() !== e.conteneurs.join(' ')) champs.conteneurs = liste(tr.conteneurs);
    if (tr.plombs.trim() !== e.plombs.join(' ')) champs.plombs = liste(tr.plombs);
    if (Object.keys(champs).length === 0) return;
    void executer(() => appeler({ action: 'maj', champs }), 'transitaire.maj_ok');
  };
  const deposer = () => {
    if (!doc.fichier || doc.fichier.size === 0 || doc.fichier.size > TAILLE_MAX) { setErreur('GBS_FICHIER_TAILLE'); return; }
    const f = new FormData();
    f.append('action', 'document'); f.append('jeton', jeton); f.append('type', doc.type);
    if (doc.libelle.trim()) f.append('libelle', doc.libelle.trim().slice(0, 200));
    f.append('fichier', doc.fichier);
    void executer(() => appeler(f), 'transitaire.document_ok').then(() => setDoc({ ...doc, libelle: '', fichier: null }));
  };

  const langues = (
    <div className="actions" style={{ justifyContent: 'flex-end' }}>
      {(['fr', 'en', 'zh'] as const).map((l) => <Bouton key={l} petit variante={i18n.language === l ? 'primaire' : undefined} onClick={() => void i18n.changeLanguage(l)}>{l.toUpperCase()}</Bouton>)}
    </div>
  );
  if (!d) {
    return <main className="screen" style={{ maxWidth: 760, margin: '0 auto' }}>{langues}
      {erreur ? <><h1>{t('transitaire.titre')}</h1><Bandeau type="err">{t(`erreurs.${erreur}`, { defaultValue: t('erreurs.generique') })}</Bandeau></> : <Chargement />}</main>;
  }
  const e = d.expedition;
  const champ = (k: keyof typeof tr, lib: string, props: Record<string, unknown> = {}) => (
    <Champ label={lib}><input value={tr[k]} onChange={(ev) => setTr({ ...tr, [k]: ev.target.value })} {...props} /></Champ>);
  return (
    <main className="screen" style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {langues}
      <header>
        <div className="surtitre">{d.destinataire} · {t(`modes_exp.${e.mode}`)}</div>
        <h1>{e.reference} — {e.port_depart ?? '?'} → {e.port_arrivee ?? e.pays_destination}</h1>
        <p className="mute">{t(`statuts_exp.${e.statut}`)} · {t('transitaire.expire', { date: dateHeure(d.expire_le, langue, FUSEAU) })}</p>
      </header>
      <Bandeau type="err">{erreur ? t(`erreurs.${erreur}`, { defaultValue: t('erreurs.generique') }) : null}</Bandeau>
      <Bandeau type="ok">{message}</Bandeau>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="section-titre">{t('transitaire.transport')}</div>
        <div className="grille3">
          {champ('navire', t('transitaire.navire'), { maxLength: 120 })}
          {champ('numero_connaissement', t('expeditions.connaissement'), { maxLength: 60 })}
          {champ('etd', 'ETD', { type: 'date' })}
          {champ('eta', 'ETA', { type: 'date' })}
          {champ('date_mainlevee', t('transitaire.mainlevee'), { type: 'date' })}
        </div>
        {champ('conteneurs', t('transitaire.conteneurs'), { placeholder: 'MSCU1234567 TGHU7654321' })}
        {champ('plombs', t('transitaire.plombs'))}
        <Bouton disabled={envoi} onClick={majTransport}>{t('commun.enregistrer')}</Bouton>
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="section-titre">{t('expeditions.etapes')}</div>
        {d.etapes.length === 0 ? <Vide>{t('expeditions.aucune_etape')}</Vide> : (
          <table className="t"><tbody>{d.etapes.map((s, i) => (
            <tr key={i}><td>{t(`etapes.${s.etape}`)}{s.lieu ? ` · ${s.lieu}` : ''}{s.commentaire && <div className="mute">{s.commentaire}</div>}</td>
              <td className="ref">{dateHeure(s.survenue_le, langue, FUSEAU)}</td></tr>))}</tbody></table>
        )}
        <div className="grille3">
          <Champ label={t('expeditions.etape')}><select value={et.etape} onChange={(ev) => setEt({ ...et, etape: ev.target.value })}>
            {ETAPES.map((x) => <option key={x} value={x}>{t(`etapes.${x}`)}</option>)}</select></Champ>
          <Champ label={t('transitaire.lieu')}><input maxLength={120} value={et.lieu} onChange={(ev) => setEt({ ...et, lieu: ev.target.value })} /></Champ>
          <Champ label={t('transitaire.survenue_le')}><input type="datetime-local" value={et.survenue_le} onChange={(ev) => setEt({ ...et, survenue_le: ev.target.value })} /></Champ>
        </div>
        <Champ label={t('champs.commentaire')}><input maxLength={1000} value={et.commentaire} onChange={(ev) => setEt({ ...et, commentaire: ev.target.value })} /></Champ>
        <Bouton disabled={envoi} onClick={ajouterEtape}>{t('transitaire.ajouter_etape')}</Bouton>
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="section-titre">{t('transitaire.documents')}</div>
        {d.documents.length > 0 && <table className="t"><tbody>{d.documents.map((x, i) => (
          <tr key={i}><td>{t(`transitaire.types.${x.type}`)}{x.libelle && <div className="mute">{x.libelle}</div>}</td><td className="ref">{dateHeure(x.depose_le, langue, FUSEAU)}</td></tr>))}</tbody></table>}
        <div className="grille3">
          <Champ label={t('transitaire.type')}><select value={doc.type} onChange={(ev) => setDoc({ ...doc, type: ev.target.value })}>
            {TYPES.map((x) => <option key={x} value={x}>{t(`transitaire.types.${x}`)}</option>)}</select></Champ>
          <Champ label={t('dd_lien.libelle')}><input maxLength={200} value={doc.libelle} onChange={(ev) => setDoc({ ...doc, libelle: ev.target.value })} /></Champ>
        </div>
        <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" aria-label={t('dd_lien.fichier')} onChange={(ev) => setDoc({ ...doc, fichier: ev.target.files?.[0] ?? null })} />
        <p className="mute">{t('dd_lien.formats')}</p>
        <Bouton variante="primaire" disabled={envoi || !doc.fichier} onClick={deposer}>{t('dd_lien.envoyer')}</Bouton>
      </section>
    </main>
  );
}

interface EtapeT { id: string; etape: string; lieu: string | null; survenue_le: string; commentaire: string | null; source: string; visible_client: boolean }
interface DocT { id: string; type: string; libelle: string | null; chemin: string; depose_le: string }
interface LienT { id: string; destinataire: string; expire_le: string; revoque_le: string | null; consultations: number; derniere_consultation: string | null }

/** Panneau de l'équipe dans la fiche expédition : lien du transitaire, étapes à publier, documents. */
export function TransitaireExpedition({ expeditionId, transitaire, onChange }: { expeditionId: string; transitaire: string | null; onChange: () => void }) {
  const { t } = useTranslation();
  const { langue, fuseau } = useAuth();
  const liens = useAsync(async () => ok(await supabase.from('liens_transitaires').select('id, destinataire, expire_le, revoque_le, consultations, derniere_consultation')
    .eq('expedition_id', expeditionId).is('revoque_le', null)) as LienT[], [expeditionId]);
  const etapes = useAsync(async () => ok(await supabase.from('expedition_etapes').select('id, etape, lieu, survenue_le, commentaire, source, visible_client')
    .eq('expedition_id', expeditionId).eq('source', 'transitaire').order('survenue_le')) as EtapeT[], [expeditionId]);
  const docs = useAsync(async () => ok(await supabase.from('documents_transitaires').select('id, type, libelle, chemin, depose_le').eq('expedition_id', expeditionId).order('depose_le')) as DocT[], [expeditionId]);
  const a = useAction();
  const [dest, setDest] = useState(transitaire ?? '');
  const [url, setUrl] = useState<string | null>(null);
  const creer = async () => {
    const v = z.string().trim().min(2).max(200).safeParse(dest);
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    let r: { jeton: string } | null = null;
    if (await a.executer(async () => { r = ok(await supabase.rpc('creer_lien_transitaire', { p_expedition: expeditionId, p_destinataire: v.data })) as { jeton: string }; })) {
      setUrl(`${window.location.origin}/transitaire#${r!.jeton}`); void liens.recharger();
    }
  };
  const publier = async (x: EtapeT) => { if (await a.executer(async () => ok(await supabase.rpc('publier_etape_transitaire', { p_etape: x.id })))) { void etapes.recharger(); onChange(); } };
  const voir = async (x: DocT) => { const u = await urlSignee(x.chemin); if (u) window.open(u, '_blank', 'noopener,noreferrer'); };
  const l = (liens.data ?? [])[0];
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="section-titre">{t('transitaire.titre_equipe')}</div>
      <Bandeau type="err">{liens.erreur ?? a.erreur}</Bandeau>
      {url && <Bandeau type="ok">{t('dd_lien.lien_cree')}<div style={{ wordBreak: 'break-all' }}><code>{url}</code></div>
        <Bouton petit onClick={() => void navigator.clipboard?.writeText(url)}>{t('plis.copier')}</Bouton></Bandeau>}
      {l && <span className="mute">{t('transitaire.lien_actif', { d: l.destinataire, date: date(l.expire_le, langue), n: l.consultations })}</span>}
      <div className="actions">
        <input placeholder={t('transitaire.destinataire')} aria-label={t('transitaire.destinataire')} maxLength={200} value={dest} onChange={(ev) => setDest(ev.target.value)} />
        <Bouton petit disabled={a.enCours} onClick={() => void creer()}>{l ? t('plis.nouveau_lien') : t('plis.creer_lien')}</Bouton>
      </div>
      {(etapes.data ?? []).length > 0 && <table className="t"><tbody>{(etapes.data ?? []).map((x) => (
        <tr key={x.id}><td>{t(`etapes.${x.etape}`)}{x.lieu ? ` · ${x.lieu}` : ''}{x.commentaire && <div className="mute">{x.commentaire}</div>}</td>
          <td className="ref">{dateHeure(x.survenue_le, langue, fuseau)}</td>
          <td className="num">{x.visible_client ? <Statut statut="ok" libelle={t('transitaire.publiee')} />
            : <Bouton petit disabled={a.enCours} onClick={() => void publier(x)}>{t('transitaire.publier')}</Bouton>}</td></tr>))}</tbody></table>}
      {(docs.data ?? []).length > 0 && <table className="t"><tbody>{(docs.data ?? []).map((x) => (
        <tr key={x.id}><td>{t(`transitaire.types.${x.type}`)}{x.libelle && <div className="mute">{x.libelle}</div>}</td>
          <td className="ref">{dateHeure(x.depose_le, langue, fuseau)}</td>
          <td className="num"><Bouton petit onClick={() => void voir(x)}>{t('commun.voir')}</Bouton></td></tr>))}</tbody></table>}
      <p className="mute">{t('transitaire.aide_equipe')}</p>
    </section>
  );
}
