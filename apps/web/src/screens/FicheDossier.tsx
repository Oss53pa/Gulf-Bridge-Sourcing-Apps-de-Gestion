import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, dateHeure, montant, pourcent } from '../lib/format';
import { deposer, FichierRefuse, urlSignee } from '../lib/fichiers';
import type { Audit, Commande, Devis, Dossier, Phase, Piece, PointBloquant } from '../lib/types';
import { Bandeau, Bouton, Champ, Chargement, Entete, Jauge, Kpis, Onglets, Statut, Tiroir, Vide } from '../components/ui';
import { useNoms } from '../lib/referentiels';
import { useCompletude } from './Dossiers';
import { Depot } from '../components/Depot';

type Onglet = 'phases' | 'blocages' | 'devis' | 'commandes' | 'journal';

export function FicheDossier() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const role = profil?.role ?? null;
  const [onglet, setOnglet] = useState<Onglet>('phases');
  const [annulation, setAnnulation] = useState(false);
  const [motifAnnulation, setMotifAnnulation] = useState('');
  const [bilan, setBilan] = useState<{ phase_atteinte: string; avoirs: string[]; factures_emises: string[] } | null>(null);
  const ann = useAction();
  const clients = useNoms('clients');
  const dossier = useAsync(async () => ok(await supabase.from('dossiers').select('*').eq('id', id).maybeSingle()) as Dossier | null, [id]);
  const phases = useAsync(async () => ok(await supabase.from('dossier_phases').select('*').eq('dossier_id', id).order('ordre')) as Phase[], [id]);
  const pieces = useAsync(async () => ok(await supabase.from('pieces').select('*').eq('dossier_id', id).order('phase').order('libelle')) as Piece[], [id]);
  const completude = useCompletude(pieces.data);
  const d = dossier.data;
  if (dossier.chargement) return <div className="screen"><Chargement /></div>;
  if (!d) return <div className="screen"><Vide>{dossier.erreur ?? t('dossiers.introuvable')}</Vide></div>;
  const recharger = () => { void dossier.recharger(); void phases.recharger(); void pieces.recharger(); };
  const onglets: { id: Onglet; lib: string }[] = [
    { id: 'phases', lib: t('fiche.phases_pieces') },
    { id: 'blocages', lib: t('fiche.points_bloquants') },
  ];
  if (['admin', 'hub_afrique', 'agent_pays', 'comptable'].includes(role ?? '')) onglets.push({ id: 'devis', lib: t('fiche.devis') });
  if (['admin', 'achats_chine', 'hub_afrique', 'comptable'].includes(role ?? '')) onglets.push({ id: 'commandes', lib: t('fiche.commandes') });
  if (['admin', 'comptable'].includes(role ?? '')) onglets.push({ id: 'journal', lib: t('fiche.journal') });

  return (
    <div className="screen">
      <Entete surtitre={`${d.reference} · ${t(`modeles.${d.modele}`)} · ${t(`modes.${d.mode_financier}`)}`}
        titre={`${clients[d.client_id] ?? ''} — ${d.intitule}`}
        actions={<>
          <Statut statut={d.statut === 'ouvert' ? 'en_cours' : d.statut} libelle={t(`statuts_dossier.${d.statut}`)} />
          {role === 'admin' && d.statut === 'ouvert' && <Bouton variante="danger" onClick={() => setAnnulation(true)}>{t('fiche.annuler_dossier')}</Bouton>}
        </>} />
      <Kpis items={[
        { lib: t('fiche.phase_courante'), texte: true, val: t(`phases.${d.phase_courante}`), sous: t('fiche.phases_validees', { n: (phases.data ?? []).filter((p) => p.statut === 'validee').length, total: (phases.data ?? []).length }) },
        { lib: t('fiche.completude'), val: `${completude} %`, sous: <Jauge valeur={completude} /> },
        { lib: t('champs.ouvert_le'), val: date(d.ouvert_le, langue), sous: t('fiche.regles_datees') },
        { lib: t('champs.date_ouverture_site'), val: d.date_ouverture_site ? date(d.date_ouverture_site, langue) : '—', sous: d.lettre_credit ? t('champs.lettre_credit') : t('fiche.sans_lc') },
      ]} />
      <Onglets actif={onglet} onChange={setOnglet} items={onglets} />
      <div className="cadre">
        {onglet === 'phases' && <PhasesPieces dossier={d} phases={phases.data ?? []} pieces={pieces.data ?? []} onChange={recharger} />}
        {onglet === 'blocages' && <Blocages dossierId={d.id} />}
        {onglet === 'devis' && <DevisDossier dossier={d} />}
        {onglet === 'commandes' && <CommandesDossier dossier={d} />}
        {onglet === 'journal' && <JournalDossier dossierId={d.id} />}
      </div>
      {annulation && (
        <Tiroir titre={t('fiche.annuler_dossier')} onClose={() => { setAnnulation(false); setBilan(null); }}>
          {bilan ? (<>
            <Bandeau type="ok">{t(`fiche.annulation_${bilan.phase_atteinte}`)}</Bandeau>
            <dl className="dl">
              <dt>{t('fiche.avoirs_emis')}</dt><dd>{bilan.avoirs.join(', ') || '—'}</dd>
              <dt>{t('fiche.factures_emises')}</dt><dd>{bilan.factures_emises.join(', ') || '—'}</dd>
            </dl>
            <p className="mute">{t('fiche.frais_engages')}</p>
          </>) : (<>
            <p className="sec">{t('fiche.aide_annulation')}</p>
            <Champ label={t('champs.motif')}><textarea value={motifAnnulation} maxLength={1000} onChange={(e) => setMotifAnnulation(e.target.value)} /></Champ>
            <Bandeau type="err">{ann.erreur}</Bandeau>
            <Bouton variante="danger" disabled={motifAnnulation.trim().length < 5 || ann.enCours} onClick={() => void ann.executer(async () => {
              setBilan(ok(await supabase.rpc('annuler_dossier', { p_dossier: d.id, p_motif: motifAnnulation.trim() })) as typeof bilan);
              recharger();
            })}>{t('fiche.confirmer_annulation')}</Bouton>
          </>)}
        </Tiroir>
      )}
    </div>
  );
}

function PhasesPieces({ dossier, phases, pieces, onChange }: { dossier: Dossier; phases: Phase[]; pieces: Piece[]; onChange: () => void }) {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const role = profil?.role ?? '';
  const a = useAction();
  const [derog, setDerog] = useState(false);
  const [motif, setMotif] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const fichier = useRef<HTMLInputElement>(null);
  const [cible, setCible] = useState<string | null>(null);
  const peutEcrire = ['admin', 'achats_chine', 'hub_afrique'].includes(role);
  const courante = dossier.phase_courante;

  const avancer = async (m?: string) => {
    setInfo(null);
    const okk = await a.executer(async () => {
      const r = ok(await supabase.rpc('avancer_phase', { p_dossier: dossier.id, p_motif_derogation: m ?? null })) as { facultatives_manquantes: string[] };
      if (r.facultatives_manquantes.length) setInfo(t('fiche.facultatives_manquantes', { liste: r.facultatives_manquantes.join(' ; ') }));
    });
    if (okk) { setDerog(false); setMotif(''); onChange(); }
  };
  const choisirFichier = (pieceId: string) => { setCible(pieceId); fichier.current?.click(); };
  const surFichier = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !cible) return;
    await a.executer(async () => {
      try {
        const r = await deposer(dossier.id, f);
        ok(await supabase.rpc('deposer_piece', { p_piece: cible, p_chemin: r.chemin, p_empreinte: r.empreinte }));
      } catch (err) {
        if (err instanceof FichierRefuse) throw new Error(err.message === 'type' ? 'GBS_FICHIER_TYPE' : 'GBS_FICHIER_TAILLE');
        throw err;
      }
    });
    onChange();
  };
  const statuer = async (p: Piece, statut: string) => { if (await a.executer(async () => ok(await supabase.rpc('statuer_piece', { p_piece: p.id, p_statut: statut, p_commentaire: null })))) onChange(); };
  const voir = async (p: Piece) => { if (p.document_chemin) { const u = await urlSignee(p.document_chemin); if (u) window.open(u, '_blank', 'noopener,noreferrer'); } };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <input ref={fichier} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden onChange={surFichier} />
      <div className="phases">{phases.map((p) => <span key={p.id} className={'phase ' + p.statut}>{p.ordre}. {t(`phases.${p.phase}`)}</span>)}</div>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bandeau>{info}</Bandeau>
      {phases.map((ph) => {
        const lst = pieces.filter((p) => p.phase === ph.phase);
        if (!lst.length && ph.phase !== courante) return null;
        return (
          <section key={ph.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="section-titre">{t(`phases.${ph.phase}`)}</span>
              <Statut statut={ph.statut} libelle={t(`statuts_phase.${ph.statut}`)} />
              {ph.phase === courante && dossier.statut === 'ouvert' && peutEcrire && (
                <span className="actions" style={{ marginLeft: 'auto' }}>
                  <Bouton variante="primaire" petit disabled={a.enCours} onClick={() => void avancer()}>{t('fiche.avancer')}</Bouton>
                  {role === 'admin' && <Bouton petit onClick={() => setDerog(true)}>{t('fiche.deroger')}</Bouton>}
                </span>
              )}
            </div>
            {lst.length === 0 ? <span className="mute">{t('fiche.aucune_piece')}</span> : (
              <table className="t">
                <thead><tr><th>{t('champs.piece')}</th><th>{t('champs.obligatoire')}</th><th>{t('champs.fournie_par')}</th><th>{t('champs.statut')}</th><th>{t('champs.date')}</th><th /></tr></thead>
                <tbody>
                  {lst.map((p) => (
                    <tr key={p.id}>
                      <td>{p.libelle}</td>
                      <td className="sec">{p.obligatoire ? t('commun.oui') : t('fiche.facultative')}</td>
                      <td className="sec">{p.fournie_par ? t(`fournisseurs_piece.${p.fournie_par}`) : '—'}</td>
                      <td><Statut statut={p.statut} libelle={t(`statuts_piece.${p.statut}`)} /></td>
                      <td className="ref">{p.statut_le ? dateHeure(p.statut_le, langue, profil?.fuseau ?? 'UTC') : '—'}</td>
                      <td className="num">
                        <span className="actions" style={{ justifyContent: 'flex-end' }}>
                          {p.document_chemin && <Bouton petit onClick={() => void voir(p)}>{t('commun.voir')}</Bouton>}
                          {['admin', 'achats_chine', 'hub_afrique', 'agent_pays'].includes(role) && p.statut !== 'validee' &&
                            <Bouton petit onClick={() => choisirFichier(p.id)}>{t('fiche.deposer')}</Bouton>}
                          {peutEcrire && p.document_chemin && p.statut !== 'validee' && <>
                            <Bouton petit onClick={() => void statuer(p, 'validee')}>{t('fiche.valider')}</Bouton>
                            <Bouton petit variante="danger" onClick={() => void statuer(p, 'refusee')}>{t('fiche.refuser')}</Bouton>
                          </>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
      {derog && (
        <Tiroir titre={t('fiche.derogation_titre')} onClose={() => setDerog(false)}>
          <p className="sec">{t('fiche.derogation_texte')}</p>
          <Champ label={t('champs.motif')}><textarea value={motif} maxLength={1000} onChange={(e) => setMotif(e.target.value)} /></Champ>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <Bouton variante="primaire" disabled={motif.trim().length < 5 || a.enCours} onClick={() => void avancer(motif.trim())}>{t('fiche.confirmer_derogation')}</Bouton>
        </Tiroir>
      )}
    </div>
  );
}

const schemaPoint = z.object({
  description: z.string().trim().min(3).max(2000),
  categorie: z.enum(['client', 'fournisseur', 'qualite', 'paiement', 'logistique', 'documents', 'interne']),
  echeance: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  impact_jours: z.number().int().min(0).max(365).nullable(),
}).strict();

function Blocages({ dossierId }: { dossierId: string }) {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const l = useAsync(async () => ok(await supabase.from('points_bloquants').select('*').eq('dossier_id', dossierId).order('echeance')) as PointBloquant[], [dossierId]);
  const [ouvert, setOuvert] = useState(false);
  const [f, setF] = useState({ description: '', categorie: 'client', echeance: '', impact_jours: '' });
  const a = useAction();
  const peut = ['admin', 'achats_chine', 'hub_afrique', 'agent_pays'].includes(profil?.role ?? '');
  const creer = async () => {
    const v = schemaPoint.safeParse({ ...f, impact_jours: f.impact_jours ? Number(f.impact_jours) : null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('points_bloquants').insert({ ...v.data, dossier_id: dossierId })))) { setOuvert(false); void l.recharger(); }
  };
  const resoudre = async (p: PointBloquant) => {
    const res = window.prompt(t('fiche.resolution'))?.trim();
    if (!res) return;
    if (await a.executer(async () => ok(await supabase.from('points_bloquants').update({ resolution: res.slice(0, 4000), resolu_le: new Date().toISOString() }).eq('id', p.id)))) void l.recharger();
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="actions">{peut && <Bouton variante="primaire" onClick={() => setOuvert(true)}>{t('fiche.nouveau_point')}</Bouton>}</div>
      <Bandeau type="err">{a.erreur ?? l.erreur}</Bandeau>
      {(l.data ?? []).length === 0 ? <Vide>{t('tableau.aucun_point')}</Vide> : (
        <table className="t">
          <thead><tr><th>{t('champs.description')}</th><th>{t('champs.categorie')}</th><th>{t('champs.impact')}</th><th>{t('champs.echeance')}</th><th>{t('champs.statut')}</th><th /></tr></thead>
          <tbody>{(l.data ?? []).map((p) => (
            <tr key={p.id}>
              <td>{p.description}{p.resolution && <div className="mute">{p.resolution}</div>}</td>
              <td className="sec">{t(`categories.${p.categorie}`)}</td>
              <td className="num">{p.impact_jours ?? '—'}</td>
              <td className="ref">{date(p.echeance, langue)}</td>
              <td>{p.resolu_le ? <Statut statut="close" libelle={t('fiche.resolu')} /> : p.escalade_le ? <Statut statut="bloquee" libelle={t('tableau.escalade')} /> : <Statut statut="ouverte" />}</td>
              <td className="num">{!p.resolu_le && peut && <Bouton petit onClick={() => void resoudre(p)}>{t('fiche.resoudre')}</Bouton>}</td>
            </tr>))}
          </tbody>
        </table>
      )}
      {ouvert && (
        <Tiroir titre={t('fiche.nouveau_point')} onClose={() => setOuvert(false)}>
          <Champ label={t('champs.description')}><textarea value={f.description} maxLength={2000} onChange={(e) => setF({ ...f, description: e.target.value })} /></Champ>
          <Champ label={t('champs.categorie')}>
            <select value={f.categorie} onChange={(e) => setF({ ...f, categorie: e.target.value })}>
              {['client', 'fournisseur', 'qualite', 'paiement', 'logistique', 'documents', 'interne'].map((c) => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}
            </select>
          </Champ>
          <div className="grille2">
            <Champ label={t('champs.echeance')}><input type="date" value={f.echeance} onChange={(e) => setF({ ...f, echeance: e.target.value })} /></Champ>
            <Champ label={t('champs.impact')}><input inputMode="numeric" value={f.impact_jours} onChange={(e) => setF({ ...f, impact_jours: e.target.value })} /></Champ>
          </div>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <Bouton variante="primaire" disabled={a.enCours} onClick={() => void creer()}>{t('commun.enregistrer')}</Bouton>
        </Tiroir>
      )}
    </div>
  );
}

function DevisDossier({ dossier }: { dossier: Dossier }) {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const role = profil?.role ?? '';
  const l = useAsync(async () => ok(await supabase.from('devis').select('*').eq('dossier_id', dossier.id).order('version', { ascending: false })) as Devis[], [dossier.id]);
  const ech = useAsync(async () => (dossier.modele === 'equipement_site'
    ? (ok(await supabase.from('echeances_projet').select('*').eq('dossier_id', dossier.id).order('ordre')) as { id: string; ordre: number; libelle: string; montant_ht: number; facture_id: string | null }[])
    : []), [dossier.id]);
  const a = useAction();
  const [mandat, setMandat] = useState<Devis | null>(null);
  const [signeLe, setSigneLe] = useState('');
  const [doc, setDoc] = useState('');
  const peut = ['admin', 'hub_afrique', 'agent_pays'].includes(role);
  const dernier = (l.data ?? [])[0];
  const calc = dernier?.calcul;
  const nouvelle = async () => {
    const v = (dernier?.version ?? 0) + 1;
    if (await a.executer(async () => {
      const r = ok(await supabase.from('devis').insert({ dossier_id: dossier.id, version: v, langue: langue === 'en' ? 'en' : 'fr' }).select('id').single()) as { id: string };
      ok(await supabase.rpc('calculer_devis', { p_devis: r.id }));
    })) void l.recharger();
  };
  const calculer = async (d: Devis) => { if (await a.executer(async () => ok(await supabase.rpc('calculer_devis', { p_devis: d.id })))) void l.recharger(); };
  const envoyer = async (d: Devis) => { if (await a.executer(async () => ok(await supabase.from('devis').update({ statut: 'envoye' }).eq('id', d.id)))) void l.recharger(); };
  const valider = async () => {
    if (!mandat || !/^\d{4}-\d{2}-\d{2}$/.test(signeLe) || !doc) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('valider_mandat', { p_devis: mandat.id, p_document: doc, p_signe_le: signeLe })))) { setMandat(null); void l.recharger(); }
  };
  const facturerEcheance = async (ordre: number) => { if (await a.executer(async () => ok(await supabase.rpc('facturer_echeance', { p_dossier: dossier.id, p_ordre: ordre })))) void ech.recharger(); };
  const facturerCommission = async (tr: number) => { await a.executer(async () => ok(await supabase.rpc('facturer_commission', { p_dossier: dossier.id, p_tranche: tr }))); };
  const x = (k: string) => montant(calc?.[k] ?? null, 'XOF', langue);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="actions">
        {peut && <Bouton variante="primaire" disabled={a.enCours} onClick={() => void nouvelle()}>{t('devis.nouvelle_version')}</Bouton>}
        {['admin', 'hub_afrique'].includes(role) && dossier.mode_financier === 'accompagne' && <>
          <Bouton onClick={() => void facturerCommission(1)}>{t('devis.facturer_t1')}</Bouton>
          <Bouton onClick={() => void facturerCommission(2)}>{t('devis.facturer_t2')}</Bouton>
        </>}
      </div>
      <Bandeau type="err">{a.erreur ?? l.erreur}</Bandeau>
      {calc && (
        <Kpis items={[
          { lib: t('devis.base_fob'), val: x('base_fob_xof'), sous: `${t('devis.taux')} ${pourcent(calc.taux_tranche, langue)}` },
          { lib: t('devis.commission_totale'), val: x('commission_totale'), sous: calc.minimum_applique ? t('devis.minimum_applique') : t('devis.calculee', { m: x('commission_calculee') }) },
          { lib: t('devis.premiere_facture'), val: x('premiere_facture'), sous: t('devis.deductions', { m: montant(Number(calc.deduction_forfait_consultation ?? 0) + Number(calc.deduction_verification_fournisseur ?? 0), 'XOF', langue) }) },
          { lib: t('devis.solde'), val: x('solde'), sous: calc.recalcul_requis ? t('devis.recalcul_change') : t('devis.avant_depart') },
        ]} />
      )}
      {(l.data ?? []).length === 0 ? <Vide>{t('devis.aucun')}</Vide> : (
        <table className="t">
          <thead><tr><th>{t('champs.reference')}</th><th>{t('champs.incoterm')}</th><th>{t('devis.inspections')}</th><th className="num">{t('devis.commission_totale')}</th><th>{t('champs.statut')}</th><th>{t('devis.mandat')}</th><th /></tr></thead>
          <tbody>{(l.data ?? []).map((d) => (
            <tr key={d.id}>
              <td className="ref">{d.reference}</td>
              <td>{d.incoterm}</td>
              <td className="sec">{t('devis.jours_inspection', { p: d.jours_inspection_production, e: d.jours_inspection_expedition })}</td>
              <td className="num">{montant(d.commission_ht, 'XOF', langue)}</td>
              <td><Statut statut={d.statut} libelle={t(`statuts_devis.${d.statut}`)} /></td>
              <td className="ref">{d.mandat_valide_le ? date(d.accepte_le, langue) : '—'}</td>
              <td className="num"><span className="actions" style={{ justifyContent: 'flex-end' }}>
                {peut && d.statut === 'brouillon' && <><Bouton petit onClick={() => void calculer(d)}>{t('devis.calculer')}</Bouton><Bouton petit onClick={() => void envoyer(d)}>{t('devis.envoyer')}</Bouton></>}
                {role === 'admin' && d.statut === 'envoye' && <Bouton petit variante="primaire" onClick={() => setMandat(d)}>{t('devis.valider_mandat')}</Bouton>}
              </span></td>
            </tr>))}
          </tbody>
        </table>
      )}
      {dossier.modele === 'equipement_site' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="section-titre">{t('devis.echeancier')} · {montant(dossier.forfait_projet_ht, 'XOF', langue)}</div>
          <Echeancier dossierId={dossier.id} lignes={ech.data ?? []} onChange={() => void ech.recharger()} onFacturer={facturerEcheance} />
        </section>
      )}
      {mandat && (
        <Tiroir titre={t('devis.valider_mandat')} onClose={() => setMandat(null)}>
          <p className="sec">{t('devis.mandat_texte')}</p>
          <Champ label={t('devis.date_signature')}><input type="date" value={signeLe} onChange={(e) => setSigneLe(e.target.value)} /></Champ>
          <Champ label={t('devis.document_signe')}><Depot dossierId={dossier.id} valeur={doc || null} onChange={setDoc} /></Champ>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <Bouton variante="primaire" disabled={a.enCours} onClick={() => void valider()}>{t('commun.valider')}</Bouton>
        </Tiroir>
      )}
    </div>
  );
}

function Echeancier({ dossierId, lignes, onChange, onFacturer }: { dossierId: string; lignes: { id: string; ordre: number; libelle: string; montant_ht: number; facture_id: string | null }[]; onChange: () => void; onFacturer: (o: number) => void }) {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const [lib, setLib] = useState('');
  const [mt, setMt] = useState('');
  const a = useAction();
  const peut = ['admin', 'hub_afrique'].includes(profil?.role ?? '');
  const ajouter = async () => {
    const v = z.object({ libelle: z.string().trim().min(2).max(200), montant_ht: z.number().int().positive().max(1e12) }).safeParse({ libelle: lib, montant_ht: Number(mt.replace(/\s/g, '')) });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    const ordre = (lignes.at(-1)?.ordre ?? 0) + 1;
    if (await a.executer(async () => ok(await supabase.from('echeances_projet').insert({ dossier_id: dossierId, ordre, ...v.data })))) { setLib(''); setMt(''); onChange(); }
  };
  return (
    <>
      <table className="t"><thead><tr><th>#</th><th>{t('champs.etape')}</th><th className="num">{t('champs.montant_ht')}</th><th>{t('champs.statut')}</th><th /></tr></thead>
        <tbody>{lignes.map((e) => (
          <tr key={e.id}><td>{e.ordre}</td><td>{e.libelle}</td><td className="num">{montant(e.montant_ht, 'XOF', langue)}</td>
            <td>{e.facture_id ? <Statut statut="emise" libelle={t('devis.facturee')} /> : <Statut statut="brouillon" libelle={t('devis.a_facturer')} />}</td>
            <td className="num">{peut && !e.facture_id && <Bouton petit onClick={() => onFacturer(e.ordre)}>{t('devis.facturer')}</Bouton>}</td></tr>))}
        </tbody></table>
      {peut && <div className="grille3" style={{ alignItems: 'end' }}>
        <Champ label={t('champs.etape')}><input value={lib} maxLength={200} onChange={(e) => setLib(e.target.value)} /></Champ>
        <Champ label={t('champs.montant_ht')}><input inputMode="numeric" value={mt} onChange={(e) => setMt(e.target.value)} /></Champ>
        <Bouton onClick={() => void ajouter()}>{t('commun.ajouter')}</Bouton>
      </div>}
      <Bandeau type="err">{a.erreur}</Bandeau>
    </>
  );
}

function CommandesDossier({ dossier }: { dossier: Dossier }) {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const hub = profil?.role === 'hub_afrique';
  const fournisseurs = useNoms('fournisseurs');
  const l = useAsync(async () => {
    if (hub) return ok(await supabase.rpc('dossier_fob', { p_dossier: dossier.id })) as { commande: string; devise: string; fob_montant: number; statut: string }[];
    return ok(await supabase.from('commandes').select('*').eq('dossier_id', dossier.id).order('reference')) as Commande[];
  }, [dossier.id, hub]);
  if (l.erreur) return <Bandeau type="err">{l.erreur}</Bandeau>;
  const rows = (l.data ?? []) as (Commande | { commande: string; devise: string; fob_montant: number; statut: string })[];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!hub && ['admin', 'achats_chine'].includes(profil?.role ?? '') && dossier.mode_financier !== 'service_seul' &&
        <div className="actions"><Link className="btn primaire" to={`/commandes?dossier=${dossier.id}`}>{t('commandes.nouvelle')}</Link></div>}
      {rows.length === 0 ? <Vide>{t('commandes.aucune')}</Vide> : (
        <table className="t"><thead><tr><th>{t('champs.reference')}</th>{!hub && <th>{t('champs.fournisseur')}</th>}<th className="num">{t('champs.fob')}</th><th>{t('champs.statut')}</th></tr></thead>
          <tbody>{rows.map((c) => 'id' in c ? (
            <tr key={c.id}><td className="ref"><Link to={`/commandes/${c.id}`}>{c.reference}</Link></td><td>{fournisseurs[c.fournisseur_id]}</td>
              <td className="num">{montant(c.fob_montant, c.devise, langue)}</td><td><Statut statut={c.statut} libelle={t(`statuts_commande.${c.statut}`)} /></td></tr>
          ) : (
            <tr key={c.commande}><td className="ref">{c.commande}</td><td className="num">{montant(c.fob_montant, c.devise, langue)}</td>
              <td><Statut statut={c.statut} libelle={t(`statuts_commande.${c.statut}`)} /></td></tr>
          ))}</tbody></table>
      )}
    </div>
  );
}

function JournalDossier({ dossierId }: { dossierId: string }) {
  const { t } = useTranslation();
  const { langue, fuseau } = useAuth();
  const profils = useNoms('profils');
  const l = useAsync(async () => ok(await supabase.from('journal_audit').select('id, horodatage, utilisateur, action, table_nom, ligne_id, motif')
    .eq('dossier_id', dossierId).order('id', { ascending: false }).limit(300)) as Audit[], [dossierId]);
  if (l.erreur) return <Bandeau type="err">{l.erreur}</Bandeau>;
  return (
    <table className="t"><thead><tr><th>{t('champs.horodatage')}</th><th>{t('champs.utilisateur')}</th><th>{t('champs.action')}</th><th>{t('champs.objet')}</th><th>{t('champs.motif')}</th></tr></thead>
      <tbody>{(l.data ?? []).map((j) => (
        <tr key={j.id}><td className="ref">{dateHeure(j.horodatage, langue, fuseau)}</td><td>{j.utilisateur ? profils[j.utilisateur] ?? '…' : t('journal.systeme')}</td>
          <td className="sec">{t(`journal.actions.${j.action}`, { defaultValue: j.action })}</td><td className="sec">{t(`tables.${j.table_nom}`, { defaultValue: j.table_nom })}</td><td>{j.motif ?? ''}</td></tr>))}
      </tbody></table>
  );
}
