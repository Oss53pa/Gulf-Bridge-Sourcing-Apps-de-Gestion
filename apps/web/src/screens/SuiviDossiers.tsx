// Suivi transversal des dossiers (maquette « Pièces manquantes » PCM et « Points bloquants » BLQ).
// Lecture selon les droits en base (RLS) ; toute écriture passe par les fonctions et règles existantes.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date } from '../lib/format';
import { useNoms } from '../lib/referentiels';
import type { Piece, PointBloquant } from '../lib/types';
import { Bandeau, Bouton, Champ, Chargement, Entete, Kpis, Onglets, Statut, Tiroir, Vide } from '../components/ui';
import { DemanderPiece } from './Avenants';

interface DossierCourt { reference: string; client_id: string; phase_courante: string; statut: string; chef_id: string | null }
type PieceSuivie = Piece & { cree_le: string; dossiers: DossierCourt };
type PointSuivi = PointBloquant & { cree_le: string; dossiers: DossierCourt };

const ATTENTE = ['manquante', 'refusee', 'expiree'];
const A_VERIFIER = ['recue', 'a_verifier'];
const jours = (depuis: string | null | undefined, aujourdhui: string) =>
  depuis ? Math.max(0, Math.round((Date.parse(aujourdhui) - Date.parse(depuis.slice(0, 10))) / 86400000)) : null;
const ddmm = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '—');

export function PiecesManquantes() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { profil, fuseau } = useAuth();
  const role = profil?.role ?? '';
  const clients = useNoms('clients');
  const a = useAction();
  const [onglet, setOnglet] = useState<'traiter' | 'obligatoires' | 'verifier'>('traiter');
  const [dossierFiltre, setDossierFiltre] = useState('tous');
  const [demande, setDemande] = useState<Piece | null>(null);
  const aujourdhui = new Intl.DateTimeFormat('en-CA', { timeZone: fuseau }).format(new Date());
  const l = useAsync(async () => ok(await supabase.from('pieces')
    .select('*, dossiers!inner(reference, client_id, phase_courante, statut, chef_id)')
    .in('statut', [...ATTENTE, ...A_VERIFIER]).eq('dossiers.statut', 'ouvert').limit(1000)) as PieceSuivie[], []);
  const toutes = l.data ?? [];
  const bloque = (p: PieceSuivie) => p.obligatoire && ATTENTE.includes(p.statut) && p.phase === p.dossiers.phase_courante;
  const enAttente = toutes.filter((p) => ATTENTE.includes(p.statut));
  const aVerifier = toutes.filter((p) => A_VERIFIER.includes(p.statut));
  const bloquantes = toutes.filter(bloque);
  const dossiersListe = useMemo(() => [...new Map(toutes.map((p) => [p.dossier_id, p.dossiers.reference])).entries()].sort((x, y) => x[1].localeCompare(y[1])), [toutes]);
  const base = onglet === 'traiter' ? enAttente : onglet === 'obligatoires' ? bloquantes : aVerifier;
  const liste = base.filter((p) => dossierFiltre === 'tous' || p.dossier_id === dossierFiltre)
    .sort((x, y) => Number(bloque(y)) - Number(bloque(x)) || (jours(y.demandee_le ?? y.cree_le, aujourdhui) ?? 0) - (jours(x.demandee_le ?? x.cree_le, aujourdhui) ?? 0));
  const peutEcrire = ['admin', 'achats_chine', 'hub_afrique'].includes(role);
  const statuer = async (p: Piece, statut: string) => {
    if (await a.executer(async () => ok(await supabase.rpc('statuer_piece', { p_piece: p.id, p_statut: statut, p_commentaire: null })))) void l.recharger();
  };
  const nbDossiers = new Set(enAttente.map((p) => p.dossier_id)).size;
  const relances = toutes.reduce((s, p) => s + (p.relances ?? 0), 0);
  const titre = t('suivi_dossiers.pcm_titre', { n: enAttente.length, d: nbDossiers })
    + (bloquantes.length ? ` ; ${t('suivi_dossiers.pcm_titre_bloque', { n: bloquantes.length })}` : '');

  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.dossiers')} · ${t('suivi_dossiers.pcm_surtitre')} · PCM`} titre={l.data ? titre : t('ecrans.pieces_manquantes')} />
      <Kpis items={[
        { lib: t('suivi_dossiers.k_attente'), val: enAttente.length, sous: t('suivi_dossiers.k_attente_sous') },
        { lib: t('suivi_dossiers.k_obligatoires'), val: bloquantes.length, sous: t('suivi_dossiers.k_obligatoires_sous') },
        { lib: t('suivi_dossiers.k_verifier'), val: aVerifier.length, sous: t('suivi_dossiers.k_verifier_sous') },
        { lib: t('suivi_dossiers.k_relances'), val: relances, sous: t('suivi_dossiers.k_relances_sous') },
      ]} />
      <div className="pf-barre">
        <Onglets actif={onglet} onChange={setOnglet} items={[
          { id: 'traiter', lib: t('suivi_dossiers.o_traiter') }, { id: 'obligatoires', lib: t('suivi_dossiers.o_obligatoires') },
          { id: 'verifier', lib: t('suivi_dossiers.o_verifier') }]} />
        <select className="pf-statut" value={dossierFiltre} onChange={(e) => setDossierFiltre(e.target.value)} aria-label={t('champs.dossier')}>
          <option value="tous">{t('suivi_dossiers.tous_dossiers')}</option>
          {dossiersListe.map(([id, ref]) => <option key={id} value={id}>{ref}</option>)}
        </select>
      </div>
      <Bandeau type="err">{l.erreur ?? a.erreur}</Bandeau>
      <div className="cadre">
        {l.chargement && !l.data ? <Chargement /> : liste.length === 0 ? <Vide>{t('suivi_dossiers.aucune_piece')}</Vide> : (
          <table className="t">
            <thead><tr><th>{t('champs.dossier')}</th><th>{t('suivi_dossiers.piece_phase')}</th><th>{t('suivi_dossiers.exigence')}</th>
              <th>{t('suivi_dossiers.attendue_de')}</th><th className="num">{t('suivi_dossiers.age')}</th><th className="num">{t('suivi_dossiers.rel')}</th>
              <th>{t('champs.statut')}</th><th /></tr></thead>
            <tbody>
              {liste.map((p) => {
                const age = jours(p.demandee_le ?? p.cree_le, aujourdhui);
                const qui = p.demandee_a ?? p.fournie_par;
                return (
                  <tr key={p.id} className={bloque(p) ? 'bloque' : undefined}>
                    <td><div className="ref"><Link to={`/dossiers/${p.dossier_id}`}>{p.dossiers.reference}</Link></div><div className="mute">{clients[p.dossiers.client_id] ?? '…'}</div></td>
                    <td><div>{p.libelle}</div><div className="mute">{t(`phases.${p.phase}`)}</div></td>
                    <td className="sec">{p.obligatoire ? t('suivi_dossiers.obligatoire') : t('suivi_dossiers.facultative')}</td>
                    <td className="sec">{qui ? t(`pieces.destinataire.${qui}`, { defaultValue: t(`fournisseurs_piece.${qui}`, { defaultValue: qui }) }) : '—'}</td>
                    <td className={'num' + (age !== null && age >= 7 ? ' alerte' : '')}>{age === null ? '—' : t('portefeuille.jours', { n: age })}</td>
                    <td className="num">{p.relances ?? 0}</td>
                    <td><Statut statut={p.statut} libelle={p.demandee_le && ATTENTE.includes(p.statut) ? t('suivi_dossiers.demandee') : t(`statuts_piece.${p.statut}`)} /></td>
                    <td className="num">
                      <span className="actions" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        {peutEcrire && ATTENTE.includes(p.statut) && <Bouton petit onClick={() => setDemande(p)}>{p.demandee_le ? t('suivi_dossiers.relancer') : t('pieces.demander')}</Bouton>}
                        {peutEcrire && A_VERIFIER.includes(p.statut) && <>
                          <Bouton petit onClick={() => void statuer(p, 'validee')}>{t('fiche.valider')}</Bouton>
                          <Bouton petit variante="danger" onClick={() => void statuer(p, 'refusee')}>{t('fiche.refuser')}</Bouton>
                        </>}
                        <Bouton petit onClick={() => nav(`/dossiers/${p.dossier_id}`)}>{t('delais.ouvrir')}</Bouton>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {demande && <DemanderPiece piece={demande} onClose={() => setDemande(null)} onDone={() => { setDemande(null); void l.recharger(); }} />}
    </div>
  );
}

const schemaPoint = z.object({
  dossier_id: z.string().uuid(),
  description: z.string().trim().min(3).max(2000),
  categorie: z.enum(['client', 'fournisseur', 'qualite', 'paiement', 'logistique', 'documents', 'interne']),
  echeance: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  impact_jours: z.number().int().min(0).max(365).nullable(),
}).strict();

/** Niveau d'escalade affiché : responsable, puis chef de dossier à l'échéance dépassée, puis administratrice une fois escaladé. */
const niveau = (p: PointSuivi, aujourdhui: string) => (p.resolu_le ? 'resolu' : p.escalade_le ? 'administratrice' : p.echeance < aujourdhui ? 'chef' : 'responsable');

export function PointsBloquants() {
  const { t } = useTranslation();
  const { profil, langue, fuseau } = useAuth();
  const role = profil?.role ?? '';
  const clients = useNoms('clients');
  const profils = useNoms('profils');
  const dossiersNoms = useNoms('dossiers');
  const a = useAction();
  const [onglet, setOnglet] = useState<'ouverts' | 'retard' | 'escalades' | 'resolus'>('ouverts');
  const [sel, setSel] = useState<string | null>(null);
  const [nouveau, setNouveau] = useState(false);
  const [resolution, setResolution] = useState<PointSuivi | null>(null);
  const [texte, setTexte] = useState('');
  const [f, setF] = useState({ dossier_id: '', description: '', categorie: 'client', echeance: '', impact_jours: '' });
  const aujourdhui = new Intl.DateTimeFormat('en-CA', { timeZone: fuseau }).format(new Date());
  const l = useAsync(async () => ok(await supabase.from('points_bloquants')
    .select('*, dossiers!inner(reference, client_id, phase_courante, statut, chef_id)')
    .order('echeance').limit(1000)) as PointSuivi[], []);
  const tous = l.data ?? [];
  const ouverts = tous.filter((p) => !p.resolu_le);
  const enRetard = ouverts.filter((p) => p.echeance < aujourdhui);
  const escalades = ouverts.filter((p) => p.escalade_le);
  const resolus = tous.filter((p) => p.resolu_le);
  const impact = ouverts.reduce((s, p) => s + (p.impact_jours ?? 0), 0);
  const liste = onglet === 'ouverts' ? ouverts : onglet === 'retard' ? enRetard : onglet === 'escalades' ? escalades : resolus;
  const choisi = liste.find((p) => p.id === sel) ?? liste[0] ?? null;
  const peut = ['admin', 'achats_chine', 'hub_afrique', 'agent_pays'].includes(role);
  const etat = (p: PointSuivi) => (p.resolu_le ? <Statut statut="ok" libelle={t('suivi_dossiers.resolu')} />
    : p.echeance < aujourdhui ? <Statut statut="err" libelle={t('suivi_dossiers.en_retard')} /> : <Statut statut="info" libelle={t('suivi_dossiers.ouvert')} />);
  const ref = (p: PointSuivi) => `BL-${p.dossiers.reference.split('-').pop()}-${String(tous.filter((x) => x.dossier_id === p.dossier_id).findIndex((x) => x.id === p.id) + 1).padStart(2, '0')}`;
  const creer = async () => {
    const v = schemaPoint.safeParse({ ...f, impact_jours: f.impact_jours ? Number(f.impact_jours) : null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('points_bloquants').insert(v.data)))) {
      setNouveau(false); setF({ dossier_id: '', description: '', categorie: 'client', echeance: '', impact_jours: '' }); void l.recharger();
    }
  };
  const resoudre = async () => {
    const v = z.string().trim().min(3).max(4000).safeParse(texte);
    if (!v.success || !resolution) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('points_bloquants').update({ resolution: v.data, resolu_le: new Date().toISOString() }).eq('id', resolution.id)))) {
      setResolution(null); setTexte(''); void l.recharger();
    }
  };
  const titre = t('suivi_dossiers.blq_titre', { n: ouverts.length })
    + (enRetard.length || impact ? ` ; ${[enRetard.length ? t('suivi_dossiers.blq_titre_retard', { n: enRetard.length }) : null,
      impact ? t('suivi_dossiers.blq_titre_impact', { n: impact }) : null].filter(Boolean).join(', ')}` : '');

  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.dossiers')} · ${t('suivi_dossiers.blq_surtitre')} · BLQ`} titre={l.data ? titre : t('ecrans.points_bloquants')}
        actions={peut && <Bouton variante="primaire" onClick={() => setNouveau(true)}>{t('suivi_dossiers.declarer')}</Bouton>} />
      <Kpis items={[
        { lib: t('suivi_dossiers.k_ouverts'), val: ouverts.length, sous: t('suivi_dossiers.k_ouverts_sous') },
        { lib: t('suivi_dossiers.k_retard'), val: enRetard.length, sous: t('delais.k_retard_sous') },
        { lib: t('suivi_dossiers.k_escalades'), val: escalades.length, sous: t('suivi_dossiers.k_escalades_sous') },
        { lib: t('suivi_dossiers.k_impact'), val: `+${impact} j`, sous: t('suivi_dossiers.k_impact_sous') },
      ]} />
      <Onglets actif={onglet} onChange={setOnglet} items={[
        { id: 'ouverts', lib: t('suivi_dossiers.o_ouverts') }, { id: 'retard', lib: t('suivi_dossiers.o_retard') },
        { id: 'escalades', lib: t('suivi_dossiers.o_escalades') }, { id: 'resolus', lib: t('suivi_dossiers.o_resolus') }]} />
      <Bandeau type="err">{l.erreur ?? a.erreur}</Bandeau>
      <div className="liste-detail pf">
        <div className="liste">
          {l.chargement && !l.data ? <Chargement /> : liste.length === 0 ? <Vide>{t('tableau.aucun_point')}</Vide> : (
            <div className="cadre">
              <table className="t">
                <thead><tr><th>{t('champs.dossier')}</th><th>{t('suivi_dossiers.point')}</th><th>{t('champs.categorie')}</th>
                  <th className="num">{t('suivi_dossiers.impact')}</th><th className="num">{t('suivi_dossiers.ech')}</th><th>{t('suivi_dossiers.niveau')}</th><th>{t('champs.statut')}</th></tr></thead>
                <tbody>
                  {liste.map((p) => (
                    <tr key={p.id} className="cliquable" aria-selected={p.id === choisi?.id} onClick={() => setSel(p.id)}>
                      <td className="ref">{p.dossiers.reference}</td>
                      <td><div style={{ fontWeight: 500 }}>{p.description}</div><div className="mute">{ref(p)}{p.responsable_id ? ` · ${profils[p.responsable_id] ?? ''}` : ''}</div></td>
                      <td className="sec">{t(`categories.${p.categorie}`)}</td>
                      <td className="num">+{p.impact_jours ?? 0} j</td>
                      <td className={'num' + (!p.resolu_le && p.echeance < aujourdhui ? ' retard-txt' : '')}>{ddmm(p.echeance)}</td>
                      <td className="sec">{t(`suivi_dossiers.niveaux.${niveau(p, aujourdhui)}`)}</td>
                      <td>{etat(p)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <aside className="detail pf-detail">
          {!choisi ? <Vide>{t('suivi_dossiers.choisir_point')}</Vide> : (
            <>
              <div className="surtitre">{ref(choisi)}</div>
              <h2 className="pf-nom">{choisi.description}</h2>
              <div className="sec"><Link to={`/dossiers/${choisi.dossier_id}`}>{dossiersNoms[choisi.dossier_id] ?? choisi.dossiers.reference}</Link> · {clients[choisi.dossiers.client_id] ?? ''}</div>
              <div>{etat(choisi)}</div>
              <div className="pf-champs">
                <div><span>{t('champs.categorie')}</span><b>{t(`categories.${choisi.categorie}`)}</b></div>
                <div><span>{t('suivi_dossiers.impact_delai')}</span><b>+{choisi.impact_jours ?? 0} {t('suivi_dossiers.jours')}</b></div>
                <div><span>{t('suivi_dossiers.responsable')}</span><b>{choisi.responsable_id ? profils[choisi.responsable_id] ?? '…' : '—'}</b></div>
                <div><span>{t('suivi_dossiers.ouvert_le')}</span><b>{date(choisi.cree_le, langue)}</b></div>
                <div><span>{t('champs.echeance')}</span><b>{date(choisi.echeance, langue)}</b></div>
                <div><span>{t('suivi_dossiers.niveau')}</span><b>{t(`suivi_dossiers.niveaux.${niveau(choisi, aujourdhui)}`)}</b></div>
              </div>
              <div className="fiche-cote" style={{ position: 'static' }}>
                <section>
                  <div className="surtitre">{t('suivi_dossiers.escalade')}</div>
                  <ol className="escalade">
                    {(['responsable', 'chef', 'administratrice'] as const).map((n, i) => {
                      const ordre = { responsable: 0, chef: 1, administratrice: 2, resolu: -1 }[niveau(choisi, aujourdhui)];
                      return (
                        <li key={n} className={i <= ordre ? 'atteint' : undefined}>
                          <span className="pastille">{i + 1}</span>
                          <span><b>{t(`suivi_dossiers.niveaux.${n}`)}</b><span className="mute">{t(`suivi_dossiers.escalade_quand.${n}`)}</span></span>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              </div>
              {choisi.resolution && <p className="sec">{choisi.resolution}</p>}
              {peut && !choisi.resolu_le && <div className="actions"><Bouton variante="primaire" onClick={() => setResolution(choisi)}>{t('fiche.resoudre')}</Bouton></div>}
            </>
          )}
        </aside>
      </div>
      {nouveau && (
        <Tiroir titre={t('suivi_dossiers.declarer')} onClose={() => setNouveau(false)}>
          <Champ label={t('champs.dossier')}>
            <select value={f.dossier_id} onChange={(e) => setF({ ...f, dossier_id: e.target.value })}>
              <option value="">—</option>
              {Object.entries(dossiersNoms).sort((x, y) => x[1].localeCompare(y[1])).map(([id, r]) => <option key={id} value={id}>{r}</option>)}
            </select>
          </Champ>
          <Champ label={t('champs.description')}><textarea value={f.description} maxLength={2000} onChange={(e) => setF({ ...f, description: e.target.value })} /></Champ>
          <div className="grille2">
            <Champ label={t('champs.categorie')}>
              <select value={f.categorie} onChange={(e) => setF({ ...f, categorie: e.target.value })}>
                {['client', 'fournisseur', 'qualite', 'paiement', 'logistique', 'documents', 'interne'].map((c) => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}
              </select>
            </Champ>
            <Champ label={t('champs.echeance')}><input type="date" value={f.echeance} onChange={(e) => setF({ ...f, echeance: e.target.value })} /></Champ>
            <Champ label={t('suivi_dossiers.impact_delai')}><input type="number" min={0} max={365} value={f.impact_jours} onChange={(e) => setF({ ...f, impact_jours: e.target.value })} /></Champ>
          </div>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <Bouton variante="primaire" disabled={a.enCours} onClick={() => void creer()}>{t('commun.enregistrer')}</Bouton>
        </Tiroir>
      )}
      {resolution && (
        <Tiroir titre={t('fiche.resoudre')} onClose={() => setResolution(null)}>
          <p className="sec">{resolution.description}</p>
          <Champ label={t('fiche.resolution')}><textarea value={texte} maxLength={4000} onChange={(e) => setTexte(e.target.value)} /></Champ>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <Bouton variante="primaire" disabled={texte.trim().length < 3 || a.enCours} onClick={() => void resoudre()}>{t('commun.confirmer')}</Bouton>
        </Tiroir>
      )}
    </div>
  );
}
