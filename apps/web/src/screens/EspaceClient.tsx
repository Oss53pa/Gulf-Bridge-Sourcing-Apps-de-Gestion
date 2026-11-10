// Portail client avec compte (maquette « Espace client »), première tranche en lecture :
// accueil, dossier, expédition, documents, factures. Le contenu vient de la base (même règle que la page
// de suivi par lien) ; aucune table interne n'est lue directement par un compte client.
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { ok, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, montant } from '../lib/format';
import { deposerPieceClient, FichierRefuse, urlSignee } from '../lib/fichiers';
import { Bandeau, Bouton, Champ, Chargement, Statut, Tiroir, Vide } from '../components/ui';
import { MessagerieVue } from './Messagerie';
import { Jauge, Vignettes } from './Avancement';
import { ReceptionsClient } from './ReceptionSite';
import { BesoinsClient } from './Besoin';
import { z } from 'zod';
import { useAction } from '../lib/data';

interface DossierListe { id: string; reference: string; intitule: string; statut: string; phase_courante: string | null; date_ouverture_site: string | null;
  chef: { nom: string; telephone: string | null } | null }
interface Espace { utilisateur: { nom: string; sous_role: string }; client: { raison_sociale: string }; dossiers: DossierListe[] }
interface Contenu {
  dossier: { reference: string; intitule: string; statut: string; phase_courante: string | null };
  ouverture: { date: string; fin_projetee: string | null; marge_jours_ouvres: number | null } | null;
  phases: { phase: string; ordre: number; statut: 'terminee' | 'en_cours' | 'a_venir'; debut: string | null; fin: string | null; fin_prevue: string | null }[];
  pieces_attendues: { libelle: string; phase: string; statut: string; demandee_le: string | null }[];
  documents: { libelle: string; phase: string; chemin: string; date: string | null }[];
  points_bloquants: { description: string; partie: string; impact_jours: number; resolu: boolean; echeance: string | null }[];
  expeditions: { reference: string; mode: string; statut: string; port_arrivee: string | null; etd: string | null; eta: string | null;
    etapes: { etape: string; lieu: string | null; survenue_le: string; commentaire: string | null }[] }[];
  production: {
    commandes: { reference: string; statut: string; fabricant: string | null; produits: { designation: string; quantite: number }[];
      avancement: { pct: number; le: string } | null; photos: { chemin: string; le: string }[] }[];
    inspections: { reference: string | null; type: string; produit: string | null; date_prevue: string | null; date_realisee: string | null; statut: string;
      decision: string | null; defauts: { critiques: number; majeurs: number; mineurs: number } | null }[];
    non_conformites: { reference: string | null; gravite: string; libelle: string; statut: string; delai: string | null }[];
  };
  depots: { id: string; libelle: string; phase: string; statut: string }[];
  reglements: { facture_id: string; numero: string | null; devise: string; reste: number; echeance: string | null;
    coordonnees: { titulaire: string; banque: string; numero: string } | null; annonce: { reference: string; statut: string; le: string } | null }[];
  factures: { numero: string | null; objet: string; type: string; date_emission: string | null; echeance: string | null; devise: string; ttc: number; net_a_payer: number; encaisse: number; statut: string }[];
}
type Vue = 'accueil' | 'dossier' | 'besoin' | 'production' | 'expedition' | 'documents' | 'factures' | 'messagerie' | 'demande';
const VUES: Vue[] = ['accueil', 'dossier', 'besoin', 'production', 'expedition', 'documents', 'factures', 'messagerie', 'demande'];

export function EspaceClient() {
  const { t } = useTranslation();
  const { langue, deconnexion } = useAuth();
  const e = useAsync(async () => ok(await supabase.rpc('espace_client')) as Espace, []);
  const [sel, setSel] = useState<string | null>(null);
  const [vue, setVue] = useState<Vue>('accueil');
  const [regler, setRegler] = useState<Contenu['reglements'][number] | null>(null);
  const nonLus = useAsync(async () => ok(await supabase.rpc('messages_non_lus')) as number, [vue]);
  const d = (e.data?.dossiers ?? []).find((x) => x.id === sel) ?? e.data?.dossiers[0] ?? null;
  const c = useAsync(async () => (d ? ok(await supabase.rpc('espace_client_dossier', { p_dossier: d.id })) as Contenu : null), [d?.id]);
  const x = c.data;
  // Questions de l'équipe en attente de réponse sur le besoin (sous-rôle finance exclu par la base).
  const besoins = useAsync(async () => (d && e.data?.utilisateur.sous_role !== 'finance'
    ? ok(await supabase.rpc('besoins_client', { p_dossier: d.id })) as { questions_ouvertes: number }[] : []), [d?.id, vue]);
  const questionsBesoin = (besoins.data ?? []).reduce((n, b) => n + Number(b.questions_ouvertes ?? 0), 0);
  const ouvrir = async (chemin: string) => { const u = await urlSignee(chemin); if (u) window.open(u, '_blank', 'noopener,noreferrer'); };
  const joursAvant = x?.ouverture ? Math.round((Date.parse(x.ouverture.date) - Date.parse(new Date().toISOString().slice(0, 10))) / 86400000) : null;
  const actions = (x?.pieces_attendues ?? []).filter((p) => p.statut !== 'recue' && p.statut !== 'validee');
  return (
    <div className="app ecl">
      <header className="topbar ecl-tete">
        <span className="ecl-marque"><b>{e.data?.client.raison_sociale ?? '…'}</b>{d && <span className="mute"> · {d.reference}</span>}</span>
        <span className="actions">
          {(e.data?.dossiers.length ?? 0) > 1 && <select aria-label={t('portail.dossier')} value={d?.id ?? ''} onChange={(v) => setSel(v.target.value)}>
            {(e.data?.dossiers ?? []).map((y) => <option key={y.id} value={y.id}>{y.reference} · {y.intitule}</option>)}</select>}
          <Bouton petit onClick={() => void deconnexion()}>{t('coque.deconnexion')}</Bouton>
        </span>
      </header>
      <nav className="ecl-nav" aria-label={t('portail.navigation')}>
        {VUES.filter((v) => v !== 'besoin' || e.data?.utilisateur.sous_role !== 'finance').map((v) => <button key={v} type="button" aria-current={vue === v ? 'page' : undefined} onClick={() => setVue(v)}>
          {t(`portail.vues.${v}`)}{v === 'accueil' && actions.length > 0 && <span className="badge">{actions.length}</span>}{v === 'messagerie' && (nonLus.data ?? 0) > 0 && <span className="badge">{nonLus.data}</span>}{v === 'besoin' && questionsBesoin > 0 && <span className="badge">{questionsBesoin}</span>}</button>)}
      </nav>
      <main className="screen ecl-main">
        <Bandeau type="err">{e.erreur ?? c.erreur}</Bandeau>
        {vue === 'demande' ? <NouvelleDemande />
          : vue === 'messagerie' && e.data ? <MessagerieVue avecEntete={false} nouveau={{ audiences: ['client'], dossiers: e.data.dossiers.map((y) => ({ id: y.id, libelle: `${y.reference} · ${y.intitule}` })) }} />
          : e.chargement && !e.data ? <Chargement /> : !d ? <Vide>{t('portail.aucun_dossier')}</Vide> : c.chargement && !x ? <Chargement /> : x && <>
          {vue === 'accueil' && <>
            <div className="surtitre">{x.dossier.intitule}</div>
            <h1 className="ecl-titre">{t('portail.bonjour', { nom: e.data!.utilisateur.nom })}{actions.length > 0 ? t('portail.actions_attendent', { n: actions.length }) : ''}</h1>
            {x.ouverture && <div className="ref-chiffres ecl-chiffres">
              <div><span>{t('portail.avant_ouverture', { d: date(x.ouverture.date, langue) })}</span><b>{joursAvant}</b></div>
              <div><span>{t('portail.marge_planning')}</span><b className={(x.ouverture.marge_jours_ouvres ?? 0) < 0 ? 'txt-err' : ''}>{x.ouverture.marge_jours_ouvres ?? '—'}</b></div>
            </div>}
            <Frise phases={x.phases} />
            <div className="ecl-grille">
              <section className="ecl-bloc">
                <div className="surtitre">{t('portail.actions')}</div>
                {actions.length === 0 ? <span className="mute">{t('portail.aucune_action')}</span> : actions.map((p, i) => (
                  <div key={p.libelle + i} className="grl-regle"><span><b>{String(i + 1).padStart(2, '0')} · {p.libelle}</b>
                    <span className="mute">{p.demandee_le ? t('portail.demandee_le', { d: date(p.demandee_le, langue) }) : t(`phases.${p.phase}`, { defaultValue: p.phase })}</span></span>
                    <span className="actions"><Statut statut={p.statut === 'refusee' || p.statut === 'expiree' ? 'err' : 'att'} libelle={t(`portail.pieces.${p.statut}`, { defaultValue: p.statut })} />
                      {(() => { const dp = (x.depots ?? []).find((y) => y.phase === p.phase && y.libelle === p.libelle); return dp ? <Transmettre pieceId={dp.id} onFait={() => void c.recharger()} /> : null; })()}</span></div>))}
                {actions.length > 0 && <span className="mute">{t('portail.transmettre')}</span>}
                {x.points_bloquants.filter((b) => !b.resolu).map((b) => <Bandeau key={b.description} type="err">{b.description}</Bandeau>)}
              </section>
              <aside className="exp-aside">
                {d.chef && <section><div className="surtitre">{t('portail.chef')}</div><b className="liv-client">{d.chef.nom}</b>
                  {d.chef.telephone && <a href={`tel:${d.chef.telephone.replace(/[^\d+]/g, '')}`}>{d.chef.telephone}</a>}</section>}
                <section><div className="surtitre">{t('portail.derniers_documents')}</div>
                  {x.documents.length === 0 ? <span className="mute">{t('portail.aucun_document')}</span> : [...x.documents].reverse().slice(0, 3).map((y) => (
                    <div key={y.chemin} className="grl-regle"><span>{y.libelle}<span className="mute">{y.date ? date(y.date, langue) : ''}</span></span>
                      <button type="button" className="lien" onClick={() => void ouvrir(y.chemin)}>PDF</button></div>))}
                  <Bouton petit onClick={() => setVue('documents')}>{t('portail.tous_documents')}</Bouton></section>
              </aside>
            </div>
          </>}
          {vue === 'dossier' && <>
            <div className="surtitre">{x.dossier.reference}{x.ouverture ? ` · ${t('portail.ouverture_le', { d: date(x.ouverture.date, langue) })}` : ''}</div>
            <h1 className="ecl-titre">{x.dossier.intitule}</h1>
            <Frise phases={x.phases} />
            <table className="t"><thead><tr><th>{t('portail.etape')}</th><th>{t('portail.debut')}</th><th>{t('portail.fin')}</th><th>{t('champs.statut')}</th></tr></thead>
              <tbody>{x.phases.map((p) => <tr key={p.phase}><td>{String(p.ordre).padStart(2, '0')} · {t(`phases.${p.phase}`, { defaultValue: p.phase })}</td>
                <td className="ref">{p.debut ? date(p.debut, langue) : '—'}</td><td className="ref">{p.fin ? date(p.fin, langue) : p.fin_prevue ? t('portail.prevue', { d: date(p.fin_prevue, langue) }) : '—'}</td>
                <td><Statut statut={p.statut === 'terminee' ? 'ok' : p.statut === 'en_cours' ? 'info' : 'neutre'} libelle={t(`portail.statuts_phase.${p.statut}`)} /></td></tr>)}</tbody></table>
          </>}
          {vue === 'besoin' && <BesoinsClient dossierId={d.id} />}
          {vue === 'production' && <>
            <h1 className="ecl-titre">{t('portail.vues.production')}</h1>
            <p className="sec">{t('portail.aide_production')}</p>
            <div className="surtitre">{t('portail.commandes')}</div>
            {x.production.commandes.length === 0 ? <Vide>{t('portail.aucune_commande')}</Vide> : x.production.commandes.map((k) => (
              <section key={k.reference} className="ecl-bloc">
                <div className="liv-pv"><b className="ref">{k.reference}{k.fabricant ? <span className="mute"> · {k.fabricant}</span> : null}</b>
                  <Statut statut={['livree', 'expediee', 'production_terminee'].includes(k.statut) ? 'ok' : 'info'} libelle={t(`statuts_commande.${k.statut}`, { defaultValue: k.statut })} /></div>
                <table className="t"><tbody>{k.produits.map((l, i) => <tr key={i}><td>{l.designation}</td><td className="num">{Number(l.quantite)}</td></tr>)}</tbody></table>
                {k.avancement && <div className="liv-pv"><Jauge pct={k.avancement.pct} /><span className="mute">{t('avancement.au', { d: date(k.avancement.le, langue) })}</span></div>}
                <Vignettes chemins={(k.photos ?? []).slice(0, 12).map((ph) => ph.chemin)} />
              </section>))}
            <div className="surtitre">{t('portail.inspections')}</div>
            {x.production.inspections.length === 0 ? <Vide>{t('portail.aucune_inspection')}</Vide> : (
              <table className="t"><thead><tr><th>{t('portail.inspection')}</th><th>{t('portail.date')}</th><th>{t('portail.resultat')}</th><th>{t('champs.statut')}</th></tr></thead>
                <tbody>{x.production.inspections.map((i, n) => <tr key={(i.reference ?? '') + n}>
                  <td>{t(`types_inspection.${i.type}`, { defaultValue: i.type })}<div className="mute ref">{[i.reference, i.produit].filter(Boolean).join(' · ')}</div></td>
                  <td className="ref">{i.date_realisee ? date(i.date_realisee, langue) : i.date_prevue ? t('portail.prevue', { d: date(i.date_prevue, langue) }) : '—'}</td>
                  <td>{i.decision ? <>{t(`decisions.${i.decision}`, { defaultValue: i.decision })}{i.defauts && <div className="mute">{t('portail.defauts', { c: i.defauts.critiques, ma: i.defauts.majeurs, mi: i.defauts.mineurs })}</div>}</> : <span className="mute">—</span>}</td>
                  <td><Statut statut={i.statut === 'validee' ? (i.decision === 'refus' ? 'err' : 'ok') : i.statut === 'refusee' ? 'err' : i.statut === 'realisee' ? 'att' : 'neutre'} libelle={t(`statuts_inspection.${i.statut}`, { defaultValue: i.statut })} /></td></tr>)}</tbody></table>)}
            <div className="surtitre">{t('portail.non_conformites')}</div>
            {x.production.non_conformites.length === 0 ? <Vide>{t('portail.aucune_nc')}</Vide> : (
              <table className="t"><tbody>{x.production.non_conformites.map((nc, n) => <tr key={(nc.reference ?? '') + n}>
                <td><Statut statut={nc.gravite === 'critique' ? 'err' : nc.gravite === 'majeur' ? 'att' : 'neutre'} libelle={t(`gravites.${nc.gravite}`)} /></td>
                <td>{nc.libelle}<div className="mute ref">{nc.reference ?? ''}</div></td>
                <td className="ref">{nc.delai ? date(nc.delai, langue) : '—'}</td>
                <td><Statut statut={nc.statut === 'ouverte' ? 'att' : 'ok'} libelle={t(`statuts_nc.${nc.statut}`)} /></td></tr>)}</tbody></table>)}
          </>}
          {vue === 'expedition' && <>
            <h1 className="ecl-titre">{t('portail.vues.expedition')}</h1>
            <ReceptionsClient dossierId={d.id} />
            {x.expeditions.length === 0 ? <Vide>{t('portail.aucune_expedition')}</Vide> : x.expeditions.map((y) => (
              <section key={y.reference} className="ecl-bloc">
                <div className="liv-pv"><b>{y.reference}{y.port_arrivee ? ` · ${y.port_arrivee}` : ''}</b><Statut statut="info" libelle={t(`statuts_exp.${y.statut}`)} /></div>
                <span className="sec">{t('portail.depart_arrivee', { d: y.etd ? date(y.etd, langue) : '—', a: y.eta ? date(y.eta, langue) : '—' })}</span>
                {y.etapes.map((s) => <div key={s.survenue_le + s.etape} className="exp-jrn"><span className="mute">{date(s.survenue_le, langue)}</span>
                  <span>{t(`etapes.${s.etape}`)}{s.lieu ? ` · ${s.lieu}` : ''}</span>{s.commentaire && <span className="sec">{s.commentaire}</span>}</div>)}
              </section>))}
          </>}
          {vue === 'documents' && <>
            <h1 className="ecl-titre">{t('portail.vues.documents')}</h1>
            <p className="sec">{t('portail.aide_documents')}</p>
            {x.documents.length === 0 ? <Vide>{t('portail.aucun_document')}</Vide> : (
              <table className="t"><tbody>{[...x.documents].reverse().map((y) => (
                <tr key={y.chemin}><td>{y.libelle}<div className="mute">{t(`phases.${y.phase}`, { defaultValue: y.phase })}</div></td><td className="ref">{y.date ? date(y.date, langue) : '—'}</td>
                  <td className="num"><Bouton petit onClick={() => void ouvrir(y.chemin)}>PDF</Bouton></td></tr>))}</tbody></table>)}
          </>}
          {vue === 'factures' && <>
            <div className="surtitre">{t('portail.transparence')}</div>
            <h1 className="ecl-titre">{t('portail.vues.factures')}</h1>
            <p className="sec">{t('portail.aide_factures')}</p>
            {(x.reglements ?? []).map((r) => (
              <div key={r.facture_id} className="grl-regle"><span><b>{t('virements.a_regler', { n: r.numero ?? '' })}</b>
                <span className="mute">{montant(Number(r.reste), r.devise, langue)}{r.annonce ? ` · ${t('virements.annonce_le', { d: date(r.annonce.le, langue), ref: r.annonce.reference })}` : ''}</span></span>
                <span className="actions">{r.annonce && <Statut statut={r.annonce.statut === 'rapprochee' ? 'ok' : r.annonce.statut === 'sans_suite' ? 'neutre' : 'att'} libelle={t(`virements.statuts.${r.annonce.statut}`)} />}
                  {r.annonce?.statut !== 'annoncee' && <Bouton petit onClick={() => setRegler(r)}>{t('virements.regler')}</Bouton>}</span></div>))}
            {x.factures.length === 0 ? <Vide>{t('portail.aucune_facture')}</Vide> : (
              <table className="t"><thead><tr><th>{t('portail.facture')}</th><th>{t('portail.echeance')}</th><th className="num">{t('portail.montant')}</th><th className="num">{t('portail.reste')}</th><th>{t('champs.statut')}</th></tr></thead>
                <tbody>{x.factures.map((f, i) => { const reste = Number(f.net_a_payer) - Number(f.encaisse); return (
                  <tr key={(f.numero ?? '') + i}><td>{f.objet}<div className="mute ref">{f.numero ?? ''}</div></td><td className="ref">{f.echeance ? date(f.echeance, langue) : '—'}</td>
                    <td className="num">{montant(Number(f.net_a_payer), f.devise, langue)}</td><td className="num">{montant(reste, f.devise, langue)}</td>
                    <td><Statut statut={f.statut === 'payee' ? 'ok' : f.echeance && f.echeance < new Date().toISOString().slice(0, 10) ? 'err' : 'att'} libelle={t(`portail.statuts_facture.${f.statut}`, { defaultValue: f.statut })} /></td></tr>); })}</tbody></table>)}
          </>}
        </>}
        {regler && <Regler r={regler} onClose={() => setRegler(null)} onFait={() => { setRegler(null); void c.recharger(); }} />}
      </main>
    </div>
  );
}

/** Transmission d'une pièce attendue : fichier contrôlé côté serveur, la pièce passe « reçue ». */
function Transmettre({ pieceId, onFait }: { pieceId: string; onFait: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  const [etat, setEtat] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const surFichier = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setEnvoi(true); setEtat(null);
    try { await deposerPieceClient(pieceId, f); onFait(); }
    catch (err) {
      const code = err instanceof FichierRefuse ? (err.message === 'type' ? 'GBS_FICHIER_TYPE' : 'GBS_FICHIER_TAILLE') : String((err as Error).message ?? '');
      setEtat(t(`erreurs.${code}`, { defaultValue: t('erreurs.generique') }));
    } finally { setEnvoi(false); }
  };
  return (<>
    <input ref={ref} type="file" hidden accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => void surFichier(e)} />
    <Bouton petit disabled={envoi} onClick={() => ref.current?.click()}>{envoi ? t('depot.envoi') : t('portail.transmettre_piece')}</Bouton>
    {etat && <span className="txt-err">{etat}</span>}
  </>);
}

/** Régler une facture : coordonnées issues de la base (jamais d'un courriel), puis annonce du virement. */
function Regler({ r, onClose, onFait }: { r: Contenu['reglements'][number]; onClose: () => void; onFait: () => void }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const a = useAction();
  const [f, setF] = useState({ reference: '', date_virement: '' });
  const envoyer = async () => {
    const v = z.object({ reference: z.string().trim().regex(/^[A-Za-z0-9 ./_-]{3,80}$/), date_virement: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }).strict()
      .safeParse({ reference: f.reference.trim(), date_virement: f.date_virement || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('annoncer_virement', { p_facture: r.facture_id, p: v.data })))) onFait();
  };
  return (
    <Tiroir titre={t('virements.titre', { n: r.numero ?? '' })} onClose={onClose}>
      <Bandeau type="err">{t('virements.alerte_fraude')}</Bandeau>
      {r.coordonnees ? <dl className="dl">
        <dt>{t('virements.titulaire')}</dt><dd>{r.coordonnees.titulaire}</dd>
        <dt>{t('virements.banque')}</dt><dd>{r.coordonnees.banque}</dd>
        <dt>{t('virements.compte')}</dt><dd className="ref">{r.coordonnees.numero}</dd>
        <dt>{t('virements.reference_a_porter')}</dt><dd className="ref">{r.numero}</dd>
        <dt>{t('portail.reste')}</dt><dd>{montant(Number(r.reste), r.devise, langue)}</dd>
      </dl> : <Bandeau>{t('virements.sans_coordonnees')}</Bandeau>}
      <div className="grille2">
        <Champ label={t('virements.votre_reference')}><input value={f.reference} maxLength={80} placeholder="VIR 091026 8812" onChange={(e) => setF({ ...f, reference: e.target.value })} /></Champ>
        <Champ label={t('virements.date')}><input type="date" max={new Date().toISOString().slice(0, 10)} value={f.date_virement} onChange={(e) => setF({ ...f, date_virement: e.target.value })} /></Champ>
      </div>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours || !r.coordonnees} onClick={() => void envoyer()}>{t('virements.j_ai_vire')}</Bouton>
    </Tiroir>
  );
}

function Frise({ phases }: { phases: Contenu['phases'] }) {
  const { t } = useTranslation();
  return (
    <ol className="exp-frise ecl-frise">{phases.map((p) => (
      <li key={p.phase} className={p.statut === 'terminee' ? 'faite' : p.statut === 'en_cours' ? 'courante' : ''}>
        <span className="pt" /><span className="nom">{String(p.ordre).padStart(2, '0')} · {t(`phases.${p.phase}`, { defaultValue: p.phase })}</span>
        {p.statut === 'en_cours' && <span className="dt">{t('portail.en_cours')}</span>}</li>))}</ol>
  );
}

/** Nouvelle demande du client : transmise à l'équipe commerciale, qui ouvre la consultation ou répond. */
function NouvelleDemande() {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const l = useAsync(async () => ok(await supabase.from('demandes_clients').select('id, besoin, statut, motif_refus, cree_le').order('cree_le', { ascending: false }).limit(50)) as
    { id: string; besoin: string; statut: 'nouvelle' | 'convertie' | 'refusee'; motif_refus: string | null; cree_le: string }[], []);
  const a = useAction();
  const [f, setF] = useState({ besoin: '', quantite: '', ouverture_souhaitee: '' });
  const [envoyee, setEnvoyee] = useState(false);
  const envoyer = async () => {
    const v = z.object({ besoin: z.string().trim().min(10).max(4000), quantite: z.string().trim().max(120).nullable(), ouverture_souhaitee: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }).strict()
      .safeParse({ besoin: f.besoin, quantite: f.quantite.trim() || null, ouverture_souhaitee: f.ouverture_souhaitee || null });
    if (!v.success) { a.setErreur(t('portail.demande_invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('deposer_demande_client', { p: v.data })))) { setF({ besoin: '', quantite: '', ouverture_souhaitee: '' }); setEnvoyee(true); void l.recharger(); }
  };
  return (
    <div className="ecl-grille">
      <section className="ecl-bloc">
        <div className="surtitre">{t('portail.nouveau_projet')}</div>
        <h1 className="ecl-titre">{t('portail.vues.demande')}</h1>
        <p className="sec">{t('portail.aide_demande')}</p>
        <label className="champ"><span>{t('portail.besoin')}</span><textarea rows={5} maxLength={4000} value={f.besoin} onChange={(e) => setF({ ...f, besoin: e.target.value })} /></label>
        <div className="grille2">
          <label className="champ"><span>{t('portail.quantite')}</span><input maxLength={120} value={f.quantite} onChange={(e) => setF({ ...f, quantite: e.target.value })} /></label>
          <label className="champ"><span>{t('portail.ouverture_souhaitee')}</span><input type="date" value={f.ouverture_souhaitee} onChange={(e) => setF({ ...f, ouverture_souhaitee: e.target.value })} /></label>
        </div>
        {envoyee && <Bandeau type="ok">{t('portail.demande_envoyee')}</Bandeau>}
        <Bandeau type="err">{a.erreur}</Bandeau>
        <Bouton variante="primaire" disabled={a.enCours || f.besoin.trim().length < 10} onClick={() => void envoyer()}>{t('portail.envoyer_demande')}</Bouton>
      </section>
      <aside className="exp-aside">
        <section><div className="surtitre">{t('portail.ensuite')}</div>
          {[1, 2, 3].map((i) => <div key={i} className="grl-regle"><span><b>{String(i).padStart(2, '0')} · {t(`portail.etapes_demande.${i}.titre`)}</b><span className="mute">{t(`portail.etapes_demande.${i}.texte`)}</span></span></div>)}</section>
        <section><div className="surtitre">{t('portail.mes_demandes')}</div>
          {(l.data ?? []).length === 0 ? <span className="mute">—</span> : (l.data ?? []).map((d) => (
            <div key={d.id} className="grl-regle"><span>{d.besoin.slice(0, 80)}{d.besoin.length > 80 ? '…' : ''}<span className="mute">{date(d.cree_le, langue)}{d.motif_refus ? ` · ${d.motif_refus}` : ''}</span></span>
              <Statut statut={d.statut === 'convertie' ? 'ok' : d.statut === 'refusee' ? 'neutre' : 'att'} libelle={t(`portail.statuts_demande.${d.statut}`)} /></div>))}</section>
      </aside>
    </div>
  );
}
