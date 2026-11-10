// Lot 1, M14 niveau 1 : page de suivi du client (publique, lecture seule) et
// gestion des liens par l'équipe. Le jeton est placé après « # » : le navigateur
// ne l'envoie ni au serveur web, ni dans l'en-tête Referer.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, dateHeure, montant } from '../lib/format';
import type { Dossier } from '../lib/types';
import { Bandeau, Bouton, Champ, Chargement, Statut, Tiroir, Vide } from '../components/ui';

type Langue = 'fr' | 'en' | 'zh';
interface DonneesSuivi {
  dossier: { reference: string; intitule: string; modele: string; statut: string; phase_courante: string; ouvert_le: string };
  client: { raison_sociale: string; langue: Langue };
  expire_le: string;
  ouverture: { date: string; fin_projetee: string | null; marge_jours_ouvres: number | null } | null;
  phases: { phase: string; ordre: number; statut: 'terminee' | 'en_cours' | 'a_venir'; debut: string | null; fin: string | null; fin_prevue: string | null }[];
  pieces_attendues: { libelle: string; phase: string; statut: string; demandee_le: string | null }[];
  documents: { libelle: string; phase: string; date: string | null; url: string }[];
  points_bloquants: { description: string; categorie: string; partie?: string; impact_jours?: number; resolu: boolean; echeance: string }[];
  retards?: { partie: string; jours_attente: number; attente_en_cours: boolean; jours_impact: number; points_ouverts: number }[];
  expeditions: { reference: string; mode: string; statut: string; port_arrivee: string | null; etd: string | null; eta: string | null;
    etapes: { etape: string; lieu: string | null; survenue_le: string; commentaire: string | null }[] }[];
  factures: { numero: string; objet: string; type: string; date_emission: string; echeance: string | null; devise: string;
    ttc: number; net_a_payer: number; encaisse: number; statut: string }[];
}

const STATUT_PHASE = { terminee: 'ok', en_cours: 'info', a_venir: 'neutre' } as const;

/** Retards par partie prenante : jours d'attente mesurés (horloge arrêtée) et jours d'impact des points rendus visibles. */
function RetardsParPartie({ retards }: { retards: NonNullable<DonneesSuivi['retards']> }) {
  const { t } = useTranslation();
  const total = (r: (typeof retards)[number]) => r.jours_attente + r.jours_impact;
  const max = Math.max(1, ...retards.map(total));
  const somme = retards.reduce((s, r) => s + total(r), 0);
  return (
    <section className="cadre retards">
      <div className="section-titre">{t('suivi.retards_titre')}</div>
      {somme === 0 ? <p className="mute">{t('suivi.retards_aucun')}</p> : (
        <>
          <p className="sec">{t('suivi.retards_total', { n: somme })}</p>
          <div className="retards-l">
            {retards.map((r) => (
              <div key={r.partie} className="retard">
                <span className="lib"><b>{t(`suivi.parties.${r.partie}`)}</b>
                  {r.attente_en_cours && <span className="mute"> · {t('suivi.attente_en_cours')}</span>}
                  {r.points_ouverts > 0 && <span className="mute"> · {t('suivi.points_ouverts', { n: r.points_ouverts })}</span>}</span>
                <span className="piste" aria-hidden="true">
                  <span className="attente" style={{ width: `${(r.jours_attente / max) * 100}%` }} />
                  <span className="impact" style={{ width: `${(r.jours_impact / max) * 100}%` }} />
                </span>
                <span className="num">{total(r) ? t('suivi.jours', { n: total(r) }) : '—'}</span>
              </div>
            ))}
          </div>
          <p className="mute"><span className="pastille-l attente" /> {t('suivi.legende_attente')} · <span className="pastille-l impact" /> {t('suivi.legende_impact')}</p>
        </>
      )}
    </section>
  );
}

export function PageSuivi() {
  const { t, i18n } = useTranslation();
  const [donnees, setDonnees] = useState<DonneesSuivi | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const jeton = window.location.hash.replace(/^#/, '');
  const langue = (donnees?.client.langue ?? (i18n.language as Langue)) as Langue;

  useEffect(() => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(jeton)) { setErreur('GBS_LIEN_INVALIDE'); return; }
    let actif = true;
    void (async () => {
      const r = await supabase.functions.invoke('gbs-suivi', { body: { jeton } });
      if (!actif) return;
      if (r.error || !r.data || (r.data as { erreur?: string }).erreur) {
        const status = (r.error as { context?: { status?: number } } | null)?.context?.status;
        setErreur(status === 429 ? 'GBS_TROP_DE_CONSULTATIONS' : 'GBS_LIEN_INVALIDE');
        return;
      }
      const d = r.data as DonneesSuivi;
      if (['fr', 'en', 'zh'].includes(d.client.langue) && i18n.language !== d.client.langue) void i18n.changeLanguage(d.client.langue);
      setDonnees(d);
    })();
    return () => { actif = false; };
  }, [jeton, i18n]);

  if (erreur) {
    return (
      <main className="screen" style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1>{t('suivi.titre')}</h1>
        <Bandeau type="err">{t(`erreurs.${erreur}`)}</Bandeau>
        <p className="mute">{t('suivi.aide_lien')}</p>
      </main>
    );
  }
  if (!donnees) return <main className="screen"><Chargement /></main>;
  const d = donnees;
  const enCours = d.phases.find((p) => p.statut === 'en_cours');
  return (
    <main className="screen" style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header>
        <div className="surtitre">{t('suivi.surtitre', { client: d.client.raison_sociale })}</div>
        <h1>{d.dossier.reference} — {d.dossier.intitule}</h1>
        <p className="mute">{t('suivi.etape_en_cours', { phase: enCours ? t(`phases.${enCours.phase}`) : t(`statuts_dossier.${d.dossier.statut}`) })}</p>
      </header>

      {d.ouverture && (
        <section className="cadre">
          <div className="section-titre">{t('suivi.ouverture', { date: date(d.ouverture.date, langue) })}</div>
          {d.ouverture.marge_jours_ouvres == null ? <p className="mute">{t('suivi.ouverture_non_calculee')}</p>
            : d.ouverture.marge_jours_ouvres >= 0
              ? <Bandeau type="ok">{t('suivi.avance', { n: d.ouverture.marge_jours_ouvres })}</Bandeau>
              : <Bandeau type="err">{t('suivi.retard', { n: -d.ouverture.marge_jours_ouvres })}</Bandeau>}
        </section>
      )}

      {d.retards && <RetardsParPartie retards={d.retards} />}

      <section className="cadre">
        <div className="section-titre">{t('suivi.jalons')}</div>
        <div style={{ overflowX: 'auto' }}><table className="t"><thead><tr><th>{t('champs.phase')}</th><th>{t('champs.statut')}</th><th>{t('suivi.debut')}</th><th>{t('suivi.fin')}</th></tr></thead>
          <tbody>{d.phases.map((p) => (
            <tr key={p.phase}><td>{p.ordre}. {t(`phases.${p.phase}`)}</td>
              <td><Statut statut={STATUT_PHASE[p.statut]} libelle={t(`suivi.statut_phase.${p.statut}`)} /></td>
              <td className="ref">{p.debut ? date(p.debut, langue) : '—'}</td>
              <td className="ref">{p.fin ? date(p.fin, langue) : p.fin_prevue ? t('suivi.prevu', { date: date(p.fin_prevue, langue) }) : '—'}</td></tr>))}
          </tbody></table></div>
      </section>

      {d.points_bloquants.length > 0 && (
        <section className="cadre">
          <div className="section-titre">{t('suivi.points_attention')}</div>
          <ul>{d.points_bloquants.map((b, i) => (
            <li key={i}>{b.partie && <b>{t(`suivi.parties.${b.partie}`)} · </b>}{b.description}
              {b.impact_jours ? <span className="mute"> · {t('suivi.impact', { n: b.impact_jours })}</span> : null}
              {' — '}{b.resolu ? t('suivi.resolu') : t('suivi.echeance', { date: date(b.echeance, langue) })}</li>))}</ul>
        </section>
      )}

      <section className="cadre">
        <div className="section-titre">{t('suivi.pieces_attendues')}</div>
        {d.pieces_attendues.length === 0 ? <Vide>{t('suivi.aucune_piece')}</Vide> : (
          <div style={{ overflowX: 'auto' }}><table className="t"><tbody>{d.pieces_attendues.map((p, i) => (
            <tr key={i}><td>{p.libelle}</td><td><Statut statut={p.statut === 'validee' ? 'ok' : p.statut === 'recue' ? 'info' : 'err'}
              libelle={t(`suivi.statut_piece.${p.statut}`, { defaultValue: t(`statuts_piece.${p.statut}`) })} /></td></tr>))}</tbody></table></div>
        )}
      </section>

      <section className="cadre">
        <div className="section-titre">{t('suivi.documents')}</div>
        {d.documents.length === 0 ? <Vide>{t('suivi.aucun_document')}</Vide> : (
          <ul>{d.documents.filter((x) => x.url.startsWith('https://')).map((x, i) => (
            <li key={i}><a href={x.url} target="_blank" rel="noopener noreferrer">{x.libelle}</a>
              {x.date && <span className="mute"> — {date(x.date, langue)}</span>}</li>))}</ul>
        )}
        <p className="mute">{t('suivi.liens_temporaires')}</p>
      </section>

      {d.expeditions.length > 0 && (
        <section className="cadre">
          <div className="section-titre">{t('suivi.expeditions')}</div>
          {d.expeditions.map((e) => (
            <div key={e.reference} style={{ marginBottom: 12 }}>
              <strong>{e.reference}</strong> · {t(`statuts.${e.statut}`, { defaultValue: e.statut })}
              {e.eta && <span className="mute"> · {t('suivi.eta', { date: date(e.eta, langue), port: e.port_arrivee ?? '' })}</span>}
              {e.etapes.length > 0 && <ul>{e.etapes.map((s, i) => (
                <li key={i}>{dateHeure(s.survenue_le, langue, 'UTC')} — {t(`etapes.${s.etape}`, { defaultValue: s.etape })}{s.lieu ? ` (${s.lieu})` : ''}
                  {s.commentaire ? ` : ${s.commentaire}` : ''}</li>))}</ul>}
            </div>
          ))}
        </section>
      )}

      <section className="cadre">
        <div className="section-titre">{t('suivi.honoraires')}</div>
        {d.factures.length === 0 ? <Vide>{t('suivi.aucune_facture')}</Vide> : (
          <div style={{ overflowX: 'auto' }}><table className="t"><thead><tr><th>{t('suivi.facture')}</th><th>{t('suivi.objet')}</th><th>{t('suivi.date')}</th>
            <th className="num">{t('suivi.montant')}</th><th className="num">{t('suivi.reste')}</th></tr></thead>
            <tbody>{d.factures.map((f) => (
              <tr key={f.numero}><td className="ref">{f.numero}</td><td>{f.objet}</td><td className="ref">{date(f.date_emission, langue)}</td>
                <td className="num">{montant(f.ttc, f.devise, langue)}</td>
                <td className="num">{montant(Math.max(Number(f.net_a_payer) - Number(f.encaisse), 0), f.devise, langue)}</td></tr>))}</tbody></table></div>
        )}
      </section>
      <p className="mute">{t('suivi.validite', { date: date(d.expire_le, langue) })}</p>
    </main>
  );
}

// ----------------------------------------------------------------------------- équipe
interface LienSuivi { id: string; destinataire: string; expire_le: string; revoque_le: string | null; cree_le: string; }

export function LiensSuivi({ dossier }: { dossier: Dossier }) {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const peutCreer = ['admin', 'hub_afrique', 'agent_pays'].includes(profil?.role ?? '') && dossier.statut === 'ouvert';
  const l = useAsync(async () => ok(await supabase.from('liens_suivi').select('id, destinataire, expire_le, revoque_le, cree_le')
    .eq('dossier_id', dossier.id).order('cree_le', { ascending: false })) as LienSuivi[], [dossier.id]);
  const consultations = useAsync(async () => ok(await supabase.from('liens_suivi_consultations').select('lien_id, consultations, derniere')) as
    { lien_id: string; consultations: number; derniere: string | null }[], [dossier.id]);
  const a = useAction();
  const [nouveau, setNouveau] = useState(false);
  const [f, setF] = useState({ destinataire: '', jours: '30' });
  const [cree, setCree] = useState<string | null>(null);
  const creer = async () => {
    const v = z.object({ p_dossier: z.string().uuid(), p_destinataire: z.string().trim().min(2).max(200), p_jours: z.coerce.number().int().min(1).max(90) })
      .strict().safeParse({ p_dossier: dossier.id, p_destinataire: f.destinataire, p_jours: f.jours });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    await a.executer(async () => {
      const r = ok(await supabase.rpc('creer_lien_suivi', v.data)) as { jeton: string };
      setCree(`${window.location.origin}/suivi#${r.jeton}`);
      void l.recharger();
    });
  };
  const revoquer = async (id: string) => {
    if (await a.executer(async () => ok(await supabase.rpc('revoquer_lien_suivi', { p_lien: id })))) void l.recharger();
  };
  const actif = (x: LienSuivi) => !x.revoque_le && new Date(x.expire_le) > new Date();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <p className="mute" style={{ margin: 0 }}>{t('suivi.aide_equipe')}</p>
        {peutCreer && <Bouton variante="primaire" onClick={() => { setNouveau(true); setCree(null); }}>{t('suivi.nouveau_lien')}</Bouton>}
      </div>
      <Bandeau type="err">{l.erreur ?? a.erreur}</Bandeau>
      {(l.data ?? []).length === 0 ? <Vide>{t('suivi.aucun_lien')}</Vide> : (
        <table className="t"><thead><tr><th>{t('suivi.destinataire')}</th><th>{t('suivi.cree_le')}</th><th>{t('suivi.expire_le')}</th>
          <th className="num">{t('suivi.consultations')}</th><th>{t('champs.statut')}</th><th /></tr></thead>
          <tbody>{(l.data ?? []).map((x) => {
            const c = consultations.data?.find((k) => k.lien_id === x.id);
            return (
              <tr key={x.id}><td>{x.destinataire}</td><td className="ref">{date(x.cree_le, langue)}</td><td className="ref">{date(x.expire_le, langue)}</td>
                <td className="num">{c?.consultations ?? 0}</td>
                <td><Statut statut={actif(x) ? 'ok' : 'neutre'} libelle={t(actif(x) ? 'suivi.actif' : x.revoque_le ? 'suivi.revoque' : 'suivi.expire')} /></td>
                <td className="num">{peutCreer && actif(x) && <Bouton petit variante="danger" disabled={a.enCours} onClick={() => void revoquer(x.id)}>{t('suivi.revoquer')}</Bouton>}</td></tr>);
          })}</tbody></table>
      )}
      {nouveau && (
        <Tiroir titre={t('suivi.nouveau_lien')} onClose={() => { setNouveau(false); setCree(null); }}>
          {cree ? (<>
            <Bandeau type="ok">{t('suivi.lien_cree')}</Bandeau>
            <Champ label={t('suivi.lien')}><input readOnly value={cree} onFocus={(e) => e.currentTarget.select()} /></Champ>
            <Bouton onClick={() => void navigator.clipboard?.writeText(cree)}>{t('suivi.copier')}</Bouton>
            <p className="mute">{t('suivi.lien_unique')}</p>
          </>) : (<>
            <Champ label={t('suivi.destinataire')}><input value={f.destinataire} maxLength={200} onChange={(e) => setF({ ...f, destinataire: e.target.value })} /></Champ>
            <Champ label={t('suivi.duree')}><input type="number" min={1} max={90} value={f.jours} onChange={(e) => setF({ ...f, jours: e.target.value })} /></Champ>
            <Bandeau type="err">{a.erreur}</Bandeau>
            <Bouton variante="primaire" disabled={a.enCours} onClick={() => void creer()}>{t('suivi.creer')}</Bouton>
          </>)}
        </Tiroir>
      )}
    </div>
  );
}
