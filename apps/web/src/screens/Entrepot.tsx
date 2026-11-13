// Logistique · entrepôt de consolidation (maquette « ENT », cahier des charges M19).
// Réserves automatiques, capacité du conteneur, clôture de la liste de colisage et empotage : règles en base.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, nombre } from '../lib/format';
import { useNoms } from '../lib/referentiels';
import { Bandeau, Bouton, Champ, Chargement, Entete, Jauge, Kpis, Statut, Tiroir, Vide } from '../components/ui';
import { Depot } from '../components/Depot';

type StatutCns = 'ouverte' | 'colisage_clos' | 'empotage_planifie' | 'empote';
interface Consolidation { id: string; reference: string; dossier_id: string; type_conteneur: '20_dv' | '40_dv' | '40_hc'; entrepot: string; statut: StatutCns;
  empotage_prevu_le: string | null; numero_conteneur: string | null; numero_plomb: string | null; dossiers: { reference: string } | null }
interface Reception { id: string; reference: string; fournisseur_id: string; recue_le: string; colis_attendus: number; colis_recus: number; volume_m3: number; poids_kg: number;
  emplacement: string | null; photos: string[]; statut: 'conforme' | 'reserve' | 'reserve_levee'; reserve: string | null; levee_motif: string | null }
interface Etat { receptions: number; colis_recus: number; colis_attendus: number; volume_m3: number; poids_kg: number; reserves_ouvertes: number; capacite_m3: number; charge_kg: number }
const TYPES = ['20_dv', '40_dv', '40_hc'] as const;
const auj = () => new Date().toISOString().slice(0, 10);
const num = (x: string) => Number(x.replace(/\s/g, '').replace(',', '.'));

export function Entrepot() {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const ecrit = ['admin', 'achats_chine'].includes(profil?.role ?? '');
  const fournisseurs = useNoms('fournisseurs');
  const cns = useAsync(async () => ok(await supabase.from('consolidations').select('id, reference, dossier_id, type_conteneur, entrepot, statut, empotage_prevu_le, numero_conteneur, numero_plomb, dossiers(reference)')
    .order('cree_le', { ascending: false }).limit(200)) as unknown as Consolidation[], []);
  const [sel, setSel] = useState<string | null>(null);
  const c = (cns.data ?? []).find((x) => x.id === sel) ?? (cns.data ?? []).find((x) => x.statut !== 'empote') ?? (cns.data ?? [])[0] ?? null;
  const recs = useAsync(async () => (c ? ok(await supabase.from('receptions_entrepot').select('*').eq('consolidation_id', c.id).order('reference')) as Reception[] : []), [c?.id]);
  const et = useAsync(async () => (c ? ok(await supabase.rpc('etat_consolidation', { p_consolidation: c.id })) as Etat : null), [c?.id, (recs.data ?? []).length]);
  const a = useAction();
  const [ouvrir, setOuvrir] = useState(false);
  const [recevoir, setRecevoir] = useState(false);
  const [lever, setLever] = useState<Reception | null>(null);
  const [empotage, setEmpotage] = useState<'planifier' | 'confirmer' | null>(null);
  const recharger = () => { void cns.recharger(); void recs.recharger(); void et.recharger(); };
  const e = et.data;
  const pct = (v: number, m: number) => (m ? Math.round((100 * Number(v)) / Number(m)) : 0);
  const clore = async () => { if (c && await a.executer(async () => ok(await supabase.rpc('clore_colisage', { p_consolidation: c.id })))) recharger(); };
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.logistique')} · ${t('entrepot.surtitre')}${c ? ` · ${c.entrepot}` : ''} · ENT`}
        titre={c && e ? t('entrepot.titre', { n: e.receptions, ref: c.dossiers?.reference ?? '', type: t(`entrepot.types.${c.type_conteneur}`), p: pct(e.volume_m3, e.capacite_m3), r: e.reserves_ouvertes })
          : t('ecrans.entrepot')}
        actions={ecrit && <>
          <Bouton onClick={() => setOuvrir(true)}>{t('entrepot.ouvrir')}</Bouton>
          {c?.statut === 'ouverte' && <Bouton variante="primaire" onClick={() => setRecevoir(true)}>{t('entrepot.nouvelle_reception')}</Bouton>}
        </>} />
      <Bandeau type="err">{cns.erreur ?? recs.erreur ?? et.erreur ?? a.erreur}</Bandeau>
      {(cns.data ?? []).length > 1 && (
        <div className="segment portee-taches" role="group" aria-label={t('entrepot.consolidations')}>
          {(cns.data ?? []).map((x) => <button key={x.id} type="button" aria-pressed={c?.id === x.id} onClick={() => setSel(x.id)}>{x.reference}</button>)}
        </div>)}
      {cns.chargement && !cns.data ? <Chargement /> : !c ? <Vide>{t('entrepot.aucune')}</Vide> : (<>
        {e && <Kpis items={[
          { lib: t('entrepot.k_volume'), val: `${nombre(Number(e.volume_m3), langue, 1)} m³`, sous: t('entrepot.sur', { v: `${e.capacite_m3} m³` }) },
          { lib: t('entrepot.k_poids'), val: `${nombre(Number(e.poids_kg), langue, 0)} kg`, sous: t('entrepot.sur', { v: `${nombre(Number(e.charge_kg), langue, 0)} kg` }) },
          { lib: t('entrepot.k_colis'), val: e.colis_recus, sous: t('entrepot.attendus', { n: e.colis_attendus }) },
          { lib: t('entrepot.k_reserves'), val: e.reserves_ouvertes, sous: e.reserves_ouvertes ? t('entrepot.a_lever') : t('entrepot.aucune_reserve') },
        ]} />}
        <div className="ref-grille ent-grille">
          <div className="cadre">
            {(recs.data ?? []).length === 0 ? <Vide>{t('entrepot.aucune_reception')}</Vide> : (
              <table className="t">
                <thead><tr><th>{t('entrepot.reception')}</th><th>{t('entrepot.fournisseur')}</th><th className="num">{t('entrepot.colis')}</th>
                  <th className="num">{t('entrepot.volume')}</th><th className="num">{t('entrepot.poids')}</th><th>{t('entrepot.emplacement')}</th><th>{t('entrepot.controle')}</th></tr></thead>
                <tbody>{(recs.data ?? []).map((r) => (
                  <tr key={r.id}>
                    <td className="ref">{r.reference}<div className="mute">{date(r.recue_le, langue)}</div></td>
                    <td>{fournisseurs[r.fournisseur_id] ?? '—'}{r.reserve && <div className={r.statut === 'reserve' ? 'txt-err' : 'mute'}>{r.reserve}</div>}
                      {r.levee_motif && <div className="mute">{t('entrepot.levee', { motif: r.levee_motif })}</div>}</td>
                    <td className={'num' + (r.colis_recus < r.colis_attendus ? ' txt-err' : '')}>{r.colis_recus} / {r.colis_attendus}</td>
                    <td className="num nowrap">{nombre(Number(r.volume_m3), langue, 1)} m³</td>
                    <td className="num nowrap">{nombre(Number(r.poids_kg), langue, 0)} kg</td>
                    <td className="ref">{r.emplacement ?? '—'}</td>
                    <td className="nowrap"><Statut statut={r.statut === 'reserve' ? 'att' : 'ok'} libelle={t(`entrepot.statuts_rec.${r.statut}`)} />
                      {ecrit && r.statut === 'reserve' && c.statut === 'ouverte' && <> <Bouton petit onClick={() => setLever(r)}>{t('entrepot.lever')}</Bouton></>}</td>
                  </tr>))}</tbody>
              </table>)}
          </div>
          <aside className="exp-aside">
            <section>
              <span className="surtitre">{t('entrepot.conteneur', { type: t(`entrepot.types.${c.type_conteneur}`), ref: c.dossiers?.reference ?? '' })}</span>
              <Statut statut={c.statut === 'empote' ? 'ok' : c.statut === 'ouverte' ? 'info' : 'att'} libelle={t(`entrepot.statuts.${c.statut}`)} />
              {e && <>
                <div className="ent-jauge"><span>{t('entrepot.k_volume')}</span><b>{pct(e.volume_m3, e.capacite_m3)} %</b></div><Jauge valeur={pct(e.volume_m3, e.capacite_m3)} />
                <div className="ent-jauge"><span>{t('entrepot.k_poids')}</span><b>{pct(e.poids_kg, e.charge_kg)} %</b></div><Jauge valeur={pct(e.poids_kg, e.charge_kg)} />
              </>}
              {c.empotage_prevu_le && <span className="sec">{t('entrepot.empotage_prevu', { d: date(c.empotage_prevu_le, langue) })}</span>}
              {c.numero_conteneur && <span className="sec ref">{c.numero_conteneur} · {c.numero_plomb}</span>}
            </section>
            {ecrit && <section>
              {c.statut === 'ouverte' && <Bouton variante="primaire" disabled={a.enCours || !e || e.reserves_ouvertes > 0 || e.receptions === 0} onClick={() => void clore()}>{t('entrepot.clore')}</Bouton>}
              {(c.statut === 'colisage_clos' || c.statut === 'empotage_planifie') && <Bouton onClick={() => setEmpotage('planifier')}>{t('entrepot.planifier')}</Bouton>}
              {c.statut === 'empotage_planifie' && <Bouton variante="primaire" onClick={() => setEmpotage('confirmer')}>{t('entrepot.confirmer')}</Bouton>}
            </section>}
            <section><p className="mute">{t('entrepot.aide')}</p></section>
          </aside>
        </div>
      </>)}
      {ouvrir && <OuvrirConsolidation onClose={() => setOuvrir(false)} onSaved={(id) => { setOuvrir(false); setSel(id); recharger(); }} />}
      {recevoir && c && <NouvelleReception c={c} fournisseurs={fournisseurs} onClose={() => setRecevoir(false)} onSaved={() => { setRecevoir(false); recharger(); }} />}
      {lever && <LeverReserve r={lever} onClose={() => setLever(null)} onSaved={() => { setLever(null); recharger(); }} />}
      {empotage && c && <Empotage c={c} mode={empotage} onClose={() => setEmpotage(null)} onSaved={() => { setEmpotage(null); recharger(); }} />}
    </div>
  );
}

function OuvrirConsolidation({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const dossiers = useAsync(async () => ok(await supabase.from('dossiers').select('id, reference, intitule').eq('statut', 'ouvert').order('reference', { ascending: false }).limit(300)) as
    { id: string; reference: string; intitule: string }[], []);
  const [f, setF] = useState({ dossier: '', type: '40_hc', entrepot: 'Foshan' });
  const valider = async () => {
    const v = z.object({ p_dossier: z.string().uuid(), p_type: z.enum(TYPES), p_entrepot: z.string().trim().min(2).max(80) }).strict()
      .safeParse({ p_dossier: f.dossier, p_type: f.type, p_entrepot: f.entrepot });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    let id = '';
    if (await a.executer(async () => { id = ok(await supabase.rpc('ouvrir_consolidation', v.data)) as string; })) onSaved(id);
  };
  return (
    <Tiroir titre={t('entrepot.ouvrir')} onClose={onClose}>
      <Champ label={t('entrepot.dossier')}><select value={f.dossier} onChange={(e) => setF({ ...f, dossier: e.target.value })}>
        <option value="">—</option>{(dossiers.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.reference} · {d.intitule}</option>)}</select></Champ>
      <Champ label={t('entrepot.type')}><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
        {TYPES.map((x) => <option key={x} value={x}>{t(`entrepot.types.${x}`)}</option>)}</select></Champ>
      <Champ label={t('entrepot.entrepot')}><input value={f.entrepot} maxLength={80} onChange={(e) => setF({ ...f, entrepot: e.target.value })} /></Champ>
      <Bandeau type="err">{a.erreur ?? dossiers.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours || !f.dossier} onClick={() => void valider()}>{t('entrepot.ouvrir')}</Bouton>
    </Tiroir>
  );
}

function NouvelleReception({ c, fournisseurs, onClose, onSaved }: { c: Consolidation; fournisseurs: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const cmds = useAsync(async () => ok(await supabase.from('commandes').select('id, reference, fournisseur_id').eq('dossier_id', c.dossier_id).neq('statut', 'annulee')) as
    { id: string; reference: string | null; fournisseur_id: string }[], [c.dossier_id]);
  const [f, setF] = useState({ commande: '', fournisseur: '', recue_le: auj(), attendus: '', recus: '', volume: '', poids: '', emplacement: '', reserve: '', photos: [] as string[] });
  const valider = async () => {
    const p: Record<string, unknown> = { recue_le: f.recue_le, colis_recus: num(f.recus), volume_m3: num(f.volume), poids_kg: num(f.poids),
      emplacement: f.emplacement.trim() || null, reserve: f.reserve.trim() || null, photos: f.photos };
    if (f.commande) p.commande_id = f.commande; else p.fournisseur_id = f.fournisseur;
    if (f.attendus.trim()) p.colis_attendus = num(f.attendus);
    const v = z.object({ p_consolidation: z.string().uuid(), p: z.object({ commande_id: z.string().uuid().optional(), fournisseur_id: z.string().uuid().optional(),
      recue_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), colis_attendus: z.number().int().min(1).max(100000).optional(), colis_recus: z.number().int().min(0).max(100000),
      volume_m3: z.number().min(0).max(200), poids_kg: z.number().min(0).max(60000), emplacement: z.string().regex(/^[A-Za-z0-9 ./_-]{1,20}$/).nullable(),
      reserve: z.string().max(1000).nullable(), photos: z.array(z.string().max(400)).max(30) }).strict() }).strict().safeParse({ p_consolidation: c.id, p });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('receptionner', v.data)))) onSaved();
  };
  return (
    <Tiroir titre={t('entrepot.nouvelle_reception')} onClose={onClose}>
      <Champ label={t('entrepot.commande')}><select value={f.commande} onChange={(e) => setF({ ...f, commande: e.target.value })}>
        <option value="">{t('entrepot.sans_commande')}</option>
        {(cmds.data ?? []).map((k) => <option key={k.id} value={k.id}>{k.reference ?? k.id.slice(0, 8)} · {fournisseurs[k.fournisseur_id] ?? ''}</option>)}</select></Champ>
      {!f.commande && <Champ label={t('entrepot.fournisseur')}><select value={f.fournisseur} onChange={(e) => setF({ ...f, fournisseur: e.target.value })}>
        <option value="">—</option>{Object.entries(fournisseurs).sort((x, y) => x[1].localeCompare(y[1])).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></Champ>}
      <Champ label={t('entrepot.recue_le')}><input type="date" value={f.recue_le} max={auj()} onChange={(e) => setF({ ...f, recue_le: e.target.value })} /></Champ>
      <Champ label={t('entrepot.colis_attendus')}><input inputMode="numeric" value={f.attendus} placeholder={f.commande ? t('entrepot.attendus_colisage') : ''} onChange={(e) => setF({ ...f, attendus: e.target.value })} /></Champ>
      <Champ label={t('entrepot.colis_recus')}><input inputMode="numeric" value={f.recus} onChange={(e) => setF({ ...f, recus: e.target.value })} /></Champ>
      <Champ label={t('entrepot.volume_m3')}><input inputMode="decimal" value={f.volume} onChange={(e) => setF({ ...f, volume: e.target.value })} /></Champ>
      <Champ label={t('entrepot.poids_kg')}><input inputMode="decimal" value={f.poids} onChange={(e) => setF({ ...f, poids: e.target.value })} /></Champ>
      <Champ label={t('entrepot.emplacement')}><input value={f.emplacement} maxLength={20} onChange={(e) => setF({ ...f, emplacement: e.target.value })} /></Champ>
      <Champ label={t('entrepot.reserve')}><textarea value={f.reserve} maxLength={1000} placeholder={t('entrepot.reserve_aide')} onChange={(e) => setF({ ...f, reserve: e.target.value })} /></Champ>
      <Champ label={t('entrepot.photos')}><Depot dossierId={c.dossier_id} valeur={null} onChange={(p) => setF({ ...f, photos: [...f.photos, p].slice(0, 30) })} />
        <span className="mute">{t('entrepot.n_photos', { n: f.photos.length })}</span></Champ>
      <Bandeau type="err">{a.erreur ?? cmds.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours || (!f.commande && !f.fournisseur) || !f.recus || !f.volume || !f.poids} onClick={() => void valider()}>{t('entrepot.enregistrer')}</Bouton>
    </Tiroir>
  );
}

function LeverReserve({ r, onClose, onSaved }: { r: Reception; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [motif, setMotif] = useState('');
  const valider = async () => {
    const v = z.object({ p_reception: z.string().uuid(), p_motif: z.string().trim().min(5).max(1000) }).strict().safeParse({ p_reception: r.id, p_motif: motif });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('lever_reserve_entrepot', v.data)))) onSaved();
  };
  return (
    <Tiroir titre={`${t('entrepot.lever')} · ${r.reference}`} onClose={onClose}>
      <p className="sec">{r.reserve}</p>
      <Champ label={t('champs.motif')}><textarea value={motif} maxLength={1000} onChange={(e) => setMotif(e.target.value)} /></Champ>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours || motif.trim().length < 5} onClick={() => void valider()}>{t('entrepot.lever')}</Bouton>
    </Tiroir>
  );
}

function Empotage({ c, mode, onClose, onSaved }: { c: Consolidation; mode: 'planifier' | 'confirmer'; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [f, setF] = useState({ date: c.empotage_prevu_le ?? '', conteneur: '', plomb: '', photos: [] as string[] });
  const valider = async () => {
    if (mode === 'planifier') {
      const v = z.object({ p_consolidation: z.string().uuid(), p_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict().safeParse({ p_consolidation: c.id, p_date: f.date });
      if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
      if (await a.executer(async () => ok(await supabase.rpc('planifier_empotage', v.data)))) onSaved();
      return;
    }
    const v = z.object({ p_consolidation: z.string().uuid(), p: z.object({ numero_conteneur: z.string().regex(/^[A-Z]{4}[0-9]{7}$/), numero_plomb: z.string().trim().min(3).max(40),
      photos: z.array(z.string().max(400)).min(1).max(30) }).strict() }).strict()
      .safeParse({ p_consolidation: c.id, p: { numero_conteneur: f.conteneur.trim().toUpperCase(), numero_plomb: f.plomb, photos: f.photos } });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('confirmer_empotage', v.data)))) onSaved();
  };
  return (
    <Tiroir titre={t(mode === 'planifier' ? 'entrepot.planifier' : 'entrepot.confirmer')} onClose={onClose}>
      {mode === 'planifier' ? (
        <Champ label={t('entrepot.date_empotage')}><input type="date" value={f.date} min={auj()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Champ>
      ) : (<>
        <Champ label={t('entrepot.numero_conteneur')}><input value={f.conteneur} maxLength={11} placeholder="MSKU4821930" onChange={(e) => setF({ ...f, conteneur: e.target.value })} /></Champ>
        <Champ label={t('entrepot.numero_plomb')}><input value={f.plomb} maxLength={40} onChange={(e) => setF({ ...f, plomb: e.target.value })} /></Champ>
        <Champ label={t('entrepot.photos_empotage')}><Depot dossierId={c.dossier_id} valeur={null} onChange={(p) => setF({ ...f, photos: [...f.photos, p].slice(0, 30) })} />
          <span className="mute">{t('entrepot.n_photos', { n: f.photos.length })}</span></Champ>
      </>)}
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours || (mode === 'planifier' ? !f.date : !f.conteneur || !f.plomb || f.photos.length === 0)} onClick={() => void valider()}>
        {t(mode === 'planifier' ? 'entrepot.planifier' : 'entrepot.confirmer')}</Bouton>
    </Tiroir>
  );
}
