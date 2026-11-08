import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, dateHeure } from '../lib/format';
import type { Commande, Constat, Dossier, Etape, Expedition, Inspection, NonConformite, Profil } from '../lib/types';
import { Bandeau, Bouton, CadreTableau, Champ, Chargement, Entete, Kpis, Statut, Tiroir, Vide } from '../components/ui';
import { useNoms } from '../lib/referentiels';
import { Depot as Depotx } from '../components/Depot';
import { FicheNc } from './NonConformites';
import { PackDocumentaire } from './PackDocumentaire';
import { TransitaireExpedition } from './Transitaires';

// ============================================================================ Inspections
export function Inspections() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { langue, profil } = useAuth();
  const dossiers = useNoms('dossiers');
  const profils = useNoms('profils');
  const [creer, setCreer] = useState(Boolean(params.get('commande')));
  const l = useAsync(async () => ok(await supabase.from('inspections').select('*').order('date_prevue', { ascending: true, nullsFirst: false }).limit(500)) as Inspection[], []);
  const ecrit = ['admin', 'achats_chine'].includes(profil?.role ?? '');
  const n = (s: string) => (l.data ?? []).filter((i) => i.statut === s).length;
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.qualite')} · M8`} titre={t('inspections.titre', { n: (l.data ?? []).length })}
        actions={ecrit && <Bouton variante="primaire" onClick={() => setCreer(true)}>{t('inspections.planifier')}</Bouton>} />
      <Kpis items={[
        { lib: t('statuts_inspection.planifiee'), val: n('planifiee') }, { lib: t('statuts_inspection.realisee'), val: n('realisee'), sous: t('inspections.a_valider') },
        { lib: t('statuts_inspection.validee'), val: n('validee'), sous: t('inspections.liberees') }, { lib: t('statuts_inspection.refusee'), val: n('refusee') },
      ]} />
      <Bandeau type="err">{l.erreur}</Bandeau>
      <CadreTableau>
        {l.chargement ? <Chargement /> : (l.data ?? []).length === 0 ? <Vide>{t('inspections.aucune')}</Vide> : (
          <table className="t"><thead><tr><th>{t('champs.reference')}</th><th>{t('champs.dossier')}</th><th>{t('champs.type')}</th><th>{t('inspections.inspecteur')}</th><th>{t('champs.date')}</th><th className="num">{t('inspections.lot')}</th><th>{t('inspections.decision_proposee')}</th><th>{t('champs.statut')}</th></tr></thead>
            <tbody>{(l.data ?? []).map((i) => (
              <tr key={i.id} className="cliquable" onClick={() => nav(`/inspections/${i.id}`)}>
                <td className="ref">{i.reference}</td><td className="ref">{dossiers[i.dossier_id]}</td><td>{t(`types_inspection.${i.type}`)}</td>
                <td className="sec">{i.inspecteur_id ? profils[i.inspecteur_id] : '—'}</td><td className="ref">{date(i.date_realisee ?? i.date_prevue, langue)}</td>
                <td className="num">{i.taille_lot}</td><td>{i.decision_proposee ? <Statut statut={i.decision_proposee} libelle={t(`decisions.${i.decision_proposee}`)} /> : '—'}</td>
                <td><Statut statut={i.statut} libelle={t(`statuts_inspection.${i.statut}`)} /></td></tr>))}</tbody></table>
        )}
      </CadreTableau>
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
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.qualite')} · ${t(`types_inspection.${x.type}`)} · ISO 2859-1`} titre={`${x.reference} — ${x.produit ?? ''}`}
        actions={<>
          <Statut statut={x.statut} libelle={t(`statuts_inspection.${x.statut}`)} />
          <Link className="btn" to={`/imprimer/inspection/${x.id}`}>{t('commun.imprimer')}</Link>
          {validateur && x.statut === 'realisee' && <><Bouton variante="primaire" onClick={() => setDecision('liberation')}>{t('inspections.liberer')}</Bouton>
            <Bouton variante="danger" onClick={() => setDecision('refus')}>{t('inspections.refuser')}</Bouton></>}
        </>} />
      {plan && (
        <Kpis items={(['critique', 'majeur', 'mineur'] as const).map((k) => ({
          lib: `${t(`gravites.${k}`)} · NQA ${k === 'critique' ? x.nqa_critique : k === 'majeur' ? x.nqa_majeur : x.nqa_mineur}`,
          val: `${k === 'critique' ? x.defauts_critiques : k === 'majeur' ? x.defauts_majeurs : x.defauts_mineurs} / ${plan[k].ac}`,
          sous: t('inspections.plan', { l: plan[k].lettre, n: plan[k].n, ac: plan[k].ac, re: plan[k].re }),
        })).concat([{ lib: t('inspections.decision_proposee'), val: x.decision_proposee ? t(`decisions.${x.decision_proposee}`) : '—', sous: t('inspections.lot_niveau', { lot: x.taille_lot, n: x.niveau }) }])} />
      )}
      {ref.data && <p className="mute">{t('approbation.reference_inspection', { v: ref.data.version, objet: ref.data.objet })}{ref.data.echantillon_description ? ` · ${t('approbation.echantillon')} : ${ref.data.echantillon_description}` : ''}</p>}
      <Bandeau type="err">{a.erreur}</Bandeau>
      <div className="cadre" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {saisit && (
          <section className="grille3" style={{ alignItems: 'end', gridTemplateColumns: 'repeat(3, minmax(0,1fr)) auto auto' }}>
            <Champ label={t('inspections.defauts_critiques')}><input inputMode="numeric" value={d.c} onChange={(e) => setDefauts({ ...d, c: e.target.value.replace(/\D/g, '') })} /></Champ>
            <Champ label={t('inspections.defauts_majeurs')}><input inputMode="numeric" value={d.ma} onChange={(e) => setDefauts({ ...d, ma: e.target.value.replace(/\D/g, '') })} /></Champ>
            <Champ label={t('inspections.defauts_mineurs')}><input inputMode="numeric" value={d.mi} onChange={(e) => setDefauts({ ...d, mi: e.target.value.replace(/\D/g, '') })} /></Champ>
            <Bouton onClick={() => void enregistrerDefauts(false)}>{t('commun.enregistrer')}</Bouton>
            {x.statut === 'planifiee' && <Bouton variante="primaire" onClick={() => void enregistrerDefauts(true)}>{t('inspections.terminer')}</Bouton>}
          </section>
        )}
        <section>
          <div className="section-titre">{t('inspections.points')}</div>
          <table className="t"><thead><tr><th>#</th><th>{t('inspections.point')}</th><th>{t('inspections.exigence')}</th><th>{t('inspections.mesure')}</th><th>{t('inspections.resultat')}</th><th>{t('inspections.gravite')}</th></tr></thead>
            <tbody>{(cs.data ?? []).map((p) => (
              <tr key={p.id}><td>{p.ordre}</td><td>{p.point}</td><td className="sec">{p.exigence ?? '—'}</td><td className="sec">{p.mesure ?? '—'}</td>
                <td><Statut statut={p.resultat === 'conforme' ? 'validee' : p.resultat === 'nc' ? 'refusee' : 'annulee'} libelle={t(`resultats.${p.resultat}`)} /></td>
                <td className="sec">{p.gravite ? `${t(`gravites.${p.gravite}`)} × ${p.nombre}` : '—'}</td></tr>))}</tbody></table>
          {saisit && (
            <div className="grille3" style={{ alignItems: 'end', marginTop: 8, gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr auto' }}>
              <Champ label={t('inspections.point')}><input value={point.point} maxLength={300} onChange={(e) => setPoint({ ...point, point: e.target.value })} /></Champ>
              <Champ label={t('inspections.exigence')}><input value={point.exigence} maxLength={500} onChange={(e) => setPoint({ ...point, exigence: e.target.value })} /></Champ>
              <Champ label={t('inspections.mesure')}><input value={point.mesure} maxLength={200} onChange={(e) => setPoint({ ...point, mesure: e.target.value })} /></Champ>
              <Champ label={t('inspections.resultat')}><select value={point.resultat} onChange={(e) => setPoint({ ...point, resultat: e.target.value })}>
                {['conforme', 'nc', 'na'].map((r) => <option key={r} value={r}>{t(`resultats.${r}`)}</option>)}</select></Champ>
              <Champ label={t('inspections.gravite')}><select value={point.gravite} onChange={(e) => setPoint({ ...point, gravite: e.target.value })}>
                <option value="">—</option>{['critique', 'majeur', 'mineur'].map((g) => <option key={g} value={g}>{t(`gravites.${g}`)}</option>)}</select></Champ>
              <Bouton onClick={() => void ajouterPoint()}>{t('commun.ajouter')}</Bouton>
            </div>
          )}
        </section>
        <section>
          <div className="section-titre">{t('inspections.non_conformites')}</div>
          {(ncs.data ?? []).length === 0 ? <span className="mute">{t('inspections.aucune_nc')}</span> : (
            <table className="t"><tbody>{(ncs.data ?? []).map((n) => (
              <tr key={n.id}><td className="ref">{n.reference}</td><td>{t(`gravites.${n.gravite}`)}</td><td>{n.description}</td><td className="ref">{date(n.delai, langue)}</td>
                <td><Statut statut={n.statut} libelle={t(`statuts_nc.${n.statut}`)} /></td>
                <td className="num"><Bouton petit onClick={() => setFicheNc(n.id)}>{t('nc.ouvrir_fiche')}</Bouton></td></tr>))}</tbody></table>
          )}
          {saisit && (
            <div className="grille3" style={{ alignItems: 'end', marginTop: 8, gridTemplateColumns: '1fr 3fr 1fr auto' }}>
              <Champ label={t('inspections.gravite')}><select value={nc.gravite} onChange={(e) => setNc({ ...nc, gravite: e.target.value })}>{['critique', 'majeur', 'mineur'].map((g) => <option key={g} value={g}>{t(`gravites.${g}`)}</option>)}</select></Champ>
              <Champ label={t('champs.description')}><input value={nc.description} maxLength={4000} onChange={(e) => setNc({ ...nc, description: e.target.value })} /></Champ>
              <Champ label={t('inspections.delai')}><input type="date" value={nc.delai} onChange={(e) => setNc({ ...nc, delai: e.target.value })} /></Champ>
              <Bouton onClick={() => void ajouterNc()}>{t('commun.ajouter')}</Bouton>
            </div>
          )}
          {saisit && <div className="actions" style={{ marginTop: 6 }}><Depotx dossierId={x.dossier_id} valeur={null} onChange={(c) => setNcPhotos((p) => (p.length < 20 ? [...p, c] : p))} />
            {ncPhotos.length > 0 && <span className="mute">{t('nc.photos_jointes', { n: ncPhotos.length })}</span>}</div>}
          {ficheNc && <FicheNc id={ficheNc} onClose={() => setFicheNc(null)} onChange={recharger} />}
        </section>
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
export function Expeditions() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { langue, profil } = useAuth();
  const dossiers = useNoms('dossiers');
  const [creer, setCreer] = useState(false);
  const l = useAsync(async () => ok(await supabase.from('expeditions').select('*').order('cree_le', { ascending: false }).limit(500)) as Expedition[], []);
  const ecrit = ['admin', 'achats_chine'].includes(profil?.role ?? '');
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.logistique')} · M9`} titre={t('expeditions.titre', { n: (l.data ?? []).length })}
        actions={ecrit && <Bouton variante="primaire" onClick={() => setCreer(true)}>{t('expeditions.nouvelle')}</Bouton>} />
      <Bandeau type="err">{l.erreur}</Bandeau>
      <CadreTableau>
        {l.chargement ? <Chargement /> : (l.data ?? []).length === 0 ? <Vide>{t('expeditions.aucune')}</Vide> : (
          <table className="t"><thead><tr><th>{t('champs.reference')}</th><th>{t('champs.dossier')}</th><th>{t('expeditions.mode')}</th><th>{t('expeditions.trajet')}</th><th>ETD</th><th>ETA</th><th>{t('expeditions.bordereau')}</th><th>{t('champs.statut')}</th></tr></thead>
            <tbody>{(l.data ?? []).map((e) => (
              <tr key={e.id} className="cliquable" onClick={() => nav(`/expeditions/${e.id}`)}>
                <td className="ref">{e.reference}</td><td className="ref">{dossiers[e.dossier_id]}</td><td>{t(`modes_exp.${e.mode}`)}</td>
                <td className="sec">{e.port_depart ?? '—'} → {e.port_arrivee ?? e.pays_destination}</td><td className="ref">{date(e.etd, langue)}</td><td className="ref">{date(e.eta, langue)}</td>
                <td className="sec">{e.bordereau_reference ?? '—'}</td><td><Statut statut={e.statut} libelle={t(`statuts_exp.${e.statut}`)} /></td></tr>))}</tbody></table>
        )}
      </CadreTableau>
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

