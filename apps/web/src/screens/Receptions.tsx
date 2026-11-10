// Lot 1, M28 : réception sur site — procès-verbal, réserves, levée, réception définitive.
// Règles et droits appliqués en base (GBS Côte d'Ivoire et administratrice).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date } from '../lib/format';
import { urlSignee } from '../lib/fichiers';
import { Bandeau, Bouton, CadreTableau, Champ, Chargement, Entete, Kpis, Statut, Tiroir, Vide } from '../components/ui';
import { Depot } from '../components/Depot';

interface Reception { id: string; reference: string; dossier_id: string; expedition_id: string | null; date_reception: string; lieu: string;
  client_signataire: string | null; constat: string | null; photos: string[]; statut: 'brouillon' | 'signee' | 'definitive' | 'refusee';
  pv_document: string | null; signe_le: string | null; pv_levee_document: string | null; definitive_le: string | null }
interface Reserve { id: string; reception_id: string; numero: number; description: string; gravite: 'mineure' | 'majeure' | 'bloquante';
  responsable: string; commande_id: string | null; non_conformite_id: string | null; delai: string | null; photos: string[]; statut: 'ouverte' | 'levee';
  preuve: string | null; photos_levee: string[]; levee_le: string | null }
interface ReserveOuverte { reserve_id: string; reception: string; dossier_id: string; dossier: string; numero: number; description: string;
  gravite: string; responsable: string; delai: string | null; en_retard: boolean }
const STATUT = { brouillon: 'neutre', signee: 'att', definitive: 'ok', refusee: 'err' } as const;
const GRAVITE = { mineure: 'neutre', majeure: 'att', bloquante: 'err' } as const;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const aujourdhui = () => new Date().toISOString().slice(0, 10);
async function ouvrir(c: string) { const u = await urlSignee(c); if (u) window.open(u, '_blank', 'noopener,noreferrer'); }

interface Livraison { id: string; reference: string; dossier_id: string; transitaire: string | null; port_arrivee: string | null; statut: string;
  date_mainlevee: string | null; dossiers: { reference: string; clients: { raison_sociale: string } | null } | null }
type RecLiv = Pick<Reception, 'id' | 'reference' | 'expedition_id' | 'statut' | 'client_signataire' | 'date_reception'>;
type ResLiv = Pick<Reserve, 'id' | 'reception_id' | 'numero' | 'description' | 'statut' | 'gravite'>;
// Dédouanement : seules les étapes mesurées en base (lien transmis au transitaire, déclaration déposée, mainlevée).
const DOUANE = ['documents_transmis', 'declaration_deposee', 'mainlevee'] as const;

/** Livraison et réception (maquette LIV) : expéditions arrivées, dédouanement, procès-verbal et réserves. */
export function Livraisons() {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const ecrit = ['admin', 'hub_afrique'].includes(profil?.role ?? '');
  const l = useAsync(async () => ok(await supabase.from('expeditions').select('id, reference, dossier_id, transitaire, port_arrivee, statut, date_mainlevee, dossiers(reference, clients(raison_sociale))')
    .in('statut', ['arrivee', 'mise_a_disposition', 'livree']).order('modifie_le', { ascending: false }).limit(200)) as unknown as Livraison[], []);
  const ids = (l.data ?? []).map((e) => e.id);
  const cle = ids.join(',');
  const rec = useAsync(async () => (ids.length ? ok(await supabase.from('receptions').select('id, reference, expedition_id, statut, client_signataire, date_reception')
    .in('expedition_id', ids).order('cree_le', { ascending: false })) as RecLiv[] : []), [cle]);
  const recIds = (rec.data ?? []).map((r) => r.id);
  const res = useAsync(async () => (recIds.length ? ok(await supabase.from('reserves_reception').select('id, reception_id, numero, description, statut, gravite')
    .in('reception_id', recIds).order('numero')) as ResLiv[] : []), [recIds.join(',')]);
  const docs = useAsync(async () => (ids.length ? ok(await supabase.from('documents_transitaires').select('expedition_id, type').in('expedition_id', ids)
    .in('type', ['declaration_douane', 'mainlevee'])) as { expedition_id: string; type: string }[] : []), [cle]);
  const liens = useAsync(async () => (ids.length ? ok(await supabase.from('liens_transitaires').select('expedition_id').in('expedition_id', ids)) as { expedition_id: string }[] : []), [cle]);
  const [sel, setSel] = useState<string | null>(null);
  const [fiche, setFiche] = useState<string | null>(null);
  const [nouvelle, setNouvelle] = useState(false);
  const tous = l.data ?? [];
  // Réception courante : la plus récente non refusée, sinon la plus récente.
  const reception = (e: string) => { const r = (rec.data ?? []).filter((x) => x.expedition_id === e); return r.find((x) => x.statut !== 'refusee') ?? r[0] ?? null; };
  const reserves = (r: RecLiv | null) => (r ? (res.data ?? []).filter((x) => x.reception_id === r.id) : []);
  const douane = (e: Livraison) => {
    const d = (docs.data ?? []).filter((x) => x.expedition_id === e.id).map((x) => x.type);
    return { documents_transmis: (liens.data ?? []).some((x) => x.expedition_id === e.id), declaration_deposee: d.includes('declaration_douane'),
      mainlevee: Boolean(e.date_mainlevee) || d.includes('mainlevee') };
  };
  const etapeDouane = (e: Livraison) => { const d = douane(e); return d.mainlevee ? 'mainlevee' : d.declaration_deposee ? 'declaration_deposee' : d.documents_transmis ? 'documents_transmis' : null; };
  const pv = (r: RecLiv | null) => {
    if (!r) return { statut: 'neutre', lib: t('livraison.pv_a_venir') };
    const ouvertes = reserves(r).filter((x) => x.statut === 'ouverte').length;
    if (r.statut === 'signee') return { statut: ouvertes ? 'att' : 'ok', lib: ouvertes ? t('livraison.pv_signe_reserves', { n: ouvertes }) : t('livraison.pv_reserves_levees') };
    if (r.statut === 'definitive') return { statut: 'ok', lib: reserves(r).length ? t('reception.statuts.definitive') : t('livraison.pv_sans_reserve') };
    return { statut: STATUT[r.statut], lib: t(`reception.statuts.${r.statut}`) };
  };
  const enCours = tous.filter((e) => reception(e.id)?.statut !== 'definitive');
  const aLever = (res.data ?? []).filter((x) => x.statut === 'ouverte' && (rec.data ?? []).some((r) => r.id === x.reception_id && r.statut === 'signee')).length;
  const titre = [t('livraison.titre_en_cours', { n: enCours.length }), aLever ? t('livraison.titre_reserves', { n: aLever }) : null].filter(Boolean).join(' ; ');
  const x = tous.find((e) => e.id === sel) ?? tous[0] ?? null;
  const rx = x ? reception(x.id) : null;
  const ddmm = (d: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '—');
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.logistique')} · ${t('livraison.surtitre')} · LIV`} titre={l.data ? titre : t('ecrans.livraisons')} />
      <Bandeau type="err">{l.erreur ?? rec.erreur ?? res.erreur ?? docs.erreur ?? liens.erreur}</Bandeau>
      <div className="ref-grille liv-grille">
        <div className="cadre">
          {l.chargement && !l.data ? <Chargement /> : tous.length === 0 ? <Vide>{t('livraison.aucune')}</Vide> : (
            <table className="t"><thead><tr><th>{t('livraison.livraison')}</th><th>{t('livraison.client')}</th><th>{t('livraison.transitaire')}</th>
              <th>{t('livraison.dedouanement')}</th><th>{t('champs.date')}</th><th>{t('livraison.pv')}</th></tr></thead>
              <tbody>{tous.map((e) => {
                const r = reception(e.id), p = pv(r), d = etapeDouane(e);
                return (
                  <tr key={e.id} className={'cliquable' + (x?.id === e.id ? ' choisi' : '')} onClick={() => setSel(e.id)}>
                    <td className="ref">{e.reference}</td><td>{e.dossiers?.clients?.raison_sociale ?? '—'}</td>
                    <td className="sec">{e.transitaire ?? '—'}</td>
                    <td><Statut statut={d === 'mainlevee' ? 'ok' : d ? 'info' : 'neutre'} libelle={d ? t(`livraison.douane.${d}`) : t('livraison.douane_non_commence')} /></td>
                    <td className="ref">{ddmm(r?.date_reception ?? e.date_mainlevee)}</td>
                    <td><Statut statut={p.statut} libelle={p.lib} /></td>
                  </tr>);
              })}</tbody></table>
          )}
        </div>
        {x && (
          <aside className="exp-aside liv-detail">
            <section>
              <span className="mute">{x.reference}</span>
              <b className="liv-client">{x.dossiers?.clients?.raison_sociale ?? '—'}</b>
              <span className="sec">{[x.dossiers?.reference, x.transitaire, x.port_arrivee].filter(Boolean).join(' · ')}</span>
              <Link to={`/expeditions/${x.id}`}>{t('livraison.voir_expedition')}</Link>
            </section>
            <section>
              <div className="surtitre">{t('livraison.dedouanement')}</div>
              <div className="liv-douane">{DOUANE.map((k) => <div key={k} className={douane(x)[k] ? 'fait' : ''}><span />{t(`livraison.douane.${k}`)}</div>)}</div>
              {x.date_mainlevee && <span className="mute">{t('livraison.mainlevee_le', { d: date(x.date_mainlevee, langue) })}</span>}
              <p className="mute">{t('livraison.aide_douane')}</p>
            </section>
            <section>
              <div className="liv-pv"><span className="surtitre">{t('livraison.reception_site')}</span><Statut statut={pv(rx).statut} libelle={pv(rx).lib} /></div>
              {rx ? <>
                <span className="sec">{rx.client_signataire ? t('livraison.signe_par', { nom: rx.client_signataire }) : `${rx.reference} · ${date(rx.date_reception, langue)}`}</span>
                {reserves(rx).map((s) => (
                  <div key={s.id} className="liv-reserve"><span>{s.numero}. {s.description}</span>
                    <Statut statut={s.statut === 'levee' ? 'ok' : 'att'} libelle={t(`reception.statuts_reserve.${s.statut}`)} />
                    {ecrit && rx.statut === 'signee' && s.statut === 'ouverte' ? <Bouton petit onClick={() => setFiche(rx.id)}>{t('reception.lever')}</Bouton> : <span />}
                  </div>))}
                <Bouton onClick={() => setFiche(rx.id)}>{t('livraison.ouvrir_pv')}</Bouton>
              </> : ecrit ? <Bouton variante="primaire" onClick={() => setNouvelle(true)}>{t('reception.nouvelle')}</Bouton>
                : <span className="mute">{t('reception.aucune')}</span>}
            </section>
          </aside>
        )}
      </div>
      {nouvelle && x && <NouvelleReception dossierId={x.dossier_id} expeditionId={x.id} onClose={() => setNouvelle(false)}
        onSaved={(id) => { setNouvelle(false); setFiche(id); void rec.recharger(); }} />}
      {fiche && <FicheReception id={fiche} onClose={() => setFiche(null)} onChange={() => { void rec.recharger(); void res.recharger(); }} />}
    </div>
  );
}

/** Réserves ouvertes de tous les dossiers visibles, en retard d'abord. */
export function ReservesOuvertes() {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const l = useAsync(async () => ok(await supabase.rpc('reserves_ouvertes')) as ReserveOuverte[], []);
  const x = l.data ?? [];
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.logistique')} · M28`} titre={t('reception.reserves_ouvertes')} />
      <Kpis items={[
        { lib: t('reception.ouvertes'), val: String(x.length), sous: t('reception.ouvertes_sous') },
        { lib: t('reception.en_retard'), val: String(x.filter((r) => r.en_retard).length), sous: t('reception.en_retard_sous') },
        { lib: t('reception.majeures'), val: String(x.filter((r) => r.gravite === 'majeure').length), sous: t('reception.majeures_sous') },
      ]} />
      <Bandeau type="err">{l.erreur}</Bandeau>
      <CadreTableau titre={t('reception.reserves_ouvertes')}>
        {x.length === 0 ? <Vide>{t('reception.aucune_reserve_ouverte')}</Vide> : (
          <table className="t"><thead><tr><th>{t('champs.dossier')}</th><th>{t('reception.pv')}</th><th>#</th><th>{t('champs.description')}</th>
            <th>{t('reception.gravite')}</th><th>{t('reception.responsable')}</th><th>{t('reception.delai')}</th></tr></thead>
            <tbody>{x.map((r) => (
              <tr key={r.reserve_id}><td className="ref"><Link to={`/dossiers/${r.dossier_id}`}>{r.dossier}</Link></td><td className="ref">{r.reception}</td>
                <td>{r.numero}</td><td>{r.description}</td><td><Statut statut={GRAVITE[r.gravite as keyof typeof GRAVITE] ?? 'neutre'} libelle={t(`reception.gravites.${r.gravite}`)} /></td>
                <td>{t(`reception.responsables.${r.responsable}`)}</td>
                <td className="ref">{r.delai ? date(r.delai, langue) : '—'}{r.en_retard && <div><Statut statut="err" libelle={t('reception.en_retard')} /></div>}</td></tr>))}</tbody></table>
        )}
      </CadreTableau>
    </div>
  );
}

/** Onglet « Réceptions » de la fiche dossier. */
export function ReceptionsDossier({ dossierId }: { dossierId: string }) {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const ecrit = ['admin', 'hub_afrique'].includes(profil?.role ?? '');
  const r = useAsync(async () => ok(await supabase.from('receptions').select('*').eq('dossier_id', dossierId).order('cree_le', { ascending: false })) as Reception[], [dossierId]);
  const [nouvelle, setNouvelle] = useState(false);
  const [fiche, setFiche] = useState<string | null>(null);
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="section-titre">{t('reception.titre')}</span>
        {ecrit && <Bouton petit onClick={() => setNouvelle(true)}>{t('reception.nouvelle')}</Bouton>}
      </div>
      <Bandeau type="err">{r.erreur}</Bandeau>
      {(r.data ?? []).length === 0 ? <span className="mute">{t('reception.aucune')}</span> : (
        <table className="t"><tbody>{(r.data ?? []).map((x) => (
          <tr key={x.id} className="cliquable" onClick={() => setFiche(x.id)}><td className="ref">{x.reference}</td><td className="ref">{date(x.date_reception, langue)}</td>
            <td>{x.lieu}</td><td><Statut statut={STATUT[x.statut]} libelle={t(`reception.statuts.${x.statut}`)} /></td></tr>))}</tbody></table>
      )}
      <p className="mute">{t('reception.aide')}</p>
      {nouvelle && <NouvelleReception dossierId={dossierId} onClose={() => setNouvelle(false)} onSaved={(id) => { setNouvelle(false); setFiche(id); void r.recharger(); }} />}
      {fiche && <FicheReception id={fiche} onClose={() => setFiche(null)} onChange={() => void r.recharger()} />}
    </section>
  );
}

function NouvelleReception({ dossierId, expeditionId, onClose, onSaved }: { dossierId: string; expeditionId?: string; onClose: () => void; onSaved: (id: string) => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const exp = useAsync(async () => ok(await supabase.from('expeditions').select('id, reference, statut').eq('dossier_id', dossierId)
    .in('statut', ['arrivee', 'mise_a_disposition', 'livree'])) as { id: string; reference: string }[], [dossierId]);
  const [f, setF] = useState({ expedition_id: expeditionId ?? '', date_reception: aujourdhui(), lieu: '', constat: '' });
  const enregistrer = async () => {
    const v = z.object({ dossier_id: z.string().uuid(), expedition_id: z.string().uuid().nullable(), date_reception: DATE, lieu: z.string().trim().min(2).max(200),
      constat: z.string().trim().max(4000).nullable() }).strict()
      .safeParse({ dossier_id: dossierId, expedition_id: f.expedition_id || null, date_reception: f.date_reception, lieu: f.lieu, constat: f.constat.trim() || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    let id = '';
    if (await a.executer(async () => { id = (ok(await supabase.from('receptions').insert(v.data).select('id').single()) as { id: string }).id; })) onSaved(id);
  };
  return (
    <Tiroir titre={t('reception.nouvelle')} onClose={onClose}>
      <Champ label={t('reception.expedition')}><select value={f.expedition_id} onChange={(e) => setF({ ...f, expedition_id: e.target.value })}>
        <option value="">—</option>{(exp.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.reference}</option>)}</select></Champ>
      <Champ label={t('reception.date')}><input type="date" max={aujourdhui()} value={f.date_reception} onChange={(e) => setF({ ...f, date_reception: e.target.value })} /></Champ>
      <Champ label={t('reception.lieu')}><input value={f.lieu} maxLength={200} onChange={(e) => setF({ ...f, lieu: e.target.value })} /></Champ>
      <Champ label={t('reception.constat')}><textarea rows={3} maxLength={4000} value={f.constat} onChange={(e) => setF({ ...f, constat: e.target.value })} /></Champ>
      <Bandeau type="err">{exp.erreur ?? a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

function FicheReception({ id, onClose, onChange }: { id: string; onClose: () => void; onChange: () => void }) {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const ecrit = ['admin', 'hub_afrique'].includes(profil?.role ?? '');
  const r = useAsync(async () => ok(await supabase.from('receptions').select('*').eq('id', id).maybeSingle()) as Reception | null, [id]);
  const rs = useAsync(async () => ok(await supabase.from('reserves_reception').select('*').eq('reception_id', id).order('numero')) as Reserve[], [id]);
  const a = useAction();
  const [res, setRes] = useState({ description: '', gravite: 'mineure', responsable: 'fournisseur', delai: '', commande_id: '' });
  const cmds = useAsync(async () => (r.data ? ok(await supabase.from('commandes').select('id, reference').eq('dossier_id', r.data.dossier_id).neq('statut', 'annulee')) as { id: string; reference: string }[] : []), [r.data?.dossier_id]);
  const [resPhotos, setResPhotos] = useState<string[]>([]);
  const [sig, setSig] = useState({ decision: 'acceptee', signataire: '', document: '', date: aujourdhui() });
  const [levee, setLevee] = useState<{ id: string; preuve: string; photos: string[] } | null>(null);
  const [def, setDef] = useState({ document: '', date: aujourdhui() });
  const x = r.data;
  const recharger = () => { void r.recharger(); void rs.recharger(); onChange(); };
  const ajouterReserve = async () => {
    const v = z.object({ reception_id: z.string().uuid(), description: z.string().trim().min(3).max(2000), gravite: z.enum(['mineure', 'majeure', 'bloquante']),
      responsable: z.enum(['fournisseur', 'transitaire', 'gbs', 'client']), delai: DATE.nullable(), photos: z.array(z.string().max(400)).max(20),
      commande_id: z.string().uuid().nullable() }).strict()
      .safeParse({ reception_id: id, description: res.description, gravite: res.gravite, responsable: res.responsable, delai: res.delai || null, photos: resPhotos,
        commande_id: res.responsable === 'fournisseur' && res.commande_id ? res.commande_id : null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('reserves_reception').insert(v.data)))) {
      setRes({ description: '', gravite: 'mineure', responsable: 'fournisseur', delai: '', commande_id: '' }); setResPhotos([]); recharger();
    }
  };
  const signer = async () => {
    const v = z.object({ p_reception: z.string().uuid(), p_decision: z.enum(['acceptee', 'refusee']), p_signataire: z.string().trim().min(2).max(120),
      p_document: z.string().min(1).max(400), p_signe_le: DATE }).strict()
      .safeParse({ p_reception: id, p_decision: sig.decision, p_signataire: sig.signataire, p_document: sig.document, p_signe_le: sig.date });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('signer_reception', v.data)))) recharger();
  };
  const lever = async () => {
    if (!levee) return;
    const v = z.object({ p_reserve: z.string().uuid(), p_preuve: z.string().trim().min(10).max(2000), p_photos: z.array(z.string().max(400)).max(20) }).strict()
      .safeParse({ p_reserve: levee.id, p_preuve: levee.preuve, p_photos: levee.photos });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('lever_reserve', v.data)))) { setLevee(null); recharger(); }
  };
  const prononcer = async () => {
    const v = z.object({ p_reception: z.string().uuid(), p_document: z.string().min(1).max(400), p_date: DATE }).strict()
      .safeParse({ p_reception: id, p_document: def.document, p_date: def.date });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('prononcer_reception_definitive', v.data)))) recharger();
  };
  const reserves = rs.data ?? [];
  return (
    <Tiroir titre={x ? `${x.reference} — ${x.lieu}` : t('reception.titre')} onClose={onClose}>
      <Bandeau type="err">{r.erreur ?? rs.erreur ?? a.erreur}</Bandeau>
      {x && <>
        <div><Statut statut={STATUT[x.statut]} libelle={t(`reception.statuts.${x.statut}`)} /> · {date(x.date_reception, langue)}
          {x.client_signataire && <> · {x.client_signataire}</>}</div>
        {x.constat && <p>{x.constat}</p>}
        <span className="actions" style={{ flexWrap: 'wrap' }}>
          {x.pv_document && <Bouton petit onClick={() => void ouvrir(x.pv_document!)}>{t('reception.pv_signe')}</Bouton>}
          {x.pv_levee_document && <Bouton petit onClick={() => void ouvrir(x.pv_levee_document!)}>{t('reception.pv_levee')}</Bouton>}
          {x.photos.map((p, i) => <Bouton key={p} petit onClick={() => void ouvrir(p)}>{t('nc.photo', { n: i + 1 })}</Bouton>)}
        </span>

        <div className="section-titre">{t('reception.reserves')}</div>
        {reserves.length === 0 ? <span className="mute">{t('reception.sans_reserve')}</span> : (
          <table className="t"><tbody>{reserves.map((s) => (
            <tr key={s.id}><td>{s.numero}</td><td>{s.description}<div className="mute">{t(`reception.responsables.${s.responsable}`)}{s.delai ? ` · ${date(s.delai, langue)}` : ''}</div>
              {s.preuve && <div className="mute">{t('reception.levee_le', { date: date(s.levee_le, langue) })} : {s.preuve}</div>}
              {s.non_conformite_id && <div className="mute">{t('reception.nc_ouverte')}</div>}</td>
              <td><Statut statut={GRAVITE[s.gravite]} libelle={t(`reception.gravites.${s.gravite}`)} /></td>
              <td><Statut statut={s.statut === 'levee' ? 'ok' : 'att'} libelle={t(`reception.statuts_reserve.${s.statut}`)} /></td>
              <td className="num">{ecrit && x.statut === 'signee' && s.statut === 'ouverte' && <Bouton petit onClick={() => setLevee({ id: s.id, preuve: '', photos: [] })}>{t('reception.lever')}</Bouton>}</td></tr>))}</tbody></table>
        )}
        {ecrit && x.statut === 'brouillon' && <>
          <Champ label={t('champs.description')}><input value={res.description} maxLength={2000} onChange={(e) => setRes({ ...res, description: e.target.value })} /></Champ>
          <div className="actions" style={{ flexWrap: 'wrap' }}>
            <select value={res.gravite} aria-label={t('reception.gravite')} onChange={(e) => setRes({ ...res, gravite: e.target.value })}>
              {(['mineure', 'majeure', 'bloquante'] as const).map((g) => <option key={g} value={g}>{t(`reception.gravites.${g}`)}</option>)}</select>
            <select value={res.responsable} aria-label={t('reception.responsable')} onChange={(e) => setRes({ ...res, responsable: e.target.value })}>
              {['fournisseur', 'transitaire', 'gbs', 'client'].map((g) => <option key={g} value={g}>{t(`reception.responsables.${g}`)}</option>)}</select>
            <input type="date" aria-label={t('reception.delai')} min={x.date_reception} value={res.delai} onChange={(e) => setRes({ ...res, delai: e.target.value })} />
            {res.responsable === 'fournisseur' && (cmds.data ?? []).length > 1 && <select value={res.commande_id} aria-label={t('reception.commande')} onChange={(e) => setRes({ ...res, commande_id: e.target.value })}>
              <option value="">{t('reception.commande')}</option>{(cmds.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.reference}</option>)}</select>}
          </div>
          {res.responsable === 'fournisseur' && res.gravite !== 'mineure' && <p className="mute">{t('reception.aide_nc')}</p>}
          <Depot dossierId={x.dossier_id} valeur={null} onChange={(c) => setResPhotos((p) => (p.length < 20 ? [...p, c] : p))} />
          {resPhotos.length > 0 && <span className="mute">{t('nc.photos_jointes', { n: resPhotos.length })}</span>}
          <Bouton petit onClick={() => void ajouterReserve()}>{t('reception.ajouter_reserve')}</Bouton>

          <div className="section-titre">{t('reception.signature')}</div>
          <Champ label={t('reception.decision')}><select value={sig.decision} onChange={(e) => setSig({ ...sig, decision: e.target.value })}>
            <option value="acceptee">{t('reception.decisions.acceptee')}</option><option value="refusee">{t('reception.decisions.refusee')}</option></select></Champ>
          <Champ label={t('approbation.signataire')}><input value={sig.signataire} maxLength={120} onChange={(e) => setSig({ ...sig, signataire: e.target.value })} /></Champ>
          <Champ label={t('reception.signe_le')}><input type="date" min={x.date_reception} max={aujourdhui()} value={sig.date} onChange={(e) => setSig({ ...sig, date: e.target.value })} /></Champ>
          <Champ label={t('reception.pv_signe')}><Depot dossierId={x.dossier_id} valeur={sig.document || null} onChange={(c) => setSig({ ...sig, document: c })} /></Champ>
          <p className="mute">{t('reception.aide_signature')}</p>
          <Bouton variante="primaire" disabled={a.enCours || !sig.document} onClick={() => void signer()}>{t('reception.enregistrer_pv')}</Bouton>
        </>}
        {ecrit && x.statut === 'signee' && reserves.every((s) => s.statut === 'levee') && <>
          <div className="section-titre">{t('reception.definitive')}</div>
          <Champ label={t('reception.date')}><input type="date" max={aujourdhui()} value={def.date} onChange={(e) => setDef({ ...def, date: e.target.value })} /></Champ>
          <Champ label={t('reception.pv_levee')}><Depot dossierId={x.dossier_id} valeur={def.document || null} onChange={(c) => setDef({ ...def, document: c })} /></Champ>
          <Bouton variante="primaire" disabled={a.enCours || !def.document} onClick={() => void prononcer()}>{t('reception.prononcer')}</Bouton>
        </>}
        {levee && <>
          <div className="section-titre">{t('reception.lever')}</div>
          <Champ label={t('nc.preuve')}><textarea rows={3} maxLength={2000} value={levee.preuve} onChange={(e) => setLevee({ ...levee, preuve: e.target.value })} /></Champ>
          <Depot dossierId={x.dossier_id} valeur={null} onChange={(c) => setLevee((l) => (l && l.photos.length < 20 ? { ...l, photos: [...l.photos, c] } : l))} />
          <span className="actions"><Bouton variante="primaire" disabled={a.enCours} onClick={() => void lever()}>{t('reception.lever')}</Bouton>
            <Bouton onClick={() => setLevee(null)}>{t('commun.fermer')}</Bouton></span>
        </>}
      </>}
    </Tiroir>
  );
}
