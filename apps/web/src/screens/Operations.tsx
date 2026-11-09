import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, dateHeure } from '../lib/format';
import type { Commande, Constat, Dossier, Etape, Expedition, Inspection, NonConformite, Profil } from '../lib/types';
import { Bandeau, Bouton, Champ, Chargement, Entete, Kpis, Statut, Tiroir, Vide } from '../components/ui';
import { useNoms } from '../lib/referentiels';
import { Depot as Depotx } from '../components/Depot';
import { FicheNc } from './NonConformites';
import { PackDocumentaire } from './PackDocumentaire';
import { TransitaireExpedition } from './Transitaires';

// ============================================================================ Inspections
type InspectionListe = Inspection & { commandes: { fournisseur_id: string } | null };
const initiales = (nom: string | undefined) => (nom ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('') || '—';

/** Planning des inspections (maquette INS) : à valider, planifiées, à venir ; non-conformités qui bloquent la libération. */
export function Inspections() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { profil } = useAuth();
  const dossiers = useNoms('dossiers');
  const profils = useNoms('profils');
  const fournisseurs = useNoms('fournisseurs');
  const [creer, setCreer] = useState(Boolean(params.get('commande')));
  const l = useAsync(async () => ok(await supabase.from('inspections').select('*, commandes(fournisseur_id)')
    .order('date_prevue', { ascending: true, nullsFirst: false }).limit(500)) as unknown as InspectionListe[], []);
  const ncs = useAsync(async () => ok(await supabase.from('non_conformites').select('id, statut').neq('statut', 'close').limit(1000)) as { id: string; statut: string }[], []);
  const ecrit = ['admin', 'achats_chine'].includes(profil?.role ?? '');
  const tous = l.data ?? [];
  const jour = new Date().toISOString().slice(0, 10);
  const finSemaine = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const aValider = tous.filter((i) => i.statut === 'realisee');
  const planifiees = tous.filter((i) => i.statut === 'planifiee' && i.date_prevue && i.date_prevue >= jour && i.date_prevue <= finSemaine);
  const sansDate = tous.filter((i) => i.statut === 'planifiee' && !i.date_prevue);
  const mois = jour.slice(0, 7);
  const joursMois = new Set(tous.filter((i) => (i.date_realisee ?? '').startsWith(mois)).map((i) => `${i.inspecteur_id}|${i.date_realisee}`)).size;
  const aVenir = tous.filter((i) => i.statut === 'planifiee' && i.date_prevue).slice(0, 8);
  const ordre = ['realisee', 'planifiee', 'refusee', 'validee'];
  const liste = [...tous].sort((x, y) => ordre.indexOf(x.statut) - ordre.indexOf(y.statut) || (x.date_prevue ?? '9').localeCompare(y.date_prevue ?? '9'));
  const ddmm = (d: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '—');
  const ddmmaaaa = (d: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '—');
  const titre = [t('inspections.titre_valider', { n: aValider.length }), t('inspections.titre_semaine', { n: planifiees.length })].join(', ')
    + ((ncs.data ?? []).length ? ` ; ${t('inspections.titre_nc', { n: (ncs.data ?? []).length })}` : '');
  const objet = (i: InspectionListe) => i.produit ?? (dossiers[i.dossier_id] ?? '—');
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.qualite')} · ${t('inspections.surtitre')} · INS`} titre={l.data ? titre : t('ecrans.inspections')}
        actions={ecrit && <Bouton variante="primaire" onClick={() => setCreer(true)}>{t('inspections.planifier')}</Bouton>} />
      <Kpis items={[
        { lib: t('inspections.k_valider'), val: aValider.length, sous: t('inspections.k_valider_sous') },
        { lib: t('inspections.k_planifiees'), val: planifiees.length, sous: t('inspections.k_planifiees_sous') },
        { lib: t('inspections.k_sans_date'), val: sansDate.length, sous: t('inspections.k_sans_date_sous') },
        { lib: t('inspections.k_jours'), val: joursMois, sous: t('inspections.k_jours_sous') },
      ]} />
      <Bandeau type="err">{l.erreur ?? ncs.erreur}</Bandeau>
      <div className="fiche-grille">
        <div className="cadre fiche-principal">
          {l.chargement && !l.data ? <Chargement /> : tous.length === 0 ? <Vide>{t('inspections.aucune')}</Vide> : (
            <table className="t"><thead><tr><th>{t('inspections.inspection')}</th><th>{t('inspections.objet_fabricant_type')}</th><th>{t('champs.date')}</th>
              <th>{t('inspections.insp')}</th><th className="num">{t('inspections.lot')}</th><th>{t('champs.statut')}</th></tr></thead>
              <tbody>{liste.map((i) => (
                <tr key={i.id} className="cliquable" onClick={() => nav(`/inspections/${i.id}`)}>
                  <td className="ref">{i.reference}</td>
                  <td><div style={{ fontWeight: 500 }}>{objet(i)}</div>
                    <div className="mute">{[i.commandes ? fournisseurs[i.commandes.fournisseur_id] : null, t(`types_inspection.${i.type}`)].filter(Boolean).join(' · ')}</div></td>
                  <td className="ref">{ddmmaaaa(i.date_realisee ?? i.date_prevue)}</td>
                  <td className="sec" title={i.inspecteur_id ? profils[i.inspecteur_id] : undefined}>{i.inspecteur_id ? initiales(profils[i.inspecteur_id]) : '—'}</td>
                  <td className="num">{i.taille_lot}</td>
                  <td><Statut statut={i.statut} libelle={i.statut === 'validee' && i.decision ? `${t('statuts_inspection.validee')} · ${t(`inspections.decisions_finales.${i.decision}`)}` : i.statut === 'realisee' ? t('inspections.k_valider') : t(`statuts_inspection.${i.statut}`)} /></td>
                </tr>))}</tbody></table>
          )}
        </div>
        <aside className="fiche-cote">
          <section className="fiche-bloc">
            <div className="surtitre">{t('inspections.a_venir')}</div>
            {aVenir.length === 0 ? <span className="mute">{t('inspections.aucune_a_venir')}</span> : aVenir.map((i) => (
              <div key={i.id} className="ao-cal cliquable" onClick={() => nav(`/inspections/${i.id}`)}>
                <span className={'ref' + (i.date_prevue! <= jour ? ' txt-err' : '')}>{ddmm(i.date_prevue)}</span>
                <span><b>{objet(i)}</b><br /><span className="mute">{t(`types_inspection.${i.type}`)} · {i.inspecteur_id ? initiales(profils[i.inspecteur_id]) : '—'}</span></span>
              </div>))}
          </section>
        </aside>
      </div>
      {creer && <NouvelleInspection commandeInitiale={params.get('commande')} onClose={() => setCreer(false)} onOk={(id) => nav(`/inspections/${id}`)} />}
    </div>
  );
}

function NouvelleInspection({ commandeInitiale, onClose, onOk }: { commandeInitiale: string | null; onClose: () => void; onOk: (id: string) => void }) {
  const { t } = useTranslation();
  const cmds = useAsync(async () => ok(await supabase.from('commandes').select('id, reference, dossier_id, statut').neq('statut', 'annulee').order('reference', { ascending: false })) as Commande[], []);
  const ds = useAsync(async () => ok(await supabase.from('dossiers').select('id, reference, intitule, modele').eq('modele', 'inspection_seule').eq('statut', 'ouvert')) as Dossier[], []);
  const insp = useAsync(async () => ok(await supabase.from('profils').select('id, nom, role').eq('role', 'inspecteur').eq('actif', true)) as Profil[], []);
  const [f, setF] = useState({ commande_id: commandeInitiale ?? '', dossier_id: '', type: 'avant_expedition', inspecteur_id: '', date_prevue: '', lieu: '', produit: '', taille_lot: '', niveau: 'II', nqa_majeur: '2.5', nqa_mineur: '4.0' });
  const a = useAction();
  const seule = f.type === 'inspection_seule';
  const envoyer = async () => {
    const v = z.object({ commande_id: z.string().uuid().nullable(), dossier_id: z.string().uuid().nullable(), type: z.enum(['en_production', 'avant_expedition', 'contre_inspection', 'inspection_seule']),
      inspecteur_id: z.string().uuid().nullable(), date_prevue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), lieu: z.string().max(200).nullable(), produit: z.string().max(300).nullable(),
      taille_lot: z.number().int().min(2).max(1e7), niveau: z.enum(['I', 'II', 'III']), nqa_majeur: z.number(), nqa_mineur: z.number() }).strict()
      .refine((x) => (seule ? x.dossier_id : x.commande_id))
      .safeParse({ ...f, commande_id: seule ? null : f.commande_id || null, dossier_id: seule ? f.dossier_id || null : null, inspecteur_id: f.inspecteur_id || null,
        date_prevue: f.date_prevue || null, lieu: f.lieu || null, produit: f.produit || null, taille_lot: Number(f.taille_lot), nqa_majeur: Number(f.nqa_majeur), nqa_mineur: Number(f.nqa_mineur) });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    const corps = { ...v.data, dossier_id: v.data.dossier_id ?? (cmds.data ?? []).find((c) => c.id === v.data.commande_id)?.dossier_id };
    await a.executer(async () => { const r = ok(await supabase.from('inspections').insert(corps).select('id').single()) as { id: string }; onOk(r.id); });
  };
  const NQA = ['0.065', '0.10', '0.15', '0.25', '0.40', '0.65', '1.0', '1.5', '2.5', '4.0', '6.5'];
  return (
    <Tiroir titre={t('inspections.planifier')} onClose={onClose}>
      <Champ label={t('champs.type')}><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
        {['en_production', 'avant_expedition', 'contre_inspection', 'inspection_seule'].map((x) => <option key={x} value={x}>{t(`types_inspection.${x}`)}</option>)}</select></Champ>
      {seule ? (
        <Champ label={t('champs.dossier')}><select value={f.dossier_id} onChange={(e) => setF({ ...f, dossier_id: e.target.value })}>
          <option value="">—</option>{(ds.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.reference} · {d.intitule}</option>)}</select></Champ>
      ) : (
        <Champ label={t('champs.commande')}><select value={f.commande_id} onChange={(e) => setF({ ...f, commande_id: e.target.value })}>
          <option value="">—</option>{(cmds.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.reference}</option>)}</select></Champ>
      )}
      <div className="grille2">
        <Champ label={t('inspections.inspecteur')}><select value={f.inspecteur_id} onChange={(e) => setF({ ...f, inspecteur_id: e.target.value })}>
          <option value="">—</option>{(insp.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}</select></Champ>
        <Champ label={t('inspections.date_prevue')}><input type="date" value={f.date_prevue} onChange={(e) => setF({ ...f, date_prevue: e.target.value })} /></Champ>
        <Champ label={t('inspections.lot')}><input inputMode="numeric" value={f.taille_lot} onChange={(e) => setF({ ...f, taille_lot: e.target.value.replace(/\D/g, '') })} /></Champ>
        <Champ label={t('inspections.niveau')}><select value={f.niveau} onChange={(e) => setF({ ...f, niveau: e.target.value })}>{['I', 'II', 'III'].map((n) => <option key={n}>{n}</option>)}</select></Champ>
        <Champ label={t('inspections.nqa_majeur')}><select value={f.nqa_majeur} onChange={(e) => setF({ ...f, nqa_majeur: e.target.value })}>{NQA.map((n) => <option key={n}>{n}</option>)}</select></Champ>
        <Champ label={t('inspections.nqa_mineur')}><select value={f.nqa_mineur} onChange={(e) => setF({ ...f, nqa_mineur: e.target.value })}>{NQA.map((n) => <option key={n}>{n}</option>)}</select></Champ>
      </div>
      <Champ label={t('inspections.lieu')}><input value={f.lieu} maxLength={200} onChange={(e) => setF({ ...f, lieu: e.target.value })} /></Champ>
      <Champ label={t('inspections.produit')}><input value={f.produit} maxLength={300} onChange={(e) => setF({ ...f, produit: e.target.value })} /></Champ>
      <p className="mute">{t('inspections.aide_critique')}</p>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void envoyer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

export function RapportInspection() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const role = profil?.role ?? '';
  const i = useAsync(async () => ok(await supabase.from('inspections').select('*').eq('id', id).maybeSingle()) as Inspection | null, [id]);
  const cs = useAsync(async () => ok(await supabase.from('constats').select('*').eq('inspection_id', id).order('ordre')) as Constat[], [id]);
  const ncs = useAsync(async () => ok(await supabase.from('non_conformites').select('*').eq('inspection_id', id).order('cree_le')) as NonConformite[], [id]);
  const a = useAction();
  const [defauts, setDefauts] = useState<{ c: string; ma: string; mi: string } | null>(null);
  const [point, setPoint] = useState({ point: '', exigence: '', mesure: '', resultat: 'conforme', gravite: '', nombre: '0' });
  const [decision, setDecision] = useState<'liberation' | 'refus' | null>(null);
  const [motif, setMotif] = useState('');
  const [nc, setNc] = useState({ gravite: 'majeur', description: '', delai: '' });
  const [ncPhotos, setNcPhotos] = useState<string[]>([]);
  const [ficheNc, setFicheNc] = useState<string | null>(null);
  const [mesuresEtat, setMesuresEtat] = useState<Record<string, string>>({});
  const profils = useNoms('profils');
  const ref = useAsync(async () => {
    const aid = (i.data as (Inspection & { approbation_id?: string | null }) | null)?.approbation_id;
    return aid ? ok(await supabase.from('approbations_techniques').select('version, objet, echantillon_description, documents').eq('id', aid).maybeSingle()) as
      { version: number; objet: string; echantillon_description: string | null; documents: string[] } | null : null;
  }, [i.data]);
  const x = i.data;
  if (i.chargement) return <div className="screen"><Chargement /></div>;
  if (!x) return <div className="screen"><Vide>{i.erreur ?? t('inspections.introuvable')}</Vide></div>;
  const ouverte = !['validee', 'refusee'].includes(x.statut);
  const saisit = ouverte && (['admin', 'achats_chine'].includes(role) || (role === 'inspecteur' && x.inspecteur_id === profil?.id));
  const validateur = role === 'admin' || profil?.delegue_validation;
  const recharger = () => { void i.recharger(); void cs.recharger(); void ncs.recharger(); };
  const d = defauts ?? { c: String(x.defauts_critiques), ma: String(x.defauts_majeurs), mi: String(x.defauts_mineurs) };
  const enregistrerDefauts = async (realisee: boolean) => {
    const v = z.object({ c: z.number().int().min(0).max(1e6), ma: z.number().int().min(0).max(1e6), mi: z.number().int().min(0).max(1e6) }).safeParse({ c: Number(d.c), ma: Number(d.ma), mi: Number(d.mi) });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    const corps: Record<string, unknown> = { defauts_critiques: v.data.c, defauts_majeurs: v.data.ma, defauts_mineurs: v.data.mi };
    if (realisee) { corps.statut = 'realisee'; corps.date_realisee = new Date().toISOString().slice(0, 10); }
    if (await a.executer(async () => ok(await supabase.from('inspections').update(corps).eq('id', x.id)))) { setDefauts(null); recharger(); }
  };
  const ajouterPoint = async () => {
    const v = z.object({ point: z.string().trim().min(2).max(300), exigence: z.string().max(500).nullable(), mesure: z.string().max(200).nullable(),
      resultat: z.enum(['conforme', 'nc', 'na']), gravite: z.enum(['critique', 'majeur', 'mineur']).nullable(), nombre: z.number().int().min(0).max(1e6) }).strict()
      .refine((p) => p.resultat !== 'nc' || p.gravite)
      .safeParse({ ...point, exigence: point.exigence || null, mesure: point.mesure || null, gravite: point.gravite || null, nombre: Number(point.nombre) });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('constats').insert({ ...v.data, inspection_id: x.id, ordre: (cs.data ?? []).length + 1 })))) {
      setPoint({ point: '', exigence: '', mesure: '', resultat: 'conforme', gravite: '', nombre: '0' }); recharger();
    }
  };
  const ajouterNc = async () => {
    const v = z.object({ gravite: z.enum(['critique', 'majeur', 'mineur']), description: z.string().trim().min(3).max(4000), delai: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      photos: z.array(z.string().max(200)).max(20) }).strict()
      .safeParse({ ...nc, delai: nc.delai || null, photos: ncPhotos });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('non_conformites').insert({ ...v.data, inspection_id: x.id })))) {
      setNc({ gravite: 'majeur', description: '', delai: '' }); setNcPhotos([]); recharger();
    }
  };
  const valider = async () => {
    if (!decision) return;
    if (await a.executer(async () => ok(await supabase.rpc('valider_inspection', { p_inspection: x.id, p_decision: decision, p_motif: motif.trim() || null })))) { setDecision(null); recharger(); }
  };
  const plan = x.plan;
  const points = cs.data ?? [];
  const renseignes = points.filter((p) => p.resultat !== 'na' || p.mesure).length;
  const ncOuvertes = (ncs.data ?? []).filter((n) => n.statut !== 'close');
  const nbPhotos = points.reduce((n, p) => n + (p.photos ?? []).length, 0);
  const majConstat = async (p: Constat, champs: Record<string, unknown>) => {
    if (await a.executer(async () => ok(await supabase.from('constats').update(champs).eq('id', p.id)))) void cs.recharger();
  };
  const resultat = (p: Constat, r: 'conforme' | 'nc' | 'na') => void majConstat(p, r === 'nc' ? { resultat: r, gravite: p.gravite ?? 'majeur', nombre: Math.max(p.nombre, 1) } : { resultat: r, gravite: null, nombre: 0 });
  const ddmmaaaa = (v: string | null) => (v ? `${v.slice(8, 10)}.${v.slice(5, 7)}.${v.slice(0, 4)}` : '—');
  return (
    <div className="screen" style={{ overflow: 'auto' }}>
      <Entete surtitre={`${t('modules.qualite')} · ${t('inspections.fiche')} · ${x.reference} · INS`}
        titre={<>{x.produit ?? x.reference} <span className="h1-statut"><Statut statut={x.statut} libelle={x.statut === 'realisee' ? t('inspections.k_valider') : t(`statuts_inspection.${x.statut}`)} /></span></>} />
      <div className="sec" style={{ marginTop: -10 }}>{[t(`types_inspection.${x.type}`), ddmmaaaa(x.date_realisee ?? x.date_prevue), x.inspecteur_id ? profils[x.inspecteur_id] : null,
        t('inspections.lot_niveau', { lot: x.taille_lot, n: x.niveau }), `NQA ${x.nqa_majeur}`].filter(Boolean).join(' · ')}</div>
      {ref.data && <p className="mute" style={{ margin: 0 }}>{t('approbation.reference_inspection', { v: ref.data.version, objet: ref.data.objet })}{ref.data.echantillon_description ? ` · ${t('approbation.echantillon')} : ${ref.data.echantillon_description}` : ''}</p>}
      <Bandeau type="err">{a.erreur}</Bandeau>
      <div className="fiche-grille">
        <div className="fiche-principal" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="ins-avancement"><span className="cmd-barre"><span style={{ width: `${points.length ? (renseignes / points.length) * 100 : 0}%`, background: 'var(--ink)' }} /></span>
            <span className="mute">{t('inspections.points_renseignes', { n: renseignes, total: points.length })}</span></div>
          {points.length === 0 ? <span className="mute">{t('inspections.aucun_point')}</span> : points.map((p) => (
            <div key={p.id} className={'ins-point' + (p.resultat === 'nc' ? ' nc' : '')}>
              <div><b>{p.point}</b><div className="mute">{t('inspections.attendu', { v: p.exigence ?? '—' })}</div>
                {p.resultat === 'nc' && p.gravite && <div className="txt-err" style={{ fontSize: 13 }}>{t(`gravites.${p.gravite}`)} × {p.nombre}</div>}</div>
              <input value={mesuresEtat[p.id] ?? p.mesure ?? ''} maxLength={200} placeholder={t('inspections.mesure_relevee')} disabled={!saisit} aria-label={t('inspections.mesure')}
                onChange={(e) => setMesuresEtat({ ...mesuresEtat, [p.id]: e.target.value })}
                onBlur={() => { const v = (mesuresEtat[p.id] ?? '').trim(); if (mesuresEtat[p.id] !== undefined && v !== (p.mesure ?? '')) void majConstat(p, { mesure: v || null }); }} />
              <span className="ins-choix" role="group" aria-label={t('inspections.resultat')}>
                {(['conforme', 'nc', 'na'] as const).map((r) => (
                  <button key={r} type="button" disabled={!saisit || a.enCours} aria-pressed={p.resultat === r}
                    className={'ins-c ' + r + (p.resultat === r ? ' actif' : '')} onClick={() => resultat(p, r)} data-sans-glose>{t(`inspections.court.${r}`)}</button>))}
              </span>
              <span className="mute ins-photos">{t('inspections.n_photos', { n: (p.photos ?? []).length })}</span>
            </div>))}
          {saisit && (
            <div className="grille3" style={{ alignItems: 'end', gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr auto' }}>
              <Champ label={t('inspections.point')}><input value={point.point} maxLength={300} onChange={(e) => setPoint({ ...point, point: e.target.value })} /></Champ>
              <Champ label={t('inspections.exigence')}><input value={point.exigence} maxLength={500} onChange={(e) => setPoint({ ...point, exigence: e.target.value })} /></Champ>
              <Champ label={t('inspections.mesure')}><input value={point.mesure} maxLength={200} onChange={(e) => setPoint({ ...point, mesure: e.target.value })} /></Champ>
              <Champ label={t('inspections.resultat')}><select value={point.resultat} onChange={(e) => setPoint({ ...point, resultat: e.target.value })}>
                {['conforme', 'nc', 'na'].map((r) => <option key={r} value={r}>{t(`resultats.${r}`)}</option>)}</select></Champ>
              <Champ label={t('inspections.gravite')}><select value={point.gravite} onChange={(e) => setPoint({ ...point, gravite: e.target.value })}>
                <option value="">—</option>{['critique', 'majeur', 'mineur'].map((g) => <option key={g} value={g}>{t(`gravites.${g}`)}</option>)}</select></Champ>
              <Bouton onClick={() => void ajouterPoint()}>{t('inspections.ajouter_point')}</Bouton>
            </div>
          )}
          {saisit && (
            <section className="fiche-bloc">
              <div className="surtitre">{t('inspections.defauts_echantillon')}</div>
              <div className="grille3" style={{ alignItems: 'end', gridTemplateColumns: 'repeat(3, minmax(0,1fr)) auto auto' }}>
                <Champ label={t('inspections.defauts_critiques')}><input inputMode="numeric" value={d.c} onChange={(e) => setDefauts({ ...d, c: e.target.value.replace(/\D/g, '') })} /></Champ>
                <Champ label={t('inspections.defauts_majeurs')}><input inputMode="numeric" value={d.ma} onChange={(e) => setDefauts({ ...d, ma: e.target.value.replace(/\D/g, '') })} /></Champ>
                <Champ label={t('inspections.defauts_mineurs')}><input inputMode="numeric" value={d.mi} onChange={(e) => setDefauts({ ...d, mi: e.target.value.replace(/\D/g, '') })} /></Champ>
                <Bouton onClick={() => void enregistrerDefauts(false)}>{t('commun.enregistrer')}</Bouton>
                {x.statut === 'planifiee' && <Bouton variante="primaire" onClick={() => void enregistrerDefauts(true)}>{t('inspections.terminer')}</Bouton>}
              </div>
            </section>
          )}
          <section className="fiche-bloc">
            <div className="surtitre">{t('inspections.non_conformites')}</div>
            {(ncs.data ?? []).length === 0 ? <span className="mute">{t('inspections.aucune_nc')}</span> : (
              <table className="t"><tbody>{(ncs.data ?? []).map((n) => (
                <tr key={n.id}><td className="ref">{n.reference}</td><td>{t(`gravites.${n.gravite}`)}</td><td>{n.description}</td><td className="ref">{date(n.delai, langue)}</td>
                  <td><Statut statut={n.statut} libelle={t(`statuts_nc.${n.statut}`)} /></td>
                  <td className="num"><Bouton petit onClick={() => setFicheNc(n.id)}>{t('nc.ouvrir_fiche')}</Bouton></td></tr>))}</tbody></table>
            )}
            {saisit && (
              <div className="grille3" style={{ alignItems: 'end', gridTemplateColumns: '1fr 3fr 1fr auto' }}>
                <Champ label={t('inspections.gravite')}><select value={nc.gravite} onChange={(e) => setNc({ ...nc, gravite: e.target.value })}>{['critique', 'majeur', 'mineur'].map((g) => <option key={g} value={g}>{t(`gravites.${g}`)}</option>)}</select></Champ>
                <Champ label={t('champs.description')}><input value={nc.description} maxLength={4000} onChange={(e) => setNc({ ...nc, description: e.target.value })} /></Champ>
                <Champ label={t('inspections.delai')}><input type="date" value={nc.delai} onChange={(e) => setNc({ ...nc, delai: e.target.value })} /></Champ>
                <Bouton onClick={() => void ajouterNc()}>{t('commun.ajouter')}</Bouton>
              </div>
            )}
            {saisit && <div className="actions"><Depotx dossierId={x.dossier_id} valeur={null} onChange={(c) => setNcPhotos((q) => (q.length < 20 ? [...q, c] : q))} />
              {ncPhotos.length > 0 && <span className="mute">{t('nc.photos_jointes', { n: ncPhotos.length })}</span>}</div>}
            {ficheNc && <FicheNc id={ficheNc} onClose={() => setFicheNc(null)} onChange={recharger} />}
          </section>
        </div>
        <aside className="fiche-cote">
          <section className="fiche-bloc">
            <div className="surtitre">{t('inspections.decision')}</div>
            {ncOuvertes.length > 0 ? <span className="txt-err">{t('inspections.nc_a_lever', { n: ncOuvertes.length })}</span>
              : <span className="mute">{x.decision ? t(`inspections.decisions_finales.${x.decision}`) : t('inspections.aucune_nc_ouverte')}</span>}
            {validateur && x.statut === 'realisee' && <div className="actions">
              <Bouton variante="danger" onClick={() => setDecision('refus')}>{t('inspections.refuser')}</Bouton>
              <Bouton variante="primaire" onClick={() => setDecision('liberation')}>{t('inspections.liberer')}</Bouton></div>}
          </section>
          {plan && (
            <section className="fiche-bloc">
              <div className="surtitre">{t('inspections.plan_aql')}</div>
              {(['critique', 'majeur', 'mineur'] as const).map((k) => (
                <div key={k} className="ligne-montant"><span>{t(`gravites.${k}`)} · NQA {k === 'critique' ? x.nqa_critique : k === 'majeur' ? x.nqa_majeur : x.nqa_mineur}<br />
                  <span className="mute">{t('inspections.plan', { l: plan[k].lettre, n: plan[k].n, ac: plan[k].ac, re: plan[k].re })}</span></span>
                  <b>{k === 'critique' ? x.defauts_critiques : k === 'majeur' ? x.defauts_majeurs : x.defauts_mineurs} / {plan[k].ac}</b></div>))}
              <div className="ligne-montant"><span>{t('inspections.decision_proposee')}</span><b>{x.decision_proposee ? t(`decisions.${x.decision_proposee}`) : '—'}</b></div>
            </section>
          )}
          <section className="fiche-bloc">
            <div className="surtitre">{t('inspections.rapport_pdf')}</div>
            <div className="ligne-montant"><span>{t('inspections.points_controles')}</span><b>{points.length}</b></div>
            <div className="ligne-montant"><span>{t('inspections.non_conformites')}</span><b>{(ncs.data ?? []).length}</b></div>
            <div className="ligne-montant"><span>{t('inspections.photos')}</span><b>{nbPhotos}</b></div>
            <Link className="btn" style={{ justifyContent: 'center' }} to={`/imprimer/inspection/${x.id}`}>{t('inspections.generer_rapport')}</Link>
          </section>
        </aside>
      </div>
      {decision && (
        <Tiroir titre={decision === 'liberation' ? t('inspections.liberer') : t('inspections.refuser')} onClose={() => setDecision(null)}>
          {decision === 'liberation' && x.decision_proposee === 'refusee' && <Bandeau type="err">{t('inspections.derogation_liberation')}</Bandeau>}
          <Champ label={t('champs.motif')}><textarea value={motif} maxLength={1000} onChange={(e) => setMotif(e.target.value)} /></Champ>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <Bouton variante={decision === 'refus' ? 'danger' : 'primaire'} disabled={a.enCours} onClick={() => void valider()}>{t('commun.confirmer')}</Bouton>
        </Tiroir>
      )}
    </div>
  );
}

// ============================================================================ Expéditions
type ExpeditionListe = Expedition & { eta_initiale: string | null; dossiers: { reference: string; clients: { raison_sociale: string } | null } | null };

/** Suivi des expéditions (maquette EXP) : arrivées reportées et jours de franchise dépassés au port. */
export function Expeditions() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { profil } = useAuth();
  const [creer, setCreer] = useState(false);
  const l = useAsync(async () => ok(await supabase.from('expeditions').select('*, dossiers(reference, clients(raison_sociale))')
    .order('cree_le', { ascending: false }).limit(500)) as unknown as ExpeditionListe[], []);
  const ids = (l.data ?? []).map((e) => e.id);
  const arr = useAsync(async () => (ids.length ? ok(await supabase.from('expedition_etapes').select('expedition_id, survenue_le').eq('etape', 'arrivee_port').in('expedition_id', ids)) as
    { expedition_id: string; survenue_le: string }[] : []), [ids.join(',')]);
  const ecrit = ['admin', 'achats_chine'].includes(profil?.role ?? '');
  const tous = l.data ?? [];
  const jour = new Date().toISOString().slice(0, 10);
  const reportee = (e: ExpeditionListe) => Boolean(e.eta && e.eta_initiale && e.eta > e.eta_initiale) && ['preparation', 'remise_transporteur', 'expediee', 'en_transit'].includes(e.statut);
  // Franchise : jours passés au port depuis l'arrivée réelle, au-delà des jours de franchise, tant que la marchandise n'est pas livrée.
  const depassement = (e: ExpeditionListe) => {
    const a = (arr.data ?? []).find((x) => x.expedition_id === e.id)?.survenue_le.slice(0, 10);
    if (!a || e.jours_franchise === null || e.statut === 'livree') return null;
    return Math.round((Date.parse(jour) - Date.parse(a)) / 86400000) - e.jours_franchise;
  };
  const reportees = tous.filter(reportee);
  const franchises = tous.filter((e) => (depassement(e) ?? 0) > 0);
  const alertes = [...new Set([...reportees.map((e) => t('expeditions.alerte_report', { port: e.port_arrivee ?? '—' })), ...franchises.map((e) => t('expeditions.alerte_franchise', { port: e.port_arrivee ?? '—' }))])];
  const titre = t('expeditions.titre_suivies', { n: tous.filter((e) => e.statut !== 'livree').length }) + (alertes.length ? ` ; ${t('expeditions.titre_alertes', { n: alertes.length, liste: alertes.join(t('expeditions.et')) })}` : '');
  const ddmm = (d: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '—');
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.logistique')} · ${t('expeditions.surtitre')} · EXP`} titre={l.data ? titre : t('ecrans.expeditions')}
        actions={ecrit && <Bouton variante="primaire" onClick={() => setCreer(true)}>{t('expeditions.nouvelle')}</Bouton>} />
      <Bandeau type="err">{l.erreur ?? arr.erreur}</Bandeau>
      <div className="cadre">
        {l.chargement && !l.data ? <Chargement /> : tous.length === 0 ? <Vide>{t('expeditions.aucune')}</Vide> : (
          <table className="t"><thead><tr><th>{t('expeditions.expedition')}</th><th>{t('expeditions.client')}</th><th>{t('expeditions.conteneur')}</th>
            <th>{t('expeditions.trajet')}</th><th>{t('expeditions.arrivee')}</th><th>{t('champs.statut')}</th><th>{t('expeditions.franchise_court')}</th></tr></thead>
            <tbody>{tous.map((e) => {
              const r = reportee(e), d = depassement(e);
              return (
                <tr key={e.id} className="cliquable" onClick={() => nav(`/expeditions/${e.id}`)}>
                  <td className="ref">{e.reference}<div className="mute">{e.dossiers?.reference}</div></td>
                  <td>{e.dossiers?.clients?.raison_sociale ?? '—'}</td>
                  <td className="sec">{e.conteneurs.length ? e.conteneurs.join(', ') : <span className="mute">{t('expeditions.a_affecter')}</span>}</td>
                  <td className="sec">{e.port_depart ?? '—'} → {e.port_arrivee ?? e.pays_destination}</td>
                  <td className="ref"><span className={r ? 'txt-err' : ''}>{ddmm(e.eta)}</span>{r && <div className="mute">{t('expeditions.prevue', { d: ddmm(e.eta_initiale) })}</div>}</td>
                  <td><Statut statut={r ? 'att' : e.statut} libelle={`${t(`statuts_exp.${e.statut}`)}${r ? ` · ${t('expeditions.retard')}` : ''}`} /></td>
                  <td className={d !== null && d > 0 ? 'txt-err' : 'mute'}>{d === null ? '—' : d > 0 ? t('expeditions.jours_depasses', { n: d }) : t('expeditions.jours_restants', { n: -d })}</td>
                </tr>);
            })}</tbody></table>
        )}
      </div>
      {creer && <NouvelleExpedition onClose={() => setCreer(false)} onOk={(id) => nav(`/expeditions/${id}`)} />}
    </div>
  );
}

function NouvelleExpedition({ onClose, onOk }: { onClose: () => void; onOk: (id: string) => void }) {
  const { t } = useTranslation();
  const ds = useAsync(async () => ok(await supabase.from('dossiers').select('id, reference, intitule, pays').eq('statut', 'ouvert').order('reference', { ascending: false })) as Dossier[], []);
  const [f, setF] = useState({ dossier_id: '', mode: 'conteneur_complet', transitaire: '', port_depart: '', port_arrivee: 'Abidjan', etd: '', eta: '', jours_franchise: '' });
  const a = useAction();
  const envoyer = async () => {
    const d = (ds.data ?? []).find((x) => x.id === f.dossier_id);
    const v = z.object({ dossier_id: z.string().uuid(), mode: z.enum(['conteneur_complet', 'groupage', 'aerien']), transitaire: z.string().max(200).nullable(), port_depart: z.string().max(80).nullable(),
      port_arrivee: z.enum(['Abidjan', 'San-Pédro', 'Owendo', 'Douala', 'Kribi']).nullable(), pays_destination: z.string().regex(/^[A-Z]{2}$/),
      etd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), eta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), jours_franchise: z.number().int().min(0).max(60).nullable() }).strict()
      .safeParse({ ...f, transitaire: f.transitaire || null, port_depart: f.port_depart || null, port_arrivee: f.port_arrivee || null, pays_destination: d?.pays ?? '',
        etd: f.etd || null, eta: f.eta || null, jours_franchise: f.jours_franchise ? Number(f.jours_franchise) : null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    await a.executer(async () => { const r = ok(await supabase.from('expeditions').insert(v.data).select('id').single()) as { id: string }; onOk(r.id); });
  };
  return (
    <Tiroir titre={t('expeditions.nouvelle')} onClose={onClose}>
      <Champ label={t('champs.dossier')}><select value={f.dossier_id} onChange={(e) => setF({ ...f, dossier_id: e.target.value })}>
        <option value="">—</option>{(ds.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.reference} · {d.intitule}</option>)}</select></Champ>
      <div className="grille2">
        <Champ label={t('expeditions.mode')}><select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{['conteneur_complet', 'groupage', 'aerien'].map((m) => <option key={m} value={m}>{t(`modes_exp.${m}`)}</option>)}</select></Champ>
        <Champ label={t('expeditions.transitaire')}><input value={f.transitaire} maxLength={200} onChange={(e) => setF({ ...f, transitaire: e.target.value })} /></Champ>
        <Champ label={t('expeditions.port_depart')}><input value={f.port_depart} maxLength={80} onChange={(e) => setF({ ...f, port_depart: e.target.value })} /></Champ>
        <Champ label={t('expeditions.port_arrivee')}><select value={f.port_arrivee} onChange={(e) => setF({ ...f, port_arrivee: e.target.value })}>{['Abidjan', 'San-Pédro', 'Owendo', 'Douala', 'Kribi'].map((p) => <option key={p}>{p}</option>)}</select></Champ>
        <Champ label="ETD"><input type="date" value={f.etd} onChange={(e) => setF({ ...f, etd: e.target.value })} /></Champ>
        <Champ label="ETA"><input type="date" value={f.eta} onChange={(e) => setF({ ...f, eta: e.target.value })} /></Champ>
        <Champ label={t('expeditions.franchise')}><input inputMode="numeric" value={f.jours_franchise} onChange={(e) => setF({ ...f, jours_franchise: e.target.value.replace(/\D/g, '') })} /></Champ>
      </div>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void envoyer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

const ORDRE_EXP = ['preparation', 'remise_transporteur', 'expediee', 'en_transit', 'arrivee', 'mise_a_disposition', 'livree'];

export function FicheExpedition() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { profil, langue, fuseau } = useAuth();
  const role = profil?.role ?? '';
  const e = useAsync(async () => ok(await supabase.from('expeditions').select('*').eq('id', id).maybeSingle()) as Expedition | null, [id]);
  const etapes = useAsync(async () => ok(await supabase.from('expedition_etapes').select('*').eq('expedition_id', id).order('survenue_le')) as Etape[], [id]);
  const liees = useAsync(async () => (['admin', 'achats_chine'].includes(role) ? ok(await supabase.from('expedition_commandes').select('commande_id').eq('expedition_id', id)) as { commande_id: string }[] : []), [id, role]);
  const cmds = useAsync(async () => (e.data && ['admin', 'achats_chine'].includes(role) ? ok(await supabase.from('commandes').select('id, reference, statut').eq('dossier_id', e.data.dossier_id).neq('statut', 'annulee')) as Commande[] : []), [e.data?.dossier_id, role]);
  const a = useAction();
  const [docs, setDocs] = useState<Partial<Expedition> | null>(null);
  const [etape, setEtape] = useState({ etape: 'depart_port', lieu: '', survenue_le: '', commentaire: '' });
  const x = e.data;
  if (e.chargement) return <div className="screen"><Chargement /></div>;
  if (!x) return <div className="screen"><Vide>{e.erreur ?? t('expeditions.introuvable')}</Vide></div>;
  const ecrit = ['admin', 'achats_chine'].includes(role);
  const suivant = ORDRE_EXP[ORDRE_EXP.indexOf(x.statut) + 1];
  const recharger = () => { void e.recharger(); void etapes.recharger(); void liees.recharger(); };
  const avancer = async () => { if (suivant && await a.executer(async () => ok(await supabase.rpc('changer_statut_expedition', { p_expedition: x.id, p_statut: suivant })))) recharger(); };
  const lier = async (cid: string) => { if (await a.executer(async () => ok(await supabase.from('expedition_commandes').insert({ expedition_id: x.id, commande_id: cid })))) recharger(); };
  const majDocs = async () => {
    if (!docs) return;
    const v = z.object({ bordereau_reference: z.string().max(60).nullable().optional(), numero_connaissement: z.string().max(60).nullable().optional(),
      type_connaissement: z.enum(['original', 'telex_release', 'non_negociable', 'lta']).nullable().optional(), navire: z.string().max(120).nullable().optional(),
      eta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), conteneurs: z.array(z.string().max(20)).max(50).optional(), plombs: z.array(z.string().max(20)).max(50).optional(),
      fds_document: z.string().max(400).nullable().optional(), declaration_imdg_document: z.string().max(400).nullable().optional(), un38_3_document: z.string().max(400).nullable().optional() }).strict()
      .safeParse(docs);
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('expeditions').update(v.data).eq('id', x.id)))) { setDocs(null); recharger(); }
  };
  const ajouterEtape = async () => {
    const v = z.object({ etape: z.enum(['remise_transporteur', 'depart_port', 'transbordement', 'arrivee_port', 'dechargement', 'mise_a_disposition', 'livraison', 'autre']),
      lieu: z.string().max(120).nullable(), survenue_le: z.string().min(10), commentaire: z.string().max(1000).nullable() }).strict()
      .safeParse({ ...etape, lieu: etape.lieu || null, commentaire: etape.commentaire || null, survenue_le: etape.survenue_le ? new Date(etape.survenue_le).toISOString() : '' });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('expedition_etapes').insert({ ...v.data, expedition_id: x.id })))) { setEtape({ etape: 'depart_port', lieu: '', survenue_le: '', commentaire: '' }); recharger(); }
  };
  const franchiseFin = x.eta && x.jours_franchise !== null ? new Date(new Date(x.eta).getTime() + x.jours_franchise * 86400000).toISOString() : null;
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.logistique')} · ${t(`modes_exp.${x.mode}`)} · ${x.pays_destination}`} titre={`${x.reference} — ${x.port_depart ?? '?'} → ${x.port_arrivee ?? x.pays_destination}`}
        actions={<>
          <Statut statut={x.statut} libelle={t(`statuts_exp.${x.statut}`)} />
          {suivant && (ecrit || (role === 'hub_afrique' && ['arrivee', 'mise_a_disposition', 'livree'].includes(suivant))) &&
            <Bouton variante="primaire" onClick={() => void avancer()}>{t('expeditions.passer', { s: t(`statuts_exp.${suivant}`) })}</Bouton>}
          {ecrit && <Bouton onClick={() => setDocs({ bordereau_reference: x.bordereau_reference, numero_connaissement: x.numero_connaissement, type_connaissement: x.type_connaissement as Expedition['type_connaissement'], navire: x.navire, eta: x.eta, conteneurs: x.conteneurs, plombs: x.plombs })}>{t('expeditions.documents')}</Bouton>}
        </>} />
      <Kpis items={[
        { lib: 'ETA', val: date(x.eta, langue), sous: x.navire ?? '—' },
        { lib: t('expeditions.bordereau'), texte: true, val: x.bordereau_reference ?? t('expeditions.manquant'), sous: x.pays_destination === 'CI' ? 'BSC' : x.pays_destination === 'CM' ? 'BESC' : x.pays_destination === 'GA' ? 'BIETC' : '—' },
        { lib: t('expeditions.connaissement'), texte: true, val: x.numero_connaissement ?? '—', sous: x.type_connaissement ? t(`connaissements.${x.type_connaissement}`) : '—' },
        { lib: t('expeditions.fin_franchise'), val: franchiseFin ? date(franchiseFin, langue) : '—', sous: t('expeditions.franchise_jours', { n: x.jours_franchise ?? 0 }) },
      ]} />
      <Bandeau type="err">{a.erreur}</Bandeau>
      <div className="cadre" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {ecrit && (
          <section>
            <div className="section-titre">{t('expeditions.commandes')}</div>
            <div className="actions">
              {(cmds.data ?? []).map((c) => {
                const lie = (liees.data ?? []).some((l) => l.commande_id === c.id);
                return lie ? <span key={c.id} className="chip info">{c.reference}</span>
                  : x.statut === 'preparation' ? <Bouton key={c.id} petit onClick={() => void lier(c.id)}>+ {c.reference}</Bouton> : null;
              })}
            </div>
          </section>
        )}
        {['admin', 'achats_chine', 'hub_afrique', 'comptable'].includes(role) && <PackDocumentaire expeditionId={x.id} dossierId={x.dossier_id} />}
        {['admin', 'achats_chine', 'hub_afrique'].includes(role) && x.statut !== 'livree' && <TransitaireExpedition expeditionId={x.id} transitaire={x.transitaire} onChange={recharger} />}
        <section>
          <div className="section-titre">{t('expeditions.etapes')}</div>
          {(etapes.data ?? []).length === 0 ? <span className="mute">{t('expeditions.aucune_etape')}</span> : (
            <table className="t"><tbody>{(etapes.data ?? []).map((s) => (
              <tr key={s.id}><td className="ref">{dateHeure(s.survenue_le, langue, fuseau)}</td><td>{t(`etapes.${s.etape}`)}</td><td className="sec">{s.lieu ?? ''}</td><td className="sec">{s.commentaire ?? ''}</td></tr>))}</tbody></table>
          )}
          {(ecrit || role === 'hub_afrique') && (
            <div className="grille3" style={{ alignItems: 'end', marginTop: 8, gridTemplateColumns: '1fr 1fr 1fr 2fr auto' }}>
              <Champ label={t('expeditions.etape')}><select value={etape.etape} onChange={(ev) => setEtape({ ...etape, etape: ev.target.value })}>
                {['remise_transporteur', 'depart_port', 'transbordement', 'arrivee_port', 'dechargement', 'mise_a_disposition', 'livraison', 'autre'].map((s) => <option key={s} value={s}>{t(`etapes.${s}`)}</option>)}</select></Champ>
              <Champ label={t('inspections.lieu')}><input value={etape.lieu} maxLength={120} onChange={(ev) => setEtape({ ...etape, lieu: ev.target.value })} /></Champ>
              <Champ label={t('champs.date')}><input type="datetime-local" value={etape.survenue_le} onChange={(ev) => setEtape({ ...etape, survenue_le: ev.target.value })} /></Champ>
              <Champ label={t('champs.commentaire')}><input value={etape.commentaire} maxLength={1000} onChange={(ev) => setEtape({ ...etape, commentaire: ev.target.value })} /></Champ>
              <Bouton onClick={() => void ajouterEtape()}>{t('commun.ajouter')}</Bouton>
            </div>
          )}
        </section>
        <p className="mute">{t('expeditions.aide_verrous')}</p>
      </div>
      {docs && (
        <Tiroir titre={t('expeditions.documents')} onClose={() => setDocs(null)}>
          <div className="grille2">
            <Champ label={t('expeditions.bordereau')}><input value={docs.bordereau_reference ?? ''} maxLength={60} onChange={(ev) => setDocs({ ...docs, bordereau_reference: ev.target.value || null })} /></Champ>
            <Champ label={t('expeditions.navire')}><input value={docs.navire ?? ''} maxLength={120} onChange={(ev) => setDocs({ ...docs, navire: ev.target.value || null })} /></Champ>
            <Champ label={t('expeditions.type_connaissement')}><select value={docs.type_connaissement ?? ''} onChange={(ev) => setDocs({ ...docs, type_connaissement: ev.target.value || null })}>
              <option value="">—</option>{['original', 'telex_release', 'non_negociable', 'lta'].map((c) => <option key={c} value={c}>{t(`connaissements.${c}`)}</option>)}</select></Champ>
            <Champ label={t('expeditions.connaissement')}><input value={docs.numero_connaissement ?? ''} maxLength={60} onChange={(ev) => setDocs({ ...docs, numero_connaissement: ev.target.value || null })} /></Champ>
            <Champ label="ETA"><input type="date" value={docs.eta ?? ''} onChange={(ev) => setDocs({ ...docs, eta: ev.target.value || null })} /></Champ>
            <Champ label={t('expeditions.conteneurs')}><input value={(docs.conteneurs ?? []).join(', ')} maxLength={1000} onChange={(ev) => setDocs({ ...docs, conteneurs: ev.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></Champ>
          </div>
          <div className="section-titre">{t('expeditions.marchandises_dangereuses')}</div>
          <Champ label={t('expeditions.fds')}><Depotx dossierId={x.dossier_id} valeur={docs.fds_document ?? x.fds_document} onChange={(c) => setDocs({ ...docs, fds_document: c })} /></Champ>
          <Champ label={t('expeditions.imdg')}><Depotx dossierId={x.dossier_id} valeur={docs.declaration_imdg_document ?? x.declaration_imdg_document} onChange={(c) => setDocs({ ...docs, declaration_imdg_document: c })} /></Champ>
          <Champ label="UN38.3"><Depotx dossierId={x.dossier_id} valeur={docs.un38_3_document ?? x.un38_3_document} onChange={(c) => setDocs({ ...docs, un38_3_document: c })} /></Champ>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <Bouton variante="primaire" disabled={a.enCours} onClick={() => void majDocs()}>{t('commun.enregistrer')}</Bouton>
        </Tiroir>
      )}
    </div>
  );
}

