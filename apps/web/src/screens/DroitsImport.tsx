import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date } from '../lib/format';
import { Bandeau, Bouton, Champ, Chargement, Tiroir, Vide } from '../components/ui';

interface LigneBareme { id: string; zone: 'UEMOA' | 'CEMAC'; code_sh: string; date_effet: string; droit_douane: number; redevance_statistique: number;
  prelevements_communautaires: number; autres_taxes: number; tva: number; source: string; commentaire: string | null; }

const TAUX = ['droit_douane', 'redevance_statistique', 'prelevements_communautaires', 'autres_taxes', 'tva'] as const;
const VIDE = { zone: 'UEMOA', code_sh: '', date_effet: '', droit_douane: '', redevance_statistique: '', prelevements_communautaires: '', autres_taxes: '', tva: '', source: '', commentaire: '' };

/** Barème des droits et taxes à l'import (lot 2) : lignes datées par zone et préfixe de code SH. Une ligne en vigueur
 *  est figée ; une ligne à venir se corrige ou se retire. Les taux se saisissent en pourcentage. */
export function DroitsImportParam() {
  const { t } = useTranslation();
  const { langue, profil } = useAuth();
  const admin = profil?.role === 'admin';
  const l = useAsync(async () => ok(await supabase.from('droits_import').select('*').order('zone').order('code_sh').order('date_effet', { ascending: false })) as LigneBareme[], []);
  const a = useAction();
  const [f, setF] = useState<typeof VIDE | null>(null);
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const pct = (n: number) => `${(Number(n) * 100).toLocaleString(langue, { maximumFractionDigits: 2 })} %`;
  const taux = (s: string) => (s.trim() === '' ? 0 : Number(s.replace(',', '.')) / 100);

  const enregistrer = async () => {
    if (!f) return;
    const v = z.object({ zone: z.enum(['UEMOA', 'CEMAC']), code_sh: z.string().regex(/^[0-9]{2}([0-9]{2}){0,4}$/), date_effet: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      droit_douane: z.number().min(0).max(1), redevance_statistique: z.number().min(0).max(0.1), prelevements_communautaires: z.number().min(0).max(0.1),
      autres_taxes: z.number().min(0).max(1), tva: z.number().min(0).max(0.5), source: z.string().trim().min(2).max(200), commentaire: z.string().trim().max(500) }).strict()
      .safeParse({ ...f, ...Object.fromEntries(TAUX.map((k) => [k, taux(f[k])])) });
    if (!v.success || f.droit_douane.trim() === '') { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('droits_import_enregistrer', { p: v.data })))) { setF(null); void l.recharger(); }
  };
  const retirer = async (id: string) => {
    if (await a.executer(async () => ok(await supabase.rpc('droits_import_retirer', { p_id: id })))) void l.recharger();
  };
  const modifier = (x: LigneBareme) => setF({ zone: x.zone, code_sh: x.code_sh, date_effet: x.date_effet, source: x.source, commentaire: x.commentaire ?? '',
    ...Object.fromEntries(TAUX.map((k) => [k, String(Math.round(Number(x[k]) * 10000) / 100)])) } as typeof VIDE);

  if (l.chargement && !l.data) return <Chargement />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p className="mute">{t('droits.aide')}</p>
      <Bandeau type="err">{l.erreur ?? a.erreur}</Bandeau>
      {admin && <div><Bouton variante="primaire" onClick={() => { a.setErreur(null); setF({ ...VIDE }); }}>{t('droits.nouvelle')}</Bouton></div>}
      {(l.data ?? []).length === 0 ? <Vide>{t('droits.vide')}</Vide> : (
        <table className="t">
          <thead><tr><th>{t('droits.zone')}</th><th>{t('droits.code_sh')}</th><th>{t('droits.date_effet')}</th>
            {TAUX.map((k) => <th key={k} className="num">{t(`droits.${k}`)}</th>)}<th>{t('droits.source')}</th><th /></tr></thead>
          <tbody>{(l.data ?? []).map((x) => {
            const futur = x.date_effet > aujourdhui;
            return (
              <tr key={x.id}><td>{x.zone}</td><td className="ref">{x.code_sh}</td>
                <td>{date(x.date_effet, langue)}{futur && <div className="mute">{t('droits.a_venir')}</div>}</td>
                {TAUX.map((k) => <td key={k} className="num">{pct(x[k])}</td>)}
                <td>{x.source}{x.commentaire && <div className="mute">{x.commentaire}</div>}</td>
                <td>{admin && futur && <><Bouton petit onClick={() => modifier(x)}>{t('droits.corriger')}</Bouton> <Bouton petit onClick={() => void retirer(x.id)}>{t('commun.retirer')}</Bouton></>}</td>
              </tr>);
          })}</tbody>
        </table>)}
      {f && (
        <Tiroir titre={t('droits.nouvelle')} onClose={() => setF(null)}>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <p className="mute">{t('droits.aide_saisie')}</p>
          <div className="grille2">
            <Champ label={t('droits.zone')}><select value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })}><option>UEMOA</option><option>CEMAC</option></select></Champ>
            <Champ label={t('droits.code_sh')}><input inputMode="numeric" maxLength={10} value={f.code_sh} onChange={(e) => setF({ ...f, code_sh: e.target.value.replace(/\D/g, '') })} /></Champ>
            <Champ label={t('droits.date_effet')}><input type="date" value={f.date_effet} onChange={(e) => setF({ ...f, date_effet: e.target.value })} /></Champ>
            {TAUX.map((k) => <Champ key={k} label={`${t(`droits.${k}`)} (%)`}><input inputMode="decimal" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Champ>)}
          </div>
          <Champ label={t('droits.source')}><input maxLength={200} value={f.source} placeholder={t('droits.source_aide')} onChange={(e) => setF({ ...f, source: e.target.value })} /></Champ>
          <Champ label={t('champs.commentaire')}><textarea maxLength={500} value={f.commentaire} onChange={(e) => setF({ ...f, commentaire: e.target.value })} /></Champ>
          <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
        </Tiroir>)}
    </div>
  );
}

interface RfqRendu { id: string; statut: string; article_id: string | null; fret_estime_xof: number | null; fret_source: string | null }

/** Article (code SH) et fret estimé d'une consultation : base du prix rendu des offres (droits et taxes à l'import). */
export function RenduConsultation({ rfq, onSaved }: { rfq: RfqRendu; onSaved: () => void }) {
  const { t } = useTranslation();
  const { langue, profil } = useAuth();
  const modifiable = ['admin', 'achats_chine'].includes(profil?.role ?? '') && ['ouverte', 'close'].includes(rfq.statut);
  const articles = useAsync(async () => ok(await supabase.from('articles').select('id, reference, designation, code_sh').is('archive_le', null).order('reference').limit(1000)) as
    { id: string; reference: string; designation: string; code_sh: string }[], []);
  const a = useAction();
  const [f, setF] = useState<{ article_id: string; fret: string; source: string } | null>(null);
  const art = (articles.data ?? []).find((x) => x.id === rfq.article_id);
  const enregistrer = async () => {
    if (!f) return;
    const v = z.object({ article_id: z.string().uuid().nullable(), fret_estime_xof: z.number().int().min(0).max(1e12).nullable(), fret_source: z.string().trim().max(200).nullable() }).strict()
      .safeParse({ article_id: f.article_id || null, fret_estime_xof: f.fret.trim() === '' ? null : Number(f.fret.replace(/\s/g, '')), fret_source: f.source.trim() || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('consultations_fournisseurs').update(v.data).eq('id', rfq.id)))) { setF(null); onSaved(); }
  };
  return (
    <div>
      <div className="section-titre">{t('droits.rendu_titre')}</div>
      <Bandeau type="err">{articles.erreur ?? a.erreur}</Bandeau>
      {!f ? (<>
        <dl className="dl">
          <dt>{t('droits.article')}</dt><dd>{art ? `${art.reference} · ${art.designation} · SH ${art.code_sh}` : '—'}</dd>
          <dt>{t('droits.fret_estime')}</dt><dd>{rfq.fret_estime_xof == null ? '—' : `${Number(rfq.fret_estime_xof).toLocaleString(langue)} FCFA`}{rfq.fret_source && <div className="mute">{rfq.fret_source}</div>}</dd>
        </dl>
        {modifiable && <Bouton petit onClick={() => setF({ article_id: rfq.article_id ?? '', fret: rfq.fret_estime_xof == null ? '' : String(rfq.fret_estime_xof), source: rfq.fret_source ?? '' })}>{t('droits.renseigner')}</Bouton>}
      </>) : (<>
        <p className="mute">{t('droits.aide_rendu')}</p>
        <Champ label={t('droits.article')}><select value={f.article_id} onChange={(e) => setF({ ...f, article_id: e.target.value })}>
          <option value="">—</option>{(articles.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.reference} · {x.designation} · SH {x.code_sh}</option>)}</select></Champ>
        <div className="grille2">
          <Champ label={t('droits.fret_estime')}><input inputMode="numeric" value={f.fret} onChange={(e) => setF({ ...f, fret: e.target.value })} /></Champ>
          <Champ label={t('droits.fret_source')}><input maxLength={200} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></Champ>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
          <Bouton onClick={() => setF(null)}>{t('commun.fermer')}</Bouton>
        </div>
      </>)}
    </div>
  );
}

interface Rendu { estime: boolean; manquants: string[]; zone: string | null; code_sh: string | null; bareme_code_sh?: string; bareme_date_effet?: string; bareme_source?: string;
  fret_xof?: number; assurance_xof?: number; caf_xof?: number; taux_droits?: number; droits_xof?: number; rendu_xof?: number; tva_import_xof?: number }

/** Décomposition du prix rendu d'une offre (lecture seule). */
export function PrixRendu({ offreId, fobXof }: { offreId: string; fobXof: number | null }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const r = useAsync(async () => ok(await supabase.rpc('prix_rendu', { p_offre: offreId })) as Rendu, [offreId]);
  const m = (n: number | null | undefined) => (n == null ? '—' : `${Number(n).toLocaleString(langue)} FCFA`);
  if (r.chargement && !r.data) return <Chargement />;
  if (r.erreur) return <Bandeau type="err">{r.erreur}</Bandeau>;
  const x = r.data;
  if (!x) return null;
  return (
    <div>
      <div className="section-titre">{t('droits.rendu_titre')}</div>
      {!x.estime ? <p className="mute">{t('droits.non_estime', { liste: x.manquants.map((k) => t(`droits.manquant.${k.startsWith('bareme_') ? 'bareme' : k.startsWith('zone_') ? 'zone' : k}`)).join(' · ') })}</p> : (
        <table className="t"><tbody>
          <tr><td>{t('droits.fob')}</td><td className="num">{m(fobXof)}</td></tr>
          <tr><td>{t('droits.fret_estime')}</td><td className="num">{m(x.fret_xof)}</td></tr>
          <tr><td>{t('droits.assurance')}</td><td className="num">{m(x.assurance_xof)}</td></tr>
          <tr><td><b>{t('droits.caf')}</b></td><td className="num"><b>{m(x.caf_xof)}</b></td></tr>
          <tr><td>{t('droits.droits_taxes', { zone: x.zone, sh: x.bareme_code_sh, taux: ((x.taux_droits ?? 0) * 100).toLocaleString(langue, { maximumFractionDigits: 2 }) })}
            <div className="mute">{x.bareme_source} · {x.bareme_date_effet && date(x.bareme_date_effet, langue)}</div></td><td className="num">{m(x.droits_xof)}</td></tr>
          <tr><td><b>{t('droits.rendu')}</b></td><td className="num"><b>{m(x.rendu_xof)}</b></td></tr>
          <tr><td className="mute">{t('droits.tva_info')}</td><td className="num mute">{m(x.tva_import_xof)}</td></tr>
        </tbody></table>)}
    </div>
  );
}
