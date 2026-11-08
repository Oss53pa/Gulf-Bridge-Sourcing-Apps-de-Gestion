// M1 : prospection — fiches, actions et relances, entonnoir, conversion en client.
// Les demandes du site web arrivent par la fonction serveur gbs-demande. Règles et cloisonnement en base.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date } from '../lib/format';
import { useNoms } from '../lib/referentiels';
import { urlSignee } from '../lib/fichiers';
import { Bandeau, Bouton, CadreTableau, Champ, Entete, Kpis, Statut, Tiroir, Vide } from '../components/ui';

interface Prospect { id: string; reference: string; raison_sociale: string; contact_nom: string | null; contact_fonction: string | null;
  email: string | null; telephone: string | null; pays: string; segment: string | null; specialite: string; source: string;
  page_origine: string | null; message: string | null; fichiers: string[]; statut: string; responsable_id: string | null;
  premier_contact_le: string | null; prochaine_relance: string | null; motif_perte: string | null; client_id: string | null; cree_le: string }
interface Action { id: string; type: string; date_action: string; compte_rendu: string; prochaine_relance: string | null; cree_par: string | null }
type Filtre = 'a_traiter' | 'sans_contact' | 'tous';
const SOURCES = ['salon', 'recommandation', 'prospection_directe', 'agent', 'reseau', 'autre'] as const;
const SPECIALITES = ['equipement_site', 'approvisionnement_industriel', 'autre'] as const;
const TYPES = ['appel', 'email', 'whatsapp', 'rendez_vous', 'visite', 'autre'] as const;
const TON = { nouveau: 'att', contacte: 'info', qualifie: 'info', consultation: 'info', converti: 'ok', perdu: 'neutre' } as Record<string, string>;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const aujourdhui = () => new Date().toISOString().slice(0, 10);
async function ouvrir(c: string) { const u = await urlSignee(c); if (u) window.open(u, '_blank', 'noopener,noreferrer'); }

export function Prospection() {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const profils = useNoms('profils');
  const [filtre, setFiltre] = useState<Filtre>('a_traiter');
  const [fiche, setFiche] = useState<string | null>(null);
  const [nouveau, setNouveau] = useState(false);
  const l = useAsync(async () => ok(await supabase.from('prospects').select('*').order('cree_le', { ascending: false }).limit(1000)) as Prospect[], []);
  const e = useAsync(async () => ok(await supabase.rpc('entonnoir_prospects')) as { statut: string; nombre: number; site_web: number }[], []);
  const sc = useAsync(async () => ok(await supabase.rpc('prospects_sans_contact')) as { prospect_id: string }[], []);
  const sansContact = new Set((sc.data ?? []).map((x) => x.prospect_id));
  const jour = aujourdhui();
  const liste = (l.data ?? []).filter((p) => filtre === 'tous' ? true
    : filtre === 'sans_contact' ? sansContact.has(p.id)
    : !['converti', 'perdu'].includes(p.statut) && (p.statut === 'nouveau' || (p.prochaine_relance !== null && p.prochaine_relance <= jour)));
  const recharger = () => { void l.recharger(); void e.recharger(); void sc.recharger(); };
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.commercial')} · M1`} titre={t('prospects.titre')}
        actions={<Bouton variante="primaire" onClick={() => setNouveau(true)}>{t('prospects.nouveau')}</Bouton>} />
      <Kpis items={(e.data ?? []).map((x) => ({ lib: t(`prospects.statuts.${x.statut}`), val: String(x.nombre),
        sous: Number(x.site_web) > 0 ? t('prospects.dont_site', { n: x.site_web }) : '' }))} />
      <Bandeau type="err">{l.erreur ?? e.erreur ?? sc.erreur}</Bandeau>
      {sansContact.size > 0 && <Bandeau type="err">{t('prospects.alerte_sans_contact', { n: sansContact.size })}</Bandeau>}
      <CadreTableau titre={t('prospects.liste')} outils={
        <select value={filtre} onChange={(ev) => setFiltre(ev.target.value as Filtre)} aria-label={t('nc.filtre')}>
          {(['a_traiter', 'sans_contact', 'tous'] as const).map((f) => <option key={f} value={f}>{t(`prospects.filtres.${f}`)}</option>)}</select>}>
        {liste.length === 0 ? <Vide>{t('prospects.aucun')}</Vide> : (
          <table className="t"><thead><tr><th>{t('nc.reference')}</th><th>{t('prospects.societe')}</th><th>{t('prospects.pays')}</th>
            <th>{t('prospects.source')}</th><th>{t('prospects.responsable')}</th><th>{t('prospects.relance')}</th><th>{t('nc.statut')}</th></tr></thead>
            <tbody>{liste.map((p) => (
              <tr key={p.id} className="cliquable" onClick={() => setFiche(p.id)}>
                <td className="ref">{p.reference}</td><td>{p.raison_sociale}<div className="mute">{p.contact_nom ?? ''}</div></td><td>{p.pays}</td>
                <td>{t(`prospects.sources.${p.source}`)}</td><td className="sec">{p.responsable_id ? profils[p.responsable_id] ?? '—' : '—'}</td>
                <td className="ref">{p.prochaine_relance ? date(p.prochaine_relance, langue) : '—'}</td>
                <td><Statut statut={TON[p.statut] ?? 'neutre'} libelle={t(`prospects.statuts.${p.statut}`)} />
                  {sansContact.has(p.id) && <div><Statut statut="err" libelle={t('prospects.sans_contact')} /></div>}</td></tr>))}</tbody></table>
        )}
      </CadreTableau>
      {nouveau && <NouveauProspect onClose={() => setNouveau(false)} onSaved={(id) => { setNouveau(false); recharger(); setFiche(id); }} />}
      {fiche && <FicheProspect id={fiche} onClose={() => setFiche(null)} onChange={recharger} />}
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

function FicheProspect({ id, onClose, onChange }: { id: string; onClose: () => void; onChange: () => void }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const nav = useNavigate();
  const profils = useNoms('profils');
  const p = useAsync(async () => ok(await supabase.from('prospects').select('*').eq('id', id).maybeSingle()) as Prospect | null, [id]);
  const ac = useAsync(async () => ok(await supabase.from('prospects_actions').select('*').eq('prospect_id', id).order('date_action', { ascending: false })) as Action[], [id]);
  const a = useAction();
  const [f, setF] = useState({ type: 'appel', date: aujourdhui(), compte_rendu: '', relance: '' });
  const [motif, setMotif] = useState('');
  const x = p.data;
  const ouvert = x && !['converti', 'perdu'].includes(x.statut);
  const apres = () => { void p.recharger(); void ac.recharger(); onChange(); };
  const action = async () => {
    const v = z.object({ p_prospect: z.string().uuid(), p_type: z.enum(TYPES), p_date: DATE, p_compte_rendu: z.string().trim().min(3).max(4000),
      p_prochaine_relance: DATE.nullable() }).strict()
      .safeParse({ p_prospect: id, p_type: f.type, p_date: f.date, p_compte_rendu: f.compte_rendu, p_prochaine_relance: f.relance || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('enregistrer_action_prospect', v.data)))) { setF({ type: 'appel', date: aujourdhui(), compte_rendu: '', relance: '' }); apres(); }
  };
  const statut = async (s: 'qualifie' | 'consultation' | 'perdu') => {
    if (s === 'perdu' && motif.trim().length < 5) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('changer_statut_prospect', { p_prospect: id, p_statut: s, p_motif: s === 'perdu' ? motif.trim().slice(0, 1000) : null })))) apres();
  };
  const convertir = async () => {
    if (await a.executer(async () => ok(await supabase.rpc('convertir_prospect', { p_prospect: id })))) { onChange(); nav('/clients'); }
  };
  return (
    <Tiroir titre={x ? `${x.reference} — ${x.raison_sociale}` : t('prospects.titre')} onClose={onClose}>
      <Bandeau type="err">{p.erreur ?? ac.erreur ?? a.erreur}</Bandeau>
      {x && <>
        <div><Statut statut={TON[x.statut] ?? 'neutre'} libelle={t(`prospects.statuts.${x.statut}`)} /> · {t(`prospects.sources.${x.source}`)} · {x.pays}
          · {t(`prospects.specialites.${x.specialite}`)}{x.segment ? ` · ${x.segment}` : ''}</div>
        <div className="mute">{[x.contact_nom, x.contact_fonction, x.email, x.telephone].filter(Boolean).join(' · ')}</div>
        <div className="mute">{t('prospects.responsable')} : {x.responsable_id ? profils[x.responsable_id] ?? '—' : '—'}
          {x.premier_contact_le ? ` · ${t('prospects.premier_contact_le', { date: date(x.premier_contact_le, langue) })}` : ''}</div>
        {x.message && <p style={{ whiteSpace: 'pre-wrap' }}>{x.message}</p>}
        {x.page_origine && <div className="mute">{t('prospects.page_origine')} : {x.page_origine}</div>}
        {x.fichiers.length > 0 && <span className="actions" style={{ flexWrap: 'wrap' }}>{x.fichiers.map((c, i) => <Bouton key={c} petit onClick={() => void ouvrir(c)}>{t('approbation.piece', { n: i + 1 })}</Bouton>)}</span>}
        {x.motif_perte && <div className="mute">{t('prospects.motif_perte')} : {x.motif_perte}</div>}

        <div className="section-titre">{t('prospects.actions')}</div>
        {(ac.data ?? []).length === 0 ? <span className="mute">{t('prospects.aucune_action')}</span> : (
          <table className="t"><tbody>{(ac.data ?? []).map((y) => (
            <tr key={y.id}><td className="ref">{date(y.date_action, langue)}</td><td>{t(`prospects.types.${y.type}`)}</td>
              <td>{y.compte_rendu}{y.prochaine_relance && <div className="mute">{t('prospects.relance')} : {date(y.prochaine_relance, langue)}</div>}</td>
              <td className="sec">{y.cree_par ? profils[y.cree_par] ?? '' : t('prospects.sources.site_web')}</td></tr>))}</tbody></table>
        )}
        {ouvert && <>
          <div className="actions" style={{ flexWrap: 'wrap' }}>
            <select value={f.type} aria-label={t('prospects.type')} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {TYPES.map((y) => <option key={y} value={y}>{t(`prospects.types.${y}`)}</option>)}</select>
            <input type="date" aria-label={t('reception.date')} max={aujourdhui()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
            <input type="date" aria-label={t('prospects.relance')} min={aujourdhui()} value={f.relance} onChange={(e) => setF({ ...f, relance: e.target.value })} />
          </div>
          <Champ label={t('prospects.compte_rendu')}><textarea rows={2} maxLength={4000} value={f.compte_rendu} onChange={(e) => setF({ ...f, compte_rendu: e.target.value })} /></Champ>
          <Bouton petit variante="primaire" disabled={a.enCours} onClick={() => void action()}>{t('prospects.enregistrer_action')}</Bouton>

          <div className="section-titre">{t('prospects.suite')}</div>
          <div className="actions" style={{ flexWrap: 'wrap' }}>
            {x.statut !== 'qualifie' && x.statut !== 'consultation' && <Bouton petit disabled={a.enCours || !x.premier_contact_le} onClick={() => void statut('qualifie')}>{t('prospects.qualifier')}</Bouton>}
            {x.statut !== 'consultation' && <Bouton petit disabled={a.enCours || !x.premier_contact_le} onClick={() => void statut('consultation')}>{t('prospects.passer_consultation')}</Bouton>}
            <Bouton petit variante="primaire" disabled={a.enCours || !x.premier_contact_le} onClick={() => void convertir()}>{t('prospects.convertir')}</Bouton>
          </div>
          <div className="actions" style={{ flexWrap: 'wrap' }}>
            <input value={motif} maxLength={1000} placeholder={t('champs.motif')} aria-label={t('champs.motif')} onChange={(e) => setMotif(e.target.value)} />
            <Bouton petit variante="danger" disabled={a.enCours || motif.trim().length < 5} onClick={() => void statut('perdu')}>{t('prospects.marquer_perdu')}</Bouton>
          </div>
          {!x.premier_contact_le && <p className="mute">{t('prospects.aide_premier_contact')}</p>}
        </>}
      </>}
    </Tiroir>
  );
}
