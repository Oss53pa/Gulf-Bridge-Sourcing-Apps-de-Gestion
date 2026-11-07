// Lot 1, M2 : vérification d'un client (cinq contrôles, bénéficiaires effectifs).
// Règles, cloisonnement et décision à quatre yeux appliqués en base.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date } from '../lib/format';
import { Bandeau, Bouton, Champ, Statut, Tiroir } from '../components/ui';

const CONTROLES = ['identite', 'immatriculation', 'beneficiaires_effectifs', 'solvabilite', 'sanctions'] as const;
const RESULTATS = ['conforme', 'non_conforme', 'a_verifier'] as const;
type Controle = { resultat: string; source: string; verifie_le: string; commentaire?: string };
interface Verification { id: string; statut: 'en_cours' | 'validee' | 'refusee' | 'perimee'; controles: Record<string, Controle>; cree_par: string | null;
  valide_jusqu_au: string | null; motif: string | null; cree_le: string }
interface Beneficiaire { id: string; nom: string; nationalite: string | null; pourcentage: number; fonction: string | null; sortie_le: string | null }
const STATUT = { en_cours: 'att', validee: 'ok', refusee: 'err', perimee: 'neutre' } as const;

export function VerificationClient({ clientId, onChange }: { clientId: string; onChange: () => void }) {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const role = profil?.role ?? '';
  const peutSaisir = ['admin', 'hub_afrique', 'agent_pays'].includes(role);
  const ver = useAsync(async () => ok(await supabase.from('verifications_clients').select('id, statut, controles, cree_par, valide_jusqu_au, motif, cree_le')
    .eq('client_id', clientId).order('cree_le', { ascending: false }).limit(5)) as Verification[], [clientId]);
  const ben = useAsync(async () => ok(await supabase.from('beneficiaires_effectifs').select('id, nom, nationalite, pourcentage, fonction, sortie_le')
    .eq('client_id', clientId).is('sortie_le', null).order('pourcentage', { ascending: false })) as Beneficiaire[], [clientId]);
  const a = useAction();
  const [saisie, setSaisie] = useState(false);
  const [nouveauBen, setNouveauBen] = useState(false);
  const [motif, setMotif] = useState('');
  const encours = (ver.data ?? []).find((v) => v.statut === 'en_cours') ?? null;
  const recharger = () => { void ver.recharger(); void ben.recharger(); onChange(); };
  const statuer = async (decision: 'validee' | 'refusee') => {
    if (!encours) return;
    if (await a.executer(async () => ok(await supabase.rpc('statuer_verification_client', { p_verification: encours.id, p_decision: decision,
      p_motif: decision === 'refusee' ? motif.trim() : null })))) { setMotif(''); recharger(); }
  };
  const sortir = async (b: Beneficiaire) => {
    if (await a.executer(async () => ok(await supabase.from('beneficiaires_effectifs').update({ sortie_le: new Date().toISOString().slice(0, 10) }).eq('id', b.id)))) recharger();
  };
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="section-titre">{t('verif.beneficiaires')}</div>
      {(ben.data ?? []).length === 0 ? <span className="mute">{t('verif.aucun_beneficiaire')}</span> : (
        <table className="t"><tbody>{(ben.data ?? []).map((b) => (
          <tr key={b.id}><td>{b.nom}{b.fonction ? <span className="mute"> · {b.fonction}</span> : null}</td><td>{b.nationalite ?? '—'}</td>
            <td className="num">{b.pourcentage} %</td>
            <td className="num">{peutSaisir && <Bouton petit onClick={() => void sortir(b)}>{t('verif.sortie')}</Bouton>}</td></tr>))}</tbody></table>
      )}
      {peutSaisir && <Bouton petit onClick={() => setNouveauBen(true)}>{t('verif.ajouter_beneficiaire')}</Bouton>}
      <p className="mute">{t('verif.aide_beneficiaires')}</p>

      <div className="section-titre">{t('verif.verification')}</div>
      <Bandeau type="err">{ver.erreur ?? ben.erreur ?? a.erreur}</Bandeau>
      {(ver.data ?? []).slice(0, 1).map((v) => (
        <div key={v.id}>
          <Statut statut={STATUT[v.statut]} libelle={t(`verif.statut.${v.statut}`)} />
          {v.valide_jusqu_au && <span className="mute"> · {t('verif.valide_jusqu_au', { date: date(v.valide_jusqu_au, langue) })}</span>}
          {v.motif && <div className="mute">{v.motif}</div>}
          <table className="t"><tbody>{CONTROLES.map((k) => {
            const c = v.controles[k];
            return (<tr key={k}><td>{t(`verif.controle.${k}`)}</td>
              <td>{c ? <Statut statut={c.resultat === 'conforme' ? 'ok' : c.resultat === 'non_conforme' ? 'err' : 'att'} libelle={t(`verif.resultat.${c.resultat}`)} /> : <span className="mute">—</span>}</td>
              <td className="mute">{c ? `${c.source} · ${date(c.verifie_le, langue)}` : ''}</td></tr>);
          })}</tbody></table>
        </div>
      ))}
      <div className="actions" style={{ flexWrap: 'wrap' }}>
        {peutSaisir && <Bouton onClick={() => setSaisie(true)}>{encours ? t('verif.completer') : t('verif.nouvelle')}</Bouton>}
        {role === 'admin' && encours && encours.cree_par !== profil?.id && <>
          <Bouton variante="primaire" disabled={a.enCours} onClick={() => void statuer('validee')}>{t('verif.valider')}</Bouton>
          <input value={motif} maxLength={1000} placeholder={t('champs.motif')} onChange={(e) => setMotif(e.target.value)} aria-label={t('champs.motif')} />
          <Bouton variante="danger" disabled={a.enCours || motif.trim().length < 5} onClick={() => void statuer('refusee')}>{t('clients.refuser')}</Bouton>
        </>}
      </div>
      {saisie && <SaisieControles clientId={clientId} existante={encours} onClose={() => setSaisie(false)} onSaved={() => { setSaisie(false); recharger(); }} />}
      {nouveauBen && <NouveauBeneficiaire clientId={clientId} onClose={() => setNouveauBen(false)} onSaved={() => { setNouveauBen(false); recharger(); }} />}
    </section>
  );
}

function SaisieControles({ clientId, existante, onClose, onSaved }: { clientId: string; existante: Verification | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState<Record<string, Controle>>(() => Object.fromEntries(CONTROLES.map((k) => [k,
    existante?.controles[k] ?? { resultat: 'a_verifier', source: '', verifie_le: aujourdhui }])));
  const enregistrer = async () => {
    const controle = z.object({ resultat: z.enum(RESULTATS), source: z.string().trim().min(2).max(200), verifie_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      commentaire: z.string().max(1000).optional() }).strict();
    // Seuls les contrôles renseignés (source indiquée) sont envoyés ; commentaire omis s'il est vide.
    const saisis: Record<string, Controle> = {};
    for (const [k, c] of Object.entries(f)) {
      if (!c.source.trim()) continue;
      saisis[k] = { resultat: c.resultat, source: c.source.trim(), verifie_le: c.verifie_le, ...(c.commentaire?.trim() ? { commentaire: c.commentaire.trim() } : {}) };
    }
    const v = z.record(z.enum(CONTROLES), controle).safeParse(saisis);
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    const okk = await a.executer(async () => {
      if (existante) ok(await supabase.from('verifications_clients').update({ controles: v.data }).eq('id', existante.id));
      else ok(await supabase.from('verifications_clients').insert({ client_id: z.string().uuid().parse(clientId), controles: v.data }));
    });
    if (okk) onSaved();
  };
  return (
    <Tiroir titre={t('verif.saisie')} onClose={onClose}>
      <p className="mute">{t('verif.aide_saisie')}</p>
      {CONTROLES.map((k) => (
        <fieldset key={k} className="champ" style={{ border: '1px solid var(--border)', padding: 8 }}>
          <span>{t(`verif.controle.${k}`)}</span>
          <div className="actions" style={{ flexWrap: 'wrap' }}>
            <select value={f[k].resultat} onChange={(e) => setF({ ...f, [k]: { ...f[k], resultat: e.target.value } })} aria-label={t('verif.resultat_label')}>
              {RESULTATS.map((r) => <option key={r} value={r}>{t(`verif.resultat.${r}`)}</option>)}</select>
            <input value={f[k].source} maxLength={200} placeholder={t('verif.source')} aria-label={t('verif.source')}
              onChange={(e) => setF({ ...f, [k]: { ...f[k], source: e.target.value } })} />
            <input type="date" value={f[k].verifie_le} max={aujourdhui} aria-label={t('verif.verifie_le')}
              onChange={(e) => setF({ ...f, [k]: { ...f[k], verifie_le: e.target.value } })} />
          </div>
          <input value={f[k].commentaire ?? ''} maxLength={1000} placeholder={t('champs.commentaire')} aria-label={t('champs.commentaire')}
            onChange={(e) => setF({ ...f, [k]: { ...f[k], commentaire: e.target.value } })} />
        </fieldset>
      ))}
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

function NouveauBeneficiaire({ clientId, onClose, onSaved }: { clientId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [f, setF] = useState({ nom: '', nationalite: '', pourcentage: '', fonction: '' });
  const enregistrer = async () => {
    const v = z.object({ client_id: z.string().uuid(), nom: z.string().trim().min(2).max(200), nationalite: z.string().regex(/^[A-Z]{2}$/).nullable(),
      pourcentage: z.coerce.number().positive().max(100), fonction: z.string().trim().max(120).nullable() }).strict()
      .safeParse({ client_id: clientId, nom: f.nom, nationalite: f.nationalite.trim().toUpperCase() || null, pourcentage: f.pourcentage, fonction: f.fonction.trim() || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('beneficiaires_effectifs').insert(v.data)))) onSaved();
  };
  return (
    <Tiroir titre={t('verif.ajouter_beneficiaire')} onClose={onClose}>
      <Champ label={t('verif.nom')}><input value={f.nom} maxLength={200} onChange={(e) => setF({ ...f, nom: e.target.value })} /></Champ>
      <Champ label={t('verif.nationalite')}><input value={f.nationalite} maxLength={2} onChange={(e) => setF({ ...f, nationalite: e.target.value })} /></Champ>
      <Champ label={t('verif.pourcentage')}><input type="number" min={0} max={100} step="0.01" value={f.pourcentage} onChange={(e) => setF({ ...f, pourcentage: e.target.value })} /></Champ>
      <Champ label={t('verif.fonction')}><input value={f.fonction} maxLength={120} onChange={(e) => setF({ ...f, fonction: e.target.value })} /></Champ>
      <p className="mute">{t('verif.aide_beneficiaires')}</p>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}
