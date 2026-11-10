// Guide d'expression du besoin (maquette « BES », cahier des charges M31), onglet de la fiche dossier.
// Le questionnaire, la complétude, les champs critiques et les incohérences viennent de la base
// (gbs.etat_besoin) ; chaque réponse y est validée champ par champ avant écriture.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import i18n from '../i18n';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, dateHeure, type Langue } from '../lib/format';
import { useNoms } from '../lib/referentiels';
import { Bandeau, Bouton, Champ, Chargement, Jauge, Statut, Vide } from '../components/ui';
import { Depot } from '../components/Depot';
import type { Dossier } from '../lib/types';
import { BarreImpression } from './Imprimes';

type TypeChamp = 'texte' | 'texte_long' | 'nombre' | 'choix' | 'choix_multiple' | 'oui_non' | 'date';
type Valeur = string | number | boolean | string[];
interface ChampDef { cle: string; libelle: string; libelle_zh?: string; type: TypeChamp; options?: string[]; critique?: boolean; aide?: string; exemple?: string; unite?: string; min?: number; max?: number }
interface EtapeDef { code: string; libelle: string; libelle_zh?: string; aide?: string; champs: ChampDef[] }
interface Alerte { champ: string; code: 'tension_pays' | 'frequence_pays' | 'prises_pays' | 'pays_inconnu'; pays: string; attendu?: number[] | number | string[]; confirme?: boolean }
interface Etat { completude: number; etapes: { code: string; total: number; remplis: number }[]; critiques_manquants: string[]; alertes: Alerte[]; etapes_definition: EtapeDef[] }
interface Besoin { id: string; categorie: string; statut: 'brouillon' | 'soumis' | 'valide'; version: number; reponses: Record<string, Valeur>; soumis_le: string | null; valide_le: string | null; document_signe: string | null; signe_le: string | null }
interface Question { id: string; champ: string; question: string; auteur_id: string; cree_le: string; reponse: string | null; repondu_le: string | null }

const REDACTEURS = ['admin', 'hub_afrique', 'agent_pays'];
const VALIDEURS = ['admin', 'hub_afrique'];

export function BesoinDossier({ dossier }: { dossier: Dossier }) {
  const { t } = useTranslation();
  const { profil } = useAuth();
  const role = profil?.role ?? '';
  const l = useAsync(async () => ok(await supabase.from('besoins').select('id, categorie, statut, version, reponses, soumis_le, valide_le, document_signe, signe_le')
    .eq('dossier_id', dossier.id).order('cree_le')) as Besoin[], [dossier.id]);
  const cats = useAsync(async () => ok(await supabase.from('questionnaires_besoin').select('categorie, libelle').eq('statut', 'actif').order('libelle')) as
    { categorie: string; libelle: string }[], []);
  const [sel, setSel] = useState<string | null>(null);
  const [categorie, setCategorie] = useState('');
  const a = useAction();
  const besoins = l.data ?? [];
  const b = besoins.find((x) => x.id === sel) ?? besoins[0] ?? null;
  const actives = cats.data ?? [];
  const tronc = actives.some((c) => c.categorie === 'tronc_commun');
  const libelleCat = (c: string) => actives.find((x) => x.categorie === c)?.libelle ?? c;
  const creer = async () => {
    const v = z.object({ p_dossier: z.string().uuid(), p_categorie: z.string().regex(/^[a-z0-9_]{2,40}$/) }).strict().safeParse({ p_dossier: dossier.id, p_categorie: categorie });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    let id: string | null = null;
    if (await a.executer(async () => { id = ok(await supabase.rpc('creer_besoin', v.data)) as string; })) { setSel(id); setCategorie(''); void l.recharger(); }
  };
  const peutCreer = REDACTEURS.includes(role) && dossier.statut === 'ouvert';
  const restantes = actives.filter((c) => !besoins.some((x) => x.categorie === c.categorie));
  return (
    <section>
      <Bandeau type="err">{l.erreur ?? cats.erreur ?? a.erreur}</Bandeau>
      {l.chargement && !l.data ? <Chargement /> : (<>
        {besoins.length > 1 && (
          <div className="segment portee-taches" role="group" aria-label={t('besoin.categorie')}>
            {besoins.map((x) => <button key={x.id} type="button" aria-pressed={b?.id === x.id} onClick={() => setSel(x.id)}>{libelleCat(x.categorie)}</button>)}
          </div>)}
        {besoins.length === 0 && <Vide>{tronc ? t('besoin.aucun') : t('besoin.questionnaire_inactif')}</Vide>}
        {peutCreer && tronc && restantes.length > 0 && (
          <div className="besoin-creer">
            <Champ label={t('besoin.categorie')}>
              <select value={categorie} onChange={(e) => setCategorie(e.target.value)}>
                <option value="">{t('besoin.choisir_categorie')}</option>
                {restantes.map((c) => <option key={c.categorie} value={c.categorie}>{c.categorie === 'tronc_commun' ? t('besoin.tronc_seul') : c.libelle}</option>)}
              </select>
            </Champ>
            <Bouton variante="primaire" disabled={a.enCours || !categorie} onClick={() => void creer()}>{t('besoin.commencer')}</Bouton>
          </div>)}
        {b && <Guide key={b.id} besoin={b} dossier={dossier} libelleCategorie={libelleCat(b.categorie)} onChange={() => void l.recharger()} />}
      </>)}
    </section>
  );
}

function Guide({ besoin, dossier, libelleCategorie, onChange }: { besoin: Besoin; dossier: Dossier; libelleCategorie: string; onChange: () => void }) {
  const { t } = useTranslation();
  const { profil, langue, fuseau } = useAuth();
  const role = profil?.role ?? '';
  const profils = useNoms('profils');
  const etat = useAsync(async () => ok(await supabase.rpc('etat_besoin', { p_besoin: besoin.id })) as Etat, [besoin.id, besoin.version, besoin.statut]);
  const questions = useAsync(async () => ok(await supabase.from('besoins_questions').select('id, champ, question, auteur_id, cree_le, reponse, repondu_le')
    .eq('besoin_id', besoin.id).order('cree_le')) as Question[], [besoin.id]);
  const versions = useAsync(async () => ok(await supabase.from('besoins_versions').select('version, cree_le').eq('besoin_id', besoin.id).order('version', { ascending: false })) as
    { version: number; cree_le: string }[], [besoin.id, besoin.version]);
  const [etape, setEtape] = useState(0);
  const [brouillon, setBrouillon] = useState<Record<string, Valeur | null>>({});
  const [reponses, setReponses] = useState<Record<string, Valeur>>(besoin.reponses ?? {});
  const [doc, setDoc] = useState<string | null>(null);
  const [signeLe, setSigneLe] = useState('');
  const a = useAction();
  const e = etat.data;
  const defs = e?.etapes_definition ?? [];
  const et = defs[Math.min(etape, defs.length - 1)];
  const redacteur = REDACTEURS.includes(role) && besoin.statut !== 'valide';
  const valeur = (c: ChampDef) => (c.cle in brouillon ? brouillon[c.cle] : reponses[c.cle]) ?? null;
  const modifie = Object.keys(brouillon).length > 0;
  const lib = (x: { libelle: string; libelle_zh?: string }) => (langue === 'zh' && x.libelle_zh ? x.libelle_zh : x.libelle);
  const enregistrer = async () => {
    if (!modifie) return true;
    let r: Etat | null = null;
    const okEnr = await a.executer(async () => { r = ok(await supabase.rpc('enregistrer_besoin', { p_besoin: besoin.id, p_reponses: brouillon })) as Etat; });
    if (okEnr) {
      const n = { ...reponses };
      for (const [k, v] of Object.entries(brouillon)) { if (v === null) delete n[k]; else n[k] = typeof v === 'string' ? v.trim() : v; }
      setReponses(n); setBrouillon({});
      if (r) void etat.recharger();
      if (besoin.statut === 'soumis') onChange();
    }
    return okEnr;
  };
  const aller = async (i: number) => { if (await enregistrer()) setEtape(i); };
  const soumettre = async () => { if (await enregistrer() && await a.executer(async () => ok(await supabase.rpc('soumettre_besoin', { p_besoin: besoin.id })))) onChange(); };
  const valider = async () => {
    const v = z.object({ p_besoin: z.string().uuid(), p_document: z.string().min(3).max(400), p_signe_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict()
      .safeParse({ p_besoin: besoin.id, p_document: doc, p_signe_le: signeLe });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('valider_besoin', v.data)))) onChange();
  };
  const pctEtape = (code: string) => { const s = e?.etapes.find((x) => x.code === code); return s && s.total ? Math.round((100 * s.remplis) / s.total) : 0; };
  const libChamp = (cle: string) => { for (const x of defs) { const c = x.champs.find((y) => y.cle === cle); if (c) return lib(c); } return cle; };
  const ouvertes = (questions.data ?? []).filter((q) => !q.reponse).length;
  if (etat.chargement && !e) return <Chargement />;
  if (!e || !et) return <Bandeau type="err">{etat.erreur}</Bandeau>;
  return (
    <div className="besoin-grille">
      <nav className="besoin-etapes" aria-label={t('besoin.etapes')}>
        {defs.map((x, i) => {
          const pc = pctEtape(x.code);
          return (
            <button key={x.code} type="button" className={'besoin-etape' + (i === etape ? ' choisi' : '')} aria-current={i === etape ? 'step' : undefined}
              disabled={a.enCours} onClick={() => void aller(i)}>
              <span className="ref">{String(i + 1).padStart(2, '0')}</span>
              <span className="besoin-etape-lib">{lib(x)}</span>
              <Statut statut={pc === 100 ? 'ok' : pc ? 'info' : 'neutre'} libelle={pc === 100 ? t('besoin.complet') : pc ? `${pc} %` : t('besoin.a_faire')} />
            </button>);
        })}
      </nav>
      <div className="besoin-champs">
        <div className="surtitre">{String(etape + 1).padStart(2, '0')} · {lib(et)}</div>
        {et.aide && <p className="sec">{et.aide}</p>}
        {et.champs.map((c) => {
          const al = e.alertes.filter((x) => x.champ === c.cle);
          const qs = (questions.data ?? []).filter((q) => q.champ === c.cle);
          return (
            <div key={c.cle} className="besoin-champ">
              <Champ label={lib(c) + (c.critique ? ' *' : '') + (c.unite ? ` (${c.unite})` : '')}>
                <Editeur c={c} v={valeur(c)} lectureSeule={!redacteur} onChange={(v) => setBrouillon({ ...brouillon, [c.cle]: v })} />
              </Champ>
              {al.map((x) => <Bandeau key={x.code} type="err">{t(`besoin.alertes.${x.code}`, { pays: x.pays, attendu: Array.isArray(x.attendu) ? x.attendu.join(', ') : String(x.attendu ?? '') })}
                {x.confirme === false && ` ${t('besoin.reseau_a_confirmer')}`}</Bandeau>)}
              {c.aide && <span className="mute">{c.aide}</span>}
              {c.exemple && <span className="mute">{t('besoin.exemple', { exemple: c.exemple })}</span>}
              {qs.map((q) => <QuestionChamp key={q.id} q={q} auteur={profils[q.auteur_id] ?? '—'} peutRepondre={redacteur} onDone={() => void questions.recharger()} />)}
              {besoin.statut !== 'valide' && ['admin', 'hub_afrique', 'agent_pays', 'achats_chine'].includes(role) &&
                <PoserQuestion besoinId={besoin.id} champ={c.cle} onDone={() => void questions.recharger()} />}
            </div>);
        })}
        <Bandeau type="err">{a.erreur ?? questions.erreur}</Bandeau>
        <div className="besoin-actions">
          {etape > 0 && <Bouton disabled={a.enCours} onClick={() => void aller(etape - 1)}>{t('besoin.precedente')}</Bouton>}
          {redacteur && modifie && <Bouton disabled={a.enCours} onClick={() => void enregistrer()}>{t('besoin.enregistrer')}</Bouton>}
          {etape < defs.length - 1 && <Bouton variante="primaire" disabled={a.enCours} onClick={() => void aller(etape + 1)}>{t('besoin.suivante')}</Bouton>}
        </div>
      </div>
      <aside className="besoin-aside">
        <span className="surtitre">{t('besoin.completude')} · {libelleCategorie}</span>
        <b className="besoin-pct">{e.completude} %</b>
        <Jauge valeur={e.completude} />
        {e.critiques_manquants.length > 0
          ? <span className="sec">{t('besoin.critiques_manquants', { liste: e.critiques_manquants.map(libChamp).join(', ') })}</span>
          : <span className="sec">{t('besoin.critiques_ok')}</span>}
        {e.alertes.length > 0 && <span className="txt-err">{t('besoin.n_alertes', { n: e.alertes.length })}</span>}
        <dl className="dl">
          <dt>{t('besoin.statut')}</dt><dd><Statut statut={besoin.statut === 'valide' ? 'ok' : besoin.statut === 'soumis' ? 'att' : 'neutre'} libelle={t(`besoin.statuts.${besoin.statut}`)} /></dd>
          <dt>{t('besoin.questions_ouvertes')}</dt><dd>{ouvertes}</dd>
          <dt>{t('besoin.versions')}</dt><dd>{(versions.data ?? []).length === 0 ? '—' : (versions.data ?? []).map((v) => `v${v.version} · ${dateHeure(v.cree_le, langue, fuseau)}`).join(' ; ')}</dd>
          {besoin.statut === 'valide' && <><dt>{t('besoin.signe_le')}</dt><dd>{besoin.signe_le ? date(besoin.signe_le, langue) : '—'}</dd></>}
        </dl>
        {redacteur && besoin.statut === 'brouillon' && (
          <Bouton variante="primaire" disabled={a.enCours || e.critiques_manquants.length > 0} onClick={() => void soumettre()}>{t('besoin.soumettre')}</Bouton>)}
        {besoin.statut === 'soumis' && VALIDEURS.includes(role) && (<div className="besoin-valider">
          <span className="sec">{t('besoin.aide_validation')}</span>
          <Champ label={t('besoin.cdc_signe')}><Depot dossierId={dossier.id} valeur={doc} onChange={setDoc} /></Champ>
          <Champ label={t('besoin.signe_le')}><input type="date" value={signeLe} max={new Date().toISOString().slice(0, 10)} onChange={(x) => setSigneLe(x.target.value)} /></Champ>
          <Bouton variante="primaire" disabled={a.enCours || !doc || !signeLe || ouvertes > 0} onClick={() => void valider()}>{t('besoin.valider')}</Bouton>
          {ouvertes > 0 && <span className="mute">{t('besoin.questions_a_clore')}</span>}
        </div>)}
        <a className="btn" href={`/imprimer/cahier-des-charges/${besoin.id}${besoin.version ? `?version=${besoin.version}` : ''}`} target="_blank" rel="noopener noreferrer">{t('besoin.imprimer_cdc')}</a>
        <p className="mute">{t('besoin.note_reference')}</p>
      </aside>
    </div>
  );
}

function Editeur({ c, v, lectureSeule, onChange }: { c: ChampDef; v: Valeur | null; lectureSeule: boolean; onChange: (v: Valeur | null) => void }) {
  const { t } = useTranslation();
  switch (c.type) {
    case 'texte_long':
      return <textarea value={typeof v === 'string' ? v : ''} maxLength={4000} disabled={lectureSeule} onChange={(e) => onChange(e.target.value.trim() ? e.target.value : null)} />;
    case 'nombre':
      return <input type="number" value={typeof v === 'number' ? v : ''} min={c.min} max={c.max} disabled={lectureSeule}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
    case 'date':
      return <input type="date" value={typeof v === 'string' ? v : ''} disabled={lectureSeule} onChange={(e) => onChange(e.target.value || null)} />;
    case 'oui_non':
      return (
        <div className="segment portee-taches" role="group">
          {[true, false].map((o) => <button key={String(o)} type="button" aria-pressed={v === o} disabled={lectureSeule} onClick={() => onChange(v === o ? null : o)}>{t(o ? 'besoin.oui' : 'besoin.non')}</button>)}
        </div>);
    case 'choix':
      return (
        <div className="segment portee-taches" role="group">
          {(c.options ?? []).map((o) => <button key={o} type="button" aria-pressed={v === o} disabled={lectureSeule} onClick={() => onChange(v === o ? null : o)}>{o}</button>)}
        </div>);
    case 'choix_multiple': {
      const sel = Array.isArray(v) ? v : [];
      return (
        <div className="segment portee-taches" role="group">
          {(c.options ?? []).map((o) => <button key={o} type="button" aria-pressed={sel.includes(o)} disabled={lectureSeule}
            onClick={() => { const n = sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o]; onChange(n.length ? n : null); }}>{o}</button>)}
        </div>);
    }
    default:
      return <input value={typeof v === 'string' ? v : ''} maxLength={500} disabled={lectureSeule} onChange={(e) => onChange(e.target.value.trim() ? e.target.value : null)} />;
  }
}

function QuestionChamp({ q, auteur, peutRepondre, onDone }: { q: Question; auteur: string; peutRepondre: boolean; onDone: () => void }) {
  const { t } = useTranslation();
  const { langue, fuseau } = useAuth();
  const a = useAction();
  const [rep, setRep] = useState('');
  const repondre = async () => {
    const v = z.object({ p_question: z.string().uuid(), p_reponse: z.string().trim().min(1).max(2000) }).strict().safeParse({ p_question: q.id, p_reponse: rep });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('repondre_question_besoin', v.data)))) onDone();
  };
  return (
    <div className="besoin-question">
      <span className="mute">{t('besoin.question_equipe')} · {auteur} · {dateHeure(q.cree_le, langue, fuseau)}</span>
      <span>{q.question}</span>
      {q.reponse ? <span className="besoin-reponse">{q.reponse}</span> : peutRepondre && (<>
        <textarea value={rep} maxLength={2000} placeholder={t('besoin.votre_reponse')} onChange={(e) => setRep(e.target.value)} />
        <Bandeau type="err">{a.erreur}</Bandeau>
        <Bouton petit disabled={a.enCours || !rep.trim()} onClick={() => void repondre()}>{t('besoin.repondre')}</Bouton>
      </>)}
    </div>
  );
}

function PoserQuestion({ besoinId, champ, onDone }: { besoinId: string; champ: string; onDone: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [ouvert, setOuvert] = useState(false);
  const [q, setQ] = useState('');
  const poser = async () => {
    const v = z.object({ p_besoin: z.string().uuid(), p_champ: z.string().regex(/^[a-z0-9_]{2,40}$/), p_question: z.string().trim().min(3).max(1000) }).strict()
      .safeParse({ p_besoin: besoinId, p_champ: champ, p_question: q });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('poser_question_besoin', v.data)))) { setQ(''); setOuvert(false); onDone(); }
  };
  if (!ouvert) return <button type="button" className="lien" onClick={() => setOuvert(true)}>{t('besoin.poser_question')}</button>;
  return (
    <div className="besoin-question">
      <textarea value={q} maxLength={1000} onChange={(e) => setQ(e.target.value)} />
      <Bandeau type="err">{a.erreur}</Bandeau>
      <div className="besoin-actions">
        <Bouton petit onClick={() => setOuvert(false)}>{t('banque.annuler')}</Bouton>
        <Bouton petit variante="primaire" disabled={a.enCours || q.trim().length < 3} onClick={() => void poser()}>{t('besoin.envoyer_question')}</Bouton>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- cahier des charges imprimable
/** Cahier des charges du client, généré depuis le besoin (version soumise ?version=N, sinon réponses en cours).
 *  En mandarin, les libellés viennent du référentiel ; les réponses libres restent dans leur langue d'origine. */
export function ImprimerBesoin() {
  const { id = '' } = useParams();
  const qs = new URLSearchParams(window.location.search);
  const lg: Langue = qs.get('langue') === 'zh' ? 'zh' : 'fr';
  const version = Number(qs.get('version')) || null;
  const t = i18n.getFixedT(lg);
  const b = useAsync(async () => ok(await supabase.from('besoins').select('id, dossier_id, categorie, statut, version, reponses, pays, soumis_le, signe_le')
    .eq('id', id).maybeSingle()) as (Besoin & { dossier_id: string; pays: string | null }) | null, [id]);
  const v = useAsync(async () => (version ? ok(await supabase.from('besoins_versions').select('version, reponses, etat, cree_le').eq('besoin_id', id).eq('version', version).maybeSingle()) as
    { version: number; reponses: Record<string, Valeur>; etat: Omit<Etat, 'etapes_definition'>; cree_le: string } | null : null), [id, version]);
  const e = useAsync(async () => ok(await supabase.rpc('etat_besoin', { p_besoin: id })) as Etat, [id]);
  const d = useAsync(async () => (b.data ? ok(await supabase.from('dossiers').select('reference, intitule, client_id').eq('id', b.data.dossier_id).maybeSingle()) as
    { reference: string; intitule: string; client_id: string } | null : null), [b.data?.dossier_id]);
  const clients = useNoms('clients');
  const cats = useAsync(async () => ok(await supabase.from('questionnaires_besoin').select('categorie, libelle').eq('statut', 'actif')) as { categorie: string; libelle: string }[], []);
  if (b.chargement || e.chargement || v.chargement) return <Chargement />;
  if (!b.data || !e.data || (version && !v.data)) return <Vide>{b.erreur ?? e.erreur ?? v.erreur ?? t('besoin.version_introuvable')}</Vide>;
  const rep = v.data?.reponses ?? b.data.reponses ?? {};
  const etat = v.data?.etat ?? e.data;
  const lib = (x: { libelle: string; libelle_zh?: string }) => (lg === 'zh' && x.libelle_zh ? x.libelle_zh : x.libelle);
  const aff = (c: ChampDef, x: Valeur | undefined) => {
    if (x === undefined || x === null) return '—';
    if (c.type === 'oui_non') return t(x ? 'besoin.oui' : 'besoin.non');
    if (c.type === 'date' && typeof x === 'string') return date(x, lg);
    if (Array.isArray(x)) return x.join(', ');
    return `${String(x)}${c.unite ? ` ${c.unite}` : ''}`;
  };
  const etiquette = v.data ? t('besoin.doc_version', { n: v.data.version, d: date(v.data.cree_le.slice(0, 10), lg) }) : t('besoin.doc_brouillon');
  const libCat = b.data.categorie === 'tronc_commun' ? t('besoin.tronc_seul') : cats.data?.find((c) => c.categorie === b.data?.categorie)?.libelle ?? b.data.categorie;
  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'center', gap: 8, paddingTop: 12 }}>
        {(['fr', 'zh'] as Langue[]).map((l) => <a key={l} className="btn petit" href={`?langue=${l}${version ? `&version=${version}` : ''}`}>{l === 'zh' ? '中文' : 'FR'}</a>)}
      </div>
      <BarreImpression />
      <article className="doc" lang={lg === 'zh' ? 'zh-CN' : 'fr'}>
        <header style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div><img src="/gbs-logo.png" alt="" width={44} height={44} /><div className="mute">Gulf Bridge Sourcing · {t('doc.bureau_achat')}</div></div>
          <div style={{ textAlign: 'right' }}><h1>{t('besoin.doc_titre')}</h1><div>{d.data?.reference ?? ''}</div>
            <div className="mute">{libCat} · {etiquette}</div></div>
        </header>
        <section style={{ margin: '20px 0' }}>
          <div style={{ fontSize: 16 }}>{d.data ? clients[d.data.client_id] ?? '' : ''}</div>
          <div className="mute">{d.data?.intitule ?? ''}{b.data.pays ? ` · ${b.data.pays}` : ''}</div>
        </section>
        {!v.data && <p className="txt-err">{t('besoin.doc_non_soumis')}</p>}
        {lg === 'zh' && <p className="mute">{t('besoin.doc_zh')}</p>}
        {e.data.etapes_definition.map((et, i) => (
          <section key={et.code} style={{ margin: '18px 0' }}>
            <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>{String(i + 1).padStart(2, '0')} · {lib(et)}</h2>
            <table><tbody>{et.champs.map((c) => (
              <tr key={c.cle}><td style={{ width: '42%' }}>{lib(c)}{c.critique ? ' *' : ''}</td><td>{aff(c, rep[c.cle])}</td></tr>))}</tbody></table>
          </section>))}
        {etat.alertes.length > 0 && (
          <section style={{ marginTop: 16, padding: 12, border: '1px solid var(--ink)' }}>
            <div className="surtitre">{t('besoin.doc_alertes')}</div>
            {etat.alertes.map((x) => <p key={x.champ + x.code} style={{ margin: '4px 0' }}>{t(`besoin.alertes.${x.code}`, { pays: x.pays, attendu: Array.isArray(x.attendu) ? x.attendu.join(', ') : String(x.attendu ?? '') })}</p>)}
          </section>)}
        <p className="mute">{t('besoin.doc_reference')}</p>
        <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 28 }}>
          {[t('besoin.doc_client'), t('besoin.doc_gbs')].map((qui) => (
            <div key={qui} style={{ borderTop: '1px solid var(--ink)', paddingTop: 8, minHeight: 110 }}>
              <div className="surtitre">{qui}</div>
              <div className="mute">{t('besoin.doc_signature')}</div>
            </div>))}
        </section>
      </article>
    </div>
  );
}
