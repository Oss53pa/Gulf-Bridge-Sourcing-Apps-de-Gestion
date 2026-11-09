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
import { Bandeau, Bouton, CadreTableau, Champ, Entete, Onglets, Statut, Tiroir, Vide } from '../components/ui';
import { Depot } from '../components/Depot';

export interface FicheNcData {
  id: string; reference: string; dossier_id: string; inspection_id: string | null; commande_id: string | null; fournisseur_id: string | null;
  gravite: 'critique' | 'majeur' | 'mineur'; description: string; photos: string[]; correction: string | null; delai: string | null;
  statut: 'ouverte' | 'corrigee' | 'close'; preuve: string | null; photos_correction: string[]; corrigee_le: string | null;
  contre_inspection_id: string | null; motif_cloture: string | null; hors_delai: boolean | null; close_le: string | null; cree_le: string;
  libelle_client: string | null; libelle_client_le: string | null;
}
interface Qualite { fournisseur_id: string; fournisseur: string; nc_12_mois: number; nc_ouvertes: number; nc_en_retard: number; critiques_12_mois: number; note_qualite: number }
type Filtre = 'a_traiter' | 'en_retard' | 'toutes';
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const aujourdhui = () => new Date().toISOString().slice(0, 10);
export const enRetard = (n: Pick<FicheNcData, 'statut' | 'delai'>, jour = aujourdhui()) => n.statut === 'ouverte' && !!n.delai && n.delai < jour;
const STATUT = { ouverte: 'att', corrigee: 'en_cours', close: 'ok' } as const;

export function NonConformites() {
  const { t } = useTranslation();

  const fournisseurs = useNoms('fournisseurs');
  const dossiers = useNoms('dossiers');
  const [onglet, setOnglet] = useState<'registre' | 'fournisseurs'>('registre');
  const [filtre, setFiltre] = useState<Filtre>('a_traiter');
  const [fiche, setFiche] = useState<string | null>(null);
  const l = useAsync(async () => ok(await supabase.from('non_conformites').select('*').order('cree_le', { ascending: false }).limit(1000)) as FicheNcData[], []);
  const q = useAsync(async () => ok(await supabase.rpc('qualite_fournisseurs')) as Qualite[], []);
  const seuils = useAsync(async () => (ok(await supabase.from('parametres').select('valeur').eq('cle', 'qualite.seuils_note').lte('date_effet', aujourdhui())
    .order('date_effet', { ascending: false }).limit(1)) as { valeur: { vert: number; orange: number } }[])[0]?.valeur ?? { vert: 80, orange: 60 }, []);
  const sv = seuils.data ?? { vert: 80, orange: 60 };
  const toutes = l.data ?? [];
  const liste = toutes.filter((n) => filtre === 'toutes' || (filtre === 'en_retard' ? enRetard(n) : n.statut !== 'close'));
  const choisie = liste.find((n) => n.id === fiche) ?? liste[0] ?? null;
  const ouvertes = toutes.filter((n) => n.statut !== 'close');
  const titre = t('nc.titre_ouvertes', { n: ouvertes.length }) + (ouvertes.length ? ` ; ${t('nc.titre_detail', { c: ouvertes.filter((n) => n.gravite === 'critique').length, r: ouvertes.filter((n) => n.statut === 'corrigee').length })}` : '');
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.qualite')} · ${t('nc.surtitre')} · NCF`} titre={l.data ? titre : t('nc.titre')} />
      <Onglets items={[{ id: 'registre', lib: t('nc.registre') }, { id: 'fournisseurs', lib: t('nc.qualite_fournisseurs') }]} actif={onglet} onChange={setOnglet} />
      <Bandeau type="err">{l.erreur ?? q.erreur}</Bandeau>
      {onglet === 'registre' && (
        <div className="ref-grille nc-grille">
          <div className="cadre">
            <Onglets actif={filtre} onChange={setFiltre} items={(['a_traiter', 'en_retard', 'toutes'] as const).map((f) => ({ id: f, lib: t(`nc.filtres.${f}`) }))} />
            {liste.length === 0 ? <Vide>{t('inspections.aucune_nc')}</Vide> : (
              <table className="t"><thead><tr><th>{t('nc.reference')}</th><th>{t('nc.defaut_fabricant')}</th><th>{t('inspections.gravite')}</th>
                <th>{t('inspections.delai')}</th><th>{t('nc.statut')}</th></tr></thead>
                <tbody>{liste.map((n) => (
                  <tr key={n.id} className={'cliquable' + (choisie?.id === n.id ? ' choisi' : '')} onClick={() => setFiche(n.id)}>
                    <td className="ref">{n.reference}<div className="mute">{dossiers[n.dossier_id] ?? ''}</div></td>
                    <td><div style={{ fontWeight: 500 }}>{n.description}</div><div className="mute">{n.fournisseur_id ? fournisseurs[n.fournisseur_id] ?? '' : ''}</div></td>
                    <td><Statut statut={n.gravite === 'critique' ? 'err' : n.gravite === 'majeur' ? 'att' : 'neutre'} libelle={t(`gravites.${n.gravite}`)} /></td>
                    <td className={'ref' + (enRetard(n) ? ' txt-err' : '')}>{n.delai ? `${n.delai.slice(8, 10)}.${n.delai.slice(5, 7)}` : '—'}</td>
                    <td><Statut statut={STATUT[n.statut]} libelle={t(`statuts_nc.${n.statut}`)} /></td></tr>))}</tbody></table>
            )}
          </div>
          {choisie && <FicheNcContenu key={choisie.id} id={choisie.id} onChange={() => { void l.recharger(); void q.recharger(); }} />}
        </div>
      )}
      {onglet === 'fournisseurs' && (
        <CadreTableau titre={t('nc.qualite_fournisseurs')}>
          {(q.data ?? []).length === 0 ? <Vide>{t('nc.aucun_fournisseur')}</Vide> : (
            <table className="t"><thead><tr><th>{t('nc.fournisseur')}</th><th className="num">{t('nc.nc_12_mois')}</th><th className="num">{t('nc.critiques')}</th>
              <th className="num">{t('nc.ouvertes')}</th><th className="num">{t('nc.en_retard')}</th><th className="num">{t('nc.note_qualite')}</th></tr></thead>
              <tbody>{(q.data ?? []).map((x) => (
                <tr key={x.fournisseur_id}><td>{x.fournisseur}</td><td className="num">{x.nc_12_mois}</td><td className="num">{x.critiques_12_mois}</td>
                  <td className="num">{x.nc_ouvertes}</td><td className="num">{x.nc_en_retard}</td>
                  <td className="num"><Statut statut={Number(x.note_qualite) >= sv.vert ? 'ok' : Number(x.note_qualite) >= sv.orange ? 'att' : 'err'} libelle={`${Number(x.note_qualite)} / 100`} /></td></tr>))}</tbody></table>
          )}
          <p className="mute">{t('nc.aide_note')}</p>
        </CadreTableau>
      )}
    </div>
  );
}

function Photos({ chemins }: { chemins: string[] }) {
  const { t } = useTranslation();
  const ouvrir = async (c: string) => { const u = await urlSignee(c); if (u) window.open(u, '_blank', 'noopener,noreferrer'); };
  if (chemins.length === 0) return <span className="mute">{t('nc.aucune_photo')}</span>;
  return <span className="actions" style={{ flexWrap: 'wrap' }}>{chemins.map((c, i) => <Bouton key={c} petit onClick={() => void ouvrir(c)}>{t('nc.photo', { n: i + 1 })}</Bouton>)}</span>;
}

/** Fiche d'une non-conformité dans un tiroir (depuis le rapport d'inspection). */
export function FicheNc({ id, onClose, onChange }: { id: string; onClose: () => void; onChange: () => void }) {
  const { t } = useTranslation();
  return <Tiroir titre={t('nc.titre')} onClose={onClose}><FicheNcContenu id={id} onChange={onChange} /></Tiroir>;
}

/** Contenu d'une fiche de non-conformité et actions de son cycle, selon le statut et le rôle. */
export function FicheNcContenu({ id, onChange }: { id: string; onChange: () => void }) {
  const fournisseurs = useNoms('fournisseurs');
  const dossiers = useNoms('dossiers');
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
  const [f, setF] = useState({ correction: '', delai: '', preuve: '', contre: '', motif: '', libelle: '' });
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
  const publier = async (retirer: boolean) => {
    const v = z.object({ p_nc: z.string().uuid(), p_libelle: z.string().trim().min(10).max(1000).nullable() }).strict()
      .safeParse({ p_nc: id, p_libelle: retirer ? null : f.libelle });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('publier_nc_client', v.data)))) { setF((g) => ({ ...g, libelle: '' })); apres(); }
  };
  const clore = async () => {
    const v = z.object({ p_nc: z.string().uuid(), p_contre_inspection: z.string().uuid().nullable(), p_motif: z.string().trim().max(1000).nullable() }).strict()
      .safeParse({ p_nc: id, p_contre_inspection: f.contre || null, p_motif: f.motif.trim() || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('clore_nc', v.data)))) apres();
  };
  return (
    <div className="nc-fiche">
      <Bandeau type="err">{n.erreur ?? ci.erreur ?? a.erreur}</Bandeau>
      {x && <>
        <div className="surtitre">{x.reference}</div>
        <div className="cons-action">{x.description}</div>
        <div className="actions"><span className="mute">{x.fournisseur_id ? fournisseurs[x.fournisseur_id] ?? '' : ''}</span>
          <Statut statut={STATUT[x.statut]} libelle={t(`statuts_nc.${x.statut}`)} />{enRetard(x) && <Statut statut="err" libelle={t('nc.retard')} />}</div>
        <div className="pf-champs" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <div><span>{t('champs.dossier')}</span><b>{dossiers[x.dossier_id] ?? '—'}</b></div>
          <div><span>{t('nc.origine')}</span><b>{x.inspection_id ? <Link to={`/inspections/${x.inspection_id}`}>{t('nc.voir_inspection')}</Link> : '—'}</b></div>
          <div><span>{t('inspections.gravite')}</span><b>{t(`gravites.${x.gravite}`)}</b></div>
          <div><span>{t('inspections.delai')}</span><b className={enRetard(x) ? 'txt-err' : ''}>{x.delai ? date(x.delai, langue) : '—'}</b></div>
          <div><span>{t('nc.ouverte_le')}</span><b>{date(x.cree_le, langue)}</b></div>
          <div><span>{t('nc.corrigee_le')}</span><b>{x.corrigee_le ? date(x.corrigee_le, langue) : '—'}</b></div>
        </div>
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
        <div className="section-titre">{t('nc.libelle_client')}</div>
        {x.libelle_client ? <p>{x.libelle_client}<br /><span className="mute">{t('nc.publie_le', { d: date(x.libelle_client_le, langue) })}</span></p>
          : <p className="mute">{t('nc.non_publie')}</p>}
        {agit && <>
          <Champ label={x.libelle_client ? t('nc.remplacer_libelle') : t('nc.libelle_client')}><textarea rows={2} maxLength={1000} value={f.libelle} onChange={(e) => setF({ ...f, libelle: e.target.value })} /></Champ>
          <p className="mute">{t('nc.aide_libelle_client')}</p>
          <div className="actions">
            <Bouton disabled={a.enCours || f.libelle.trim().length < 10} onClick={() => void publier(false)}>{t('nc.publier_client')}</Bouton>
            {x.libelle_client && <Bouton disabled={a.enCours} onClick={() => void publier(true)}>{t('nc.retirer_client')}</Bouton>}
          </div>
        </>}
        {x.statut === 'close' && <p className="mute">{t('nc.close_le', { date: date(x.close_le, langue) })}{x.hors_delai ? ` · ${t('nc.hors_delai')}` : ''}{x.motif_cloture ? ` · ${x.motif_cloture}` : ''}</p>}
      </>}
    </div>
  );
}
