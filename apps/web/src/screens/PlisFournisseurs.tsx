// Lot 1, M17 niveau 1 et M5 : formulaire fournisseur par lien sécurisé (page publique, en mandarin
// par défaut) et, pour l'équipe achats, liens, questions et ouverture des plis après la date limite.
// Le jeton est placé après « # » : le navigateur ne l'envoie ni au serveur web ni dans le Referer.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { dateHeure, type Langue } from '../lib/format';
import { Bandeau, Bouton, Champ, Chargement, Statut, Vide } from '../components/ui';

const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CPT', 'CIF', 'CIP'] as const;
const CG = ['puissance_kw', 'heures_an', 'duree_vie_ans', 'entretien_heures_an', 'pieces_cout_an', 'pieces_disponibles_ans', 'delai_pieces_jours'] as const;

interface Formulaire {
  consultation: { reference: string; objet: string; specifications: string | null; quantite: number | null; incoterm_demande: string; lieu: string | null;
    date_limite: string; fuseau: string; ouverte: boolean };
  fournisseur: string;
  pli: { depose_le: string; empreinte: string; complet: boolean } | null;
  peut_deposer?: boolean;
  questions: { question: string; reponse: string | null; repondu_le: string | null; mienne: boolean }[];
}

/** Code d'erreur renvoyé par une fonction serveur (corps { erreur }), sans détail technique. */
async function codeFonction(e: unknown): Promise<string> {
  try {
    const c = (e as { context?: Response }).context;
    const j = c ? await c.json() as { erreur?: string } : null;
    return j?.erreur && /^GBS_[A-Z_]+$/.test(j.erreur) ? j.erreur : 'GBS_ERREUR';
  } catch { return 'GBS_ERREUR'; }
}

/** Code GBS_* d'une erreur (fonction serveur ou base), sinon générique. */
const codeErreur = (e: unknown) => (String((e as Error)?.message ?? '').match(/GBS_[A-Z_]+/)?.[0] ?? 'GBS_ERREUR');

const nombre = (s: string) => (s.trim() === '' ? undefined : Number(s.replace(/\s/g, '').replace(',', '.')));

/** Page publique du fournisseur (lien par jeton) ou, avec `consultation`, la même réponse depuis le compte
 * fournisseur : lecture et questions par la base, dépôt chiffré par la fonction serveur. */
export function PageFournisseur({ consultation, onRetour }: { consultation?: string; onRetour?: () => void } = {}) {
  const { t, i18n } = useTranslation();
  const compte = !!consultation;
  const jeton = compte ? '' : window.location.hash.replace(/^#/, '');
  const [d, setD] = useState<Formulaire | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({ incoterm: 'FOB', devise: 'USD', lieu: '', montant: '', fret: '', assurance: '', frais_jusqu_a_bord: '',
    delai_jours: '', garantie_mois: '', conditions_paiement: '', commentaire: '', sav_afrique: '', ...Object.fromEntries(CG.map((k) => [k, ''])) });
  const [question, setQuestion] = useState('');

  const appeler = async (body: Record<string, unknown>) => {
    if (compte) {
      if (body.action === 'lire') return ok(await supabase.rpc('formulaire_fournisseur_compte', { p_consultation: consultation }));
      if (body.action === 'question') return ok(await supabase.rpc('poser_question_compte', { p_consultation: consultation, p_question: body.question }));
      const r = await supabase.functions.invoke('gbs-fournisseur', { body: { action: 'repondre_compte', consultation, offre: body.offre } });
      if (r.error) throw new Error(await codeFonction(r.error));
      return r.data;
    }
    const r = await supabase.functions.invoke('gbs-fournisseur', { body: { jeton, ...body } });
    if (r.error) throw new Error(await codeFonction(r.error));
    return r.data;
  };
  const charger = async () => {
    try { setD(await appeler({ action: 'lire' }) as Formulaire); setErreur(null); } catch (e) { setErreur(codeErreur(e)); }
  };
  useEffect(() => {
    if (compte) { void charger(); return; }
    if (!['zh', 'en', 'fr'].includes(i18n.language) || i18n.language === 'fr') void i18n.changeLanguage('zh');
    if (!/^[A-Za-z0-9_-]{43}$/.test(jeton)) { setErreur('GBS_LIEN_INVALIDE'); return; }
    void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jeton, consultation]);

  const deposer = async () => {
    setMessage(null);
    const cg: Record<string, number | string> = {};
    for (const k of CG) { const v = nombre(f[k]); if (v !== undefined) cg[k] = v; }
    if (f.sav_afrique.trim()) cg.sav_afrique = f.sav_afrique.trim();
    const offre = { incoterm: f.incoterm, lieu: f.lieu.trim(), devise: f.devise, montant: nombre(f.montant), fret: nombre(f.fret), assurance: nombre(f.assurance),
      frais_jusqu_a_bord: nombre(f.frais_jusqu_a_bord), delai_jours: nombre(f.delai_jours), garantie_mois: nombre(f.garantie_mois),
      conditions_paiement: f.conditions_paiement.trim() || undefined, commentaire: f.commentaire.trim() || undefined, cout_global: cg };
    const v = z.object({ incoterm: z.enum(INCOTERMS), lieu: z.string().min(2).max(120), devise: z.enum(['USD', 'CNY']), montant: z.number().positive().max(1e12),
      fret: z.number().min(0).optional(), assurance: z.number().min(0).optional(), frais_jusqu_a_bord: z.number().min(0).optional(),
      delai_jours: z.number().int().min(0).max(730), garantie_mois: z.number().int().min(0).max(240), conditions_paiement: z.string().max(200).optional(),
      commentaire: z.string().max(2000).optional(), cout_global: z.record(z.union([z.number(), z.string()])) }).strict().safeParse(offre);
    if (!v.success) { setErreur('GBS_OFFRE_INVALIDE'); return; }
    setEnvoi(true);
    try { await appeler({ action: 'repondre', offre: JSON.parse(JSON.stringify(v.data)) }); setErreur(null); setMessage(t('plis.depose_ok')); await charger(); }
    catch (e) { setErreur(codeErreur(e)); } finally { setEnvoi(false); }
  };
  const poser = async () => {
    if (question.trim().length < 5) return;
    try { await appeler({ action: 'question', question: question.trim() }); setQuestion(''); setMessage(t('plis.question_ok')); await charger(); }
    catch (e) { setErreur(codeErreur(e)); }
  };

  const langues = compte ? (onRetour ? <div><Bouton petit onClick={onRetour}>{t('portail_f.retour_cotations')}</Bouton></div> : null) : (
    <div className="actions" style={{ justifyContent: 'flex-end' }}>
      {(['zh', 'en', 'fr'] as const).map((l) => <Bouton key={l} petit variante={i18n.language === l ? 'primaire' : undefined} onClick={() => void i18n.changeLanguage(l)}>{l.toUpperCase()}</Bouton>)}
    </div>
  );
  if (!d) {
    return <main className={compte ? '' : 'screen'} style={{ maxWidth: 760, margin: '0 auto' }}>{langues}
      {erreur ? <><h1>{t('plis.titre')}</h1><Bandeau type="err">{t(`erreurs.${erreur}`, { defaultValue: t('erreurs.generique') })}</Bandeau></> : <Chargement />}</main>;
  }
  const c = d.consultation;
  const champ = (k: string, lib: string, props: Record<string, unknown> = {}) => (
    <Champ label={lib}><input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} /></Champ>);
  return (
    <main className={compte ? '' : 'screen'} style={{ maxWidth: 860, margin: compte ? undefined : '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {langues}
      <header>
        <div className="surtitre">{c.reference} · {d.fournisseur}</div>
        <h1>{c.objet}</h1>
        <p>{t('plis.date_limite')} : <strong>{dateHeure(c.date_limite, i18n.language as Langue, c.fuseau)}</strong> ({c.fuseau})</p>
      </header>
      <Bandeau type="err">{erreur ? t(`erreurs.${erreur}`, { defaultValue: t('erreurs.generique') }) : null}</Bandeau>
      <Bandeau type="ok">{message}</Bandeau>
      <section>
        <div className="section-titre">{t('plis.demande')}</div>
        <dl className="dl">
          <dt>{t('champs.quantite')}</dt><dd>{c.quantite ?? '—'}</dd>
          <dt>{t('champs.incoterm')}</dt><dd>{c.incoterm_demande}{c.lieu ? ` · ${c.lieu}` : ''}</dd>
        </dl>
        {c.specifications && <p style={{ whiteSpace: 'pre-wrap' }}>{c.specifications}</p>}
      </section>
      <Bandeau>{t('plis.confidentialite')}</Bandeau>
      {d.pli && (
        <section>
          <div className="section-titre">{t('plis.accuse')}</div>
          <p>{t('plis.depose_le', { date: dateHeure(d.pli.depose_le, i18n.language as Langue, c.fuseau) })}
            {' '}<Statut statut={d.pli.complet ? 'ok' : 'att'} libelle={d.pli.complet ? t('plis.complet') : t('plis.incomplet')} /></p>
          <p className="mute" style={{ wordBreak: 'break-all' }}>{t('plis.empreinte')} : {d.pli.empreinte}</p>
        </section>
      )}
      {c.ouverte && d.peut_deposer === false ? <Bandeau>{t('portail_f.depot_commercial')}</Bandeau> : c.ouverte ? (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="section-titre">{d.pli ? t('plis.remplacer') : t('plis.offre')}</div>
          <div className="grille3">
            <Champ label={t('champs.incoterm')}><select value={f.incoterm} onChange={(e) => setF({ ...f, incoterm: e.target.value })}>{INCOTERMS.map((x) => <option key={x}>{x}</option>)}</select></Champ>
            {champ('lieu', t('plis.lieu'), { maxLength: 120 })}
            <Champ label={t('champs.devise')}><select value={f.devise} onChange={(e) => setF({ ...f, devise: e.target.value })}>{['USD', 'CNY'].map((x) => <option key={x}>{x}</option>)}</select></Champ>
            {champ('montant', t('plis.montant'), { inputMode: 'decimal' })}
            {champ('fret', t('plis.fret'), { inputMode: 'decimal' })}
            {champ('assurance', t('plis.assurance'), { inputMode: 'decimal' })}
            {champ('frais_jusqu_a_bord', t('plis.frais_bord'), { inputMode: 'decimal' })}
            {champ('delai_jours', t('plis.delai'), { inputMode: 'numeric' })}
            {champ('garantie_mois', t('plis.garantie'), { inputMode: 'numeric' })}
          </div>
          {champ('conditions_paiement', t('plis.conditions'), { maxLength: 200 })}
          <div className="section-titre">{t('plis.cout_global')}</div>
          <p className="mute">{t('plis.aide_cout_global')}</p>
          <div className="grille3">
            {CG.map((k) => <span key={k}>{champ(k, t(`plis.cg.${k}`), { inputMode: 'decimal' })}</span>)}
            {champ('sav_afrique', t('plis.cg.sav_afrique'), { maxLength: 200 })}
          </div>
          <Champ label={t('plis.commentaire')}><textarea maxLength={2000} value={f.commentaire} onChange={(e) => setF({ ...f, commentaire: e.target.value })} /></Champ>
          <Bouton variante="primaire" disabled={envoi} onClick={() => void deposer()}>{t('plis.deposer')}</Bouton>
        </section>
      ) : <Bandeau>{t('plis.close')}</Bandeau>}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="section-titre">{t('plis.questions')}</div>
        <p className="mute">{t('plis.aide_questions')}</p>
        {d.questions.length === 0 ? <Vide>{t('plis.aucune_question')}</Vide> : d.questions.map((q, i) => (
          <div key={i} className="carte" style={{ padding: 10 }}><strong>{q.question}</strong>
            <div className={q.reponse ? '' : 'mute'}>{q.reponse ?? t('plis.en_attente')}</div></div>))}
        {c.ouverte && <>
          <textarea aria-label={t('plis.votre_question')} placeholder={t('plis.votre_question')} maxLength={2000} value={question} onChange={(e) => setQuestion(e.target.value)} />
          <Bouton petit onClick={() => void poser()}>{t('plis.envoyer_question')}</Bouton>
        </>}
      </section>
    </main>
  );
}

interface Lien { id: string; fournisseur_id: string; expire_le: string; revoque_le: string | null; consultations: number; derniere_consultation: string | null }
interface Pli { id: string; fournisseur_id: string; depose_le: string; complet: boolean; statut: string }
interface Question { id: string; question: string; posee_le: string; reponse: string | null; fournisseur_id: string }

/** Panneau de l'équipe achats dans la consultation : liens, plis déposés, questions, ouverture. */
export function PlisConsultation({ consultationId, dateLimite, invites, noms, onOuvert }:
  { consultationId: string; dateLimite: string; invites: string[]; noms: Record<string, string>; onOuvert: () => void }) {
  const { t } = useTranslation();
  const { langue, fuseau } = useAuth();
  const liens = useAsync(async () => ok(await supabase.from('liens_fournisseurs').select('id, fournisseur_id, expire_le, revoque_le, consultations, derniere_consultation')
    .eq('consultation_id', consultationId).is('revoque_le', null)) as Lien[], [consultationId]);
  const plis = useAsync(async () => ok(await supabase.from('plis').select('id, fournisseur_id, depose_le, complet, statut').eq('consultation_id', consultationId).neq('statut', 'remplace')) as Pli[], [consultationId]);
  const qs = useAsync(async () => ok(await supabase.from('questions_consultation').select('*').eq('consultation_id', consultationId).order('posee_le')) as Question[], [consultationId]);
  const a = useAction();
  const [nouveau, setNouveau] = useState<{ fournisseur: string; url: string } | null>(null);
  const [reponses, setReponses] = useState<Record<string, string>>({});
  const avantLimite = new Date(dateLimite).getTime() > Date.now();
  const creer = async (f: string) => {
    let r: { jeton: string } | null = null;
    if (await a.executer(async () => { r = ok(await supabase.rpc('creer_lien_fournisseur', { p_consultation: consultationId, p_fournisseur: f })) as { jeton: string }; })) {
      setNouveau({ fournisseur: f, url: `${window.location.origin}/fournisseur#${r!.jeton}` }); void liens.recharger();
    }
  };
  const repondre = async (q: Question) => {
    const v = z.string().trim().min(2).max(4000).safeParse(reponses[q.id] ?? '');
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('repondre_question_consultation', { p_question: q.id, p_reponse: v.data })))) void qs.recharger();
  };
  const ouvrir = async () => {
    if (await a.executer(async () => {
      const r = await supabase.functions.invoke('gbs-fournisseur', { body: { action: 'ouvrir', consultation: consultationId } });
      if (r.error) throw new Error(await codeFonction(r.error));
    })) { void plis.recharger(); onOuvert(); }
  };
  const deposes = (plis.data ?? []).filter((p) => p.statut === 'depose');
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="section-titre">{t('plis.titre_equipe')}</div>
      <Bandeau type="err">{liens.erreur ?? plis.erreur ?? a.erreur}</Bandeau>
      {nouveau && <Bandeau type="ok">{t('plis.lien_cree', { f: noms[nouveau.fournisseur] ?? '' })}<div style={{ wordBreak: 'break-all' }}><code>{nouveau.url}</code></div>
        <Bouton petit onClick={() => void navigator.clipboard?.writeText(nouveau.url)}>{t('plis.copier')}</Bouton></Bandeau>}
      {invites.length === 0 ? <span className="mute">{t('rfq.aucun_invite')}</span> : (
        <table className="t"><tbody>{invites.map((f) => {
          const l = (liens.data ?? []).find((x) => x.fournisseur_id === f);
          const p = (plis.data ?? []).find((x) => x.fournisseur_id === f);
          return (
            <tr key={f}><td>{noms[f] ?? ''}{l && <div className="mute">{t('plis.consulte', { n: l.consultations })}</div>}</td>
              <td>{p ? <Statut statut={p.statut === 'ouvert' ? 'ok' : 'info'} libelle={`${t(`plis.statuts.${p.statut}`)} · ${dateHeure(p.depose_le, langue, fuseau)}${p.complet ? '' : ` · ${t('plis.incomplet')}`}`} />
                : <span className="mute">{t('plis.aucun_pli')}</span>}</td>
              <td className="num">{avantLimite && <Bouton petit disabled={a.enCours} onClick={() => void creer(f)}>{l ? t('plis.nouveau_lien') : t('plis.creer_lien')}</Bouton>}</td></tr>);
        })}</tbody></table>
      )}
      <p className="mute">{avantLimite ? t('plis.aide_equipe') : t('plis.aide_ouverture')}</p>
      {!avantLimite && deposes.length > 0 && <Bouton variante="primaire" disabled={a.enCours} onClick={() => void ouvrir()}>{t('plis.ouvrir', { n: deposes.length })}</Bouton>}
      {(qs.data ?? []).length > 0 && <>
        <div className="section-titre">{t('plis.questions')}</div>
        {(qs.data ?? []).map((q) => (
          <div key={q.id} className="carte" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <strong>{q.question}</strong><span className="mute">{noms[q.fournisseur_id] ?? ''} · {dateHeure(q.posee_le, langue, fuseau)}</span>
            {q.reponse ? <div>{q.reponse}</div> : <>
              <textarea aria-label={t('plis.reponse')} maxLength={4000} value={reponses[q.id] ?? ''} onChange={(e) => setReponses({ ...reponses, [q.id]: e.target.value })} />
              <Bouton petit onClick={() => void repondre(q)}>{t('plis.publier_reponse')}</Bouton></>}
          </div>))}
        <p className="mute">{t('plis.aide_reponses')}</p>
      </>}
    </section>
  );
}
