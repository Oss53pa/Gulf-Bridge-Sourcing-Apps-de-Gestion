// Lot 1, M37 : interventions sur site (installation, mise en service, après-vente), HSE,
// temps passé, coût réel et facturation au coût + 15 %. Règles et droits appliqués en base.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, dateHeure, montant } from '../lib/format';
import { useNoms } from '../lib/referentiels';
import { urlSignee } from '../lib/fichiers';
import { Bandeau, Bouton, CadreTableau, Champ, Entete, Onglets, Statut, Tiroir, Vide } from '../components/ui';
import { Depot } from '../components/Depot';

interface Intervention { id: string; reference: string; dossier_id: string; type: string; objet: string; lieu: string; date_debut: string; date_fin: string;
  habilitations_requises: string[]; permis_requis: string[]; analyse_risques: { danger: string; mesure: string }[]; epi: string[];
  statut: 'planifiee' | 'en_cours' | 'terminee' | 'facturee' | 'annulee'; compte_rendu: string | null; pv_document: string | null; facture_id: string | null }
type InterventionListe = Intervention & { dossiers: { reference: string; clients: { raison_sociale: string } | null } | null;
  intervention_techniciens: { technicien_id: string }[]; intervention_temps: { heures: number }[] };
interface Cout { temps_xof: number; frais_xof: number; cout_reel_xof: number; majoration: number; a_facturer_xof: number }
interface Temps { id: string; technicien_id: string; date_travail: string; heures: number; taux_horaire_xof: number; cout_xof: number; travaux: string }
interface Incident { id: string; reference: string; intervention_id: string; survenu_le: string; nature: string; description: string; mesures: string }
interface Permis { id: string; type: string; numero: string; delivre_par: string; valide_du: string; valide_au: string }
interface Habilitation { habilitation_id: string; technicien: string; type: string; libelle: string; expire_le: string }
const HABILITATIONS = ['electrique', 'travail_hauteur', 'espace_confine', 'levage', 'soudure', 'frigorifique', 'secourisme', 'accueil_site', 'autre'] as const;
const NATURES = ['presque_accident', 'incident', 'accident_sans_arret', 'accident_avec_arret'] as const;
const STATUT = { planifiee: 'neutre', en_cours: 'info', terminee: 'att', facturee: 'ok', annulee: 'neutre' } as const;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const liste = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
async function ouvrir(c: string) { const u = await urlSignee(c); if (u) window.open(u, '_blank', 'noopener,noreferrer'); }

/** Écran transverse : planning, habilitations, registre HSE. */
export function Interventions() {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const gere = ['admin', 'hub_afrique'].includes(profil?.role ?? '');
  const [onglet, setOnglet] = useState<'planning' | 'habilitations' | 'hse'>('planning');
  const [fiche, setFiche] = useState<string | null>(null);
  const dossiers = useNoms('dossiers');
  const l = useAsync(async () => ok(await supabase.from('interventions')
    .select('*, dossiers(reference, clients(raison_sociale)), intervention_techniciens(technicien_id), intervention_temps(heures)')
    .order('date_debut', { ascending: false }).limit(500)) as unknown as InterventionListe[], []);
  // Coût réel et montant à facturer calculés en base (temps + frais, majoration paramétrée), pour qui gère les interventions.
  const couts = useAsync(async () => {
    const ids = gere ? (l.data ?? []).filter((x) => x.intervention_temps.length > 0 && x.statut !== 'annulee').map((x) => x.id) : [];
    const out: Record<string, Cout> = {};
    for (let i = 0; i < ids.length; i += 8) {
      await Promise.all(ids.slice(i, i + 8).map(async (id) => { const r = await supabase.rpc('cout_intervention', { p_intervention: id }); if (!r.error) out[id] = r.data as Cout; }));
    }
    return out;
  }, [gere, (l.data ?? []).map((x) => x.id).join(',')]);
  const noms = useNoms('profils');
  const h = useAsync(async () => (gere ? ok(await supabase.rpc('habilitations_a_renouveler', { p_jours: null })) as Habilitation[] : []), [gere]);
  const r = useAsync(async () => ok(await supabase.from('incidents_hse').select('*').order('survenu_le', { ascending: false }).limit(500)) as Incident[], []);
  const aRealiser = (l.data ?? []).filter((x) => ['planifiee', 'en_cours'].includes(x.statut)).length;
  const aFacturer = (l.data ?? []).filter((x) => x.statut === 'terminee').length;
  const majoration = Object.values(couts.data ?? {})[0]?.majoration ?? null;
  const items: { id: 'planning' | 'habilitations' | 'hse'; lib: string }[] = [{ id: 'planning', lib: t('interventions.planning') }, { id: 'hse', lib: t('interventions.registre_hse') }];
  if (gere) items.splice(1, 0, { id: 'habilitations', lib: t('interventions.habilitations') });
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.apres_vente')} · ${t('interventions.surtitre')} · INT`}
        titre={l.data ? t('interventions.titre_synthese', { p: aRealiser, f: aFacturer }) : t('interventions.titre')} />
      <Onglets items={items} actif={onglet} onChange={setOnglet} />
      <Bandeau type="err">{l.erreur ?? couts.erreur ?? h.erreur ?? r.erreur}</Bandeau>
      {onglet === 'planning' && (
        <div className="cadre">
          {(l.data ?? []).length === 0 ? <Vide>{t('interventions.aucune')}</Vide> : (
            <div style={{ overflowX: 'auto' }}><table className="t"><thead><tr><th>{t('interventions.interv')}</th><th>{t('interventions.client')}</th><th>{t('interventions.objet')}</th>
              <th>{t('champs.date')}</th><th>{t('interventions.techniciens')}</th><th className="num">{t('interventions.temps')}</th>
              {gere && <><th className="num">{t('interventions.cout_reel')}</th><th className="num">{t('interventions.a_facturer')}</th></>}<th>{t('champs.statut')}</th></tr></thead>
              <tbody>{(l.data ?? []).map((x) => {
                const heures = x.intervention_temps.reduce((n, y) => n + Number(y.heures), 0);
                const c = couts.data?.[x.id];
                return (
                  <tr key={x.id} className="cliquable" onClick={() => setFiche(x.id)}>
                    <td className="ref">{x.reference}</td>
                    <td>{x.dossiers?.clients?.raison_sociale ?? '—'}<div className="mute"><Link to={`/dossiers/${x.dossier_id}`} onClick={(e) => e.stopPropagation()}>{x.dossiers?.reference ?? dossiers[x.dossier_id] ?? '—'}</Link></div></td>
                    <td>{x.objet}<div className="mute">{t(`interventions.types.${x.type}`)} · {x.lieu}</div></td>
                    <td className="ref">{date(x.date_debut, langue)}{x.date_fin !== x.date_debut && <div className="mute">→ {date(x.date_fin, langue)}</div>}</td>
                    <td>{x.intervention_techniciens.map((y) => noms[y.technicien_id] ?? '…').join(', ') || <span className="mute">—</span>}</td>
                    <td className="num">{heures > 0 ? t('interventions.nb_heures', { n: heures }) : '—'}</td>
                    {gere && <><td className="num">{c ? montant(Number(c.cout_reel_xof), 'XOF', langue) : '—'}</td>
                      <td className="num">{c && ['terminee', 'facturee'].includes(x.statut) ? montant(Number(c.a_facturer_xof), 'XOF', langue) : '—'}</td></>}
                    <td><Statut statut={STATUT[x.statut]} libelle={t(`interventions.statuts.${x.statut}`)} /></td>
                  </tr>);
              })}</tbody></table></div>
          )}
          {gere && <p className="mute" style={{ marginTop: 12 }}>{t('interventions.aide_cout', { p: majoration === null ? '—' : `${Math.round(majoration * 100)} %` })}</p>}
        </div>
      )}
      {onglet === 'habilitations' && gere && <Habilitations alertes={h.data ?? []} onChange={() => void h.recharger()} />}
      {onglet === 'hse' && (
        <CadreTableau titre={t('interventions.registre_hse')}>
          {(r.data ?? []).length === 0 ? <Vide>{t('interventions.aucun_incident')}</Vide> : (
            <table className="t"><tbody>{(r.data ?? []).map((x) => (
              <tr key={x.id}><td className="ref">{x.reference}</td><td className="ref">{dateHeure(x.survenu_le, langue, profil?.fuseau ?? 'Africa/Abidjan')}</td>
                <td><Statut statut={x.nature === 'presque_accident' ? 'att' : 'err'} libelle={t(`interventions.natures.${x.nature}`)} /></td>
                <td>{x.description}<div className="mute">{t('interventions.mesures')} : {x.mesures}</div></td></tr>))}</tbody></table>
          )}
        </CadreTableau>
      )}
      {fiche && <FicheIntervention id={fiche} onClose={() => setFiche(null)} onChange={() => { void l.recharger(); void r.recharger(); }} />}
    </div>
  );
}

function Habilitations({ alertes, onChange }: { alertes: Habilitation[]; onChange: () => void }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const a = useAction();
  const techs = useAsync(async () => ok(await supabase.from('profils').select('id, nom').in('role', ['inspecteur', 'hub_afrique', 'achats_chine', 'admin']).eq('actif', true).order('nom')) as { id: string; nom: string }[], []);
  const [f, setF] = useState({ technicien_id: '', type: 'electrique', libelle: '', organisme: '', delivree_le: '', expire_le: '' });
  const enregistrer = async () => {
    const v = z.object({ technicien_id: z.string().uuid(), type: z.enum(HABILITATIONS), libelle: z.string().trim().min(2).max(200),
      organisme: z.string().trim().max(200).nullable(), delivree_le: DATE, expire_le: DATE }).strict()
      .refine((x) => x.expire_le > x.delivree_le && x.delivree_le <= aujourdhui())
      .safeParse({ ...f, organisme: f.organisme.trim() || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('habilitations').insert(v.data)))) { setF({ ...f, libelle: '', organisme: '', delivree_le: '', expire_le: '' }); onChange(); }
  };
  return (
    <CadreTableau titre={t('interventions.habilitations')}>
      {alertes.length === 0 ? <span className="mute">{t('interventions.aucune_habilitation_a_renouveler')}</span> : (
        <table className="t"><tbody>{alertes.map((x) => (
          <tr key={x.habilitation_id}><td>{x.technicien}</td><td>{t(`interventions.habilitations_types.${x.type}`)}<div className="mute">{x.libelle}</div></td>
            <td><Statut statut={x.expire_le < aujourdhui() ? 'err' : 'att'} libelle={t('interventions.expire_le', { date: date(x.expire_le, langue) })} /></td></tr>))}</tbody></table>
      )}
      <div className="section-titre">{t('interventions.nouvelle_habilitation')}</div>
      <div className="actions" style={{ flexWrap: 'wrap' }}>
        <select value={f.technicien_id} aria-label={t('interventions.technicien')} onChange={(e) => setF({ ...f, technicien_id: e.target.value })}>
          <option value="">{t('interventions.technicien')}</option>{(techs.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}</select>
        <select value={f.type} aria-label={t('interventions.type_habilitation')} onChange={(e) => setF({ ...f, type: e.target.value })}>
          {HABILITATIONS.map((x) => <option key={x} value={x}>{t(`interventions.habilitations_types.${x}`)}</option>)}</select>
        <input placeholder={t('interventions.libelle')} aria-label={t('interventions.libelle')} maxLength={200} value={f.libelle} onChange={(e) => setF({ ...f, libelle: e.target.value })} />
        <input placeholder={t('interventions.organisme')} aria-label={t('interventions.organisme')} maxLength={200} value={f.organisme} onChange={(e) => setF({ ...f, organisme: e.target.value })} />
        <input type="date" aria-label={t('interventions.delivree_le')} max={aujourdhui()} value={f.delivree_le} onChange={(e) => setF({ ...f, delivree_le: e.target.value })} />
        <input type="date" aria-label={t('interventions.expire')} value={f.expire_le} onChange={(e) => setF({ ...f, expire_le: e.target.value })} />
        <Bouton petit disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.ajouter')}</Bouton>
      </div>
      <Bandeau type="err">{techs.erreur ?? a.erreur}</Bandeau>
    </CadreTableau>
  );
}

/** Onglet « Interventions » de la fiche dossier. */
export function InterventionsDossier({ dossierId }: { dossierId: string }) {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const gere = ['admin', 'hub_afrique'].includes(profil?.role ?? '');
  const l = useAsync(async () => ok(await supabase.from('interventions').select('*').eq('dossier_id', dossierId).order('date_debut')) as Intervention[], [dossierId]);
  const [nouvelle, setNouvelle] = useState(false);
  const [fiche, setFiche] = useState<string | null>(null);
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="section-titre">{t('interventions.titre')}</span>
        {gere && <Bouton petit onClick={() => setNouvelle(true)}>{t('interventions.nouvelle')}</Bouton>}
      </div>
      <Bandeau type="err">{l.erreur}</Bandeau>
      {(l.data ?? []).length === 0 ? <span className="mute">{t('interventions.aucune')}</span> : (
        <table className="t"><tbody>{(l.data ?? []).map((x) => (
          <tr key={x.id} className="cliquable" onClick={() => setFiche(x.id)}><td className="ref">{x.reference}</td><td>{t(`interventions.types.${x.type}`)}</td>
            <td>{x.objet}</td><td className="ref">{date(x.date_debut, langue)}</td><td><Statut statut={STATUT[x.statut]} libelle={t(`interventions.statuts.${x.statut}`)} /></td></tr>))}</tbody></table>
      )}
      {nouvelle && <NouvelleIntervention dossierId={dossierId} onClose={() => setNouvelle(false)} onSaved={(id) => { setNouvelle(false); void l.recharger(); setFiche(id); }} />}
      {fiche && <FicheIntervention id={fiche} onClose={() => setFiche(null)} onChange={() => void l.recharger()} />}
    </section>
  );
}

function NouvelleIntervention({ dossierId, onClose, onSaved }: { dossierId: string; onClose: () => void; onSaved: (id: string) => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [f, setF] = useState({ type: 'installation', objet: '', lieu: '', date_debut: aujourdhui(), date_fin: aujourdhui(), epi: '', permis: '' });
  const [hab, setHab] = useState<string[]>([]);
  const [risques, setRisques] = useState([{ danger: '', mesure: '' }]);
  const enregistrer = async () => {
    const v = z.object({ dossier_id: z.string().uuid(), type: z.enum(['installation', 'mise_en_service', 'apres_vente']), objet: z.string().trim().min(3).max(300),
      lieu: z.string().trim().min(2).max(200), date_debut: DATE, date_fin: DATE, habilitations_requises: z.array(z.enum(HABILITATIONS)).max(10),
      permis_requis: z.array(z.string().regex(/^[a-z_]{2,40}$/)).max(10), epi: z.array(z.string().min(2).max(80)).max(20),
      analyse_risques: z.array(z.object({ danger: z.string().trim().min(3).max(300), mesure: z.string().trim().min(3).max(500) }).strict()).max(50) }).strict()
      .refine((x) => x.date_fin >= x.date_debut)
      .safeParse({ dossier_id: dossierId, type: f.type, objet: f.objet, lieu: f.lieu, date_debut: f.date_debut, date_fin: f.date_fin, habilitations_requises: hab,
        permis_requis: liste(f.permis).map((x) => x.toLowerCase().replace(/[^a-z_]/g, '_')), epi: liste(f.epi), analyse_risques: risques.filter((r) => r.danger.trim() || r.mesure.trim()) });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    let id = '';
    if (await a.executer(async () => { id = (ok(await supabase.from('interventions').insert(v.data).select('id').single()) as { id: string }).id; })) onSaved(id);
  };
  return (
    <Tiroir titre={t('interventions.nouvelle')} onClose={onClose}>
      <Champ label={t('interventions.type')}><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
        {['installation', 'mise_en_service', 'apres_vente'].map((x) => <option key={x} value={x}>{t(`interventions.types.${x}`)}</option>)}</select></Champ>
      <Champ label={t('interventions.objet')}><input value={f.objet} maxLength={300} onChange={(e) => setF({ ...f, objet: e.target.value })} /></Champ>
      <Champ label={t('interventions.lieu')}><input value={f.lieu} maxLength={200} onChange={(e) => setF({ ...f, lieu: e.target.value })} /></Champ>
      <div className="actions">
        <Champ label={t('interventions.debut')}><input type="date" value={f.date_debut} onChange={(e) => setF({ ...f, date_debut: e.target.value })} /></Champ>
        <Champ label={t('interventions.fin')}><input type="date" min={f.date_debut} value={f.date_fin} onChange={(e) => setF({ ...f, date_fin: e.target.value })} /></Champ>
      </div>
      <div className="section-titre">{t('interventions.habilitations_requises')}</div>
      <div className="actions" style={{ flexWrap: 'wrap' }}>{HABILITATIONS.map((x) => (
        <label key={x} style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={hab.includes(x)}
          onChange={(e) => setHab(e.target.checked ? [...hab, x] : hab.filter((y) => y !== x))} />{t(`interventions.habilitations_types.${x}`)}</label>))}</div>
      <Champ label={t('interventions.permis_requis')}><input value={f.permis} maxLength={400} placeholder="permis_feu, permis_electrique" onChange={(e) => setF({ ...f, permis: e.target.value })} /></Champ>
      <Champ label={t('interventions.epi')}><input value={f.epi} maxLength={800} placeholder={t('interventions.epi_exemple')} onChange={(e) => setF({ ...f, epi: e.target.value })} /></Champ>
      <div className="section-titre">{t('interventions.analyse_risques')}</div>
      {risques.map((r, i) => (
        <div key={i} className="actions" style={{ flexWrap: 'wrap' }}>
          <input placeholder={t('interventions.danger')} aria-label={t('interventions.danger')} maxLength={300} value={r.danger} onChange={(e) => setRisques(risques.map((x, j) => (j === i ? { ...x, danger: e.target.value } : x)))} />
          <input placeholder={t('interventions.mesure_prevention')} aria-label={t('interventions.mesure_prevention')} maxLength={500} value={r.mesure} onChange={(e) => setRisques(risques.map((x, j) => (j === i ? { ...x, mesure: e.target.value } : x)))} />
        </div>
      ))}
      {risques.length < 50 && <Bouton petit onClick={() => setRisques([...risques, { danger: '', mesure: '' }])}>{t('interventions.ajouter_risque')}</Bouton>}
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

function FicheIntervention({ id, onClose, onChange }: { id: string; onClose: () => void; onChange: () => void }) {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const gere = ['admin', 'hub_afrique'].includes(profil?.role ?? '');
  const profils = useNoms('profils');
  const i = useAsync(async () => ok(await supabase.from('interventions').select('*').eq('id', id).maybeSingle()) as Intervention | null, [id]);
  const tech = useAsync(async () => ok(await supabase.from('intervention_techniciens').select('technicien_id').eq('intervention_id', id)) as { technicien_id: string }[], [id]);
  const tps = useAsync(async () => ok(await supabase.from('intervention_temps').select('*').eq('intervention_id', id).order('date_travail')) as Temps[], [id]);
  const pm = useAsync(async () => ok(await supabase.from('permis_travail').select('*').eq('intervention_id', id)) as Permis[], [id]);
  const ctl = useAsync(async () => ok(await supabase.rpc('controles_hse', { p_intervention: id })) as { controle: string; technicien?: string; type?: string }[], [id]);
  const cout = useAsync(async () => (gere ? ok(await supabase.rpc('cout_intervention', { p_intervention: id })) as { heures: number; cout_reel_xof: number; a_facturer_xof: number; majoration: number } : null), [id, gere]);
  const candidats = useAsync(async () => (gere ? ok(await supabase.from('profils').select('id, nom').in('role', ['inspecteur', 'hub_afrique', 'achats_chine', 'admin']).eq('actif', true).order('nom')) as { id: string; nom: string }[] : []), [gere]);
  const a = useAction();
  const [ajout, setAjout] = useState('');
  const [p, setP] = useState({ type: '', numero: '', delivre_par: '', valide_du: aujourdhui(), valide_au: aujourdhui(), document: '' });
  const admin = profil?.role === 'admin';
  const [tm, setTm] = useState({ technicien_id: profil?.id ?? '', date_travail: aujourdhui(), heures: '', taux: '', travaux: '' });
  const [inc, setInc] = useState({ nature: 'presque_accident', description: '', mesures: '' });
  const [fin, setFin] = useState({ compte_rendu: '', pv: '' });
  const x = i.data;
  const recharger = () => { void i.recharger(); void tech.recharger(); void tps.recharger(); void pm.recharger(); void ctl.recharger(); void cout.recharger(); onChange(); };
  const rpc = async (fn: string, args: Record<string, unknown>) => { if (await a.executer(async () => ok(await supabase.rpc(fn, args)))) recharger(); };
  const inserer = async (table: string, corps: Record<string, unknown>, apres?: () => void) => {
    if (await a.executer(async () => ok(await supabase.from(table).insert(corps)))) { apres?.(); recharger(); }
  };
  const ajouterPermis = async () => {
    const v = z.object({ intervention_id: z.string().uuid(), type: z.string().regex(/^[a-z_]{2,40}$/), numero: z.string().trim().min(1).max(80), delivre_par: z.string().trim().min(2).max(200),
      valide_du: DATE, valide_au: DATE, document: z.string().max(400).nullable() }).strict().refine((y) => y.valide_au >= y.valide_du)
      .safeParse({ ...p, intervention_id: id, document: p.document || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    await inserer('permis_travail', v.data, () => setP({ type: '', numero: '', delivre_par: '', valide_du: aujourdhui(), valide_au: aujourdhui(), document: '' }));
  };
  const ajouterTemps = async () => {
    const v = z.object({ intervention_id: z.string().uuid(), technicien_id: z.string().uuid(), date_travail: DATE, heures: z.number().positive().max(16),
      taux_horaire_xof: z.number().int().positive().max(1_000_000).nullable(), travaux: z.string().trim().min(3).max(1000) }).strict()
      // Taux horaire : celui du paramètre, sauf correction de l'administratrice (la base l'impose).
      .safeParse({ intervention_id: id, technicien_id: tm.technicien_id, date_travail: tm.date_travail, heures: Number(tm.heures.replace(',', '.')),
        taux_horaire_xof: admin && tm.taux ? Number(tm.taux) : null, travaux: tm.travaux });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    await inserer('intervention_temps', v.data, () => setTm({ ...tm, heures: '', travaux: '' }));
  };
  const declarer = async () => {
    const v = z.object({ intervention_id: z.string().uuid(), survenu_le: z.string(), nature: z.enum(NATURES), description: z.string().trim().min(10).max(4000),
      mesures: z.string().trim().min(5).max(4000) }).strict()
      .safeParse({ intervention_id: id, survenu_le: new Date().toISOString(), nature: inc.nature, description: inc.description, mesures: inc.mesures });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    await inserer('incidents_hse', v.data, () => setInc({ nature: 'presque_accident', description: '', mesures: '' }));
  };
  const techniciens = (tech.data ?? []).map((y) => y.technicien_id);
  return (
    <Tiroir titre={x ? `${x.reference} — ${x.objet}` : t('interventions.titre')} onClose={onClose}>
      <Bandeau type="err">{i.erreur ?? a.erreur}</Bandeau>
      {x && <>
        <div><Statut statut={STATUT[x.statut]} libelle={t(`interventions.statuts.${x.statut}`)} /> · {t(`interventions.types.${x.type}`)} · {x.lieu}
          · {date(x.date_debut, langue)} → {date(x.date_fin, langue)}</div>
        <div className="section-titre">{t('interventions.hse')}</div>
        <div className="mute">{t('interventions.habilitations_requises')} : {x.habilitations_requises.map((h) => t(`interventions.habilitations_types.${h}`)).join(', ') || '—'}</div>
        <div className="mute">{t('interventions.permis_requis')} : {x.permis_requis.join(', ') || '—'} · {t('interventions.epi')} : {x.epi.join(', ') || '—'}</div>
        {x.analyse_risques.map((r, k) => <div key={k} className="mute">⚠ {r.danger} — {r.mesure}</div>)}
        {x.statut === 'planifiee' && (ctl.data ?? []).length > 0 && <Bandeau type="err">{t('interventions.hse_incomplet')} : {(ctl.data ?? []).map((c) =>
          `${t(`interventions.controles.${c.controle}`)}${c.type ? ` (${c.type}${c.technicien ? `, ${c.technicien}` : ''})` : ''}`).join(' ; ')}</Bandeau>}

        <div className="section-titre">{t('interventions.techniciens')}</div>
        <div>{techniciens.map((y) => profils[y] ?? '—').join(', ') || <span className="mute">—</span>}</div>
        {gere && ['planifiee', 'en_cours'].includes(x.statut) && <div className="actions">
          <select value={ajout} aria-label={t('interventions.technicien')} onChange={(e) => setAjout(e.target.value)}>
            <option value="">{t('interventions.technicien')}</option>{(candidats.data ?? []).filter((c) => !techniciens.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}</select>
          <Bouton petit disabled={!ajout || a.enCours} onClick={() => void inserer('intervention_techniciens', { intervention_id: id, technicien_id: ajout }, () => setAjout(''))}>{t('commun.ajouter')}</Bouton>
        </div>}

        <div className="section-titre">{t('interventions.permis')}</div>
        {(pm.data ?? []).map((y) => <div key={y.id} className="mute">{y.type} · {y.numero} · {y.delivre_par} · {date(y.valide_du, langue)} → {date(y.valide_au, langue)}</div>)}
        {gere && x.statut === 'planifiee' && <div className="actions" style={{ flexWrap: 'wrap' }}>
          <input placeholder="permis_feu" aria-label={t('interventions.type')} maxLength={40} value={p.type} onChange={(e) => setP({ ...p, type: e.target.value.toLowerCase() })} />
          <input placeholder={t('interventions.numero')} aria-label={t('interventions.numero')} maxLength={80} value={p.numero} onChange={(e) => setP({ ...p, numero: e.target.value })} />
          <input placeholder={t('interventions.delivre_par')} aria-label={t('interventions.delivre_par')} maxLength={200} value={p.delivre_par} onChange={(e) => setP({ ...p, delivre_par: e.target.value })} />
          <input type="date" aria-label={t('interventions.debut')} value={p.valide_du} onChange={(e) => setP({ ...p, valide_du: e.target.value })} />
          <input type="date" aria-label={t('interventions.fin')} value={p.valide_au} onChange={(e) => setP({ ...p, valide_au: e.target.value })} />
          <Depot dossierId={x.dossier_id} valeur={p.document || null} onChange={(c) => setP({ ...p, document: c })} />
          <Bouton petit disabled={a.enCours} onClick={() => void ajouterPermis()}>{t('commun.ajouter')}</Bouton>
        </div>}
        {gere && x.statut === 'planifiee' && <span className="actions">
          <Bouton variante="primaire" disabled={a.enCours} onClick={() => void rpc('demarrer_intervention', { p_intervention: id })}>{t('interventions.demarrer')}</Bouton>
        </span>}

        <div className="section-titre">{t('interventions.temps')}</div>
        {(tps.data ?? []).length === 0 ? <span className="mute">—</span> : (
          <table className="t"><tbody>{(tps.data ?? []).map((y) => (
            <tr key={y.id}><td className="ref">{date(y.date_travail, langue)}</td><td>{profils[y.technicien_id] ?? '—'}</td><td>{y.travaux}</td>
              <td className="num">{y.heures} h</td>{gere && <td className="num">{montant(y.cout_xof, 'XOF', langue)}</td>}</tr>))}</tbody></table>
        )}
        {x.statut === 'en_cours' && (gere || techniciens.includes(profil?.id ?? '')) && <div className="actions" style={{ flexWrap: 'wrap' }}>
          {gere && <select value={tm.technicien_id} aria-label={t('interventions.technicien')} onChange={(e) => setTm({ ...tm, technicien_id: e.target.value })}>
            {techniciens.map((y) => <option key={y} value={y}>{profils[y] ?? y}</option>)}</select>}
          <input type="date" aria-label={t('reception.date')} min={x.date_debut} max={aujourdhui()} value={tm.date_travail} onChange={(e) => setTm({ ...tm, date_travail: e.target.value })} />
          <input inputMode="decimal" placeholder={t('interventions.heures')} aria-label={t('interventions.heures')} value={tm.heures} onChange={(e) => setTm({ ...tm, heures: e.target.value })} />
          {admin && <input inputMode="numeric" placeholder={t('interventions.taux_correction')} aria-label={t('interventions.taux_correction')} value={tm.taux} onChange={(e) => setTm({ ...tm, taux: e.target.value.replace(/\D/g, '') })} />}
          <input placeholder={t('interventions.travaux')} aria-label={t('interventions.travaux')} maxLength={1000} value={tm.travaux} onChange={(e) => setTm({ ...tm, travaux: e.target.value })} />
          <Bouton petit disabled={a.enCours} onClick={() => void ajouterTemps()}>{t('commun.ajouter')}</Bouton>
        </div>}

        {['en_cours', 'terminee', 'facturee'].includes(x.statut) && <>
          <div className="section-titre">{t('interventions.declarer_incident')}</div>
          <div className="actions" style={{ flexWrap: 'wrap' }}>
            <select value={inc.nature} aria-label={t('interventions.nature')} onChange={(e) => setInc({ ...inc, nature: e.target.value })}>
              {NATURES.map((n) => <option key={n} value={n}>{t(`interventions.natures.${n}`)}</option>)}</select>
            <input placeholder={t('champs.description')} aria-label={t('champs.description')} maxLength={4000} value={inc.description} onChange={(e) => setInc({ ...inc, description: e.target.value })} />
            <input placeholder={t('interventions.mesures')} aria-label={t('interventions.mesures')} maxLength={4000} value={inc.mesures} onChange={(e) => setInc({ ...inc, mesures: e.target.value })} />
            <Bouton petit disabled={a.enCours} onClick={() => void declarer()}>{t('interventions.declarer')}</Bouton>
          </div>
        </>}

        {gere && x.statut === 'en_cours' && <>
          <div className="section-titre">{t('interventions.terminer')}</div>
          <Champ label={t('interventions.compte_rendu')}><textarea rows={3} maxLength={4000} value={fin.compte_rendu} onChange={(e) => setFin({ ...fin, compte_rendu: e.target.value })} /></Champ>
          <Champ label={t('interventions.pv_mise_en_service')}><Depot dossierId={x.dossier_id} valeur={fin.pv || null} onChange={(c) => setFin({ ...fin, pv: c })} /></Champ>
          <Bouton variante="primaire" disabled={a.enCours || fin.compte_rendu.trim().length < 10} onClick={() => void rpc('terminer_intervention', { p_intervention: id, p_compte_rendu: fin.compte_rendu.trim(), p_pv: fin.pv || null })}>{t('interventions.terminer')}</Bouton>
        </>}
        {x.compte_rendu && <p className="mute">{x.compte_rendu}</p>}
        {x.pv_document && <Bouton petit onClick={() => void ouvrir(x.pv_document!)}>{t('interventions.pv_mise_en_service')}</Bouton>}

        {gere && cout.data && <>
          <div className="section-titre">{t('interventions.cout')}</div>
          <div>{t('interventions.cout_detail', { h: cout.data.heures, reel: montant(cout.data.cout_reel_xof, 'XOF', langue), facture: montant(cout.data.a_facturer_xof, 'XOF', langue) })}</div>
          {x.statut === 'terminee' && <Bouton variante="primaire" disabled={a.enCours} onClick={() => void rpc('facturer_intervention', { p_intervention: id })}>{t('interventions.facturer')}</Bouton>}
          {x.facture_id && <Link to={`/factures/${x.facture_id}`}>{t('interventions.voir_facture')}</Link>}
        </>}
      </>}
    </Tiroir>
  );
}
