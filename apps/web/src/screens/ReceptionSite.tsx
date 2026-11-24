// Préparer la réception sur site : l'équipe propose des créneaux et les points « site prêt » ;
// le client choisit, coche et confirme. Règles et droits tenus par la base (migration 71).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { dateHeure } from '../lib/format';
import { Bandeau, Bouton, Champ, Statut } from '../components/ui';

interface Creneau { date: string; moment: 'matin' | 'apres_midi' }
interface Reception { expedition_id: string; reference?: string; creneaux: Creneau[]; creneau_choisi: number | null; points: { libelle: string; pret: boolean }[]; confirmee_le: string | null }

export function libelleCreneau(c: Creneau, t: (k: string, o?: Record<string, unknown>) => string, langue: string) {
  return `${new Date(c.date + 'T12:00:00').toLocaleDateString(langue, { weekday: 'short', day: '2-digit', month: '2-digit' })} · ${t(`recsite.moments.${c.moment}`)}`;
}

/** Fiche expédition (équipe) : créneaux proposés et points à vérifier ; état de la préparation du client. */
export function PreparerReception({ expeditionId, livree }: { expeditionId: string; livree: boolean }) {
  const { t } = useTranslation();
  const { langue, fuseau } = useAuth();
  const r = useAsync(async () => ok(await supabase.from('receptions_site').select('expedition_id, creneaux, creneau_choisi, points, confirmee_le').eq('expedition_id', expeditionId).maybeSingle()) as Reception | null, [expeditionId]);
  const a = useAction();
  const [edit, setEdit] = useState<{ creneaux: Creneau[]; points: string; motif: string } | null>(null);
  const ouvrir = () => setEdit({ creneaux: r.data?.creneaux?.length ? r.data.creneaux : [{ date: '', moment: 'matin' }],
    points: (r.data?.points ?? []).map((p) => p.libelle).join('\n') || t('recsite.points_defaut'), motif: '' });
  const enregistrer = async () => {
    if (!edit) return;
    const v = z.object({ creneaux: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), moment: z.enum(['matin', 'apres_midi']) }).strict()).min(1).max(6),
      points: z.array(z.string().trim().min(3).max(160)).max(10), motif: z.string().trim().min(5).max(1000).nullable() }).strict()
      .safeParse({ creneaux: edit.creneaux.filter((c) => c.date), points: edit.points.split('\n').map((x) => x.trim()).filter(Boolean), motif: edit.motif.trim() || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    const p = v.data.motif ? v.data : { creneaux: v.data.creneaux, points: v.data.points };
    if (await a.executer(async () => ok(await supabase.rpc('preparer_reception_site', { p_expedition: expeditionId, p })))) { setEdit(null); void r.recharger(); }
  };
  const x = r.data;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="liv-pv"><span className="section-titre">{t('recsite.titre')}</span>
        {!livree && !edit && <Bouton petit onClick={ouvrir}>{x ? t('recsite.modifier') : t('recsite.proposer')}</Bouton>}</div>
      <Bandeau type="err">{r.erreur ?? a.erreur}</Bandeau>
      {!x && !edit && <span className="mute">{t('recsite.aucune')}</span>}
      {x && !edit && <>
        <div className="grl-regle"><span>{t('recsite.creneau')}</span><b>{x.creneau_choisi !== null ? libelleCreneau(x.creneaux[x.creneau_choisi], t, langue) : t('recsite.non_choisi')}</b></div>
        {x.points.map((p, i) => <div key={i} className="grl-regle"><span>{p.libelle}</span><span className="nowrap"><Statut statut={p.pret ? 'ok' : 'att'} libelle={p.pret ? t('recsite.pret') : t('recsite.a_verifier')} /></span></div>)}
        <Statut statut={x.confirmee_le ? 'ok' : 'neutre'} libelle={x.confirmee_le ? t('recsite.confirmee_le', { d: dateHeure(x.confirmee_le, langue, fuseau) }) : t('recsite.non_confirmee')} />
      </>}
      {edit && <div className="carte" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {edit.creneaux.map((c, i) => <div key={i} className="grille2">
          <Champ label={`${t('recsite.creneau')} ${i + 1}`}><input type="date" min={new Date().toISOString().slice(0, 10)} value={c.date}
            onChange={(e) => setEdit({ ...edit, creneaux: edit.creneaux.map((y, j) => (j === i ? { ...y, date: e.target.value } : y)) })} /></Champ>
          <Champ label={t('recsite.moment')}><select value={c.moment} onChange={(e) => setEdit({ ...edit, creneaux: edit.creneaux.map((y, j) => (j === i ? { ...y, moment: e.target.value as Creneau['moment'] } : y)) })}>
            <option value="matin">{t('recsite.moments.matin')}</option><option value="apres_midi">{t('recsite.moments.apres_midi')}</option></select></Champ></div>)}
        {edit.creneaux.length < 6 && <div><Bouton petit onClick={() => setEdit({ ...edit, creneaux: [...edit.creneaux, { date: '', moment: 'matin' }] })}>{t('recsite.ajouter_creneau')}</Bouton></div>}
        <Champ label={t('recsite.points')}><textarea rows={4} value={edit.points} onChange={(e) => setEdit({ ...edit, points: e.target.value })} /></Champ>
        {x?.confirmee_le && <Champ label={t('recsite.motif_reouverture')}><input maxLength={1000} value={edit.motif} onChange={(e) => setEdit({ ...edit, motif: e.target.value })} /></Champ>}
        <div className="actions"><Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
          <Bouton onClick={() => setEdit(null)}>{t('banque.annuler')}</Bouton></div>
      </div>}
    </section>
  );
}

/** Portail client : choisir le créneau, cocher les points, confirmer la réception. */
export function ReceptionsClient({ dossierId }: { dossierId: string }) {
  const { t } = useTranslation();
  const { langue, fuseau } = useAuth();
  const l = useAsync(async () => ok(await supabase.rpc('receptions_client', { p_dossier: dossierId })) as Reception[], [dossierId]);
  const a = useAction();
  const agir = async (fn: string, args: Record<string, unknown>) => { if (await a.executer(async () => ok(await supabase.rpc(fn, args)))) void l.recharger(); };
  if (!(l.data ?? []).length) return null;
  return (<>{(l.data ?? []).map((x) => {
    const prets = x.points.filter((p) => p.pret).length;
    const peut = x.creneau_choisi !== null && prets === x.points.length;
    return (
      <section key={x.expedition_id} className="ecl-bloc">
        <div className="liv-pv"><b>{t('recsite.preparer', { ref: x.reference ?? '' })}</b>
          <Statut statut={x.confirmee_le ? 'ok' : 'att'} libelle={x.confirmee_le ? t('recsite.confirmee_le', { d: dateHeure(x.confirmee_le, langue, fuseau) }) : t('recsite.a_confirmer')} /></div>
        <Bandeau type="err">{l.erreur ?? a.erreur}</Bandeau>
        <div className="surtitre">01 · {t('recsite.creneau')}</div>
        <div className="actions" style={{ flexWrap: 'wrap' }}>{x.creneaux.map((c, i) => (
          <Bouton key={i} petit variante={x.creneau_choisi === i ? 'primaire' : undefined} disabled={!!x.confirmee_le || a.enCours || c.date < new Date().toISOString().slice(0, 10)}
            onClick={() => void agir('choisir_creneau', { p_expedition: x.expedition_id, p_indice: i })}>{libelleCreneau(c, t, langue)}</Bouton>))}</div>
        <div className="surtitre">02 · {t('recsite.site_pret', { n: prets, total: x.points.length })}</div>
        {x.points.map((p, i) => (
          <label key={i} className="grl-regle" style={{ cursor: x.confirmee_le ? 'default' : 'pointer' }}><span>{p.libelle}</span>
            <input type="checkbox" checked={p.pret} disabled={!!x.confirmee_le || a.enCours}
              onChange={(e) => void agir('cocher_point_reception', { p_expedition: x.expedition_id, p_indice: i, p_pret: e.target.checked })} /></label>))}
        {!x.confirmee_le && <div className="actions"><Bouton variante="primaire" disabled={!peut || a.enCours} onClick={() => void agir('confirmer_reception_site', { p_expedition: x.expedition_id })}>{t('recsite.confirmer')}</Bouton>
          <span className="mute">{x.creneau_choisi === null ? t('recsite.choisir_creneau') : !peut ? t('recsite.points_restants', { n: x.points.length - prets }) : t('recsite.tout_pret')}</span></div>}
        {x.confirmee_le && x.creneau_choisi !== null && <span className="sec">{t('recsite.livraison_le', { c: libelleCreneau(x.creneaux[x.creneau_choisi], t, langue) })}</span>}
      </section>);
  })}</>);
}
