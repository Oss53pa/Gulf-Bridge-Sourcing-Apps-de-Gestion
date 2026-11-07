// Lot 1, M27 : registre des non-conformités, fiche et actions correctives, note qualité des fournisseurs.
// Le cycle (correction exigée, déclarée, contre-inspection, clôture) est imposé par la base.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date } from '../lib/format';
import { useNoms } from '../lib/referentiels';
import { urlSignee } from '../lib/fichiers';
import { Bandeau, Bouton, CadreTableau, Champ, Entete, Kpis, Onglets, Statut, Tiroir, Vide } from '../components/ui';
import { Depot } from '../components/Depot';

export interface FicheNcData {
  id: string; reference: string; dossier_id: string; inspection_id: string | null; commande_id: string | null; fournisseur_id: string | null;
  gravite: 'critique' | 'majeur' | 'mineur'; description: string; photos: string[]; correction: string | null; delai: string | null;
  statut: 'ouverte' | 'corrigee' | 'close'; preuve: string | null; photos_correction: string[]; corrigee_le: string | null;
  contre_inspection_id: string | null; motif_cloture: string | null; hors_delai: boolean | null; close_le: string | null; cree_le: string;
}
interface Qualite { fournisseur_id: string; fournisseur: string; nc_12_mois: number; nc_ouvertes: number; nc_en_retard: number; critiques_12_mois: number; note_qualite: number }
type Filtre = 'a_traiter' | 'en_retard' | 'toutes';
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const aujourdhui = () => new Date().toISOString().slice(0, 10);
export const enRetard = (n: Pick<FicheNcData, 'statut' | 'delai'>, jour = aujourdhui()) => n.statut === 'ouverte' && !!n.delai && n.delai < jour;
const STATUT = { ouverte: 'att', corrigee: 'en_cours', close: 'ok' } as const;

export function NonConformites() {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const fournisseurs = useNoms('fournisseurs');
  const dossiers = useNoms('dossiers');
  const [onglet, setOnglet] = useState<'registre' | 'fournisseurs'>('registre');
  const [filtre, setFiltre] = useState<Filtre>('a_traiter');
  const [fiche, setFiche] = useState<string | null>(null);
  const l = useAsync(async () => ok(await supabase.from('non_conformites').select('*').order('cree_le', { ascending: false }).limit(1000)) as FicheNcData[], []);
  const q = useAsync(async () => ok(await supabase.rpc('qualite_fournisseurs')) as Qualite[], []);
  const toutes = l.data ?? [];
  const liste = toutes.filter((n) => filtre === 'toutes' || (filtre === 'en_retard' ? enRetard(n) : n.statut !== 'close'));
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.qualite')} · M27`} titre={t('nc.titre')} />
      <Kpis items={[
        { lib: t('nc.ouvertes'), val: String(toutes.filter((n) => n.statut === 'ouverte').length), sous: t('nc.ouvertes_sous') },
        { lib: t('nc.a_clore'), val: String(toutes.filter((n) => n.statut === 'corrigee').length), sous: t('nc.a_clore_sous') },
        { lib: t('nc.en_retard'), val: String(toutes.filter((n) => enRetard(n)).length), sous: t('nc.en_retard_sous') },
        { lib: t('nc.critiques'), val: String(toutes.filter((n) => n.gravite === 'critique' && n.statut !== 'close').length), sous: t('nc.critiques_sous') },
      ]} />
      <Onglets items={[{ id: 'registre', lib: t('nc.registre') }, { id: 'fournisseurs', lib: t('nc.qualite_fournisseurs') }]} actif={onglet} onChange={setOnglet} />
      <Bandeau type="err">{l.erreur ?? q.erreur}</Bandeau>
      {onglet === 'registre' && (
        <CadreTableau titre={t('nc.registre')} outils={
          <select value={filtre} onChange={(e) => setFiltre(e.target.value as Filtre)} aria-label={t('nc.filtre')}>
            {(['a_traiter', 'en_retard', 'toutes'] as const).map((f) => <option key={f} value={f}>{t(`nc.filtres.${f}`)}</option>)}</select>}>
          {liste.length === 0 ? <Vide>{t('inspections.aucune_nc')}</Vide> : (
            <table className="t"><thead><tr><th>{t('nc.reference')}</th><th>{t('champs.dossier')}</th><th>{t('nc.fournisseur')}</th><th>{t('inspections.gravite')}</th>
              <th>{t('champs.description')}</th><th>{t('inspections.delai')}</th><th>{t('nc.statut')}</th></tr></thead>
              <tbody>{liste.map((n) => (
                <tr key={n.id} className="cliquable" onClick={() => setFiche(n.id)}>
                  <td className="ref">{n.reference}</td><td className="ref">{dossiers[n.dossier_id] ?? '—'}</td>
                  <td>{n.fournisseur_id ? fournisseurs[n.fournisseur_id] ?? '—' : '—'}</td><td>{t(`gravites.${n.gravite}`)}</td>
                  <td>{n.description}</td>
                  <td className="ref">{n.delai ? date(n.delai, langue) : '—'}{enRetard(n) && <div><Statut statut="err" libelle={t('nc.retard')} /></div>}</td>
                  <td><Statut statut={STATUT[n.statut]} libelle={t(`statuts_nc.${n.statut}`)} /></td></tr>))}</tbody></table>
          )}
        </CadreTableau>
      )}
      {onglet === 'fournisseurs' && (
        <CadreTableau titre={t('nc.qualite_fournisseurs')}>
          {(q.data ?? []).length === 0 ? <Vide>{t('nc.aucun_fournisseur')}</Vide> : (
            <table className="t"><thead><tr><th>{t('nc.fournisseur')}</th><th className="num">{t('nc.nc_12_mois')}</th><th className="num">{t('nc.critiques')}</th>
              <th className="num">{t('nc.ouvertes')}</th><th className="num">{t('nc.en_retard')}</th><th className="num">{t('nc.note_qualite')}</th></tr></thead>
              <tbody>{(q.data ?? []).map((x) => (
                <tr key={x.fournisseur_id}><td>{x.fournisseur}</td><td className="num">{x.nc_12_mois}</td><td className="num">{x.critiques_12_mois}</td>
                  <td className="num">{x.nc_ouvertes}</td><td className="num">{x.nc_en_retard}</td>
                  <td className="num"><Statut statut={Number(x.note_qualite) >= 80 ? 'ok' : Number(x.note_qualite) >= 60 ? 'att' : 'err'} libelle={`${Number(x.note_qualite)} / 100`} /></td></tr>))}</tbody></table>
          )}
          <p className="mute">{t('nc.aide_note')}</p>
        </CadreTableau>
      )}
      {fiche && <FicheNc id={fiche} onClose={() => setFiche(null)} onChange={() => { void l.recharger(); void q.recharger(); }} />}
    </div>
  );
}

function Photos({ chemins }: { chemins: string[] }) {
  const { t } = useTranslation();
  const ouvrir = async (c: string) => { const u = await urlSignee(c); if (u) window.open(u, '_blank', 'noopener,noreferrer'); };
  if (chemins.length === 0) return <span className="mute">{t('nc.aucune_photo')}</span>;
  return <span className="actions" style={{ flexWrap: 'wrap' }}>{chemins.map((c, i) => <Bouton key={c} petit onClick={() => void ouvrir(c)}>{t('nc.photo', { n: i + 1 })}</Bouton>)}</span>;
}

/** Fiche d'une non-conformité et actions de son cycle, selon le statut et le rôle. */
export function FicheNc({ id, onClose, onChange }: { id: string; onClose: () => void; onChange: () => void }) {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const agit = ['admin', 'achats_chine'].includes(profil?.role ?? '');
  const n = useAsync(async () => ok(await supabase.from('non_conformites').select('*').eq('id', id).maybeSingle()) as FicheNcData | null, [id]);
  const x = n.data;
  const ci = useAsync(async () => {
    if (!x || x.statut !== 'corrigee') return [];
    let r = supabase.from('inspections').select('id, reference, type, date_realisee, decision_proposee, statut').eq('dossier_id', x.dossier_id)
      .in('type', ['contre_inspection', 'inspection_seule']).in('statut', ['realisee', 'validee']).neq('id', x.inspection_id ?? '00000000-0000-0000-0000-000000000000');
    if (x.commande_id) r = r.eq('commande_id', x.commande_id);
    return ok(await r) as { id: string; reference: string; date_realisee: string | null; decision_proposee: string | null }[];
  }, [x?.id, x?.statut]);
  const a = useAction();
  const [f, setF] = useState({ correction: '', delai: '', preuve: '', contre: '', motif: '' });
  const [photos, setPhotos] = useState<string[]>([]);
  const apres = () => { void n.recharger(); onChange(); };
  const exiger = async () => {
    const v = z.object({ p_nc: z.string().uuid(), p_correction: z.string().trim().min(10).max(4000), p_delai: DATE }).strict()
      .safeParse({ p_nc: id, p_correction: f.correction, p_delai: f.delai });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('exiger_correction_nc', v.data)))) apres();
  };
  const declarer = async () => {
    const v = z.object({ p_nc: z.string().uuid(), p_preuve: z.string().trim().min(10).max(4000), p_photos: z.array(z.string().max(200)).max(20) }).strict()
      .safeParse({ p_nc: id, p_preuve: f.preuve, p_photos: photos });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('declarer_correction_nc', v.data)))) { setPhotos([]); apres(); }
  };
  const clore = async () => {
    const v = z.object({ p_nc: z.string().uuid(), p_contre_inspection: z.string().uuid().nullable(), p_motif: z.string().trim().max(1000).nullable() }).strict()
      .safeParse({ p_nc: id, p_contre_inspection: f.contre || null, p_motif: f.motif.trim() || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('clore_nc', v.data)))) apres();
  };
  return (
    <Tiroir titre={x ? `${x.reference} — ${t(`gravites.${x.gravite}`)}` : t('nc.titre')} onClose={onClose}>
      <Bandeau type="err">{n.erreur ?? ci.erreur ?? a.erreur}</Bandeau>
      {x && <>
        <div><Statut statut={STATUT[x.statut]} libelle={t(`statuts_nc.${x.statut}`)} />{enRetard(x) && <> <Statut statut="err" libelle={t('nc.retard')} /></>}
          {x.inspection_id && <> · <Link to={`/inspections/${x.inspection_id}`}>{t('nc.voir_inspection')}</Link></>}</div>
        <div className="section-titre">{t('champs.description')}</div>
        <p>{x.description}</p>
        <Photos chemins={x.photos} />
        <div className="section-titre">{t('nc.correction_exigee')}</div>
        {x.correction ? <p>{x.correction}<br /><span className="mute">{t('inspections.delai')} : {x.delai ? date(x.delai, langue) : '—'}</span></p>
          : agit && x.statut === 'ouverte' ? <>
            <Champ label={t('nc.correction_exigee')}><textarea rows={3} maxLength={4000} value={f.correction} onChange={(e) => setF({ ...f, correction: e.target.value })} /></Champ>
            <Champ label={t('inspections.delai')}><input type="date" min={aujourdhui()} value={f.delai} onChange={(e) => setF({ ...f, delai: e.target.value })} /></Champ>
            <Bouton variante="primaire" disabled={a.enCours} onClick={() => void exiger()}>{t('nc.exiger')}</Bouton>
          </> : <span className="mute">—</span>}
        {(x.correction || x.preuve) && <div className="section-titre">{t('nc.correction_declaree')}</div>}
        {x.preuve ? <><p>{x.preuve}<br /><span className="mute">{date(x.corrigee_le, langue)}</span></p><Photos chemins={x.photos_correction} /></>
          : agit && x.statut === 'ouverte' && x.correction ? <>
            <Champ label={t('nc.preuve')}><textarea rows={3} maxLength={4000} value={f.preuve} onChange={(e) => setF({ ...f, preuve: e.target.value })} /></Champ>
            <Depot dossierId={x.dossier_id} valeur={null} onChange={(c) => setPhotos((p) => (p.length < 20 ? [...p, c] : p))} />
            {photos.length > 0 && <span className="mute">{t('nc.photos_jointes', { n: photos.length })}</span>}
            <p className="mute">{t('nc.aide_declaration')}</p>
            <Bouton variante="primaire" disabled={a.enCours} onClick={() => void declarer()}>{t('nc.declarer')}</Bouton>
          </> : null}
        {x.statut === 'corrigee' && agit && <>
          <div className="section-titre">{t('nc.cloture')}</div>
          <Champ label={t('nc.contre_inspection')}><select value={f.contre} onChange={(e) => setF({ ...f, contre: e.target.value })}>
            <option value="">{x.gravite === 'mineur' ? t('nc.sans_contre_inspection') : '—'}</option>
            {(ci.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.reference} · {date(c.date_realisee, langue)} · {c.decision_proposee ? t(`decisions.${c.decision_proposee}`) : '—'}</option>)}</select></Champ>
          <Champ label={t('champs.commentaire')}><input maxLength={1000} value={f.motif} onChange={(e) => setF({ ...f, motif: e.target.value })} /></Champ>
          <p className="mute">{t('nc.aide_cloture')}</p>
          <Bouton variante="primaire" disabled={a.enCours} onClick={() => void clore()}>{t('inspections.clore_nc')}</Bouton>
        </>}
        {x.statut === 'close' && <p className="mute">{t('nc.close_le', { date: date(x.close_le, langue) })}{x.hors_delai ? ` · ${t('nc.hors_delai')}` : ''}{x.motif_cloture ? ` · ${x.motif_cloture}` : ''}</p>}
      </>}
    </Tiroir>
  );
}
