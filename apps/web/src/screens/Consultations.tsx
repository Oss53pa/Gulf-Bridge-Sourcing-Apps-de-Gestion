// Commercial · Affaires : consultations des clients (M3, maquette « Consultations » CNS) et formulaire de demande.
// Une consultation est la phase « consultation » d'un dossier : la liste lit gbs.consultations_clients(),
// qui déduit l'étape des faits enregistrés (facture du forfait, cahier des charges, phase validée).
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { nombre } from '../lib/format';
import { normaliser } from '../lib/droits';
import type { Client, Piece } from '../lib/types';
import { urlSignee } from '../lib/fichiers';
import { Bandeau, Bouton, Champ, Chargement, Entete, Kpis, Onglets, Statut, Vide } from '../components/ui';

interface Consultation {
  dossier_id: string; reference: string; intitule: string; client_id: string; client: string; client_verifie: boolean;
  modele: string; segment: string | null; pays: string; ouvert_le: string; forfait_ht: number | null; devise: string;
  facture_id: string | null; facture_numero: string | null; facture_statut: string | null; cdc_statut: string; pieces_jointes: number;
  etape: string; rang: number; phase_courante: string | null;
}

const ddmmyyyy = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const TON: Record<string, string> = {
  demande_recue: 'neutre', forfait_facture: 'att', forfait_regle: 'info', cdc_redaction: 'info', cdc_valide: 'ok', sourcing_lance: 'ok',
};
const FILTRES = { toutes: [] as string[], a_facturer: ['demande_recue'], attente_paiement: ['forfait_facture'],
  redaction: ['forfait_regle', 'cdc_redaction'], sourcing: ['cdc_valide', 'sourcing_lance'] };
type Filtre = keyof typeof FILTRES;

export function Consultations() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { profil, langue } = useAuth();
  const [filtre, setFiltre] = useState<Filtre>('toutes');
  const [q, setQ] = useState('');
  const l = useAsync(async () => ok(await supabase.rpc('consultations_clients')) as Consultation[], []);
  const tous = l.data ?? [];
  const enCours = tous.filter((c) => c.etape !== 'sourcing_lance');
  const nonRegles = tous.filter((c) => c.etape === 'forfait_facture');
  const aFacturer = tous.filter((c) => c.etape === 'demande_recue');
  const annee = new Date().getFullYear();
  const factures = tous.filter((c) => c.facture_numero && c.forfait_ht !== null && c.ouvert_le.startsWith(String(annee)));
  // Forfaits facturés de l'année, par devise (une consultation au Gabon ou au Cameroun est facturée en USD).
  const parDevise = factures.reduce<Record<string, number>>((a, c) => ({ ...a, [c.devise]: (a[c.devise] ?? 0) + Number(c.forfait_ht) }), {});
  const [principal, ...autres] = Object.entries(parDevise).sort((x, y) => (x[0] === 'XOF' ? -1 : y[0] === 'XOF' ? 1 : 0));

  const n = normaliser(q.trim());
  const liste = useMemo(() => tous.filter((c) => (filtre === 'toutes' || FILTRES[filtre].includes(c.etape))
    && (!n || normaliser(`${c.reference} ${c.client} ${c.intitule}`).includes(n))), [tous, filtre, n]);
  const peutCreer = ['admin', 'hub_afrique', 'agent_pays'].includes(profil?.role ?? '');
  const titre = [t('consultations.titre_en_cours', { n: enCours.length }),
    nonRegles.length ? t('consultations.titre_non_regles', { n: nonRegles.length }) : null].filter(Boolean).join(' ; ');
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.commercial')} · ${t('consultations.surtitre')} · CNS`} titre={l.data ? titre : t('ecrans.consultations_clients')}
        actions={peutCreer && <Bouton variante="primaire" onClick={() => nav('/consultations/nouvelle')}>{t('consultations.nouvelle')}</Bouton>} />
      <Kpis items={[
        { lib: t('consultations.k_en_cours'), val: enCours.length, sous: t('consultations.k_en_cours_sous') },
        { lib: t('consultations.k_factures'), val: principal ? nombre(principal[1], langue) : '—',
          sous: principal ? [`${principal[0]} · ${annee}`, ...autres.map(([d, v]) => `${nombre(v, langue)} ${d}`)].join(' · ') : t('consultations.k_factures_aucun') },
        { lib: t('consultations.k_non_regles'), val: nonRegles.length, sous: t('consultations.k_non_regles_sous') },
        { lib: t('consultations.k_a_facturer'), val: aFacturer.length, sous: t('consultations.k_a_facturer_sous') },
      ]} />
      <div className="pf-barre">
        <input className="pf-recherche" placeholder={t('consultations.rechercher')} value={q} maxLength={80} onChange={(e) => setQ(e.target.value)} aria-label={t('consultations.rechercher')} />
        <Onglets actif={filtre} onChange={setFiltre} items={(Object.keys(FILTRES) as Filtre[]).map((id) => ({ id, lib: t(`consultations.f_${id}`) }))} />
        <span className="pf-droite mute">{t('prospects.x_sur_y', { x: liste.length, y: tous.length })}</span>
      </div>
      <Bandeau type="err">{l.erreur}</Bandeau>
      <div className="cadre">
        {l.chargement && !l.data ? <Chargement /> : liste.length === 0 ? <Vide>{t('consultations.aucune')}</Vide> : (
          <table className="t"><thead><tr><th>{t('consultations.ref')}</th><th>{t('consultations.client')}</th><th>{t('consultations.objet')}</th>
            <th className="num">{t('consultations.forfait')}</th><th className="num">{t('consultations.pj')}</th><th>{t('consultations.statut')}</th>
            <th>{t('consultations.ouverte')}</th></tr></thead>
            <tbody>{liste.map((c) => (
              <tr key={c.dossier_id} className="cliquable" onClick={() => nav(`/consultations/${c.dossier_id}`)}>
                <td className="ref">{c.reference}</td>
                <td><div style={{ fontWeight: 500 }}>{c.client}</div>{!c.client_verifie && <div className="txt-att" style={{ fontSize: 12 }}>{t('consultations.client_a_verifier')}</div>}</td>
                <td>{c.intitule}{c.segment && <div className="mute">{c.segment}</div>}</td>
                <td className="num">{c.modele === 'equipement_site' ? <span className="mute">{t('consultations.forfait_projet')}</span>
                  : c.forfait_ht === null ? '—' : `${nombre(c.forfait_ht, langue)} ${c.devise}`}</td>
                <td className="num">{c.pieces_jointes}</td>
                <td><Statut statut={TON[c.etape] ?? 'neutre'} libelle={t(`consultations.etapes.${c.etape}`)} /></td>
                <td className="ref">{ddmmyyyy(c.ouvert_le)}</td></tr>))}</tbody></table>
        )}
      </div>
    </div>
  );
}

const CATEGORIES = ['buanderie', 'froid', 'cuisine', 'mobilier', 'mobilier_medical', 'linge', 'eclairage', 'signaletique', 'modules', 'due_diligence', 'autre'] as const;
const PRESETS = [500000, 850000];

/** Formulaire de demande : crée le dossier dont la phase « consultation » porte la demande du client. */
export function NouvelleConsultation() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { langue, societes } = useAuth();
  const [params] = useSearchParams();
  const clients = useAsync(async () => ok(await supabase.from('clients').select('*').is('archive_le', null).order('raison_sociale').limit(1000)) as Client[], []);
  const [f, setF] = useState({ client_id: params.get('client') ?? '', intitule: '', categorie: '', quantite: '', modele: 'achat_accompagne', date_ouverture_site: '', forfait: '500000', besoin: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const a = useAction();
  const client = (clients.data ?? []).find((c) => c.id === f.client_id) ?? null;
  const devise = societes.find((s) => s.id === client?.societe_id)?.devise ?? client?.devise ?? 'XOF';

  const envoyer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client) { setErrs({ client_id: t('formulaire.invalide') }); return; }
    const v = z.object({
      intitule: z.string().trim().min(2).max(200), client_id: z.string().uuid(), societe_id: z.string().uuid(),
      modele: z.enum(['achat_accompagne', 'consultation']), priorite: z.literal('normale'),
      segment: z.string().max(80).nullable(), date_ouverture_site: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      forfait_consultation_ht: z.number().int().min(0).max(100000000),
      quantite_besoin: z.string().max(120).nullable(), besoin: z.string().max(4000).nullable(),
    }).strict().safeParse({
      intitule: f.intitule, client_id: client.id, societe_id: client.societe_id, modele: f.modele, priorite: 'normale',
      segment: f.categorie ? t(`consultations.categories.${f.categorie}`).slice(0, 80) : null, date_ouverture_site: f.date_ouverture_site || null,
      forfait_consultation_ht: Number(f.forfait.replace(/\s/g, '')),
      quantite_besoin: f.quantite.trim() || null, besoin: f.besoin.trim() || null,
    });
    if (!v.success) {
      const err: Record<string, string> = {};
      for (const i of v.error.issues) err[String(i.path[0])] = t('formulaire.invalide');
      setErrs(err);
      return;
    }
    setErrs({});
    await a.executer(async () => {
      const r = ok(await supabase.from('dossiers').insert(v.data).select('id').single()) as { id: string };
      nav(`/dossiers/${r.id}`);
    });
  };

  return (
    <div className="screen" style={{ overflow: 'auto' }}>
      <Entete surtitre={`${t('modules.commercial')} · ${t('consultations.surtitre_form')} · CNS`} titre={t('consultations.nouvelle')} />
      <div className="fiche-grille">
        <form className="cadre fiche-principal" onSubmit={envoyer} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="grille2">
            <Champ label={`${t('consultations.client')} *`} erreur={errs.client_id}>
              <select value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })}>
                <option value="">—</option>
                {(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.raison_sociale} · {c.pays}</option>)}
              </select>
            </Champ>
            <Champ label={`${t('consultations.objet')} *`} erreur={errs.intitule}>
              <input value={f.intitule} maxLength={200} onChange={(e) => setF({ ...f, intitule: e.target.value })} />
            </Champ>
            <Champ label={t('consultations.categorie')} erreur={errs.segment}>
              <select value={f.categorie} onChange={(e) => setF({ ...f, categorie: e.target.value })}>
                <option value="">—</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{t(`consultations.categories.${c}`)}</option>)}
              </select>
            </Champ>
            <Champ label={t('consultations.quantite')} erreur={errs.quantite_besoin}>
              <input value={f.quantite} maxLength={120} placeholder={t('consultations.quantite_exemple')} onChange={(e) => setF({ ...f, quantite: e.target.value })} />
            </Champ>
            <Champ label={t('consultations.pays_livraison')}>
              <input value={client?.pays ?? ''} disabled title={t('consultations.pays_du_client')} />
            </Champ>
            <Champ label={t('consultations.suite')}>
              <select value={f.modele} onChange={(e) => setF({ ...f, modele: e.target.value })}>
                {['achat_accompagne', 'consultation'].map((m) => <option key={m} value={m}>{t(`modeles.${m}`)}</option>)}
              </select>
            </Champ>
            <Champ label={t('champs.date_ouverture_site')} erreur={errs.date_ouverture_site}>
              <input type="date" value={f.date_ouverture_site} onChange={(e) => setF({ ...f, date_ouverture_site: e.target.value })} />
            </Champ>
            <Champ label={`${t('consultations.forfait')} (${devise})`} erreur={errs.forfait_consultation_ht}>
              <input inputMode="numeric" value={f.forfait} onChange={(e) => setF({ ...f, forfait: e.target.value })} />
            </Champ>
          </div>
          {devise === 'XOF' && (
            <div className="actions">
              {PRESETS.map((p, i) => <Bouton key={p} petit onClick={() => setF({ ...f, forfait: String(p) })}>
                {t(i === 0 ? 'consultations.standard' : 'consultations.renforce')} · {nombre(p, langue)} XOF</Bouton>)}
            </div>
          )}
          <Champ label={t('consultations.besoin')} erreur={errs.besoin}>
            <textarea rows={4} maxLength={4000} value={f.besoin} placeholder={t('consultations.besoin_exemple')} onChange={(e) => setF({ ...f, besoin: e.target.value })} />
          </Champ>
          <Bandeau type="err">{a.erreur ?? clients.erreur}</Bandeau>
          <div className="actions">
            <Bouton onClick={() => nav(-1)}>{t('consultations.annuler')}</Bouton>
            <Bouton type="submit" variante="primaire" disabled={a.enCours}>{t('consultations.creer')}</Bouton>
          </div>
        </form>
        <aside className="fiche-cote">
          <section className="fiche-bloc">
            <div className="surtitre">{t('consultations.client_selectionne')}</div>
            {client ? <>
              <b>{client.raison_sociale}</b>
              <Statut statut={client.verification_statut === 'verifie' ? 'ok' : 'att'} libelle={t(`verification.${client.verification_statut}`)} />
            </> : <span className="mute">—</span>}
            <p className="mute" style={{ margin: 0 }}>{t('consultations.aide_forfait')}</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

const ETAPES = ['demande_recue', 'forfait_facture', 'forfait_regle', 'cdc_redaction', 'cdc_valide', 'sourcing_lance'] as const;

/** Fiche consultation (maquette consFiche) : étapes, synthèse, pièces de la phase, prochaine action, conditions du sourcing. */
export function FicheConsultation() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const nav = useNavigate();
  const { profil, langue } = useAuth();
  const role = profil?.role ?? '';
  const l = useAsync(async () => ok(await supabase.rpc('consultations_clients')) as Consultation[], []);
  const d = useAsync(async () => ok(await supabase.from('dossiers').select('besoin, quantite_besoin').eq('id', id).maybeSingle()) as
    { besoin: string | null; quantite_besoin: string | null } | null, [id]);
  const p = useAsync(async () => ok(await supabase.from('pieces').select('*').eq('dossier_id', id).eq('phase', 'consultation').order('libelle')) as Piece[], [id]);
  const c = (l.data ?? []).find((x) => x.dossier_id === id);
  if (!c) return <div className="screen">{l.chargement ? <Chargement /> : <Vide>{l.erreur ?? t('consultations.introuvable')}</Vide>}</div>;
  const forfaitProjet = c.modele === 'equipement_site';
  const regle = forfaitProjet || c.facture_statut === 'payee';
  const facture = forfaitProjet || Boolean(c.facture_numero);
  const conditions: [string, boolean][] = [
    ['verification', c.client_verifie], ['forfait_facture', facture], ['forfait_regle', regle],
    ['pieces', c.pieces_jointes > 0], ['cdc_valide', c.cdc_statut === 'validee'],
  ];
  // Prochaine action : écran où elle se fait, selon les droits du profil.
  const finance = ['admin', 'hub_afrique', 'comptable'].includes(role);
  const action: { cle: string; aller: (() => void) | null } = {
    demande_recue: { cle: 'facturer', aller: finance ? () => nav('/factures') : null },
    forfait_facture: { cle: 'paiement', aller: finance && c.facture_id ? () => nav(`/factures/${c.facture_id}`) : null },
    forfait_regle: { cle: 'deposer_cdc', aller: () => nav(`/dossiers/${id}`) },
    cdc_redaction: { cle: 'valider_cdc', aller: () => nav(`/dossiers/${id}`) },
    cdc_valide: { cle: 'lancer_sourcing', aller: () => nav(`/dossiers/${id}`) },
    sourcing_lance: { cle: 'suivre', aller: () => nav(`/dossiers/${id}`) },
  }[c.etape] ?? { cle: 'suivre', aller: () => nav(`/dossiers/${id}`) };
  const ouvrir = async (chemin: string) => { const u = await urlSignee(chemin); if (u) window.open(u, '_blank', 'noopener,noreferrer'); };
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.commercial')} · ${t('consultations.fiche')} · ${c.reference} · CNS`}
        titre={<>{c.intitule} <span className="h1-statut"><Statut statut={TON[c.etape] ?? 'neutre'} libelle={t(`consultations.etapes.${c.etape}`)} /></span></>}
        actions={<Bouton onClick={() => nav(`/dossiers/${id}`)}>{t('consultations.ouvrir_dossier')}</Bouton>} />
      <div className="sec" style={{ marginTop: -10 }}>{c.client}</div>
      <ol className="etapes-pros etapes-6">
        {ETAPES.map((e, i) => <li key={e} className={i + 1 < c.rang ? 'faite' : i + 1 === c.rang ? 'courante' : ''}><span>{i + 1}</span> {t(`consultations.etapes.${e}`)}</li>)}
      </ol>
      <Bandeau type="err">{d.erreur ?? p.erreur}</Bandeau>
      <div className="fiche-grille">
        <div className="cadre fiche-principal">
          <div className="pf-champs" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            <div><span>{t('consultations.client')}</span><b>{c.client}</b></div>
            <div><span>{t('consultations.categorie')}</span><b>{c.segment ?? '—'}</b></div>
            <div><span>{t('consultations.quantite')}</span><b>{d.data?.quantite_besoin ?? '—'}</b></div>
            <div><span>{t('consultations.pays_livraison')}</span><b>{c.pays}</b></div>
            <div><span>{t('consultations.forfait')}</span><b>{forfaitProjet ? t('consultations.forfait_projet') : c.forfait_ht === null ? '—' : `${nombre(c.forfait_ht, langue)} ${c.devise}`}</b></div>
            <div><span>{t('consultations.facture')}</span><b>{c.facture_numero ?? '—'}</b></div>
            <div><span>{t('consultations.ouverte_le')}</span><b>{ddmmyyyy(c.ouvert_le)}</b></div>
            <div><span>{t('consultations.deduction')}</span><b>{forfaitProjet ? '—' : t('consultations.deduction_texte')}</b></div>
          </div>
          {d.data?.besoin && (
            <section className="fiche-bloc">
              <div className="surtitre">{t('consultations.besoin')}</div>
              <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{d.data.besoin}</p>
            </section>
          )}
          <section className="fiche-bloc">
            <div className="surtitre" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{t('consultations.pieces')}</span>
              <Bouton petit onClick={() => nav(`/dossiers/${id}`)}>{t('consultations.ajouter_piece')}</Bouton>
            </div>
            {(p.data ?? []).length === 0 ? <span className="mute">{t('consultations.aucune_piece')}</span> : (
              <table className="t"><tbody>{(p.data ?? []).map((x) => (
                <tr key={x.id}><td>{x.libelle}</td>
                  <td><Statut statut={x.statut} libelle={t(`statuts_piece.${x.statut}`)} /></td>
                  <td style={{ textAlign: 'right' }}>{x.document_chemin && <Bouton petit onClick={() => void ouvrir(x.document_chemin!)}>{t('consultations.voir')}</Bouton>}</td></tr>))}
              </tbody></table>
            )}
          </section>
        </div>
        <aside className="fiche-cote">
          <section className="fiche-bloc">
            <div className="surtitre">{t('consultations.prochaine_action')}</div>
            <div className="cons-action">{t(`consultations.actions.${action.cle}`)}</div>
            <p className="mute" style={{ margin: 0 }}>{t(`consultations.actions_aide.${action.cle}`)}</p>
            {action.aller ? <Bouton variante="primaire" data-sans-glose style={{ width: '100%', justifyContent: 'center' }} onClick={action.aller}>{t(`consultations.actions.${action.cle}`)}</Bouton>
              : <span className="mute">{t('consultations.action_autre_profil')}</span>}
          </section>
          <section className="fiche-bloc">
            <div className="surtitre">{t('consultations.conditions')}</div>
            {conditions.map(([k, okc]) => (
              <div key={k} className="ligne-montant"><span>{t(`consultations.cond.${k}`)}</span>
                <Statut statut={okc ? 'ok' : 'neutre'} libelle={okc ? t('consultations.fait') : t('consultations.a_faire')} /></div>))}
          </section>
        </aside>
      </div>
    </div>
  );
}
