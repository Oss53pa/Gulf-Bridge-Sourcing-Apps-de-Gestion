// Lot 1, M23 : délais en jours ouvrés, attente d'un tiers, tâches et « mes tâches ».
// Toutes les règles (droits, calendrier, voyants) sont appliquées en base ; l'écran
// ne fait que valider la saisie avant envoi.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, dateHeure } from '../lib/format';
import { useNoms } from '../lib/referentiels';
import type { Dossier, Phase } from '../lib/types';
import { Bandeau, Bouton, Champ, Chargement, Entete, Kpis, Onglets, Statut, Tiroir, Vide } from '../components/ui';

const PHASES = ['consultation', 'verification', 'mise_en_concurrence', 'devis_mandat', 'contrat', 'approbation_technique',
  'production', 'inspection', 'expedition', 'livraison', 'cloture'] as const;
const TIERS = ['client', 'fournisseur', 'transporteur', 'autre'] as const;
const PAYS = ['CN', 'CI', 'GA', 'CM'] as const;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const UUID = z.string().uuid();

interface EtatDelai {
  phase: string; ordre: number; statut: string; responsable_id: string | null; pays_calendrier: string | null;
  debut: string | null; fin: string | null; cible: number | null; jours_internes: number | null; jours_externes: number | null;
  echeance: string | null; voyant: 'vert' | 'orange' | 'rouge' | null;
}
interface Tache {
  id: string; dossier_id: string | null; phase: string | null; libelle: string; details: string | null; assigne_a: string;
  echeance: string | null; statut: string; cree_par: string | null;
}
interface PlanningOuverture {
  date_ouverture: string | null; cibles_manquantes?: string[]; debut_au_plus_tard?: string | null; fin_projetee?: string | null;
  marge_jours_ouvres?: number | null; intenable?: boolean;
  phases?: { phase: string; ordre: number; statut: string; cible: number | null; debut_au_plus_tard: string | null;
    fin_au_plus_tard: string | null; fin_projetee: string | null; en_retard: boolean }[];
}
interface ElementMesTaches {
  nature: 'tache' | 'point_bloquant' | 'piece' | 'delai' | 'ouverture'; objet_id: string; dossier_id: string | null;
  dossier_reference: string | null; libelle: string; echeance: string | null; urgence: number;
}

export function Voyant({ v }: { v: EtatDelai['voyant'] }) {
  const { t } = useTranslation();
  if (!v) return <span className="mute">{t('delais.sans_cible')}</span>;
  const s = v === 'vert' ? 'ok' : v === 'orange' ? 'att' : 'err';
  return <Statut statut={s} libelle={t(`delais.voyant_${v}`)} />;
}

/** Équipe interne active, pour confier une tâche ou une phase. */
function useEquipe() {
  return useAsync(async () => ok(await supabase.from('profils').select('id, nom, role')
    .in('role', ['admin', 'achats_chine', 'hub_afrique', 'agent_pays', 'inspecteur', 'comptable']).eq('actif', true).order('nom')) as
    { id: string; nom: string; role: string }[], []);
}

// ----------------------------------------------------------------------------- fiche dossier
export function DelaisDossier({ dossier, phases, onChange }: { dossier: Dossier; phases: Phase[]; onChange: () => void }) {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const role = profil?.role ?? '';
  const noms = useNoms('profils');
  const equipe = useEquipe();
  const etat = useAsync(async () => ok(await supabase.rpc('etat_delais', { p_dossier: dossier.id })) as EtatDelai[], [dossier.id, phases]);
  const taches = useAsync(async () => ok(await supabase.from('taches').select('*').eq('dossier_id', dossier.id)
    .order('statut').order('echeance', { nullsFirst: false })) as Tache[], [dossier.id]);
  const a = useAction();
  const [tiers, setTiers] = useState<string>('client');
  const [nouvelle, setNouvelle] = useState(false);
  const peutPiloter = ['admin', 'achats_chine', 'hub_afrique'].includes(role) && dossier.statut === 'ouvert';
  const courante = phases.find((p) => p.phase === dossier.phase_courante);

  const majPhase = async (champs: Record<string, unknown>) => {
    if (!courante) return;
    if (await a.executer(async () => ok(await supabase.from('dossier_phases').update(champs).eq('id', courante.id)))) onChange();
  };
  const terminer = async (x: Tache) => {
    if (await a.executer(async () => ok(await supabase.from('taches').update({ statut: 'faite' }).eq('id', x.id)))) void taches.recharger();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Bandeau type="err">{etat.erreur ?? a.erreur}</Bandeau>
      {etat.chargement && !etat.data ? <Chargement /> : (
        <table className="t">
          <thead><tr><th>{t('champs.phase')}</th><th>{t('champs.statut')}</th><th>{t('delais.responsable')}</th><th>{t('delais.calendrier')}</th>
            <th className="num">{t('delais.internes')}</th><th className="num">{t('delais.externes')}</th><th>{t('delais.echeance')}</th><th>{t('delais.voyant')}</th></tr></thead>
          <tbody>{(etat.data ?? []).map((e) => (
            <tr key={e.phase}>
              <td>{e.ordre}. {t(`phases.${e.phase}`)}</td>
              <td><Statut statut={e.statut} libelle={t(`statuts_phase.${e.statut}`)} /></td>
              <td>{e.responsable_id ? noms[e.responsable_id] ?? '' : <span className="mute">{t('delais.chef_dossier')}</span>}</td>
              <td className="ref">{e.pays_calendrier ?? '—'}</td>
              <td className="num">{e.jours_internes ?? '—'}{e.cible ? ` / ${e.cible}` : ''}</td>
              <td className="num">{e.jours_externes ?? '—'}</td>
              <td className="ref">{e.echeance ? date(e.echeance, langue) : '—'}</td>
              <td><Voyant v={e.voyant} /></td>
            </tr>))}</tbody>
        </table>
      )}
      <p className="mute">{t('delais.aide_horloge')}</p>
      {dossier.date_ouverture_site && <PlanningOuvertureDossier dossier={dossier} peutAppliquer={peutPiloter} onChange={onChange} />}
      {peutPiloter && courante && (
        <div className="actions" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Champ label={t('delais.responsable_phase')}>
            <select value={courante.responsable_id ?? ''} disabled={a.enCours}
              onChange={(ev) => void majPhase({ responsable_id: ev.target.value ? UUID.parse(ev.target.value) : null })}>
              <option value="">{t('delais.chef_dossier')}</option>
              {(equipe.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
            </select>
          </Champ>
          {courante.statut === 'attente_tiers' ? (
            <Bouton disabled={a.enCours} onClick={() => void majPhase({ statut: 'en_cours' })}>{t('delais.reprendre')}</Bouton>
          ) : (<>
            <Champ label={t('delais.tiers_attendu')}>
              <select value={tiers} onChange={(ev) => setTiers(ev.target.value)}>
                {TIERS.map((x) => <option key={x} value={x}>{t(`delais.tiers.${x}`)}</option>)}
              </select>
            </Champ>
            <Bouton disabled={a.enCours} onClick={() => void majPhase({ statut: 'attente_tiers', attente_tiers: z.enum(TIERS).parse(tiers) })}>
              {t('delais.mettre_en_attente')}</Bouton>
          </>)}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="section-titre">{t('delais.taches_dossier')}</div>
        {dossier.statut === 'ouvert' && <Bouton petit onClick={() => setNouvelle(true)}>{t('delais.nouvelle_tache')}</Bouton>}
      </div>
      {(taches.data ?? []).length === 0 ? <Vide>{t('delais.aucune_tache')}</Vide> : (
        <table className="t"><thead><tr><th>{t('delais.tache')}</th><th>{t('champs.phase')}</th><th>{t('delais.assigne_a')}</th><th>{t('delais.echeance')}</th><th>{t('champs.statut')}</th><th /></tr></thead>
          <tbody>{(taches.data ?? []).map((x) => (
            <tr key={x.id}><td>{x.libelle}</td><td>{x.phase ? t(`phases.${x.phase}`) : '—'}</td><td>{noms[x.assigne_a] ?? ''}</td>
              <td className="ref">{x.echeance ? date(x.echeance, langue) : '—'}</td>
              <td><Statut statut={x.statut === 'faite' ? 'ok' : x.statut === 'annulee' ? 'annulee' : 'en_cours'} libelle={t(`delais.statut_tache.${x.statut}`)} /></td>
              <td className="num">{x.assigne_a === profil?.id && ['a_faire', 'en_cours'].includes(x.statut) &&
                <Bouton petit disabled={a.enCours} onClick={() => void terminer(x)}>{t('delais.marquer_faite')}</Bouton>}</td></tr>))}</tbody></table>
      )}
      {nouvelle && <NouvelleTache dossierId={dossier.id} phase={dossier.phase_courante} equipe={equipe.data ?? []}
        onClose={() => setNouvelle(false)} onSaved={() => { setNouvelle(false); void taches.recharger(); }} />}
    </div>
  );
}

function NouvelleTache({ dossierId, phase, equipe, onClose, onSaved }: {
  dossierId: string | null; phase: string | null; equipe: { id: string; nom: string }[]; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { profil } = useAuth();
  const a = useAction();
  const [f, setF] = useState({ libelle: '', details: '', assigne_a: profil?.id ?? '', echeance: '' });
  const schema = z.object({
    dossier_id: UUID.nullable(), phase: z.enum(PHASES).nullable(), libelle: z.string().trim().min(3).max(300),
    details: z.string().max(2000).nullable(), assigne_a: UUID, echeance: DATE.nullable(),
  }).strict();
  const enregistrer = async () => {
    const v = schema.safeParse({ dossier_id: dossierId, phase: dossierId ? phase : null, libelle: f.libelle,
      details: f.details.trim() || null, assigne_a: f.assigne_a, echeance: f.echeance || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('taches').insert(v.data)))) onSaved();
  };
  return (
    <Tiroir titre={t('delais.nouvelle_tache')} onClose={onClose}>
      <Champ label={t('delais.tache')}><input value={f.libelle} maxLength={300} onChange={(e) => setF({ ...f, libelle: e.target.value })} /></Champ>
      <Champ label={t('delais.details')}><textarea value={f.details} maxLength={2000} onChange={(e) => setF({ ...f, details: e.target.value })} /></Champ>
      <Champ label={t('delais.assigne_a')}>
        <select value={f.assigne_a} onChange={(e) => setF({ ...f, assigne_a: e.target.value })}>
          {equipe.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
        </select>
      </Champ>
      <Champ label={t('delais.echeance')}><input type="date" value={f.echeance} onChange={(e) => setF({ ...f, echeance: e.target.value })} /></Champ>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

function PlanningOuvertureDossier({ dossier, peutAppliquer, onChange }: { dossier: Dossier; peutAppliquer: boolean; onChange: () => void }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const p = useAsync(async () => ok(await supabase.rpc('planning_ouverture', { p_dossier: dossier.id })) as PlanningOuverture, [dossier.id]);
  const a = useAction();
  const d = p.data;
  if (!d || !d.date_ouverture) return p.erreur ? <Bandeau type="err">{p.erreur}</Bandeau> : null;
  const manquantes = d.cibles_manquantes ?? [];
  const appliquer = async () => {
    if (await a.executer(async () => ok(await supabase.rpc('appliquer_planning_ouverture', { p_dossier: dossier.id })))) { void p.recharger(); onChange(); }
  };
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div className="section-titre">{t('ouverture.titre', { date: date(d.date_ouverture, langue) })}</div>
        {peutAppliquer && manquantes.length === 0 &&
          <Bouton petit disabled={a.enCours} onClick={() => void appliquer()}>{t('ouverture.appliquer')}</Bouton>}
      </div>
      <Bandeau type="err">{a.erreur}</Bandeau>
      {manquantes.length > 0 ? (
        <Bandeau>{t('ouverture.cibles_manquantes', { liste: manquantes.map((x) => t(`phases.${x}`)).join(', ') })}</Bandeau>
      ) : d.marge_jours_ouvres == null ? null : d.intenable ? (
        <Bandeau type="err">{t('ouverture.intenable', { n: Math.abs(d.marge_jours_ouvres), date: d.fin_projetee ? date(d.fin_projetee, langue) : '—' })}</Bandeau>
      ) : (
        <Bandeau type="ok">{t('ouverture.avance', { n: d.marge_jours_ouvres })}</Bandeau>
      )}
      <table className="t"><thead><tr><th>{t('champs.phase')}</th><th>{t('ouverture.debut_au_plus_tard')}</th><th>{t('ouverture.fin_au_plus_tard')}</th>
        <th>{t('ouverture.fin_projetee')}</th><th /></tr></thead>
        <tbody>{(d.phases ?? []).map((x) => (
          <tr key={x.phase}><td>{x.ordre}. {t(`phases.${x.phase}`)}</td>
            <td className="ref">{x.debut_au_plus_tard ? date(x.debut_au_plus_tard, langue) : '—'}</td>
            <td className="ref">{x.fin_au_plus_tard ? date(x.fin_au_plus_tard, langue) : '—'}</td>
            <td className="ref">{x.fin_projetee ? date(x.fin_projetee, langue) : '—'}</td>
            <td>{x.en_retard && <Statut statut="err" libelle={t('ouverture.en_retard')} />}</td></tr>))}</tbody></table>
      <p className="mute">{t('ouverture.aide')}</p>
    </section>
  );
}

// ----------------------------------------------------------------------------- mes tâches
type FiltreTaches = 'toutes' | 'retard' | 'aujourdhui' | 'semaine' | 'terminees';

export function MesTaches() {
  const { t } = useTranslation();
  const { profil, langue, fuseau } = useAuth();
  const equipe = useEquipe();
  const nav = useNavigate();
  const l = useAsync(async () => ok(await supabase.rpc('mes_taches')) as ElementMesTaches[], []);
  // Lundi de la semaine en cours, dans le fuseau de l'utilisateur.
  const aujourdhui = new Intl.DateTimeFormat('en-CA', { timeZone: fuseau }).format(new Date());
  const j = new Date(`${aujourdhui}T12:00:00Z`);
  const lundi = new Date(j); lundi.setUTCDate(j.getUTCDate() - ((j.getUTCDay() + 6) % 7));
  const dimanche = new Date(lundi); dimanche.setUTCDate(lundi.getUTCDate() + 6);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const faites = useAsync(async () => (profil
    ? ok(await supabase.from('taches').select('id, libelle, dossier_id, echeance, faite_le').eq('assigne_a', profil.id).eq('statut', 'faite')
      .gte('faite_le', `${iso(lundi)}T00:00:00Z`).order('faite_le', { ascending: false }).limit(200)) as { id: string; libelle: string; dossier_id: string | null; echeance: string | null; faite_le: string }[]
    : []), [profil?.id, iso(lundi)]);
  const ids = [...new Set([...(l.data ?? []).map((x) => x.dossier_id), ...(faites.data ?? []).map((x) => x.dossier_id)].filter((x): x is string => Boolean(x)))];
  const dossiers = useAsync(async () => (ids.length
    ? ok(await supabase.from('dossiers').select('id, reference, client_id').in('id', ids)) as { id: string; reference: string; client_id: string }[]
    : []), [ids.join(',')]);
  const clients = useNoms('clients');
  const a = useAction();
  const [nouvelle, setNouvelle] = useState(false);
  const [absence, setAbsence] = useState(false);
  const [filtre, setFiltre] = useState<FiltreTaches>('toutes');
  const items = [...(l.data ?? [])].sort((x, y) => x.urgence - y.urgence || (x.echeance ?? '9999').localeCompare(y.echeance ?? '9999'));
  const enRetard = items.filter((x) => x.echeance && x.echeance < aujourdhui);
  const duJour = items.filter((x) => x.echeance === aujourdhui || (x.urgence === 1 && !(x.echeance && x.echeance < aujourdhui)));
  const semaine = items.filter((x) => x.echeance && x.echeance > aujourdhui && x.echeance <= iso(dimanche) && !duJour.includes(x));
  const plusTard = items.filter((x) => !enRetard.includes(x) && !duJour.includes(x) && !semaine.includes(x));
  const terminer = async (id: string) => {
    if (await a.executer(async () => ok(await supabase.from('taches').update({ statut: 'faite' }).eq('id', UUID.parse(id))))) { void l.recharger(); void faites.recharger(); }
  };
  const ddmm = (d: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '—');
  const dossier = (id: string | null) => dossiers.data?.find((x) => x.id === id);
  const sousTitre = (id: string | null, ref: string | null) => {
    const d = dossier(id);
    return [d?.reference ?? ref, d ? clients[d.client_id] : null].filter(Boolean).join(' · ');
  };
  const libelle = (x: ElementMesTaches) => (x.nature === 'delai' ? t('delais.phase_en_retard', { phase: t(`phases.${x.libelle}`) })
    : x.nature === 'ouverture' ? t('ouverture.intenable_tache', { n: Math.abs(Number(x.libelle)) }) : x.libelle);
  const initiales = (profil?.nom ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((m) => m[0]?.toUpperCase()).join('');
  const ligne = (x: ElementMesTaches) => (
    <div key={x.nature + x.objet_id} className="tache">
      {x.nature === 'tache'
        ? <button className="tache-case" aria-label={t('delais.marquer_faite')} title={t('delais.marquer_faite')} disabled={a.enCours} onClick={() => void terminer(x.objet_id)} />
        : <span className="tache-case vide" aria-hidden="true" />}
      <div className="tache-txt">
        <div className="tache-lib">{x.urgence === 1 && <span className="tache-urgent" aria-label={t('delais.urgence_1')} />}{libelle(x)}</div>
        <div className="sec">{sousTitre(x.dossier_id, x.dossier_reference) || '—'}</div>
      </div>
      <span className="tache-nat sec">{t(`delais.nature.${x.nature}`)}</span>
      <span className={'tache-date' + (x.echeance && x.echeance < aujourdhui ? ' retard' : '')}>{ddmm(x.echeance)}</span>
      <span className="tache-qui sec">{initiales}</span>
      <span className="tache-act">{x.dossier_id && <Bouton petit onClick={() => nav(`/dossiers/${x.dossier_id}`)}>{t('delais.ouvrir')}</Bouton>}</span>
    </div>
  );
  const groupe = (titre: string, lst: ElementMesTaches[]) => (lst.length === 0 ? null : (
    <section key={titre} className="taches-groupe"><div className="surtitre">{titre}</div>{lst.map(ligne)}</section>));
  const titre = t('delais.titre_taches', { n: items.length }) + (duJour.length ? ` ; ${t('delais.titre_aujourdhui', { n: duJour.length })}` : '')
    + (enRetard.length ? ` ; ${t('delais.titre_retard', { n: enRetard.length })}` : '');

  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.dossiers')} · ${t('ecrans.mes_taches')} · TAC`} titre={l.data ? titre : t('ecrans.mes_taches')}
        actions={<>
          <Bouton onClick={() => setAbsence(true)}>{t('delais.deleguer')}</Bouton>
          <Bouton variante="primaire" onClick={() => setNouvelle(true)}>{t('delais.nouvelle_tache')}</Bouton>
        </>} />
      <Kpis items={[
        { lib: t('delais.k_ouvertes'), val: items.length, sous: profil?.nom ?? '' },
        { lib: t('delais.k_retard'), val: enRetard.length, sous: t('delais.k_retard_sous') },
        { lib: t('delais.k_aujourdhui'), val: duJour.length, sous: date(aujourdhui, langue) },
        { lib: t('delais.k_terminees'), val: (faites.data ?? []).length, sous: t('delais.k_terminees_sous') },
      ]} />
      <Onglets actif={filtre} onChange={setFiltre} items={[
        { id: 'toutes', lib: t('delais.f_toutes') }, { id: 'retard', lib: t('delais.f_retard') }, { id: 'aujourdhui', lib: t('delais.f_aujourdhui') },
        { id: 'semaine', lib: t('delais.f_semaine') }, { id: 'terminees', lib: t('delais.f_terminees') }]} />
      <div className="cadre">
        <Bandeau type="err">{l.erreur ?? a.erreur}</Bandeau>
        {l.chargement && !l.data ? <Chargement /> : filtre === 'terminees' ? (
          (faites.data ?? []).length === 0 ? <Vide>{t('delais.aucune_terminee')}</Vide> : (
            <section className="taches-groupe">
              {(faites.data ?? []).map((x) => (
                <div key={x.id} className="tache faite">
                  <span className="tache-case coche" aria-hidden="true">✓</span>
                  <div className="tache-txt"><div className="tache-lib">{x.libelle}</div><div className="sec">{sousTitre(x.dossier_id, null) || '—'}</div></div>
                  <span className="tache-nat sec">{t('delais.nature.tache')}</span>
                  <span className="tache-date">{dateHeure(x.faite_le, langue, fuseau).slice(0, 5)}</span>
                  <span className="tache-qui sec">{initiales}</span>
                  <span className="tache-act" />
                </div>))}
            </section>)
        ) : items.length === 0 ? <Vide>{t('delais.rien_a_faire')}</Vide> : (
          <>
            {(filtre === 'toutes' || filtre === 'retard') && groupe(t('delais.g_retard'), enRetard)}
            {(filtre === 'toutes' || filtre === 'aujourdhui') && groupe(t('delais.g_aujourdhui'), duJour)}
            {(filtre === 'toutes' || filtre === 'semaine') && groupe(t('delais.g_semaine'), semaine)}
            {filtre === 'toutes' && groupe(t('delais.g_plus_tard'), plusTard)}
          </>
        )}
      </div>
      {nouvelle && <NouvelleTache dossierId={null} phase={null} equipe={equipe.data ?? []}
        onClose={() => setNouvelle(false)} onSaved={() => { setNouvelle(false); void l.recharger(); }} />}
      {absence && <Delegation de={profil?.id ?? ''} equipe={(equipe.data ?? []).filter((p) => p.id !== profil?.id)}
        onClose={() => setAbsence(false)} onDone={() => { setAbsence(false); void l.recharger(); }} />}
    </div>
  );
}

function Delegation({ de, equipe, onClose, onDone }: { de: string; equipe: { id: string; nom: string }[]; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [vers, setVers] = useState(equipe[0]?.id ?? '');
  const [motif, setMotif] = useState('');
  const [bilan, setBilan] = useState<{ taches: number; phases: number; points_bloquants: number } | null>(null);
  const valider = async () => {
    const v = z.object({ p_de: UUID, p_a: UUID, p_motif: z.string().trim().min(5).max(1000) }).strict()
      .safeParse({ p_de: de, p_a: vers, p_motif: motif });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    await a.executer(async () => setBilan(ok(await supabase.rpc('deleguer', v.data)) as typeof bilan));
  };
  return (
    <Tiroir titre={t('delais.deleguer')} onClose={bilan ? onDone : onClose}>
      {bilan ? <Bandeau type="ok">{t('delais.delegation_faite', bilan)}</Bandeau> : (<>
        <p className="sec">{t('delais.aide_delegation')}</p>
        <Champ label={t('delais.remplacant')}>
          <select value={vers} onChange={(e) => setVers(e.target.value)}>{equipe.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}</select>
        </Champ>
        <Champ label={t('champs.motif')}><textarea value={motif} maxLength={1000} onChange={(e) => setMotif(e.target.value)} /></Champ>
        <Bandeau type="err">{a.erreur}</Bandeau>
        <Bouton variante="primaire" disabled={a.enCours || motif.trim().length < 5} onClick={() => void valider()}>{t('commun.confirmer')}</Bouton>
      </>)}
    </Tiroir>
  );
}

// ----------------------------------------------------------------------------- paramétrage
interface JourCalendrier { pays: string; jour: string; nature: 'ferie' | 'ouvre'; libelle: string; confirme: boolean; source: string | null; }

export function CalendrierParam() {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const [pays, setPays] = useState<(typeof PAYS)[number]>('CN');
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const l = useAsync(async () => ok(await supabase.from('calendrier').select('*').eq('pays', pays)
    .gte('jour', `${annee}-01-01`).lte('jour', `${annee}-12-31`).order('jour')) as JourCalendrier[], [pays, annee]);
  const a = useAction();
  const [f, setF] = useState({ jour: '', nature: 'ferie', libelle: '' });
  const ajouter = async () => {
    const v = z.object({ pays: z.enum(PAYS), jour: DATE, nature: z.enum(['ferie', 'ouvre']), libelle: z.string().trim().min(2).max(120),
      confirme: z.literal(true), source: z.string().max(200) }).strict()
      .safeParse({ pays, jour: f.jour, nature: f.nature, libelle: f.libelle, confirme: true, source: 'Saisie de l\'administratrice' });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('calendrier').upsert(v.data)))) { setF({ jour: '', nature: 'ferie', libelle: '' }); void l.recharger(); }
  };
  const confirmer = async (j: JourCalendrier) => {
    if (await a.executer(async () => ok(await supabase.from('calendrier').update({ confirme: true }).eq('pays', j.pays).eq('jour', j.jour)))) void l.recharger();
  };
  const retirer = async (j: JourCalendrier) => {
    if (await a.executer(async () => ok(await supabase.from('calendrier').delete().eq('pays', j.pays).eq('jour', j.jour)))) void l.recharger();
  };
  const aConfirmer = (l.data ?? []).filter((j) => !j.confirme).length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p className="mute">{t('delais.aide_calendrier')}</p>
      <div className="actions" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Champ label={t('delais.pays')}><select value={pays} onChange={(e) => setPays(z.enum(PAYS).parse(e.target.value))}>
          {PAYS.map((p) => <option key={p} value={p}>{t(`delais.pays_noms.${p}`)}</option>)}</select></Champ>
        <Champ label={t('delais.annee')}><input type="number" min={2020} max={2100} value={annee} onChange={(e) => setAnnee(Number(e.target.value) || annee)} /></Champ>
      </div>
      {pays === 'CN' && (l.data ?? []).length === 0 && <Bandeau type="err">{t('delais.chine_vide')}</Bandeau>}
      {aConfirmer > 0 && <Bandeau>{t('delais.a_confirmer', { n: aConfirmer })}</Bandeau>}
      <Bandeau type="err">{l.erreur ?? a.erreur}</Bandeau>
      <table className="t"><thead><tr><th>{t('delais.jour')}</th><th>{t('delais.nature_jour')}</th><th>{t('delais.libelle')}</th><th>{t('delais.confirme')}</th><th /></tr></thead>
        <tbody>{(l.data ?? []).map((j) => (
          <tr key={j.jour}><td className="ref">{date(j.jour, langue)}</td><td>{t(`delais.${j.nature}`)}</td><td>{j.libelle}</td>
            <td>{j.confirme ? <Statut statut="ok" libelle={t('commun.oui')} /> : <Bouton petit disabled={a.enCours} onClick={() => void confirmer(j)}>{t('commun.confirmer')}</Bouton>}</td>
            <td className="num"><Bouton petit disabled={a.enCours} onClick={() => void retirer(j)}>{t('commun.retirer')}</Bouton></td></tr>))}</tbody></table>
      <div className="actions" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Champ label={t('delais.jour')}><input type="date" value={f.jour} onChange={(e) => setF({ ...f, jour: e.target.value })} /></Champ>
        <Champ label={t('delais.nature_jour')}><select value={f.nature} onChange={(e) => setF({ ...f, nature: e.target.value })}>
          <option value="ferie">{t('delais.ferie')}</option><option value="ouvre">{t('delais.ouvre')}</option></select></Champ>
        <Champ label={t('delais.libelle')}><input value={f.libelle} maxLength={120} onChange={(e) => setF({ ...f, libelle: e.target.value })} /></Champ>
        <Bouton variante="primaire" disabled={a.enCours} onClick={() => void ajouter()}>{t('commun.ajouter')}</Bouton>
      </div>
    </div>
  );
}

export function DelaisCiblesParam() {
  const { t } = useTranslation();
  const modeles = useAsync(async () => ok(await supabase.from('modeles_dossier').select('code, phases').order('code')) as { code: string; phases: string[] }[], []);
  const cibles = useAsync(async () => ok(await supabase.from('delais_cibles').select('modele, phase, jours_ouvres')) as
    { modele: string; phase: string; jours_ouvres: number }[], []);
  const a = useAction();
  const [saisie, setSaisie] = useState<Record<string, string>>({});
  const valeur = (m: string, p: string) => saisie[`${m}|${p}`] ?? String(cibles.data?.find((c) => c.modele === m && c.phase === p)?.jours_ouvres ?? '');
  const enregistrer = async (m: string, p: string) => {
    const brut = valeur(m, p).trim();
    const existe = cibles.data?.some((c) => c.modele === m && c.phase === p);
    if (brut === '') {
      if (existe && await a.executer(async () => ok(await supabase.from('delais_cibles').delete().eq('modele', m).eq('phase', p)))) void cibles.recharger();
      return;
    }
    const v = z.object({ modele: z.string().regex(/^[a-z_]{2,40}$/), phase: z.enum(PHASES), jours_ouvres: z.coerce.number().int().min(1).max(365) }).strict()
      .safeParse({ modele: m, phase: p, jours_ouvres: brut });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('delais_cibles').upsert(v.data)))) void cibles.recharger();
  };
  if (modeles.chargement && !modeles.data) return <Chargement />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p className="mute">{t('delais.aide_cibles')}</p>
      <Bandeau type="err">{modeles.erreur ?? cibles.erreur ?? a.erreur}</Bandeau>
      {(modeles.data ?? []).map((m) => (
        <div key={m.code}>
          <div className="section-titre">{t(`modeles.${m.code}`)}</div>
          <table className="t"><tbody>{m.phases.map((p) => (
            <tr key={p}><td>{t(`phases.${p}`)}</td>
              <td className="num" style={{ width: 160 }}>
                <input type="number" min={1} max={365} aria-label={`${t(`modeles.${m.code}`)} — ${t(`phases.${p}`)}`}
                  placeholder={t('delais.non_defini')} value={valeur(m.code, p)}
                  onChange={(e) => setSaisie({ ...saisie, [`${m.code}|${p}`]: e.target.value })}
                  onBlur={() => void enregistrer(m.code, p)} />
              </td><td className="mute">{t('delais.jours_ouvres')}</td></tr>))}</tbody></table>
        </div>
      ))}
    </div>
  );
}
