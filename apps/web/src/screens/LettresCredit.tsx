// Lot 1, M12 : lettres de crédit (mode 1) et certificat d'inspection rédigé selon le crédit.
// Analyse du crédit, contrôles de cohérence et émission appliqués en base.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';
import i18n from '../i18n';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, montant, type Langue } from '../lib/format';
import { Bandeau, Bouton, Champ, Chargement, Statut, Tiroir, Vide } from '../components/ui';

interface DocExige { document: string; originaux?: number; copies?: number; mentions?: string }
interface Lc { id: string; reference: string; dossier_id: string; commande_id: string; numero: string; banque_emettrice: string; banque_notificatrice: string | null;
  beneficiaire: string; montant: number; devise: string; tolerance_montant: number; tolerance_quantite: number; emise_le: string; expire_le: string;
  derniere_date_expedition: string; port_chargement: string | null; port_dechargement: string | null; expeditions_partielles: boolean; regles: string;
  emetteur_certificat: string; formulation_certificat: string; documents_exiges: DocExige[]; statut: 'saisie' | 'conforme' | 'a_amender';
  anomalies: { code: string }[] }
interface Certificat { id: string; numero: string; lettre_credit_id: string; inspection_id: string; expedition_id: string | null; formulation: string;
  donnees: Record<string, unknown> & { articles?: { reference: string; designation: string; quantite: number }[] }; emis_le: string }
const STATUT = { saisie: 'neutre', conforme: 'ok', a_amender: 'err' } as const;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Onglet « Lettre de crédit » de la fiche dossier. */
export function LettresCreditDossier({ dossierId }: { dossierId: string }) {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const role = profil?.role ?? '';
  const ecrit = ['admin', 'achats_chine', 'hub_afrique'].includes(role);
  const validateur = role === 'admin' || profil?.delegue_validation;
  const l = useAsync(async () => ok(await supabase.from('lettres_credit').select('*').eq('dossier_id', dossierId).order('cree_le')) as Lc[], [dossierId]);
  const c = useAsync(async () => ok(await supabase.from('certificats_lc').select('*').eq('dossier_id', dossierId).order('cree_le')) as Certificat[], [dossierId]);
  const a = useAction();
  const [edition, setEdition] = useState<Lc | 'nouveau' | null>(null);
  const [emission, setEmission] = useState<Lc | null>(null);
  const recharger = () => { void l.recharger(); void c.recharger(); };
  const analyser = async (x: Lc) => { if (await a.executer(async () => ok(await supabase.rpc('analyser_lc', { p_lc: x.id })))) recharger(); };
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="section-titre">{t('lc.titre')}</span>
        {ecrit && <Bouton petit onClick={() => setEdition('nouveau')}>{t('lc.nouvelle')}</Bouton>}
      </div>
      <Bandeau type="err">{l.erreur ?? c.erreur ?? a.erreur}</Bandeau>
      {(l.data ?? []).length === 0 ? <span className="mute">{t('lc.aucune')}</span> : (l.data ?? []).map((x) => (
        <div key={x.id} className="cadre" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div><span className="ref">{x.reference}</span> · {x.numero} · {x.banque_emettrice} · {montant(x.montant, x.devise, langue)}
            {' '}<Statut statut={STATUT[x.statut]} libelle={t(`lc.statuts.${x.statut}`)} /></div>
          <div className="mute">{t('lc.dates', { emise: date(x.emise_le, langue), expedition: date(x.derniere_date_expedition, langue), expire: date(x.expire_le, langue) })}
            {x.port_chargement || x.port_dechargement ? ` · ${x.port_chargement ?? '—'} → ${x.port_dechargement ?? '—'}` : ''}</div>
          <div className="mute">{t('lc.emetteur')} : {x.emetteur_certificat}</div>
          {x.anomalies.length > 0 && <Bandeau type="err">{t('lc.a_amender')} : {x.anomalies.map((y) => t(`lc.anomalies.${y.code}`)).join(' ; ')}</Bandeau>}
          {x.documents_exiges.length > 0 && <div className="mute">{t('lc.documents_exiges')} : {x.documents_exiges.map((d) => `${d.document}${d.originaux != null ? ` (${d.originaux}/${d.copies ?? 0})` : ''}`).join(' · ')}</div>}
          <span className="actions" style={{ flexWrap: 'wrap' }}>
            {ecrit && !(c.data ?? []).some((y) => y.lettre_credit_id === x.id) && <Bouton petit onClick={() => setEdition(x)}>{t('lc.amender')}</Bouton>}
            {ecrit && <Bouton petit disabled={a.enCours} onClick={() => void analyser(x)}>{t('lc.analyser')}</Bouton>}
            {validateur && x.statut === 'conforme' && <Bouton petit variante="primaire" onClick={() => setEmission(x)}>{t('lc.emettre_certificat')}</Bouton>}
          </span>
          {(c.data ?? []).filter((y) => y.lettre_credit_id === x.id).map((y) => (
            <div key={y.id}><Link to={`/imprimer/certificat-lc/${y.id}`}>{y.numero}</Link> · {date(y.emis_le, langue)}</div>))}
        </div>
      ))}
      <p className="mute">{t('lc.aide')}</p>
      {edition && <EditionLc dossierId={dossierId} lc={edition === 'nouveau' ? null : edition} onClose={() => setEdition(null)} onSaved={() => { setEdition(null); recharger(); }} />}
      {emission && <EmissionCertificat lc={emission} onClose={() => setEmission(null)} onSaved={() => { setEmission(null); recharger(); }} />}
    </section>
  );
}

function EditionLc({ dossierId, lc, onClose, onSaved }: { dossierId: string; lc: Lc | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const cmds = useAsync(async () => ok(await supabase.from('commandes').select('id, reference, devise').eq('dossier_id', dossierId).neq('statut', 'annulee')) as { id: string; reference: string; devise: string }[], [dossierId]);
  const s = (v: unknown) => (v == null ? '' : String(v));
  const [f, setF] = useState({ commande_id: s(lc?.commande_id), numero: s(lc?.numero), banque_emettrice: s(lc?.banque_emettrice), banque_notificatrice: s(lc?.banque_notificatrice),
    beneficiaire: s(lc?.beneficiaire), montant: s(lc?.montant), devise: lc?.devise ?? 'USD', tolerance_montant: s(lc ? lc.tolerance_montant * 100 : 0),
    tolerance_quantite: s(lc ? lc.tolerance_quantite * 100 : 0), emise_le: s(lc?.emise_le), expire_le: s(lc?.expire_le), derniere_date_expedition: s(lc?.derniere_date_expedition),
    port_chargement: s(lc?.port_chargement), port_dechargement: s(lc?.port_dechargement), regles: lc?.regles ?? 'UCP 600',
    emetteur_certificat: lc?.emetteur_certificat ?? 'Gulf Bridge Sourcing', formulation_certificat: s(lc?.formulation_certificat) });
  const [docs, setDocs] = useState<DocExige[]>(lc?.documents_exiges.length ? lc.documents_exiges : [{ document: '', originaux: 1, copies: 0, mentions: '' }]);
  const enregistrer = async () => {
    const opt = (n: number) => z.string().trim().max(n).nullable();
    const doc = z.object({ document: z.string().trim().min(2).max(120), originaux: z.number().int().min(0).max(10), copies: z.number().int().min(0).max(10), mentions: z.string().max(1000) }).strict();
    const v = z.object({ commande_id: z.string().uuid(), numero: z.string().trim().min(3).max(80), banque_emettrice: z.string().trim().min(2).max(200),
      banque_notificatrice: opt(200), beneficiaire: z.string().trim().min(2).max(200), montant: z.number().positive().max(1e12),
      devise: z.enum(['USD', 'CNY', 'EUR', 'XOF', 'XAF']), tolerance_montant: z.number().min(0).max(0.1), tolerance_quantite: z.number().min(0).max(0.1),
      emise_le: DATE, expire_le: DATE, derniere_date_expedition: DATE, port_chargement: opt(80), port_dechargement: opt(80), regles: z.string().trim().min(2).max(40),
      emetteur_certificat: z.string().trim().min(2).max(200), formulation_certificat: z.string().max(2000), documents_exiges: z.array(doc).max(30) }).strict()
      .refine((x) => x.expire_le >= x.emise_le && x.derniere_date_expedition <= x.expire_le)
      .safeParse({ ...f, montant: Number(f.montant.replace(',', '.')), tolerance_montant: Number(f.tolerance_montant.replace(',', '.')) / 100,
        tolerance_quantite: Number(f.tolerance_quantite.replace(',', '.')) / 100, banque_notificatrice: f.banque_notificatrice.trim() || null,
        port_chargement: f.port_chargement.trim() || null, port_dechargement: f.port_dechargement.trim() || null,
        documents_exiges: docs.filter((d) => d.document.trim()).map((d) => ({ document: d.document.trim(), originaux: Number(d.originaux ?? 0), copies: Number(d.copies ?? 0), mentions: (d.mentions ?? '').trim() })) });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    const ok2 = await a.executer(async () => {
      if (lc) ok(await supabase.from('lettres_credit').update(v.data).eq('id', lc.id));
      else ok(await supabase.from('lettres_credit').insert({ ...v.data, dossier_id: z.string().uuid().parse(dossierId) }));
    });
    if (ok2) onSaved();
  };
  const champ = (k: keyof typeof f, label: string, max: number, type = 'text') => (
    <Champ label={label}><input type={type} value={f[k]} maxLength={max} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Champ>);
  return (
    <Tiroir titre={lc ? `${t('lc.amender')} — ${lc.reference}` : t('lc.nouvelle')} onClose={onClose}>
      <Champ label={t('lc.commande')}><select value={f.commande_id} onChange={(e) => setF({ ...f, commande_id: e.target.value })}>
        <option value="">—</option>{(cmds.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.reference} ({x.devise})</option>)}</select></Champ>
      {champ('numero', t('lc.numero'), 80)}
      {champ('banque_emettrice', t('lc.banque_emettrice'), 200)}
      {champ('banque_notificatrice', t('lc.banque_notificatrice'), 200)}
      {champ('beneficiaire', t('lc.beneficiaire'), 200)}
      <div className="actions">
        {champ('montant', t('champs.montant'), 20)}
        <Champ label={t('lc.devise')}><select value={f.devise} onChange={(e) => setF({ ...f, devise: e.target.value })}>{['USD', 'CNY', 'EUR', 'XOF', 'XAF'].map((x) => <option key={x}>{x}</option>)}</select></Champ>
        {champ('tolerance_montant', t('lc.tolerance_montant'), 4)}
        {champ('tolerance_quantite', t('lc.tolerance_quantite'), 4)}
      </div>
      <div className="actions">
        {champ('emise_le', t('lc.emise_le'), 10, 'date')}
        {champ('derniere_date_expedition', t('lc.derniere_expedition'), 10, 'date')}
        {champ('expire_le', t('lc.expire_le'), 10, 'date')}
      </div>
      <div className="actions">{champ('port_chargement', t('lc.port_chargement'), 80)}{champ('port_dechargement', t('lc.port_dechargement'), 80)}{champ('regles', t('lc.regles'), 40)}</div>
      {champ('emetteur_certificat', t('lc.emetteur'), 200)}
      <Champ label={t('lc.formulation')}><textarea rows={4} maxLength={2000} value={f.formulation_certificat} onChange={(e) => setF({ ...f, formulation_certificat: e.target.value })} /></Champ>
      <div className="section-titre">{t('lc.documents_exiges')}</div>
      {docs.map((d, i) => (
        <div key={i} className="actions" style={{ flexWrap: 'wrap' }}>
          <input placeholder={t('lc.document')} aria-label={t('lc.document')} maxLength={120} value={d.document} onChange={(e) => setDocs(docs.map((x, j) => (j === i ? { ...x, document: e.target.value } : x)))} />
          <input type="number" min={0} max={10} aria-label={t('lc.originaux')} title={t('lc.originaux')} value={d.originaux ?? 0} onChange={(e) => setDocs(docs.map((x, j) => (j === i ? { ...x, originaux: Number(e.target.value) } : x)))} style={{ width: 70 }} />
          <input type="number" min={0} max={10} aria-label={t('lc.copies')} title={t('lc.copies')} value={d.copies ?? 0} onChange={(e) => setDocs(docs.map((x, j) => (j === i ? { ...x, copies: Number(e.target.value) } : x)))} style={{ width: 70 }} />
          <input placeholder={t('lc.mentions')} aria-label={t('lc.mentions')} maxLength={1000} value={d.mentions ?? ''} onChange={(e) => setDocs(docs.map((x, j) => (j === i ? { ...x, mentions: e.target.value } : x)))} />
        </div>
      ))}
      {docs.length < 30 && <Bouton petit onClick={() => setDocs([...docs, { document: '', originaux: 1, copies: 0, mentions: '' }])}>{t('lc.ajouter_document')}</Bouton>}
      <p className="mute">{t('lc.aide_saisie')}</p>
      <Bandeau type="err">{cmds.erreur ?? a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

function EmissionCertificat({ lc, onClose, onSaved }: { lc: Lc; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const a = useAction();
  const ins = useAsync(async () => ok(await supabase.from('inspections').select('id, reference, type, validee_le').eq('commande_id', lc.commande_id)
    .eq('statut', 'validee').eq('decision', 'liberation').in('type', ['avant_expedition', 'contre_inspection'])) as { id: string; reference: string; validee_le: string }[], [lc.id]);
  const exps = useAsync(async () => ok(await supabase.from('expedition_commandes').select('expeditions(id, reference, etd)').eq('commande_id', lc.commande_id)) as unknown as
    { expeditions: { id: string; reference: string; etd: string | null } | null }[], [lc.id]);
  const [f, setF] = useState({ inspection: '', expedition: '' });
  const emettre = async () => {
    const v = z.object({ p_lc: z.string().uuid(), p_inspection: z.string().uuid(), p_expedition: z.string().uuid().nullable() }).strict()
      .safeParse({ p_lc: lc.id, p_inspection: f.inspection, p_expedition: f.expedition || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('emettre_certificat_lc', v.data)))) onSaved();
  };
  return (
    <Tiroir titre={`${t('lc.emettre_certificat')} — ${lc.numero}`} onClose={onClose}>
      <Champ label={t('lc.inspection_liberee')}><select value={f.inspection} onChange={(e) => setF({ ...f, inspection: e.target.value })}>
        <option value="">—</option>{(ins.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.reference} · {date(x.validee_le, langue)}</option>)}</select></Champ>
      <Champ label={t('reception.expedition')}><select value={f.expedition} onChange={(e) => setF({ ...f, expedition: e.target.value })}>
        <option value="">—</option>{(exps.data ?? []).filter((x) => x.expeditions).map((x) => <option key={x.expeditions!.id} value={x.expeditions!.id}>{x.expeditions!.reference}{x.expeditions!.etd ? ` · ETD ${date(x.expeditions!.etd, langue)}` : ''}</option>)}</select></Champ>
      <div className="section-titre">{t('lc.formulation')}</div>
      <p style={{ whiteSpace: 'pre-wrap' }}>{lc.formulation_certificat}</p>
      <p className="mute">{t('lc.aide_emission')}</p>
      <Bandeau type="err">{ins.erreur ?? exps.erreur ?? a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours || !f.inspection} onClick={() => void emettre()}>{t('lc.emettre')}</Bouton>
    </Tiroir>
  );
}

/** Impression du certificat : formulation exacte du crédit, données figées à l'émission (texte échappé par React). */
export function ImprimerCertificatLc() {
  const { id = '' } = useParams();
  const c = useAsync(async () => ok(await supabase.from('certificats_lc').select('*').eq('id', id).single()) as Certificat, [id]);
  const lg = (new URLSearchParams(window.location.search).get('langue') as Langue) ?? 'en';
  if (c.chargement) return <Chargement />;
  if (!c.data) return <Vide>{c.erreur}</Vide>;
  const x = c.data;
  const d = x.donnees as Record<string, string | number | null>;
  const t = i18n.getFixedT(lg);
  const ligne = (k: string, v: unknown) => (v == null || v === '' ? null : <tr key={k}><td>{t(`lc.cert.${k}`)}</td><td>{String(v)}</td></tr>);
  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: 12 }}>
        {(['en', 'fr'] as Langue[]).map((l) => <a key={l} className="btn petit" href={`?langue=${l}`}>{l.toUpperCase()}</a>)}
        <Bouton variante="primaire" onClick={() => window.print()}>{i18n.t('commun.imprimer')}</Bouton>
      </div>
      <article className="doc" lang={lg}>
        <header style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div><img src="/gbs-logo.png" alt="" width={44} height={44} /><div>{String(d.emetteur ?? '')}</div></div>
          <div style={{ textAlign: 'right' }}><h1>{t('lc.cert.titre')}</h1><div>{x.numero}</div><div className="mute">{date(x.emis_le, lg)}</div></div>
        </header>
        <table style={{ margin: '20px 0' }}><tbody>
          {ligne('lc_numero', d.lc_numero)}{ligne('banque_emettrice', d.banque_emettrice)}{ligne('regles', d.regles)}{ligne('beneficiaire', d.beneficiaire)}
          {ligne('commande', d.commande)}{ligne('fournisseur', d.fournisseur)}{ligne('inspection', d.inspection)}{ligne('date_inspection', d.date_inspection)}
          {ligne('taille_lot', d.taille_lot)}{ligne('niveau', d.niveau ? `${d.niveau} · ISO 2859-1` : null)}
          {ligne('expedition', d.expedition)}{ligne('connaissement', d.connaissement)}{ligne('navire', d.navire)}
          {ligne('ports', d.port_chargement || d.port_dechargement ? `${d.port_chargement ?? '—'} → ${d.port_dechargement ?? '—'}` : null)}{ligne('etd', d.etd)}
        </tbody></table>
        <table><thead><tr><th>{t('lc.cert.reference')}</th><th>{t('lc.cert.designation')}</th><th className="num">{t('lc.cert.quantite')}</th></tr></thead>
          <tbody>{(x.donnees.articles ?? []).map((a, k) => <tr key={k}><td>{a.reference}</td><td>{a.designation}</td><td className="num">{a.quantite}</td></tr>)}</tbody></table>
        <section style={{ marginTop: 24, padding: 12, border: '1px solid var(--ink)' }}>
          <p style={{ whiteSpace: 'pre-wrap', fontSize: 15 }}>{x.formulation}</p>
        </section>
        <p style={{ marginTop: 40 }}>{t('lc.cert.signature')}</p>
      </article>
    </div>
  );
}
