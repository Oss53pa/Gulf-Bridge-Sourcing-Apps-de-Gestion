// Lot 1, M26 : approbation technique (versions, soumission, décision signée du client)
// et essais en usine (procès-verbal). Règles et verrous appliqués en base.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, montant } from '../lib/format';
import { urlSignee } from '../lib/fichiers';
import { Bandeau, Bouton, Champ, Statut, Tiroir } from '../components/ui';
import { Depot } from '../components/Depot';

interface Approbation { id: string; version: number; objet: string; documents: string[]; echantillon: boolean; echantillon_description: string | null;
  echantillon_envoye_le: string | null; echantillon_cout_xof: number | null; essais_requis: boolean;
  statut: 'brouillon' | 'soumise' | 'approuvee' | 'refusee' | 'remplacee'; soumise_le: string | null; decision_le: string | null;
  signataire: string | null; document_signe: string | null; commentaire_client: string | null }
interface Resultat { critere: string; attendu: string; mesure: string; conforme: boolean }
interface Essai { id: string; date_essai: string; lieu: string | null; protocole: string; resultats: Resultat[]; conforme: boolean | null;
  temoins: string | null; pv_document: string | null; statut: 'brouillon' | 'valide' }
const STATUT = { brouillon: 'neutre', soumise: 'att', approuvee: 'ok', refusee: 'err', remplacee: 'neutre' } as const;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const CHEMIN = z.string().max(400);

async function ouvrir(c: string) { const u = await urlSignee(c); if (u) window.open(u, '_blank', 'noopener,noreferrer'); }

export function ApprobationEssais({ commandeId, dossierId, statutCommande, onChange }:
  { commandeId: string; dossierId: string; statutCommande: string; onChange: () => void }) {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const role = profil?.role ?? '';
  const ecrit = ['admin', 'achats_chine'].includes(role);
  const validateur = role === 'admin' || profil?.delegue_validation;
  const ap = useAsync(async () => ok(await supabase.from('approbations_techniques').select('*').eq('commande_id', commandeId).order('version', { ascending: false })) as Approbation[], [commandeId]);
  const es = useAsync(async () => ok(await supabase.from('essais_usine').select('*').eq('commande_id', commandeId).order('date_essai', { ascending: false })) as Essai[], [commandeId]);
  const a = useAction();
  const [nouvelle, setNouvelle] = useState(false);
  const [decision, setDecision] = useState<Approbation | null>(null);
  const [essai, setEssai] = useState(false);
  const recharger = () => { void ap.recharger(); void es.recharger(); onChange(); };
  const versions = ap.data ?? [];
  const enCours = versions.some((v) => ['brouillon', 'soumise'].includes(v.statut));
  const avantProduction = ['brouillon', 'contrat_signe'].includes(statutCommande);
  const essaisRequis = versions.some((v) => v.statut === 'approuvee' && v.essais_requis);
  const soumettre = async (v: Approbation) => { if (await a.executer(async () => ok(await supabase.rpc('soumettre_approbation', { p_approbation: v.id })))) recharger(); };
  const joindrePv = async (e: Essai, c: string) => { if (await a.executer(async () => ok(await supabase.from('essais_usine').update({ pv_document: c }).eq('id', e.id)))) recharger(); };
  const validerEssai = async (e: Essai) => { if (await a.executer(async () => ok(await supabase.rpc('valider_essai', { p_essai: e.id })))) recharger(); };
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="section-titre">{t('approbation.titre')}</span>
        {ecrit && avantProduction && !enCours && <Bouton petit onClick={() => setNouvelle(true)}>{t('approbation.nouvelle_version')}</Bouton>}
      </div>
      <Bandeau type="err">{ap.erreur ?? es.erreur ?? a.erreur}</Bandeau>
      {versions.length === 0 ? <span className="mute">{t('approbation.aucune')}</span> : (
        <table className="t"><thead><tr><th>{t('approbation.version')}</th><th>{t('approbation.objet')}</th><th>{t('approbation.pieces')}</th><th>{t('approbation.decision')}</th><th /></tr></thead>
          <tbody>{versions.map((v) => (
            <tr key={v.id}><td className="ref">v{v.version}</td>
              <td>{v.objet}{v.echantillon && <div className="mute">{t('approbation.echantillon')} : {v.echantillon_description}
                {v.echantillon_envoye_le ? ` · ${t('approbation.envoye_le', { date: date(v.echantillon_envoye_le, langue) })}` : ''}
                {v.echantillon_cout_xof != null ? ` · ${montant(v.echantillon_cout_xof, 'XOF', langue)}` : ''}</div>}
                {v.essais_requis && <div className="mute">{t('approbation.essais_requis')}</div>}</td>
              <td><span className="actions" style={{ flexWrap: 'wrap' }}>{v.documents.map((d, i) => <Bouton key={d} petit onClick={() => void ouvrir(d)}>{t('approbation.piece', { n: i + 1 })}</Bouton>)}</span></td>
              <td><Statut statut={STATUT[v.statut]} libelle={t(`approbation.statuts.${v.statut}`)} />
                {v.decision_le && <div className="mute">{v.signataire} · {date(v.decision_le, langue)}</div>}
                {v.commentaire_client && <div className="mute">{v.commentaire_client}</div>}
                {v.document_signe && <Bouton petit onClick={() => void ouvrir(v.document_signe!)}>{t('approbation.document_signe')}</Bouton>}</td>
              <td className="num">{ecrit && v.statut === 'brouillon' && <Bouton petit variante="primaire" disabled={a.enCours} onClick={() => void soumettre(v)}>{t('approbation.soumettre')}</Bouton>}
                {ecrit && v.statut === 'soumise' && <Bouton petit variante="primaire" onClick={() => setDecision(v)}>{t('approbation.enregistrer_decision')}</Bouton>}</td></tr>))}</tbody></table>
      )}
      <p className="mute">{t('approbation.aide')}</p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="section-titre">{t('essais.titre')}</span>
        {ecrit && <Bouton petit onClick={() => setEssai(true)}>{t('essais.nouveau')}</Bouton>}
      </div>
      {essaisRequis && !(es.data ?? []).some((e) => e.statut === 'valide' && e.conforme) && <Bandeau type="err">{t('essais.exiges')}</Bandeau>}
      {(es.data ?? []).length === 0 ? <span className="mute">{t('essais.aucun')}</span> : (
        <table className="t"><tbody>{(es.data ?? []).map((e) => (
          <tr key={e.id}><td className="ref">{date(e.date_essai, langue)}</td><td>{e.protocole}<div className="mute">{e.lieu ?? ''}</div>
            {e.resultats.map((r, i) => <div key={i} className="mute">{r.conforme ? '✓' : '✗'} {r.critere} — {r.attendu || '—'} / {r.mesure || '—'}</div>)}</td>
            <td><Statut statut={e.conforme === null ? 'neutre' : e.conforme ? 'ok' : 'err'} libelle={e.conforme === null ? '—' : e.conforme ? t('essais.conforme') : t('essais.non_conforme')} /></td>
            <td>{e.pv_document ? <Bouton petit onClick={() => void ouvrir(e.pv_document!)}>{t('essais.pv')}</Bouton>
              : ecrit && e.statut === 'brouillon' ? <Depot dossierId={dossierId} valeur={null} onChange={(c) => void joindrePv(e, c)} />
              : <span className="mute">{t('essais.pv_manquant')}</span>}</td>
            <td className="num">{e.statut === 'valide' ? <Statut statut="ok" libelle={t('essais.valide')} />
              : validateur && <Bouton petit variante="primaire" disabled={a.enCours || !e.pv_document} onClick={() => void validerEssai(e)}>{t('commun.valider')}</Bouton>}</td></tr>))}</tbody></table>
      )}
      {nouvelle && <NouvelleVersion commandeId={commandeId} dossierId={dossierId} onClose={() => setNouvelle(false)} onSaved={() => { setNouvelle(false); recharger(); }} />}
      {decision && <Decision v={decision} dossierId={dossierId} onClose={() => setDecision(null)} onSaved={() => { setDecision(null); recharger(); }} />}
      {essai && <NouvelEssai commandeId={commandeId} dossierId={dossierId} onClose={() => setEssai(false)} onSaved={() => { setEssai(false); recharger(); }} />}
    </section>
  );
}

function NouvelleVersion({ commandeId, dossierId, onClose, onSaved }: { commandeId: string; dossierId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [f, setF] = useState({ objet: '', echantillon: false, echantillon_description: '', echantillon_envoye_le: '', echantillon_cout_xof: '', essais_requis: false });
  const [docs, setDocs] = useState<string[]>([]);
  const enregistrer = async () => {
    const v = z.object({ commande_id: z.string().uuid(), objet: z.string().trim().min(3).max(300), documents: z.array(CHEMIN).max(30), echantillon: z.boolean(),
      echantillon_description: z.string().trim().max(1000).nullable(), echantillon_envoye_le: DATE.nullable(), echantillon_cout_xof: z.number().int().min(0).max(1e12).nullable(),
      essais_requis: z.boolean() }).strict()
      .refine((x) => !x.echantillon || !!x.echantillon_description)
      .safeParse({ commande_id: commandeId, objet: f.objet, documents: docs, echantillon: f.echantillon,
        echantillon_description: f.echantillon ? f.echantillon_description.trim() || null : null, echantillon_envoye_le: f.echantillon && f.echantillon_envoye_le ? f.echantillon_envoye_le : null,
        echantillon_cout_xof: f.echantillon && f.echantillon_cout_xof ? Number(f.echantillon_cout_xof) : null, essais_requis: f.essais_requis });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('approbations_techniques').insert(v.data)))) onSaved();
  };
  return (
    <Tiroir titre={t('approbation.nouvelle_version')} onClose={onClose}>
      <Champ label={t('approbation.objet')}><input value={f.objet} maxLength={300} onChange={(e) => setF({ ...f, objet: e.target.value })} /></Champ>
      <Champ label={t('approbation.pieces')}><Depot dossierId={dossierId} valeur={null} onChange={(c) => setDocs((d) => (d.length < 30 ? [...d, c] : d))} /></Champ>
      {docs.length > 0 && <span className="mute">{t('approbation.pieces_jointes', { n: docs.length })}</span>}
      <label className="champ" style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={f.echantillon} onChange={(e) => setF({ ...f, echantillon: e.target.checked })} /><span>{t('approbation.echantillon')}</span></label>
      {f.echantillon && <>
        <Champ label={t('approbation.echantillon_description')}><input value={f.echantillon_description} maxLength={1000} onChange={(e) => setF({ ...f, echantillon_description: e.target.value })} /></Champ>
        <Champ label={t('approbation.echantillon_envoye_le')}><input type="date" max={new Date().toISOString().slice(0, 10)} value={f.echantillon_envoye_le} onChange={(e) => setF({ ...f, echantillon_envoye_le: e.target.value })} /></Champ>
        <Champ label={t('approbation.echantillon_cout')}><input inputMode="numeric" value={f.echantillon_cout_xof} onChange={(e) => setF({ ...f, echantillon_cout_xof: e.target.value.replace(/\D/g, '') })} /></Champ>
      </>}
      <label className="champ" style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={f.essais_requis} onChange={(e) => setF({ ...f, essais_requis: e.target.checked })} /><span>{t('approbation.essais_requis')}</span></label>
      <p className="mute">{t('approbation.aide_version')}</p>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

function Decision({ v, dossierId, onClose, onSaved }: { v: Approbation; dossierId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [f, setF] = useState({ decision: 'approuvee', signataire: '', document: '', date: new Date().toISOString().slice(0, 10), commentaire: '' });
  const enregistrer = async () => {
    const x = z.object({ p_approbation: z.string().uuid(), p_decision: z.enum(['approuvee', 'refusee']), p_signataire: z.string().trim().min(2).max(120),
      p_document: CHEMIN.min(1), p_decision_le: DATE, p_commentaire: z.string().trim().max(2000).nullable() }).strict()
      .refine((y) => y.p_decision === 'approuvee' || (y.p_commentaire ?? '').length >= 5)
      .safeParse({ p_approbation: v.id, p_decision: f.decision, p_signataire: f.signataire, p_document: f.document, p_decision_le: f.date, p_commentaire: f.commentaire.trim() || null });
    if (!x.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('enregistrer_decision_approbation', x.data)))) onSaved();
  };
  return (
    <Tiroir titre={`${t('approbation.enregistrer_decision')} — v${v.version}`} onClose={onClose}>
      <Champ label={t('approbation.decision')}><select value={f.decision} onChange={(e) => setF({ ...f, decision: e.target.value })}>
        <option value="approuvee">{t('approbation.statuts.approuvee')}</option><option value="refusee">{t('approbation.statuts.refusee')}</option></select></Champ>
      <Champ label={t('approbation.signataire')}><input value={f.signataire} maxLength={120} onChange={(e) => setF({ ...f, signataire: e.target.value })} /></Champ>
      <Champ label={t('approbation.date_decision')}><input type="date" max={new Date().toISOString().slice(0, 10)} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Champ>
      <Champ label={t('approbation.document_signe')}><Depot dossierId={dossierId} valeur={f.document || null} onChange={(c) => setF({ ...f, document: c })} /></Champ>
      <Champ label={t('approbation.reserves')}><textarea rows={3} maxLength={2000} value={f.commentaire} onChange={(e) => setF({ ...f, commentaire: e.target.value })} /></Champ>
      <p className="mute">{t('approbation.aide_decision')}</p>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours || !f.document} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

function NouvelEssai({ commandeId, dossierId, onClose, onSaved }: { commandeId: string; dossierId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), lieu: '', protocole: '', temoins: '', pv: '' });
  const [res, setRes] = useState<Resultat[]>([{ critere: '', attendu: '', mesure: '', conforme: true }]);
  const enregistrer = async () => {
    const r = z.object({ critere: z.string().trim().min(2).max(200), attendu: z.string().trim().max(200), mesure: z.string().trim().max(200), conforme: z.boolean() }).strict();
    const v = z.object({ commande_id: z.string().uuid(), date_essai: DATE, lieu: z.string().trim().max(200).nullable(), protocole: z.string().trim().min(3).max(2000),
      resultats: z.array(r).min(1).max(100), temoins: z.string().trim().max(500).nullable(), pv_document: CHEMIN.nullable() }).strict()
      .safeParse({ commande_id: commandeId, date_essai: f.date, lieu: f.lieu.trim() || null, protocole: f.protocole, resultats: res.filter((x) => x.critere.trim()),
        temoins: f.temoins.trim() || null, pv_document: f.pv || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('essais_usine').insert(v.data)))) onSaved();
  };
  const maj = (i: number, p: Partial<Resultat>) => setRes(res.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Tiroir titre={t('essais.nouveau')} onClose={onClose}>
      <Champ label={t('essais.date')}><input type="date" max={new Date().toISOString().slice(0, 10)} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Champ>
      <Champ label={t('essais.lieu')}><input value={f.lieu} maxLength={200} onChange={(e) => setF({ ...f, lieu: e.target.value })} /></Champ>
      <Champ label={t('essais.protocole')}><textarea rows={2} maxLength={2000} value={f.protocole} onChange={(e) => setF({ ...f, protocole: e.target.value })} /></Champ>
      <div className="section-titre">{t('essais.resultats')}</div>
      {res.map((x, i) => (
        <div key={i} className="actions" style={{ flexWrap: 'wrap' }}>
          <input placeholder={t('essais.critere')} aria-label={t('essais.critere')} maxLength={200} value={x.critere} onChange={(e) => maj(i, { critere: e.target.value })} />
          <input placeholder={t('essais.attendu')} aria-label={t('essais.attendu')} maxLength={200} value={x.attendu} onChange={(e) => maj(i, { attendu: e.target.value })} />
          <input placeholder={t('essais.mesure')} aria-label={t('essais.mesure')} maxLength={200} value={x.mesure} onChange={(e) => maj(i, { mesure: e.target.value })} />
          <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={x.conforme} onChange={(e) => maj(i, { conforme: e.target.checked })} />{t('essais.conforme')}</label>
        </div>
      ))}
      {res.length < 100 && <Bouton petit onClick={() => setRes([...res, { critere: '', attendu: '', mesure: '', conforme: true }])}>{t('essais.ajouter_critere')}</Bouton>}
      <Champ label={t('essais.temoins')}><input value={f.temoins} maxLength={500} onChange={(e) => setF({ ...f, temoins: e.target.value })} /></Champ>
      <Champ label={t('essais.pv')}><Depot dossierId={dossierId} valeur={f.pv || null} onChange={(c) => setF({ ...f, pv: c })} /></Champ>
      <p className="mute">{t('essais.aide')}</p>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}
