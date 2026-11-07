import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { VerificationClient } from './VerificationClient';
import { useAuth } from '../lib/auth';
import { date, nombre } from '../lib/format';
import { normaliser } from '../lib/droits';
import { invaliderReferentiels } from '../lib/referentiels';
import type { Article, Client, Compte, DueDiligence, Fournisseur } from '../lib/types';
import { Bandeau, Bouton, CadreTableau, Champ, Chargement, Entete, Statut, Tiroir, Vide } from '../components/ui';

// ============================================================================ Clients
const schemaClient = z.object({
  raison_sociale: z.string().trim().min(2).max(200),
  societe_id: z.string().uuid(),
  pays: z.string().regex(/^[A-Z]{2}$/),
  devise: z.enum(['XOF', 'XAF', 'USD', 'CNY']),
  segment: z.string().trim().max(80).nullable(),
  specialite: z.enum(['equipement_site', 'approvisionnement_industriel', 'autre']).nullable(),
  conditions_paiement: z.string().trim().max(200).nullable(),
  langue: z.enum(['fr', 'en', 'zh']),
  origine: z.enum(['direct', 'agent_pays']),
  agent_id: z.string().uuid().nullable(),
}).strict();

export function Clients() {
  const { t } = useTranslation();
  const { profil, societes, langue } = useAuth();
  const role = profil?.role ?? '';
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [creer, setCreer] = useState(false);
  const l = useAsync(async () => ok(await supabase.from('clients').select('*').is('archive_le', null).order('raison_sociale').limit(1000)) as Client[], []);
  const liste = useMemo(() => (l.data ?? []).filter((c) => !q || normaliser(c.raison_sociale).includes(normaliser(q))), [l.data, q]);
  const c = liste.find((x) => x.id === sel) ?? null;
  const a = useAction();
  const peutCreer = ['admin', 'hub_afrique', 'agent_pays'].includes(role);
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.commercial')} · M2`} titre={t('clients.titre', { n: liste.length })}
        actions={peutCreer && <Bouton variante="primaire" onClick={() => setCreer(true)}>{t('clients.nouveau')}</Bouton>} />
      <input className="search" style={{ flex: 'none' }} placeholder={t('clients.filtrer')} value={q} maxLength={80} onChange={(e) => setQ(e.target.value)} aria-label={t('clients.filtrer')} />
      <Bandeau type="err">{l.erreur ?? a.erreur}</Bandeau>
      <div className="liste-detail">
        <div className="liste"><CadreTableau>
          {l.chargement ? <Chargement /> : liste.length === 0 ? <Vide>{t('clients.aucun')}</Vide> : (
            <table className="t"><thead><tr><th>{t('champs.raison_sociale')}</th><th>{t('champs.pays')}</th><th>{t('champs.devise')}</th><th>{t('champs.societe')}</th><th>{t('champs.origine')}</th><th>{t('champs.verification')}</th></tr></thead>
              <tbody>{liste.map((x) => (
                <tr key={x.id} className="cliquable" aria-selected={x.id === sel} onClick={() => setSel(x.id)}>
                  <td>{x.raison_sociale}<div className="mute">{x.segment ?? ''}</div></td><td>{x.pays}</td><td>{x.devise}</td>
                  <td className="sec">{societes.find((s) => s.id === x.societe_id)?.raison_sociale ?? '—'}</td>
                  <td className="sec">{t(`origines.${x.origine}`)}</td>
                  <td><Statut statut={x.verification_statut} libelle={t(`verification.${x.verification_statut}`)} /></td>
                </tr>))}</tbody></table>
          )}
        </CadreTableau></div>
        <aside className="detail">
          {!c ? <Vide>{t('clients.choisir')}</Vide> : (<>
            <div className="surtitre">{c.reference ?? t('clients.fiche')}</div>
            <h2 style={{ fontSize: 22 }}>{c.raison_sociale}</h2>
            <dl className="dl">
              <dt>{t('champs.pays')}</dt><dd>{c.pays}</dd>
              <dt>{t('champs.devise')}</dt><dd>{c.devise}</dd>
              <dt>{t('champs.specialite')}</dt><dd>{c.specialite ? t(`specialites.${c.specialite}`) : '—'}</dd>
              <dt>{t('champs.conditions_paiement')}</dt><dd>{c.conditions_paiement ?? '—'}</dd>
              <dt>{t('champs.langue')}</dt><dd>{c.langue.toUpperCase()}</dd>
              <dt>{t('champs.verification')}</dt><dd>{t(`verification.${c.verification_statut}`)} {c.verification_date ? `· ${date(c.verification_date, langue)}` : ''}</dd>
            </dl>
            <p className="mute">{t('clients.aide_verification')}</p>
            {['admin', 'hub_afrique', 'agent_pays'].includes(role) && <VerificationClient clientId={c.id} onChange={() => void l.recharger()} />}
          </>)}
        </aside>
      </div>
      {creer && <NouveauClient onClose={() => setCreer(false)} onCree={() => { setCreer(false); invaliderReferentiels(); void l.recharger(); }} />}
    </div>
  );
}

function NouveauClient({ onClose, onCree }: { onClose: () => void; onCree: () => void }) {
  const { t } = useTranslation();
  const { profil, societes } = useAuth();
  const agent = profil?.role === 'agent_pays';
  const [f, setF] = useState({ raison_sociale: '', societe_id: agent ? (profil?.societes[0] ?? '') : '', pays: agent ? (profil?.pays ?? '') : 'CI',
    devise: agent ? 'XAF' : 'XOF', segment: '', specialite: '', conditions_paiement: '', langue: 'fr' });
  const a = useAction();
  const envoyer = async () => {
    const v = schemaClient.safeParse({ ...f, pays: f.pays.toUpperCase(), segment: f.segment || null, specialite: f.specialite || null,
      conditions_paiement: f.conditions_paiement || null, langue: f.langue, origine: agent ? 'agent_pays' : 'direct', agent_id: agent ? profil?.id ?? null : null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('clients').insert(v.data)))) onCree();
  };
  return (
    <Tiroir titre={t('clients.nouveau')} onClose={onClose}>
      <Champ label={t('champs.raison_sociale')}><input value={f.raison_sociale} maxLength={200} onChange={(e) => setF({ ...f, raison_sociale: e.target.value })} /></Champ>
      <div className="grille2">
        <Champ label={t('champs.societe')}><select value={f.societe_id} onChange={(e) => setF({ ...f, societe_id: e.target.value })}>
          <option value="">—</option>{societes.map((s) => <option key={s.id} value={s.id}>{s.raison_sociale}</option>)}</select></Champ>
        <Champ label={t('champs.pays')}><select value={f.pays} disabled={agent} onChange={(e) => setF({ ...f, pays: e.target.value, devise: e.target.value === 'CI' ? 'XOF' : e.target.value === 'GA' || e.target.value === 'CM' ? 'XAF' : f.devise })}>
          {['CI', 'GA', 'CM', 'SN', 'BF', 'ML', 'TG', 'BJ', 'CN'].map((p) => <option key={p} value={p}>{p}</option>)}</select></Champ>
        <Champ label={t('champs.devise')}><select value={f.devise} onChange={(e) => setF({ ...f, devise: e.target.value })}>
          {['XOF', 'XAF', 'USD', 'CNY'].map((d) => <option key={d}>{d}</option>)}</select></Champ>
        <Champ label={t('champs.langue')}><select value={f.langue} onChange={(e) => setF({ ...f, langue: e.target.value })}>
          <option value="fr">FR</option><option value="en">EN</option><option value="zh">中文</option></select></Champ>
        <Champ label={t('champs.segment')}><input value={f.segment} maxLength={80} onChange={(e) => setF({ ...f, segment: e.target.value })} /></Champ>
        <Champ label={t('champs.specialite')}><select value={f.specialite} onChange={(e) => setF({ ...f, specialite: e.target.value })}>
          <option value="">—</option>{['equipement_site', 'approvisionnement_industriel', 'autre'].map((s) => <option key={s} value={s}>{t(`specialites.${s}`)}</option>)}</select></Champ>
      </div>
      <Champ label={t('champs.conditions_paiement')}><input value={f.conditions_paiement} maxLength={200} onChange={(e) => setF({ ...f, conditions_paiement: e.target.value })} /></Champ>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void envoyer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

// ============================================================================ Fournisseurs
const CRITERES = ['Existence légale et licence', 'Capacité d\'export', 'Audit d\'usine', 'Capacités de production', 'Certifications',
  'Références', 'Litiges', 'Conformité sociale et environnementale', 'Bénéficiaires effectifs', 'Listes de sanctions',
  'Concordance du compte bancaire avec la licence'];

export function Fournisseurs() {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const role = profil?.role ?? '';
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [creer, setCreer] = useState(false);
  const [dd, setDd] = useState<DueDiligence | 'nouvelle' | null>(null);
  const [compte, setCompte] = useState(false);
  const l = useAsync(async () => ok(await supabase.from('fournisseurs').select('*').is('archive_le', null).order('raison_sociale_en').limit(1000)) as Fournisseur[], []);
  const liste = useMemo(() => (l.data ?? []).filter((f) => !q || normaliser(`${f.raison_sociale_en} ${f.raison_sociale_zh ?? ''}`).includes(normaliser(q))), [l.data, q]);
  const f = liste.find((x) => x.id === sel) ?? null;
  const dds = useAsync(async () => (f ? ok(await supabase.from('due_diligences').select('*').eq('fournisseur_id', f.id).order('cree_le', { ascending: false })) as DueDiligence[] : []), [f?.id]);
  const comptes = useAsync(async () => (f && ['admin', 'achats_chine'].includes(role) ? ok(await supabase.from('comptes_paiement').select('*').eq('fournisseur_id', f.id).is('archive_le', null)) as Compte[] : []), [f?.id]);
  const a = useAction();
  const ecrit = ['admin', 'achats_chine'].includes(role);
  const agreer = async () => { if (f && await a.executer(async () => ok(await supabase.rpc('agreer_fournisseur', { p_fournisseur: f.id })))) void l.recharger(); };
  const statuerDd = async (x: DueDiligence, s: 'validee' | 'refusee') => { if (await a.executer(async () => ok(await supabase.rpc('valider_due_diligence', { p_dd: x.id, p_statut: s, p_conclusion: null })))) void dds.recharger(); };
  const demanderVerif = async (c: Compte) => { if (await a.executer(async () => ok(await supabase.rpc('demander_verification_compte', { p_compte: c.id })))) void comptes.recharger(); };
  const verifier = async (c: Compte) => { if (await a.executer(async () => ok(await supabase.rpc('verifier_compte', { p_compte: c.id })))) void comptes.recharger(); };
  const engagement = async () => {
    if (!f) return;
    if (await a.executer(async () => ok(await supabase.from('fournisseurs').update({ engagement_non_commission_le: new Date().toISOString().slice(0, 10) }).eq('id', f.id)))) void l.recharger();
  };

  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.achats')} · M4 · M16`} titre={t('fournisseurs.titre', { n: liste.length, agrees: liste.filter((x) => x.statut_agrement === 'agree').length })}
        actions={ecrit && <Bouton variante="primaire" onClick={() => setCreer(true)}>{t('fournisseurs.nouveau')}</Bouton>} />
      <input className="search" style={{ flex: 'none' }} placeholder={t('fournisseurs.filtrer')} value={q} maxLength={80} onChange={(e) => setQ(e.target.value)} aria-label={t('fournisseurs.filtrer')} />
      <Bandeau type="err">{l.erreur ?? a.erreur}</Bandeau>
      <div className="liste-detail">
        <div className="liste"><CadreTableau>
          {l.chargement ? <Chargement /> : liste.length === 0 ? <Vide>{t('fournisseurs.aucun')}</Vide> : (
            <table className="t"><thead><tr><th>{t('champs.raison_sociale')}</th><th>{t('champs.ville')}</th><th>{t('champs.categories')}</th><th className="num">{t('champs.note')}</th><th>{t('champs.agrement')}</th></tr></thead>
              <tbody>{liste.map((x) => (
                <tr key={x.id} className="cliquable" aria-selected={x.id === sel} onClick={() => setSel(x.id)}>
                  <td>{x.raison_sociale_en}<div className="mute">{x.raison_sociale_zh ?? ''}</div></td><td className="sec">{x.ville ?? '—'}</td>
                  <td className="sec">{x.categories.join(', ')}</td><td className="num">{x.note ?? '—'}</td>
                  <td><Statut statut={x.statut_agrement} libelle={t(`agrement.${x.statut_agrement}`)} /></td>
                </tr>))}</tbody></table>
          )}
        </CadreTableau></div>
        <aside className="detail">
          {!f ? <Vide>{t('fournisseurs.choisir')}</Vide> : (<>
            <div className="surtitre">{f.uscc ?? t('fournisseurs.fiche')}</div>
            <h2 style={{ fontSize: 22 }}>{f.raison_sociale_en}</h2>
            <dl className="dl">
              <dt>{t('champs.agrement')}</dt><dd>{t(`agrement.${f.statut_agrement}`)}{f.agree_le ? ` · ${date(f.agree_le, langue)}` : ''}</dd>
              <dt>{t('fournisseurs.engagement')}</dt><dd>{f.engagement_non_commission_le ? date(f.engagement_non_commission_le, langue) : t('fournisseurs.non_signe')}</dd>
            </dl>
            {ecrit && !f.engagement_non_commission_le && <Bouton petit onClick={() => void engagement()}>{t('fournisseurs.enregistrer_engagement')}</Bouton>}
            {role === 'admin' && f.statut_agrement !== 'agree' && <Bouton variante="primaire" onClick={() => void agreer()}>{t('fournisseurs.agreer')}</Bouton>}
            <div className="filet" />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="section-titre">{t('fournisseurs.due_diligence')}</span>
              {ecrit && <Bouton petit onClick={() => setDd('nouvelle')}>{t('commun.ajouter')}</Bouton>}
            </div>
            {(dds.data ?? []).length === 0 ? <span className="mute">{t('fournisseurs.aucune_dd')}</span> : (dds.data ?? []).map((x) => (
              <div key={x.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Statut statut={x.statut} libelle={`${t(`statuts_dd.${x.statut}`)} · ${x.note ?? '—'}/100`} />
                  <span className="mute">{x.valide_jusqu_au ? t('fournisseurs.valide_jusqu', { d: date(x.valide_jusqu_au, langue) }) : t(`niveaux_dd.${x.niveau}`)}</span>
                </div>
                <div className="actions">
                  <a className="btn petit" href={`/imprimer/due-diligence/${x.id}`}>{t('commun.imprimer')}</a>
                  {ecrit && x.statut === 'en_cours' && <Bouton petit onClick={() => setDd(x)}>{t('fournisseurs.grille')}</Bouton>}
                  {role === 'admin' && x.statut === 'en_cours' && <>
                    <Bouton petit onClick={() => void statuerDd(x, 'validee')}>{t('fiche.valider')}</Bouton>
                    <Bouton petit variante="danger" onClick={() => void statuerDd(x, 'refusee')}>{t('fiche.refuser')}</Bouton></>}
                </div>
              </div>
            ))}
            {ecrit && <>
              <div className="filet" />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="section-titre">{t('fournisseurs.comptes')}</span>
                <Bouton petit onClick={() => setCompte(true)}>{t('commun.ajouter')}</Bouton>
              </div>
              {(comptes.data ?? []).map((c) => (
                <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>{t(`types_compte.${c.type}`)} · {c.devise} · {c.titulaire}</span>
                  <span className="mute">{c.banque ?? ''} {c.numero.replace(/.(?=.{4})/g, '•')}</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {c.verifie ? <Statut statut="verifie" libelle={t('fournisseurs.verifie')} /> : <Statut statut="non_verifie" libelle={t('fournisseurs.non_verifie')} />}
                    {!c.verifie && !c.verification_demandee_par && <Bouton petit onClick={() => void demanderVerif(c)}>{t('fournisseurs.demander_verif')}</Bouton>}
                    {!c.verifie && c.verification_demandee_par && c.verification_demandee_par !== profil?.id && (role === 'admin' || profil?.delegue_validation) &&
                      <Bouton petit variante="primaire" onClick={() => void verifier(c)}>{t('fournisseurs.verifier')}</Bouton>}
                    {!c.verifie && c.verification_demandee_par === profil?.id && <span className="mute">{t('fournisseurs.attente_second')}</span>}
                  </div>
                </div>
              ))}
            </>}
          </>)}
        </aside>
      </div>
      {creer && <NouveauFournisseur onClose={() => setCreer(false)} onCree={() => { setCreer(false); invaliderReferentiels(); void l.recharger(); }} />}
      {dd && f && <GrilleDd fournisseur={f} dd={dd === 'nouvelle' ? null : dd} onClose={() => setDd(null)} onOk={() => { setDd(null); void dds.recharger(); }} />}
      {compte && f && <NouveauCompte fournisseur={f} onClose={() => setCompte(false)} onOk={() => { setCompte(false); void comptes.recharger(); }} />}
    </div>
  );
}

function NouveauFournisseur({ onClose, onCree }: { onClose: () => void; onCree: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ raison_sociale_en: '', raison_sociale_zh: '', uscc: '', ville: '', categories: '', apporte_par_client: false });
  const a = useAction();
  const envoyer = async () => {
    const v = z.object({
      raison_sociale_en: z.string().trim().min(2).max(200), raison_sociale_zh: z.string().trim().max(200).nullable(),
      uscc: z.string().regex(/^[0-9A-Z]{18}$/).nullable(), ville: z.string().trim().max(80).nullable(),
      categories: z.array(z.string().trim().min(1).max(80)).max(20), apporte_par_client: z.boolean(),
    }).strict().safeParse({ raison_sociale_en: f.raison_sociale_en, raison_sociale_zh: f.raison_sociale_zh || null, uscc: f.uscc.toUpperCase() || null,
      ville: f.ville || null, categories: f.categories.split(',').map((x) => x.trim()).filter(Boolean), apporte_par_client: f.apporte_par_client });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('fournisseurs').insert(v.data)))) onCree();
  };
  return (
    <Tiroir titre={t('fournisseurs.nouveau')} onClose={onClose}>
      <Champ label={t('fournisseurs.nom_en')}><input value={f.raison_sociale_en} maxLength={200} onChange={(e) => setF({ ...f, raison_sociale_en: e.target.value })} /></Champ>
      <Champ label={t('fournisseurs.nom_zh')}><input value={f.raison_sociale_zh} maxLength={200} onChange={(e) => setF({ ...f, raison_sociale_zh: e.target.value })} /></Champ>
      <div className="grille2">
        <Champ label={t('fournisseurs.uscc')}><input value={f.uscc} maxLength={18} onChange={(e) => setF({ ...f, uscc: e.target.value })} /></Champ>
        <Champ label={t('champs.ville')}><input value={f.ville} maxLength={80} onChange={(e) => setF({ ...f, ville: e.target.value })} /></Champ>
      </div>
      <Champ label={t('fournisseurs.categories_aide')}><input value={f.categories} maxLength={500} onChange={(e) => setF({ ...f, categories: e.target.value })} /></Champ>
      <label className="champ" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" style={{ width: 18, height: 18 }} checked={f.apporte_par_client} onChange={(e) => setF({ ...f, apporte_par_client: e.target.checked })} />
        <span>{t('fournisseurs.apporte_client')}</span>
      </label>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void envoyer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

function GrilleDd({ fournisseur, dd, onClose, onOk }: { fournisseur: Fournisseur; dd: DueDiligence | null; onClose: () => void; onOk: () => void }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const [niveau, setNiveau] = useState(dd?.niveau ?? 'standard');
  const [grille, setGrille] = useState(dd?.grille.length ? dd.grille : CRITERES.map((c) => ({ critere: c, poids: 10, note: 0, commentaire: '' })));
  const [conclusion, setConclusion] = useState(dd?.conclusion ?? '');
  const a = useAction();
  const note = useMemo(() => {
    const p = grille.reduce((s, x) => s + Number(x.poids), 0);
    return p ? Math.round((1000 * grille.reduce((s, x) => s + Number(x.poids) * Number(x.note) / 5, 0)) / p) / 10 : 0;
  }, [grille]);
  const envoyer = async () => {
    const v = z.array(z.object({ critere: z.string().min(1).max(200), poids: z.number().min(0).max(100), note: z.number().min(0).max(5), commentaire: z.string().max(1000).optional() }).strict()).min(1).safeParse(grille);
    if (!v.success || conclusion.length > 4000) { a.setErreur(t('formulaire.invalide')); return; }
    const corps = { grille: v.data, conclusion: conclusion || null, niveau };
    if (await a.executer(async () => ok(dd
      ? await supabase.from('due_diligences').update(corps).eq('id', dd.id)
      : await supabase.from('due_diligences').insert({ ...corps, fournisseur_id: fournisseur.id, realisee_le: new Date().toISOString().slice(0, 10) })))) onOk();
  };
  return (
    <Tiroir titre={`${t('fournisseurs.grille')} · ${fournisseur.raison_sociale_en}`} onClose={onClose}>
      <Champ label={t('fournisseurs.niveau')}><select value={niveau} onChange={(e) => setNiveau(e.target.value)}>
        <option value="standard">{t('niveaux_dd.standard')}</option><option value="renforcee">{t('niveaux_dd.renforcee')}</option></select></Champ>
      <table className="t"><thead><tr><th>{t('fournisseurs.critere')}</th><th className="num">{t('fournisseurs.poids')}</th><th className="num">{t('fournisseurs.note_5')}</th></tr></thead>
        <tbody>{grille.map((g, i) => (
          <tr key={g.critere}><td>{g.critere}</td>
            <td className="num"><input style={{ width: 60, height: 32 }} inputMode="numeric" value={g.poids} onChange={(e) => setGrille(grille.map((x, j) => j === i ? { ...x, poids: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } : x))} /></td>
            <td className="num"><select style={{ height: 32 }} value={g.note} onChange={(e) => setGrille(grille.map((x, j) => j === i ? { ...x, note: Number(e.target.value) } : x))}>
              {[0, 1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></td></tr>))}
        </tbody></table>
      <div className="section-titre">{t('fournisseurs.note_ponderee')} : {nombre(note, langue, 1)} / 100</div>
      <Champ label={t('fournisseurs.conclusion')}><textarea value={conclusion} maxLength={4000} onChange={(e) => setConclusion(e.target.value)} /></Champ>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void envoyer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

function NouveauCompte({ fournisseur, onClose, onOk }: { fournisseur: Fournisseur; onClose: () => void; onOk: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ type: 'banque', titulaire: fournisseur.raison_sociale_en, devise: 'USD', banque: '', numero: '', swift: '' });
  const a = useAction();
  const envoyer = async () => {
    const v = z.object({ type: z.enum(['banque', 'wechat_pay', 'alipay']), titulaire: z.string().trim().min(2).max(200), devise: z.enum(['USD', 'CNY']),
      banque: z.string().trim().max(200).nullable(), numero: z.string().trim().min(4).max(64), swift: z.string().regex(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/).nullable(),
      fournisseur_id: z.string().uuid() }).strict()
      .safeParse({ ...f, banque: f.banque || null, swift: f.swift.toUpperCase() || null, fournisseur_id: fournisseur.id });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('comptes_paiement').insert(v.data)))) onOk();
  };
  return (
    <Tiroir titre={t('fournisseurs.nouveau_compte')} onClose={onClose}>
      <p className="sec">{t('fournisseurs.aide_compte')}</p>
      <div className="grille2">
        <Champ label={t('champs.type')}><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, devise: e.target.value === 'banque' ? f.devise : 'CNY' })}>
          {['banque', 'wechat_pay', 'alipay'].map((x) => <option key={x} value={x}>{t(`types_compte.${x}`)}</option>)}</select></Champ>
        <Champ label={t('champs.devise')}><select value={f.devise} onChange={(e) => setF({ ...f, devise: e.target.value })}><option>USD</option><option>CNY</option></select></Champ>
      </div>
      <Champ label={t('fournisseurs.titulaire')}><input value={f.titulaire} maxLength={200} onChange={(e) => setF({ ...f, titulaire: e.target.value })} /></Champ>
      {f.type === 'banque' && <Champ label={t('fournisseurs.banque')}><input value={f.banque} maxLength={200} onChange={(e) => setF({ ...f, banque: e.target.value })} /></Champ>}
      <div className="grille2">
        <Champ label={t('fournisseurs.numero')}><input value={f.numero} maxLength={64} onChange={(e) => setF({ ...f, numero: e.target.value })} /></Champ>
        {f.type === 'banque' && <Champ label="SWIFT"><input value={f.swift} maxLength={11} onChange={(e) => setF({ ...f, swift: e.target.value })} /></Champ>}
      </div>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void envoyer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

// ============================================================================ Articles
export function Articles() {
  const { t } = useTranslation();
  const { profil } = useAuth();
  const [creer, setCreer] = useState(false);
  const l = useAsync(async () => ok(await supabase.from('articles').select('*').is('archive_le', null).order('reference').limit(2000)) as Article[], []);
  const ecrit = ['admin', 'achats_chine'].includes(profil?.role ?? '');
  const [f, setF] = useState({ reference: '', designation: '', designation_zh: '', categorie: '', unite: 'piece', code_sh: '', poids_kg: '', volume_m3: '', dangereux: false, classe_danger: '', certificats: '' });
  const a = useAction();
  const envoyer = async () => {
    const n = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
    const v = z.object({ reference: z.string().regex(/^[A-Z0-9-]{3,30}$/), designation: z.string().trim().min(2).max(300), designation_zh: z.string().max(300).nullable(),
      categorie: z.string().trim().min(1).max(120), unite: z.enum(['piece', 'lot', 'kg', 'm', 'm2', 'm3', 'l', 'jeu', 'carton']), code_sh: z.string().regex(/^\d{6}(\d{2,4})?$/),
      poids_kg: z.number().min(0).max(1e6).nullable(), volume_m3: z.number().min(0).max(1e4).nullable(), dangereux: z.boolean(),
      classe_danger: z.string().regex(/^[1-9](\.[1-6])?$/).nullable(), certificats: z.array(z.string().max(40)).max(20) }).strict()
      .refine((x) => !x.dangereux || x.classe_danger)
      .safeParse({ ...f, reference: f.reference.toUpperCase(), designation_zh: f.designation_zh || null, poids_kg: n(f.poids_kg), volume_m3: n(f.volume_m3),
        classe_danger: f.classe_danger || null, certificats: f.certificats.split(',').map((x) => x.trim()).filter(Boolean) });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('articles').insert(v.data)))) { setCreer(false); invaliderReferentiels(); void l.recharger(); }
  };
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.achats')} · ${t('ecrans.articles')}`} titre={t('articles.titre', { n: (l.data ?? []).length })}
        actions={ecrit && <Bouton variante="primaire" onClick={() => setCreer(true)}>{t('articles.nouveau')}</Bouton>} />
      <Bandeau type="err">{l.erreur}</Bandeau>
      <CadreTableau>
        {(l.data ?? []).length === 0 ? <Vide>{t('articles.aucun')}</Vide> : (
          <table className="t"><thead><tr><th>{t('champs.reference')}</th><th>{t('champs.designation')}</th><th>{t('champs.categorie')}</th><th>{t('articles.code_sh')}</th><th>{t('champs.unite')}</th><th className="num">kg</th><th className="num">m³</th><th>{t('articles.dangereux')}</th></tr></thead>
            <tbody>{(l.data ?? []).map((x) => (
              <tr key={x.id}><td className="ref">{x.reference}</td><td>{x.designation}<div className="mute">{x.designation_zh ?? ''}</div></td><td className="sec">{x.categorie}</td>
                <td className="ref">{x.code_sh}</td><td className="sec">{t(`unites.${x.unite}`)}</td><td className="num">{x.poids_kg ?? '—'}</td><td className="num">{x.volume_m3 ?? '—'}</td>
                <td>{x.dangereux ? <Statut statut="err" libelle={t('articles.classe', { c: x.classe_danger })} /> : '—'}</td></tr>))}</tbody></table>
        )}
      </CadreTableau>
      {creer && (
        <Tiroir titre={t('articles.nouveau')} onClose={() => setCreer(false)}>
          <div className="grille2">
            <Champ label={t('champs.reference')}><input value={f.reference} maxLength={30} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Champ>
            <Champ label={t('articles.code_sh')}><input value={f.code_sh} maxLength={10} inputMode="numeric" onChange={(e) => setF({ ...f, code_sh: e.target.value.replace(/\D/g, '') })} /></Champ>
          </div>
          <Champ label={t('champs.designation')}><input value={f.designation} maxLength={300} onChange={(e) => setF({ ...f, designation: e.target.value })} /></Champ>
          <Champ label={t('articles.designation_zh')}><input value={f.designation_zh} maxLength={300} onChange={(e) => setF({ ...f, designation_zh: e.target.value })} /></Champ>
          <div className="grille2">
            <Champ label={t('champs.categorie')}><input value={f.categorie} maxLength={120} onChange={(e) => setF({ ...f, categorie: e.target.value })} /></Champ>
            <Champ label={t('champs.unite')}><select value={f.unite} onChange={(e) => setF({ ...f, unite: e.target.value })}>
              {['piece', 'lot', 'kg', 'm', 'm2', 'm3', 'l', 'jeu', 'carton'].map((u) => <option key={u} value={u}>{t(`unites.${u}`)}</option>)}</select></Champ>
            <Champ label={t('articles.poids')}><input inputMode="decimal" value={f.poids_kg} onChange={(e) => setF({ ...f, poids_kg: e.target.value })} /></Champ>
            <Champ label={t('articles.volume')}><input inputMode="decimal" value={f.volume_m3} onChange={(e) => setF({ ...f, volume_m3: e.target.value })} /></Champ>
          </div>
          <label className="champ" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" style={{ width: 18, height: 18 }} checked={f.dangereux} onChange={(e) => setF({ ...f, dangereux: e.target.checked })} />
            <span>{t('articles.dangereux')}</span></label>
          {f.dangereux && <Champ label={t('articles.classe_danger')}><input value={f.classe_danger} maxLength={3} onChange={(e) => setF({ ...f, classe_danger: e.target.value })} /></Champ>}
          <Champ label={t('articles.certificats')}><input value={f.certificats} maxLength={400} onChange={(e) => setF({ ...f, certificats: e.target.value })} /></Champ>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <Bouton variante="primaire" disabled={a.enCours} onClick={() => void envoyer()}>{t('commun.enregistrer')}</Bouton>
        </Tiroir>
      )}
    </div>
  );
}
