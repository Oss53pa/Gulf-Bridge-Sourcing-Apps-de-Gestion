// Portail client avec compte (maquette « Espace client »), première tranche en lecture :
// accueil, dossier, expédition, documents, factures. Le contenu vient de la base (même règle que la page
// de suivi par lien) ; aucune table interne n'est lue directement par un compte client.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { ok, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, montant } from '../lib/format';
import { urlSignee } from '../lib/fichiers';
import { Bandeau, Bouton, Chargement, Statut, Vide } from '../components/ui';

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
  factures: { numero: string | null; objet: string; type: string; date_emission: string | null; echeance: string | null; devise: string; ttc: number; net_a_payer: number; encaisse: number; statut: string }[];
}
type Vue = 'accueil' | 'dossier' | 'expedition' | 'documents' | 'factures';
const VUES: Vue[] = ['accueil', 'dossier', 'expedition', 'documents', 'factures'];

export function EspaceClient() {
  const { t } = useTranslation();
  const { langue, deconnexion } = useAuth();
  const e = useAsync(async () => ok(await supabase.rpc('espace_client')) as Espace, []);
  const [sel, setSel] = useState<string | null>(null);
  const [vue, setVue] = useState<Vue>('accueil');
  const d = (e.data?.dossiers ?? []).find((x) => x.id === sel) ?? e.data?.dossiers[0] ?? null;
  const c = useAsync(async () => (d ? ok(await supabase.rpc('espace_client_dossier', { p_dossier: d.id })) as Contenu : null), [d?.id]);
  const x = c.data;
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
        {VUES.map((v) => <button key={v} type="button" aria-current={vue === v ? 'page' : undefined} onClick={() => setVue(v)}>
          {t(`portail.vues.${v}`)}{v === 'accueil' && actions.length > 0 && <span className="badge">{actions.length}</span>}</button>)}
      </nav>
      <main className="screen ecl-main">
        <Bandeau type="err">{e.erreur ?? c.erreur}</Bandeau>
        {e.chargement && !e.data ? <Chargement /> : !d ? <Vide>{t('portail.aucun_dossier')}</Vide> : c.chargement && !x ? <Chargement /> : x && <>
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
                    <Statut statut={p.statut === 'refusee' || p.statut === 'expiree' ? 'err' : 'att'} libelle={t(`portail.pieces.${p.statut}`, { defaultValue: p.statut })} /></div>))}
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
          {vue === 'expedition' && <>
            <h1 className="ecl-titre">{t('portail.vues.expedition')}</h1>
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
            {x.factures.length === 0 ? <Vide>{t('portail.aucune_facture')}</Vide> : (
              <table className="t"><thead><tr><th>{t('portail.facture')}</th><th>{t('portail.echeance')}</th><th className="num">{t('portail.montant')}</th><th className="num">{t('portail.reste')}</th><th>{t('champs.statut')}</th></tr></thead>
                <tbody>{x.factures.map((f, i) => { const reste = Number(f.net_a_payer) - Number(f.encaisse); return (
                  <tr key={(f.numero ?? '') + i}><td>{f.objet}<div className="mute ref">{f.numero ?? ''}</div></td><td className="ref">{f.echeance ? date(f.echeance, langue) : '—'}</td>
                    <td className="num">{montant(Number(f.net_a_payer), f.devise, langue)}</td><td className="num">{montant(reste, f.devise, langue)}</td>
                    <td><Statut statut={f.statut === 'payee' ? 'ok' : f.echeance && f.echeance < new Date().toISOString().slice(0, 10) ? 'err' : 'att'} libelle={t(`portail.statuts_facture.${f.statut}`, { defaultValue: f.statut })} /></td></tr>); })}</tbody></table>)}
          </>}
        </>}
      </main>
    </div>
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
