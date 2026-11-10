// M1 : prospection — fiches, actions et relances, entonnoir, conversion en client.
// Les demandes du site web arrivent par la fonction serveur gbs-demande. Règles et cloisonnement en base.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, pourcent } from '../lib/format';
import { normaliser } from '../lib/droits';
import { useNoms } from '../lib/referentiels';
import { urlSignee } from '../lib/fichiers';
import { Bandeau, Bouton, Champ, Entete, Kpis, Onglets, Statut, Tiroir, Vide } from '../components/ui';

interface Prospect { id: string; reference: string; raison_sociale: string; contact_nom: string | null; contact_fonction: string | null;
  email: string | null; telephone: string | null; pays: string; segment: string | null; specialite: string; source: string;
  page_origine: string | null; message: string | null; fichiers: string[]; statut: string; responsable_id: string | null;
  premier_contact_le: string | null; prochaine_relance: string | null; motif_perte: string | null; client_id: string | null; cree_le: string }
interface Action { id: string; type: string; date_action: string; compte_rendu: string; prochaine_relance: string | null; cree_par: string | null }
const SOURCES = ['salon', 'recommandation', 'prospection_directe', 'agent', 'reseau', 'autre'] as const;
const SPECIALITES = ['equipement_site', 'approvisionnement_industriel', 'autre'] as const;
const TYPES = ['appel', 'email', 'whatsapp', 'rendez_vous', 'visite', 'autre'] as const;
const TON = { nouveau: 'att', contacte: 'info', qualifie: 'info', consultation: 'info', converti: 'ok', perdu: 'neutre' } as Record<string, string>;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const aujourdhui = () => new Date().toISOString().slice(0, 10);
async function ouvrir(c: string) { const u = await urlSignee(c); if (u) window.open(u, '_blank', 'noopener,noreferrer'); }

const ETAPES = ['nouveau', 'contacte', 'qualifie', 'consultation', 'converti'] as const;
const initiales = (nom: string | undefined) => (nom ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('');
const ddmm = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '—');

export function Prospection() {
  const { t } = useTranslation();
  const paysLib = (c: string) => (c === 'ZZ' ? t('prospects.pays_a_preciser') : c);
  const nav = useNavigate();
  const { profil, langue } = useAuth();
  const profils = useNoms('profils');
  const [q, setQ] = useState('');
  const [pays, setPays] = useState('tous');
  const [etape, setEtape] = useState('actifs');
  const [mien, setMien] = useState(false);
  const [nouveau, setNouveau] = useState(false);
  const l = useAsync(async () => ok(await supabase.from('prospects').select('*').order('cree_le', { ascending: false }).limit(1000)) as Prospect[], []);
  const sc = useAsync(async () => ok(await supabase.rpc('prospects_sans_contact')) as { prospect_id: string }[], []);
  const sansContact = new Set((sc.data ?? []).map((x) => x.prospect_id));
  const jour = aujourdhui();
  const tous = l.data ?? [];
  const actifs = tous.filter((p) => !['converti', 'perdu'].includes(p.statut));
  const dues = actifs.filter((p) => p.prochaine_relance && p.prochaine_relance <= jour);
  const retard = dues.filter((p) => p.prochaine_relance! < jour);
  const site = actifs.filter((p) => p.source === 'site_web' && p.statut === 'nouveau');
  const conversion = tous.length ? tous.filter((p) => p.statut === 'converti').length / tous.length : 0;
  const paysListe = [...new Set(tous.map((p) => p.pays))].sort();
  const n = normaliser(q.trim());
  const liste = tous.filter((p) => (etape === 'actifs' ? !['converti', 'perdu'].includes(p.statut) : etape === 'tous' || p.statut === etape)
    && (pays === 'tous' || p.pays === pays) && (!mien || p.responsable_id === profil?.id)
    && (!n || normaliser(`${p.raison_sociale} ${p.contact_nom ?? ''} ${p.reference}`).includes(n)))
    .sort((x, y) => (x.prochaine_relance ?? '9999').localeCompare(y.prochaine_relance ?? '9999'));
  const titre = [t('prospects.titre_actifs', { n: actifs.length }),
    dues.length ? t('prospects.titre_relances', { n: dues.length, r: retard.length }) : null,
    site.length ? t('prospects.titre_site', { n: site.length }) : null].filter(Boolean).join(' ; ');
  const relance = (p: Prospect) => {
    if (!p.prochaine_relance) return <span className="mute">—</span>;
    return p.prochaine_relance < jour ? <span className="txt-err">{ddmm(p.prochaine_relance)} · {t('prospects.en_retard')}</span>
      : p.prochaine_relance === jour ? <span className="txt-att">{ddmm(p.prochaine_relance)} · {t('prospects.aujourdhui')}</span>
        : <span>{ddmm(p.prochaine_relance)}</span>;
  };
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.commercial')} · ${t('ecrans.prospection')} · PRO`} titre={l.data ? titre : t('ecrans.prospection')}
        actions={<>
          <Bouton onClick={() => nav('/prospection/entonnoir')}>{t('prospects.entonnoir')}</Bouton>
          <Bouton variante="primaire" onClick={() => setNouveau(true)}>{t('prospects.nouveau')}</Bouton>
        </>} />
      <Kpis items={[
        { lib: t('prospects.k_actifs'), val: actifs.length, sous: [...new Set(actifs.map((p) => p.pays))].join(' · ') || '—' },
        { lib: t('prospects.k_relances'), val: dues.length, sous: t('prospects.k_relances_sous', { n: retard.length }) },
        { lib: t('prospects.k_conversion'), val: pourcent(conversion, langue, 0), sous: t('prospects.k_conversion_sous') },
        { lib: t('prospects.k_site'), val: site.length, sous: sansContact.size ? t('prospects.k_site_retard', { n: sansContact.size }) : t('prospects.k_site_sous') },
      ]} />
      <div className="pf-barre">
        <input className="pf-recherche" placeholder={t('prospects.rechercher')} value={q} maxLength={80} onChange={(e) => setQ(e.target.value)} aria-label={t('prospects.rechercher')} />
        <Onglets actif={pays} onChange={setPays} items={[{ id: 'tous', lib: t('dossiers.tous') }, ...paysListe.map((x) => ({ id: x, lib: paysLib(x) }))]} />
        <select className="pf-statut" value={etape} onChange={(e) => setEtape(e.target.value)} aria-label={t('prospects.etape')}>
          <option value="actifs">{t('prospects.toutes_etapes')}</option><option value="tous">{t('prospects.y_compris_clos')}</option>
          {[...ETAPES, 'perdu'].map((x) => <option key={x} value={x}>{t(`prospects.statuts.${x}`)}</option>)}
        </select>
        <label className="bascule"><input type="checkbox" checked={mien} onChange={(e) => setMien(e.target.checked)} /> {t('prospects.mes_prospects')}</label>
        <span className="pf-droite mute">{t('prospects.x_sur_y', { x: liste.length, y: tous.length })}</span>
      </div>
      <Bandeau type="err">{l.erreur ?? sc.erreur}</Bandeau>
      <div className="cadre">
        {liste.length === 0 ? <Vide>{t('prospects.aucun')}</Vide> : (
          <table className="t"><thead><tr><th>{t('prospects.prospect')}</th><th>{t('prospects.pays')}</th><th>{t('prospects.segment')}</th>
            <th>{t('prospects.source')}</th><th>{t('prospects.etape')}</th><th>{t('prospects.prochaine_relance')}</th><th>{t('prospects.resp')}</th></tr></thead>
            <tbody>{liste.map((p) => (
              <tr key={p.id} className="cliquable" onClick={() => nav(`/prospection/${p.id}`)}>
                <td><div style={{ fontWeight: 500 }}>{p.raison_sociale}</div><div className="mute">{[p.contact_nom, p.contact_fonction].filter(Boolean).join(' · ')}</div></td>
                <td className="sec">{paysLib(p.pays)}</td><td className="sec">{p.segment ?? '—'}</td>
                <td>{t(`prospects.sources.${p.source}`)}</td>
                <td><Statut statut={TON[p.statut] ?? 'neutre'} libelle={t(`prospects.statuts.${p.statut}`)} />
                  {sansContact.has(p.id) && <div className="txt-err" style={{ fontSize: 12 }}>{t('prospects.sans_contact')}</div>}</td>
                <td>{relance(p)}</td>
                <td className="sec">{p.responsable_id ? initiales(profils[p.responsable_id]) : '—'}</td></tr>))}</tbody></table>
        )}
      </div>
      {nouveau && <NouveauProspect onClose={() => setNouveau(false)} onSaved={(id) => { setNouveau(false); nav(`/prospection/${id}`); }} />}
    </div>
  );
}

export function Entonnoir() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { langue } = useAuth();
  const annee = new Date().getFullYear();
  const l = useAsync(async () => ok(await supabase.from('prospects').select('id, statut, source, motif_perte, cree_le')
    .gte('cree_le', `${annee}-01-01T00:00:00Z`).limit(5000)) as Pick<Prospect, 'id' | 'statut' | 'source' | 'motif_perte' | 'cree_le'>[], [annee]);
  const tous = l.data ?? [];
  // Étape atteinte : rang du statut ; un prospect perdu compte au moins comme « nouveau ».
  const rang = (s: string) => Math.max(0, ETAPES.indexOf(s as (typeof ETAPES)[number]));
  const atteints = ETAPES.map((_, i) => tous.filter((p) => rang(p.statut) >= i).length);
  const max = Math.max(1, atteints[0] ?? 0);
  const sources = [...new Set(tous.map((p) => p.source))].map((src) => {
    const lst = tous.filter((p) => p.source === src);
    const conv = lst.filter((p) => p.statut === 'converti').length;
    return { src, entres: lst.length, conv, taux: lst.length ? conv / lst.length : 0 };
  }).sort((x, y) => y.taux - x.taux || y.entres - x.entres);
  const motifs = Object.entries(tous.filter((p) => p.statut === 'perdu' && p.motif_perte)
    .reduce<Record<string, number>>((acc, p) => { const k = p.motif_perte!.trim().slice(0, 60); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {}))
    .sort((x, y) => y[1] - x[1]).slice(0, 6);
  const maxMotif = Math.max(1, ...motifs.map((m) => m[1]));
  const meilleure = sources.find((s) => s.entres >= 3);
  const volume = [...sources].sort((x, y) => y.entres - x.entres)[0];
  const titre = !tous.length ? t('prospects.ent_vide')
    : [meilleure ? t('prospects.ent_meilleure', { src: t(`prospects.sources.${meilleure.src}`), p: pourcent(meilleure.taux, langue, 0) }) : null,
      volume && volume.src !== meilleure?.src ? t('prospects.ent_volume', { src: t(`prospects.sources.${volume.src}`) }) : null].filter(Boolean).join(' ; ');
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.commercial')} · ${t('prospects.entonnoir')} · ${annee} · PRO`} titre={titre} />
      <Bandeau type="err">{l.erreur}</Bandeau>
      <div className="fiche-grille prd">
        <section className="entonnoir">
          {ETAPES.map((e, i) => (
            <div key={e} className="ent-l">
              <span className="lib"><b>{t(`prospects.statuts.${e}`)}</b>
                <span className="mute">{i === 0 ? t('prospects.ent_base') : t('prospects.ent_part', { p: pourcent(atteints[i - 1] ? atteints[i] / atteints[i - 1] : 0, langue, 0) })}</span></span>
              <span className="ent-piste"><span style={{ width: `${(atteints[i] / max) * 100}%` }}>{atteints[i]}</span></span>
            </div>
          ))}
          <p className="mute">{t('prospects.ent_note', { date: `01.01.${annee}` })}</p>
        </section>
        <aside className="fiche-cote">
          <section>
            <table className="t"><thead><tr><th>{t('prospects.source')}</th><th className="num">{t('prospects.entres')}</th>
              <th className="num">{t('prospects.convertis')}</th><th className="num">{t('prospects.taux')}</th></tr></thead>
              <tbody>{sources.map((s) => (
                <tr key={s.src}><td>{t(`prospects.sources.${s.src}`)}</td><td className="num">{s.entres}</td><td className="num">{s.conv}</td>
                  <td className="num"><b>{pourcent(s.taux, langue, 0)}</b></td></tr>))}</tbody></table>
          </section>
          <section>
            <div className="surtitre">{t('prospects.motifs_perte')}</div>
            {motifs.length === 0 ? <span className="mute">{t('prospects.aucun_motif')}</span> : motifs.map(([m, k]) => (
              <div key={m} className="barre-l"><span className="lib">{m}</span><span className="piste"><span style={{ width: `${(k / maxMotif) * 100}%`, background: 'var(--strong)' }} /></span><span className="num">{k}</span></div>
            ))}
          </section>
          <Bouton onClick={() => nav('/prospection')}>{t('prospects.retour_liste')}</Bouton>
        </aside>
      </div>
    </div>
  );
}

function NouveauProspect({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const { t } = useTranslation();
  const { profil } = useAuth();
  const a = useAction();
  const [f, setF] = useState({ raison_sociale: '', contact_nom: '', contact_fonction: '', email: '', telephone: '',
    pays: profil?.role === 'agent_pays' ? profil.pays ?? '' : 'CI', segment: '', specialite: 'equipement_site', source: 'prospection_directe' });
  const enregistrer = async () => {
    const opt = (n: number) => z.string().trim().max(n).nullable();
    const v = z.object({ raison_sociale: z.string().trim().min(2).max(200), contact_nom: opt(120), contact_fonction: opt(120),
      email: z.string().trim().email().max(254).nullable(), telephone: z.string().trim().regex(/^[0-9+() .-]{6,40}$/).nullable(),
      pays: z.string().regex(/^[A-Z]{2}$/), segment: opt(80), specialite: z.enum(SPECIALITES), source: z.enum(SOURCES) }).strict()
      .refine((x) => x.email || x.telephone)
      .safeParse({ ...f, pays: f.pays.trim().toUpperCase(), contact_nom: f.contact_nom.trim() || null, contact_fonction: f.contact_fonction.trim() || null,
        email: f.email.trim() || null, telephone: f.telephone.trim() || null, segment: f.segment.trim() || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    let id = '';
    if (await a.executer(async () => { id = (ok(await supabase.from('prospects').insert(v.data).select('id').single()) as { id: string }).id; })) onSaved(id);
  };
  const champ = (k: keyof typeof f, max: number) => <input value={f[k]} maxLength={max} onChange={(e) => setF({ ...f, [k]: e.target.value })} />;
  return (
    <Tiroir titre={t('prospects.nouveau')} onClose={onClose}>
      <Champ label={t('prospects.societe')}>{champ('raison_sociale', 200)}</Champ>
      <Champ label={t('prospects.contact')}>{champ('contact_nom', 120)}</Champ>
      <Champ label={t('prospects.fonction')}>{champ('contact_fonction', 120)}</Champ>
      <Champ label={t('prospects.email')}>{champ('email', 254)}</Champ>
      <Champ label={t('prospects.telephone')}>{champ('telephone', 40)}</Champ>
      <Champ label={t('prospects.pays')}><input value={f.pays} maxLength={2} disabled={profil?.role === 'agent_pays'} onChange={(e) => setF({ ...f, pays: e.target.value })} /></Champ>
      <Champ label={t('prospects.segment')}>{champ('segment', 80)}</Champ>
      <Champ label={t('prospects.specialite')}><select value={f.specialite} onChange={(e) => setF({ ...f, specialite: e.target.value })}>
        {SPECIALITES.map((s) => <option key={s} value={s}>{t(`prospects.specialites.${s}`)}</option>)}</select></Champ>
      <Champ label={t('prospects.source')}><select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
        {SOURCES.map((s) => <option key={s} value={s}>{t(`prospects.sources.${s}`)}</option>)}</select></Champ>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

export function FicheProspect() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const paysLib = (c: string) => (c === 'ZZ' ? t('prospects.pays_a_preciser') : c);
  const { langue } = useAuth();
  const nav = useNavigate();
  const profils = useNoms('profils');
  const p = useAsync(async () => ok(await supabase.from('prospects').select('*').eq('id', id).maybeSingle()) as Prospect | null, [id]);
  const ac = useAsync(async () => ok(await supabase.from('prospects_actions').select('*').eq('prospect_id', id).order('date_action', { ascending: false })) as Action[], [id]);
  const a = useAction();
  const [f, setF] = useState({ type: 'appel', date: aujourdhui(), compte_rendu: '', relance: '' });
  const [perdu, setPerdu] = useState(false);
  const [motif, setMotif] = useState('');
  const [precis, setPrecis] = useState({ pays: '', specialite: 'autre' });
  const x = p.data;
  const ouvert = x && !['converti', 'perdu'].includes(x.statut);
  const apres = () => { void p.recharger(); void ac.recharger(); };
  const action = async () => {
    const v = z.object({ p_prospect: z.string().uuid(), p_type: z.enum(TYPES), p_date: DATE, p_compte_rendu: z.string().trim().min(3).max(4000),
      p_prochaine_relance: DATE.nullable() }).strict()
      .safeParse({ p_prospect: id, p_type: f.type, p_date: f.date, p_compte_rendu: f.compte_rendu, p_prochaine_relance: f.relance || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('enregistrer_action_prospect', v.data)))) { setF({ type: 'appel', date: aujourdhui(), compte_rendu: '', relance: '' }); apres(); }
  };
  const statut = async (s: 'qualifie' | 'consultation' | 'perdu') => {
    if (s === 'perdu' && motif.trim().length < 5) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('changer_statut_prospect', { p_prospect: id, p_statut: s, p_motif: s === 'perdu' ? motif.trim().slice(0, 1000) : null })))) { setPerdu(false); apres(); }
  };
  const preciser = async () => {
    const v = z.object({ pays: z.string().regex(/^[A-Z]{2}$/).refine((c) => c !== 'ZZ'), specialite: z.enum(SPECIALITES) }).strict()
      .safeParse({ pays: precis.pays.trim().toUpperCase(), specialite: precis.specialite });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('prospects').update(v.data).eq('id', id)))) apres();
  };
  const convertir = async () => {
    if (await a.executer(async () => ok(await supabase.rpc('convertir_prospect', { p_prospect: id })))) nav('/clients');
  };
  if (p.chargement && !x) return <div className="screen"><Bandeau type="err">{p.erreur}</Bandeau></div>;
  if (!x) return <div className="screen"><Vide>{p.erreur ?? t('prospects.introuvable')}</Vide></div>;
  const rangX = ETAPES.indexOf(x.statut as (typeof ETAPES)[number]);
  const suivante = x.statut === 'contacte' || x.statut === 'nouveau' ? 'qualifie' : x.statut === 'qualifie' ? 'consultation' : null;
  const relances = (ac.data ?? []).filter((y) => y.prochaine_relance && y.prochaine_relance < aujourdhui());
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.commercial')} · ${t('prospects.fiche')} · ${x.reference}`}
        titre={<>{x.raison_sociale} <span className="h1-statut"><Statut statut={TON[x.statut] ?? 'neutre'} libelle={t(`prospects.statuts.${x.statut}`)} /></span></>}
        actions={ouvert && <>
          <Bouton onClick={() => setPerdu(true)}>{t('prospects.marquer_perdu')}</Bouton>
          <Bouton disabled={a.enCours || !x.premier_contact_le} onClick={() => void convertir()}>{t('prospects.convertir')}</Bouton>
          {suivante && <Bouton variante="primaire" disabled={a.enCours || !x.premier_contact_le} onClick={() => void statut(suivante)}>
            {t('prospects.passer_a', { etape: t(`prospects.statuts.${suivante}`) })}</Bouton>}
        </>} />
      <div className="sec" style={{ marginTop: -10 }}>{[x.contact_nom, x.contact_fonction].filter(Boolean).join(' · ')}</div>
      <ol className="etapes-pros">
        {ETAPES.map((e, i) => <li key={e} className={x.statut === 'perdu' ? 'perdu' : i < rangX ? 'faite' : i === rangX ? 'courante' : ''}><span>{i + 1}</span> {t(`prospects.statuts.${e}`)}</li>)}
      </ol>
      <Bandeau type="err">{ac.erreur ?? a.erreur}</Bandeau>
      {!x.premier_contact_le && ouvert && <Bandeau>{t('prospects.aide_premier_contact')}</Bandeau>}
      {x.pays === 'ZZ' && ouvert && (
        <div className="pros-preciser">
          <span>{t('prospects.aide_pays_a_preciser')}</span>
          <input value={precis.pays} maxLength={2} placeholder="CI" aria-label={t('prospects.pays')} onChange={(e) => setPrecis({ ...precis, pays: e.target.value })} />
          <select value={precis.specialite} aria-label={t('prospects.specialite')} onChange={(e) => setPrecis({ ...precis, specialite: e.target.value })}>
            {SPECIALITES.map((s) => <option key={s} value={s}>{t(`prospects.specialites.${s}`)}</option>)}</select>
          <Bouton disabled={a.enCours} onClick={() => void preciser()}>{t('commun.enregistrer')}</Bouton>
        </div>
      )}
      <div className="fiche-grille">
        <div className="cadre fiche-principal">
          <div className="pf-champs" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <div><span>{t('prospects.pays')}</span><b>{paysLib(x.pays)}</b></div>
            <div><span>{t('prospects.segment')}</span><b>{x.segment ?? '—'}</b></div>
            <div><span>{t('prospects.source')}</span><b>{t(`prospects.sources.${x.source}`)}</b></div>
            <div><span>{t('prospects.responsable')}</span><b>{x.responsable_id ? profils[x.responsable_id] ?? '—' : '—'}</b></div>
            <div><span>{t('prospects.telephone')}</span><b>{x.telephone ?? '—'}</b></div>
            <div><span>{t('prospects.email')}</span><b>{x.email ?? '—'}</b></div>
            <div><span>{t('prospects.specialite')}</span><b>{t(`prospects.specialites.${x.specialite}`)}</b></div>
            <div><span>{t('prospects.premier_contact')}</span><b>{x.premier_contact_le ? date(x.premier_contact_le, langue) : '—'}</b></div>
          </div>
          <section className="fiche-bloc">
            <div className="surtitre">{t('prospects.besoin')}</div>
            {x.message ? <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{x.message}</p> : <span className="mute">{t('prospects.aucun_besoin')}</span>}
            {x.page_origine && <div className="mute">{t('prospects.page_origine')} : {x.page_origine}</div>}
            {x.fichiers.length > 0 && <span className="actions" style={{ flexWrap: 'wrap' }}>{x.fichiers.map((c, i) => <Bouton key={c} petit onClick={() => void ouvrir(c)}>{t('approbation.piece', { n: i + 1 })}</Bouton>)}</span>}
            {x.motif_perte && <div className="txt-err">{t('prospects.motif_perte')} : {x.motif_perte}</div>}
          </section>
          <section className="fiche-bloc">
            <div className="surtitre">{t('prospects.historique')}</div>
            {ouvert && (
              <div className="pros-ajout">
                <select value={f.type} aria-label={t('prospects.type')} onChange={(e) => setF({ ...f, type: e.target.value })}>
                  {TYPES.map((y) => <option key={y} value={y}>{t(`prospects.types.${y}`)}</option>)}</select>
                <input type="date" aria-label={t('reception.date')} max={aujourdhui()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
                <textarea rows={2} maxLength={4000} value={f.compte_rendu} placeholder={t('prospects.note_placeholder')} aria-label={t('prospects.compte_rendu')}
                  onChange={(e) => setF({ ...f, compte_rendu: e.target.value })} />
                <Bouton disabled={a.enCours} onClick={() => void action()}>{t('commun.ajouter')}</Bouton>
              </div>
            )}
            {(ac.data ?? []).length === 0 ? <span className="mute">{t('prospects.aucune_action')}</span> : (ac.data ?? []).map((y) => (
              <div key={y.id} className="pros-histo"><span className="ref">{date(y.date_action, langue)}</span>
                <span className="sec">{y.cree_par ? initiales(profils[y.cree_par]) : t('prospects.sources.site_web')}</span>
                <span><span className="mute">{t(`prospects.types.${y.type}`)} · </span>{y.compte_rendu}</span></div>
            ))}
          </section>
        </div>
        <aside className="fiche-cote">
          <section>
            <div className="surtitre">{t('prospects.relances')}</div>
            {ouvert && (
              <div className="grille2">
                <input type="date" aria-label={t('prospects.relance')} min={aujourdhui()} value={f.relance} onChange={(e) => setF({ ...f, relance: e.target.value })} />
                <span className="mute" style={{ alignSelf: 'center', fontSize: 12 }}>{t('prospects.relance_avec_note')}</span>
              </div>
            )}
            {x.prochaine_relance && <div className="relance-l"><span className={'tache-case' + (x.prochaine_relance < aujourdhui() ? ' retard' : '')} aria-hidden="true" />
              <span className={x.prochaine_relance < aujourdhui() ? 'txt-err' : ''}>{date(x.prochaine_relance, langue)}</span><span>{t('prospects.prochaine_relance')}</span></div>}
            {relances.slice(0, 5).map((y) => (
              <div key={y.id} className="relance-l faite"><span className="tache-case coche" aria-hidden="true">✓</span>
                <span className="mute">{date(y.prochaine_relance, langue)}</span><span className="mute">{y.compte_rendu.slice(0, 60)}</span></div>
            ))}
          </section>
          <section>
            <div className="surtitre">{t('prospects.suite')}</div>
            <p className="mute" style={{ margin: 0 }}>{t('prospects.suite_texte')}</p>
            {x.client_id && <Bouton onClick={() => nav('/clients')}>{t('prospects.voir_client')}</Bouton>}
          </section>
        </aside>
      </div>
      {perdu && (
        <Tiroir titre={t('prospects.marquer_perdu')} onClose={() => setPerdu(false)}>
          <Champ label={t('prospects.motif_perte')}><textarea value={motif} maxLength={1000} onChange={(e) => setMotif(e.target.value)} /></Champ>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <Bouton variante="danger" disabled={a.enCours || motif.trim().length < 5} onClick={() => void statut('perdu')}>{t('prospects.marquer_perdu')}</Bouton>
        </Tiroir>
      )}
    </div>
  );
}
