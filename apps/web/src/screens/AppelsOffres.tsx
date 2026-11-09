// Commercial · Appels d'offres (M24, lot 2 ; maquette « Appels d'offres » AOF et fiche d'appel d'offres).
// Lecture par les règles de la base (admin, Hub Afrique, sur leurs sociétés) ; toute écriture passe par
// les fonctions gbs.*_appel_offres, qui revalident tout (la validation ci-dessous n'est qu'un confort).
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { nombre } from '../lib/format';
import { Bandeau, Bouton, Champ, Chargement, Entete, Kpis, Statut, Tiroir, Vide } from '../components/ui';

interface AppelOffres {
  id: string; reference: string; societe_id: string; client_id: string | null; donneur_ordre: string; objet: string; nature: string;
  procedure: string; date_limite: string; valeur_estimee: number | null; devise: string; statut: string; motif_resultat: string | null;
  depose_le: string | null; resultat_le: string | null; cree_le: string;
}
interface PieceAo { id: string; ao_id: string; libelle: string; ordre: number; prete: boolean }
interface Question { id: string; ao_id: string; question: string; reponse: string | null; posee_le: string; repondue_le: string | null }

const OUVERTS = ['en_preparation', 'depose'];
const PIECES_TYPES = ['attestation_fiscale', 'caisse_sociale', 'rccm', 'caution', 'references', 'offre_technique', 'offre_financiere', 'pouvoir'];
const ddmm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
const ddmmyyyy = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const jours = (d: string) => Math.round((Date.parse(d) - Date.parse(new Date().toISOString().slice(0, 10))) / 86400000);

function etat(a: AppelOffres, pieces: PieceAo[]) {
  const total = pieces.length, pretes = pieces.filter((p) => p.prete).length, manque = total - pretes;
  if (a.statut === 'en_preparation') return manque > 0 || total === 0 ? { ton: 'att', cle: 'manquantes', n: manque } : { ton: 'ok', cle: 'pret', n: 0 };
  return { ton: { depose: 'info', gagne: 'ok', perdu: 'err', abandonne: 'neutre' }[a.statut] ?? 'neutre', cle: a.statut, n: 0 };
}

export function AppelsOffres() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { langue } = useAuth();
  const [creer, setCreer] = useState(false);
  const l = useAsync(async () => ok(await supabase.from('appels_offres').select('*').order('date_limite', { ascending: true }).limit(500)) as AppelOffres[], []);
  const p = useAsync(async () => ok(await supabase.from('appels_offres_pieces').select('id, ao_id, libelle, ordre, prete').limit(5000)) as PieceAo[], []);
  const tous = l.data ?? [];
  const pieces = (id: string) => (p.data ?? []).filter((x) => x.ao_id === id);
  const ouverts = tous.filter((a) => OUVERTS.includes(a.statut));
  const aPreparer = ouverts.filter((a) => a.statut === 'en_preparation').sort((x, y) => x.date_limite.localeCompare(y.date_limite));
  const prochain = aPreparer[0];
  const annee = String(new Date().getFullYear());
  const clos = tous.filter((a) => ['gagne', 'perdu'].includes(a.statut) && (a.resultat_le ?? '').startsWith(annee));
  const gagnes = clos.filter((a) => a.statut === 'gagne').length;
  const enJeu = ouverts.filter((a) => a.devise === 'XOF' && a.valeur_estimee !== null).reduce((s, a) => s + Number(a.valeur_estimee), 0);
  const manquantesProchain = prochain ? pieces(prochain.id).filter((x) => !x.prete).length : 0;
  const titre = [t('ao.titre_ouverts', { n: ouverts.length }),
    prochain ? t('ao.titre_prochain', { donneur: prochain.donneur_ordre, j: jours(prochain.date_limite), n: manquantesProchain }) : null].filter(Boolean).join(' ; ');
  const liste = useMemo(() => [...tous].sort((x, y) => Number(!OUVERTS.includes(x.statut)) - Number(!OUVERTS.includes(y.statut)) || x.date_limite.localeCompare(y.date_limite)), [tous]);
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.commercial')} · ${t('ao.surtitre')} · AOF`} titre={l.data ? titre : t('ecrans.appels_offres')}
        actions={<Bouton variante="primaire" onClick={() => setCreer(true)}>{t('ao.nouveau')}</Bouton>} />
      <Kpis items={[
        { lib: t('ao.k_ouverts'), val: ouverts.length, sous: t('ao.k_ouverts_sous', { n: ouverts.filter((a) => a.nature === 'prequalification').length }) },
        { lib: t('ao.k_echeance'), val: prochain ? ddmm(prochain.date_limite) : '—', sous: prochain ? `J−${jours(prochain.date_limite)}` : t('ao.aucune_echeance') },
        { lib: t('ao.k_succes', { annee }), val: clos.length ? `${Math.round((gagnes / clos.length) * 100)} %` : '—', sous: t('ao.k_succes_sous', { g: gagnes, n: clos.length }) },
        { lib: t('ao.k_valeur'), val: enJeu ? `${nombre(enJeu / 1e6, langue, 0)} M` : '—', sous: t('ao.k_valeur_sous') },
      ]} />
      <Bandeau type="err">{l.erreur ?? p.erreur}</Bandeau>
      <div className="fiche-grille">
        <div className="cadre fiche-principal">
          {l.chargement && !l.data ? <Chargement /> : liste.length === 0 ? <Vide>{t('ao.aucun')}</Vide> : (
            <table className="t"><thead><tr><th>{t('ao.ao')}</th><th>{t('ao.donneur')}</th><th>{t('ao.objet')}</th><th>{t('ao.limite')}</th>
              <th className="num">{t('ao.pieces')}</th><th>{t('ao.statut')}</th></tr></thead>
              <tbody>{liste.map((a) => {
                const ps = pieces(a.id), e = etat(a, ps), ouvert = OUVERTS.includes(a.statut);
                return (
                  <tr key={a.id} className="cliquable" onClick={() => nav(`/appels-offres/${a.id}`)}>
                    <td className="ref">{a.reference}</td><td style={{ fontWeight: 500 }}>{a.donneur_ordre}</td>
                    <td>{a.objet}{a.nature === 'prequalification' && <div className="mute">{t('ao.natures.prequalification')}</div>}</td>
                    <td className="ref">{ddmmyyyy(a.date_limite)} <span className={ouvert && jours(a.date_limite) <= 7 ? 'txt-err' : 'mute'}>{ouvert ? `J−${jours(a.date_limite)}` : t('ao.clos')}</span></td>
                    <td className="num">{ps.filter((x) => x.prete).length}/{ps.length}</td>
                    <td><Statut statut={e.ton} libelle={t(`ao.etats.${e.cle}`, { n: e.n })} />{a.statut === 'perdu' && a.motif_resultat && <div className="mute" style={{ fontSize: 12 }}>{a.motif_resultat}</div>}</td>
                  </tr>);
              })}</tbody></table>
          )}
        </div>
        <aside className="fiche-cote">
          <section className="fiche-bloc">
            <div className="surtitre">{t('ao.calendrier')}</div>
            {aPreparer.length === 0 ? <span className="mute">{t('ao.aucune_echeance')}</span> : aPreparer.map((a) => (
              <div key={a.id} className="ao-cal cliquable" onClick={() => nav(`/appels-offres/${a.id}`)}>
                <span className="ref">{ddmm(a.date_limite)} <span className={jours(a.date_limite) <= 7 ? 'txt-err' : 'mute'}>J−{jours(a.date_limite)}</span></span>
                <span><b>{a.donneur_ordre}</b><br /><span className="mute">{a.objet}</span></span>
              </div>))}
          </section>
        </aside>
      </div>
      {creer && <NouvelAppelOffres onClose={() => setCreer(false)} onCree={(id) => nav(`/appels-offres/${id}`)} />}
    </div>
  );
}

function NouvelAppelOffres({ onClose, onCree }: { onClose: () => void; onCree: (id: string) => void }) {
  const { t } = useTranslation();
  const { societes } = useAuth();
  const a = useAction();
  const [f, setF] = useState({ societe_id: societes[0]?.id ?? '', donneur_ordre: '', objet: '', nature: 'appel_offres', procedure: 'ouvert',
    date_limite: '', valeur: '', devise: 'XOF', pieces: PIECES_TYPES.map((c) => t(`ao.pieces_types.${c}`)) });
  const enregistrer = async () => {
    const v = z.object({
      societe_id: z.string().uuid(), donneur_ordre: z.string().trim().min(2).max(200), objet: z.string().trim().min(2).max(300),
      nature: z.enum(['appel_offres', 'prequalification']), procedure: z.enum(['ouvert', 'restreint', 'consultation', 'referencement']),
      date_limite: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), valeur_estimee: z.number().int().min(0).max(1e11).nullable(),
      devise: z.enum(['XOF', 'XAF', 'USD']), pieces: z.array(z.string().trim().min(2).max(200)).max(30),
    }).strict().safeParse({ societe_id: f.societe_id, donneur_ordre: f.donneur_ordre, objet: f.objet, nature: f.nature, procedure: f.procedure,
      date_limite: f.date_limite, valeur_estimee: f.valeur.trim() ? Number(f.valeur.replace(/\s/g, '')) : null, devise: f.devise,
      pieces: f.pieces.map((x) => x.trim()).filter(Boolean) });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    let id = '';
    if (await a.executer(async () => { id = ok(await supabase.rpc('creer_appel_offres', { p: v.data })) as string; }) && id) onCree(id);
  };
  return (
    <Tiroir titre={t('ao.nouveau')} onClose={onClose}>
      <p className="sec">{t('ao.aide_nouveau')}</p>
      <Champ label={t('ao.societe')}><select value={f.societe_id} onChange={(e) => setF({ ...f, societe_id: e.target.value })}>
        {societes.map((s) => <option key={s.id} value={s.id}>{s.raison_sociale}</option>)}</select></Champ>
      <Champ label={`${t('ao.donneur')} *`}><input value={f.donneur_ordre} maxLength={200} onChange={(e) => setF({ ...f, donneur_ordre: e.target.value })} /></Champ>
      <Champ label={`${t('ao.objet')} *`}><input value={f.objet} maxLength={300} onChange={(e) => setF({ ...f, objet: e.target.value })} /></Champ>
      <div className="grille2">
        <Champ label={t('ao.nature')}><select value={f.nature} onChange={(e) => setF({ ...f, nature: e.target.value })}>
          {['appel_offres', 'prequalification'].map((x) => <option key={x} value={x}>{t(`ao.natures.${x}`)}</option>)}</select></Champ>
        <Champ label={t('ao.procedure')}><select value={f.procedure} onChange={(e) => setF({ ...f, procedure: e.target.value })}>
          {['ouvert', 'restreint', 'consultation', 'referencement'].map((x) => <option key={x} value={x}>{t(`ao.procedures.${x}`)}</option>)}</select></Champ>
        <Champ label={`${t('ao.date_limite')} *`}><input type="date" value={f.date_limite} onChange={(e) => setF({ ...f, date_limite: e.target.value })} /></Champ>
        <Champ label={t('ao.valeur')}><span style={{ display: 'flex', gap: 6 }}>
          <input inputMode="numeric" value={f.valeur} onChange={(e) => setF({ ...f, valeur: e.target.value })} />
          <select value={f.devise} style={{ width: 90 }} onChange={(e) => setF({ ...f, devise: e.target.value })}>{['XOF', 'XAF', 'USD'].map((x) => <option key={x}>{x}</option>)}</select>
        </span></Champ>
      </div>
      <Champ label={t('ao.pieces_liste')}>
        <textarea rows={8} value={f.pieces.join('\n')} onChange={(e) => setF({ ...f, pieces: e.target.value.split('\n').slice(0, 30) })} />
      </Champ>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('ao.creer')}</Bouton>
    </Tiroir>
  );
}

export function FicheAppelOffres() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { langue } = useAuth();
  const a = useAction();
  const ao = useAsync(async () => ok(await supabase.from('appels_offres').select('*').eq('id', id).maybeSingle()) as AppelOffres | null, [id]);
  const p = useAsync(async () => ok(await supabase.from('appels_offres_pieces').select('id, ao_id, libelle, ordre, prete').eq('ao_id', id).order('ordre')) as PieceAo[], [id]);
  const q = useAsync(async () => ok(await supabase.from('appels_offres_questions').select('*').eq('ao_id', id).order('posee_le')) as Question[], [id]);
  const [nouvellePiece, setNouvellePiece] = useState('');
  const [question, setQuestion] = useState('');
  const [reponses, setReponses] = useState<Record<string, string>>({});
  const [resultat, setResultat] = useState(false);
  const [res, setRes] = useState({ statut: 'gagne', motif: '' });
  const x = ao.data;
  if (!x) return <div className="screen">{ao.chargement ? <Chargement /> : <Vide>{ao.erreur ?? t('ao.introuvable')}</Vide>}</div>;
  const ps = p.data ?? [];
  const e = etat(x, ps);
  const prep = x.statut === 'en_preparation';
  const pretes = ps.filter((y) => y.prete).length;
  const recharger = () => { void ao.recharger(); void p.recharger(); void q.recharger(); };
  const appel = async (fn: string, args: Record<string, unknown>) => { if (await a.executer(async () => ok(await supabase.rpc(fn, args)))) { recharger(); return true; } return false; };
  const ajouterPiece = async () => {
    const v = z.string().trim().min(2).max(200).safeParse(nouvellePiece);
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await appel('ajouter_piece_appel_offres', { p_ao: id, p_libelle: v.data })) setNouvellePiece('');
  };
  const poser = async () => {
    const v = z.string().trim().min(3).max(1000).safeParse(question);
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await appel('poser_question_appel_offres', { p_ao: id, p_question: v.data })) setQuestion('');
  };
  const repondre = async (qid: string) => {
    const v = z.string().trim().min(1).max(2000).safeParse(reponses[qid] ?? '');
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    await appel('repondre_question_appel_offres', { p_question: qid, p_reponse: v.data });
  };
  const saisirResultat = async () => {
    const v = z.object({ p_ao: z.string().uuid(), p_statut: z.enum(['gagne', 'perdu', 'abandonne']), p_motif: z.string().trim().max(1000).nullable() }).strict()
      .safeParse({ p_ao: id, p_statut: res.statut, p_motif: res.motif.trim() || null });
    if (!v.success || (res.statut !== 'gagne' && res.motif.trim().length < 3)) { a.setErreur(t('formulaire.invalide')); return; }
    if (await appel('resultat_appel_offres', v.data)) setResultat(false);
  };
  const j = jours(x.date_limite);
  return (
    <div className="screen" style={{ overflow: 'auto' }}>
      <Entete surtitre={`${t('modules.commercial')} · ${t('ao.fiche')} · ${x.reference} · AOF`}
        titre={<>{x.objet} <span className="h1-statut"><Statut statut={e.ton} libelle={t(`ao.etats.${e.cle}`, { n: e.n })} /></span></>}
        actions={prep && <div className="ao-limite"><b className={j <= 7 ? 'txt-err' : ''}>J−{j}</b><span className="mute">{t('ao.limite_le', { d: ddmmyyyy(x.date_limite) })}</span></div>} />
      <div className="sec" style={{ marginTop: -10 }}>{x.donneur_ordre} · {t(`ao.procedures.${x.procedure}`)}</div>
      <Bandeau type="err">{a.erreur ?? p.erreur ?? q.erreur}</Bandeau>
      <div className="fiche-grille">
        <div className="cadre fiche-principal">
          <div className="pf-champs" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            <div><span>{t('ao.donneur')}</span><b>{x.donneur_ordre}</b></div>
            <div><span>{t('ao.procedure')}</span><b>{t(`ao.procedures.${x.procedure}`)}</b></div>
            <div><span>{t('ao.date_limite')}</span><b>{ddmmyyyy(x.date_limite)}</b></div>
            <div><span>{t('ao.valeur')}</span><b>{x.valeur_estimee === null ? '—' : `${nombre(Number(x.valeur_estimee) / 1e6, langue, 0)} M ${x.devise}`}</b></div>
          </div>
          <section className="fiche-bloc">
            <div className="surtitre" style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('ao.pieces_titre')}</span>
              <span className="mute" style={{ textTransform: 'none', letterSpacing: 0 }}>{t('ao.pieces_pretes', { p: pretes, n: ps.length })}</span></div>
            <div className="ao-barre" role="progressbar" aria-valuemin={0} aria-valuemax={ps.length} aria-valuenow={pretes}>
              <span style={{ width: `${ps.length ? (pretes / ps.length) * 100 : 0}%` }} /></div>
            {ps.length === 0 ? <span className="mute">{t('ao.aucune_piece')}</span> : ps.map((y) => (
              <div key={y.id} className="ao-piece">
                <button type="button" className={'ao-coche' + (y.prete ? ' oui' : '')} disabled={!prep || a.enCours}
                  aria-pressed={y.prete} aria-label={t(y.prete ? 'ao.marquer_manquante' : 'ao.marquer_prete') + ' · ' + y.libelle}
                  onClick={() => void appel('marquer_piece_appel_offres', { p_piece: y.id, p_prete: !y.prete })}>{y.prete ? '✓' : ''}</button>
                <span>{y.libelle}</span>
                <Statut statut={y.prete ? 'ok' : 'att'} libelle={t(y.prete ? 'ao.prete' : 'ao.manquante')} />
              </div>))}
            {prep && <div className="pros-ajout" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
              <input value={nouvellePiece} maxLength={200} placeholder={t('ao.nouvelle_piece')} aria-label={t('ao.nouvelle_piece')} onChange={(ev) => setNouvellePiece(ev.target.value)} />
              <Bouton disabled={a.enCours} onClick={() => void ajouterPiece()}>{t('ao.ajouter')}</Bouton></div>}
          </section>
          <section className="fiche-bloc">
            <div className="surtitre">{t('ao.questions')}</div>
            {(q.data ?? []).length === 0 && <span className="mute">{t('ao.aucune_question')}</span>}
            {(q.data ?? []).map((y) => (
              <div key={y.id} className="ao-question">
                <b>{y.question}</b>
                {y.reponse ? <span>{y.reponse}</span> : (
                  <span className="pros-ajout" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
                    <input value={reponses[y.id] ?? ''} maxLength={2000} placeholder={t('ao.reponse_recue')} aria-label={t('ao.reponse_recue')}
                      onChange={(ev) => setReponses({ ...reponses, [y.id]: ev.target.value })} />
                    <Bouton petit disabled={a.enCours} onClick={() => void repondre(y.id)}>{t('ao.enregistrer')}</Bouton>
                  </span>)}
              </div>))}
            {prep && <div className="pros-ajout" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
              <textarea rows={2} value={question} maxLength={1000} placeholder={t('ao.question_placeholder')} aria-label={t('ao.questions')} onChange={(ev) => setQuestion(ev.target.value)} />
              <Bouton disabled={a.enCours} onClick={() => void poser()}>{t('ao.envoyer')}</Bouton></div>}
          </section>
        </div>
        <aside className="fiche-cote">
          <section className="fiche-bloc">
            <div className="surtitre">{t('ao.depot_resultat')}</div>
            {prep && <Bouton variante="primaire" data-sans-glose style={{ width: '100%', justifyContent: 'center' }} disabled={a.enCours || pretes < ps.length || ps.length === 0}
              onClick={() => void appel('deposer_appel_offres', { p_ao: id })}>{t('ao.deposer')}</Bouton>}
            {x.depose_le && <div className="ligne-montant"><span>{t('ao.depose_le')}</span><b>{ddmmyyyy(x.depose_le.slice(0, 10))}</b></div>}
            {['en_preparation', 'depose'].includes(x.statut) && <Bouton style={{ width: '100%', justifyContent: 'center' }} data-sans-glose
              onClick={() => { setRes({ statut: x.statut === 'depose' ? 'gagne' : 'abandonne', motif: '' }); setResultat(true); }}>{t('ao.saisir_resultat')}</Bouton>}
            {x.motif_resultat && <div className="ligne-montant"><span>{t('ao.motif')}</span><b>{x.motif_resultat}</b></div>}
            <p className="mute" style={{ margin: 0 }}>{t('ao.aide_depot')}</p>
          </section>
        </aside>
      </div>
      {resultat && (
        <Tiroir titre={t('ao.resultat_titre', { ref: x.reference })} onClose={() => setResultat(false)}>
          <p className="sec">{t('ao.aide_resultat')}</p>
          <Champ label={t('ao.resultat')}><select value={res.statut} onChange={(ev) => setRes({ ...res, statut: ev.target.value })}>
            {(x.statut === 'depose' ? ['gagne', 'perdu', 'abandonne'] : ['abandonne']).map((s) => <option key={s} value={s}>{t(`ao.etats.${s}`)}</option>)}</select></Champ>
          <Champ label={t('ao.motif')}><textarea rows={3} maxLength={1000} value={res.motif} onChange={(ev) => setRes({ ...res, motif: ev.target.value })} /></Champ>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <Bouton variante="primaire" disabled={a.enCours} onClick={() => void saisirResultat()}>{t('ao.enregistrer')}</Bouton>
        </Tiroir>
      )}
    </div>
  );
}
