import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, dateHeure } from '../lib/format';
import type { Audit, Parametre, Profil } from '../lib/types';
import { Bandeau, Bouton, CadreTableau, Champ, Entete, Onglets, Statut, Tiroir, Vide } from '../components/ui';
import { useNoms } from '../lib/referentiels';
import { CalendrierParam, DelaisCiblesParam } from './Delais';

export function Journal() {
  const { t } = useTranslation();
  const { langue, fuseau } = useAuth();
  const profils = useNoms('profils');
  const [table, setTable] = useState('');
  const [sel, setSel] = useState<Audit | null>(null);
  const l = useAsync(async () => {
    let r = supabase.from('journal_audit').select('*').order('id', { ascending: false }).limit(500);
    if (table) r = r.eq('table_nom', table);
    return ok(await r) as Audit[];
  }, [table]);
  const a = useAction();
  const [verif, setVerif] = useState<{ premiere_ligne_alteree: number | null; lignes_verifiees: number } | null>(null);
  const verifier = async () => {
    await a.executer(async () => {
      const r = ok(await supabase.rpc('audit_verifier')) as { premiere_ligne_alteree: number | null; lignes_verifiees: number }[];
      setVerif(r[0] ?? null);
    });
  };
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.supervision')} · ${t('journal.ajout_seul')}`} titre={t('journal.titre')}
        actions={<>
          <select className="search" style={{ width: 220 }} value={table} onChange={(e) => setTable(e.target.value)} aria-label={t('journal.filtre_table')}>
            <option value="">{t('journal.toutes_tables')}</option>
            {['dossiers', 'pieces', 'derogations', 'commandes', 'paiements_fournisseurs', 'comptes_paiement', 'factures', 'encaissements', 'inspections', 'parametres', 'profils', 'fournisseurs'].map((x) =>
              <option key={x} value={x}>{t(`tables.${x}`, { defaultValue: x })}</option>)}
          </select>
          <Bouton variante="primaire" onClick={() => void verifier()}>{t('journal.verifier')}</Bouton>
        </>} />
      {verif && (verif.premiere_ligne_alteree === null
        ? <Bandeau type="ok">{t('journal.chaine_ok', { n: verif.lignes_verifiees })}</Bandeau>
        : <Bandeau type="err">{t('journal.chaine_ko', { id: verif.premiere_ligne_alteree })}</Bandeau>)}
      <Bandeau type="err">{l.erreur ?? a.erreur}</Bandeau>
      <div className="liste-detail">
        <div className="liste"><CadreTableau>
          {(l.data ?? []).length === 0 ? <Vide>{t('journal.vide')}</Vide> : (
            <table className="t"><thead><tr><th>#</th><th>{t('champs.horodatage')}</th><th>{t('champs.utilisateur')}</th><th>{t('champs.action')}</th><th>{t('champs.objet')}</th><th>{t('champs.motif')}</th></tr></thead>
              <tbody>{(l.data ?? []).map((j) => (
                <tr key={j.id} className="cliquable" aria-selected={sel?.id === j.id} onClick={() => setSel(j)}>
                  <td className="ref">{j.id}</td><td className="ref">{dateHeure(j.horodatage, langue, fuseau)}</td>
                  <td>{j.utilisateur ? profils[j.utilisateur] ?? '…' : t('journal.systeme')}</td>
                  <td className="sec">{t(`journal.actions.${j.action}`, { defaultValue: j.action })}</td>
                  <td className="sec">{t(`tables.${j.table_nom}`, { defaultValue: j.table_nom })}</td><td>{j.motif ?? ''}</td></tr>))}</tbody></table>
          )}
        </CadreTableau></div>
        <aside className="detail">
          {!sel ? <Vide>{t('journal.choisir')}</Vide> : (<>
            <div className="surtitre">#{sel.id} · {t(`tables.${sel.table_nom}`, { defaultValue: sel.table_nom })}</div>
            <dl className="dl"><dt>{t('journal.empreinte')}</dt><dd style={{ wordBreak: 'break-all' }}><code>{sel.empreinte}</code></dd></dl>
            <div className="section-titre">{t('journal.avant')}</div>
            <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{sel.avant ? JSON.stringify(sel.avant, null, 2) : '—'}</pre>
            <div className="section-titre">{t('journal.apres')}</div>
            <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{sel.apres ? JSON.stringify(sel.apres, null, 2) : '—'}</pre>
          </>)}
        </aside>
      </div>
    </div>
  );
}

type OngletParam = 'parametres' | 'taux' | 'calendrier' | 'delais' | 'utilisateurs' | 'societes';

export function Parametrage() {
  const { t } = useTranslation();
  const [onglet, setOnglet] = useState<OngletParam>('parametres');
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.parametrage')} · ${t('parametrage.dates')}`} titre={t('parametrage.titre')} />
      <Onglets actif={onglet} onChange={setOnglet} items={(['parametres', 'taux', 'calendrier', 'delais', 'utilisateurs', 'societes'] as OngletParam[]).map((id) => ({ id, lib: t(`parametrage.onglets.${id}`) }))} />
      <div className="cadre">
        {onglet === 'parametres' && <Parametres />}
        {onglet === 'taux' && <Taux />}
        {onglet === 'calendrier' && <CalendrierParam />}
        {onglet === 'delais' && <DelaisCiblesParam />}
        {onglet === 'utilisateurs' && <Utilisateurs />}
        {onglet === 'societes' && <Societes />}
      </div>
    </div>
  );
}

function Parametres() {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const l = useAsync(async () => ok(await supabase.from('parametres').select('*').order('cle').order('date_effet', { ascending: false })) as Parametre[], []);
  const [f, setF] = useState<{ cle: string; valeur: string; date_effet: string; commentaire: string } | null>(null);
  const a = useAction();
  const enregistrer = async () => {
    if (!f) return;
    let val: unknown;
    try { val = JSON.parse(f.valeur); } catch { a.setErreur(t('parametrage.json_invalide')); return; }
    const v = z.object({ cle: z.string().regex(/^[a-zA-Z0-9_.]{2,80}$/), valeur: z.unknown(), date_effet: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), commentaire: z.string().max(500).nullable() }).strict()
      .safeParse({ ...f, valeur: val, commentaire: f.commentaire || null });
    if (!v.success || JSON.stringify(val).length > 10000) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('parametres').insert(v.data)))) { setF(null); void l.recharger(); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p className="mute">{t('parametrage.aide')}</p>
      <Bandeau type="err">{l.erreur}</Bandeau>
      <table className="t"><thead><tr><th>{t('parametrage.cle')}</th><th>{t('parametrage.valeur')}</th><th>{t('parametrage.date_effet')}</th><th>{t('champs.commentaire')}</th><th /></tr></thead>
        <tbody>{(l.data ?? []).map((p) => (
          <tr key={p.id}><td className="ref">{p.cle}</td><td><code style={{ fontSize: 12 }}>{JSON.stringify(p.valeur).slice(0, 120)}</code></td><td className="ref">{date(p.date_effet, langue)}</td>
            <td className="mute">{p.commentaire ?? ''}</td>
            <td className="num"><Bouton petit onClick={() => setF({ cle: p.cle, valeur: JSON.stringify(p.valeur), date_effet: new Date().toISOString().slice(0, 10), commentaire: '' })}>{t('parametrage.nouvelle_valeur')}</Bouton></td></tr>))}</tbody></table>
      {f && (
        <Tiroir titre={t('parametrage.nouvelle_valeur')} onClose={() => setF(null)}>
          <p className="sec">{t('parametrage.aide_date')}</p>
          <Champ label={t('parametrage.cle')}><input value={f.cle} maxLength={80} onChange={(e) => setF({ ...f, cle: e.target.value })} /></Champ>
          <Champ label={t('parametrage.valeur_json')}><textarea value={f.valeur} maxLength={10000} onChange={(e) => setF({ ...f, valeur: e.target.value })} /></Champ>
          <Champ label={t('parametrage.date_effet')}><input type="date" value={f.date_effet} onChange={(e) => setF({ ...f, date_effet: e.target.value })} /></Champ>
          <Champ label={t('champs.commentaire')}><input value={f.commentaire} maxLength={500} onChange={(e) => setF({ ...f, commentaire: e.target.value })} /></Champ>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
        </Tiroir>
      )}
    </div>
  );
}

function Taux() {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const l = useAsync(async () => ok(await supabase.from('taux_change').select('*').order('date_taux', { ascending: false }).limit(200)) as { devise: string; date_taux: string; taux_xof: number; source: string | null }[], []);
  const [f, setF] = useState({ devise: 'USD', date_taux: new Date().toISOString().slice(0, 10), taux_xof: '', source: '' });
  const a = useAction();
  const ajouter = async () => {
    const v = z.object({ devise: z.enum(['USD', 'CNY', 'EUR', 'XAF']), date_taux: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), taux_xof: z.number().positive().max(1e6), source: z.string().max(120).nullable() }).strict()
      .safeParse({ ...f, taux_xof: Number(f.taux_xof.replace(',', '.')), source: f.source || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('taux_change').insert(v.data)))) { setF({ ...f, taux_xof: '' }); void l.recharger(); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p className="mute">{t('parametrage.aide_taux')}</p>
      <div className="grille3" style={{ alignItems: 'end', gridTemplateColumns: '1fr 1fr 1fr 2fr auto' }}>
        <Champ label={t('champs.devise')}><select value={f.devise} onChange={(e) => setF({ ...f, devise: e.target.value })}>{['USD', 'CNY', 'EUR', 'XAF'].map((d) => <option key={d}>{d}</option>)}</select></Champ>
        <Champ label={t('champs.date')}><input type="date" value={f.date_taux} onChange={(e) => setF({ ...f, date_taux: e.target.value })} /></Champ>
        <Champ label={t('parametrage.taux_xof')}><input inputMode="decimal" value={f.taux_xof} onChange={(e) => setF({ ...f, taux_xof: e.target.value })} /></Champ>
        <Champ label={t('parametrage.source')}><input value={f.source} maxLength={120} onChange={(e) => setF({ ...f, source: e.target.value })} /></Champ>
        <Bouton onClick={() => void ajouter()}>{t('commun.ajouter')}</Bouton>
      </div>
      <Bandeau type="err">{a.erreur ?? l.erreur}</Bandeau>
      <table className="t"><thead><tr><th>{t('champs.devise')}</th><th>{t('champs.date')}</th><th className="num">1 = … XOF</th><th>{t('parametrage.source')}</th></tr></thead>
        <tbody>{(l.data ?? []).map((x) => <tr key={x.devise + x.date_taux}><td>{x.devise}</td><td className="ref">{date(x.date_taux, langue)}</td><td className="num">{x.taux_xof}</td><td className="mute">{x.source ?? ''}</td></tr>)}</tbody></table>
    </div>
  );
}

const ROLES = ['admin', 'achats_chine', 'hub_afrique', 'agent_pays', 'inspecteur', 'comptable'] as const;

function Utilisateurs() {
  const { t } = useTranslation();
  const { societes } = useAuth();
  const l = useAsync(async () => ok(await supabase.from('profils').select('*').order('nom')) as Profil[], []);
  const [sel, setSel] = useState<Profil | null>(null);
  const a = useAction();
  const enregistrer = async () => {
    if (!sel) return;
    const v = z.object({ role: z.enum(ROLES).nullable(), societes: z.array(z.string().uuid()), pays: z.string().regex(/^[A-Z]{2}$/).nullable(), delegue: z.boolean(), actif: z.boolean() })
      .safeParse({ role: sel.role, societes: sel.societes, pays: sel.pays || null, delegue: sel.delegue_validation, actif: sel.actif });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('admin_definir_profil', { p_user: sel.id, p_role: v.data.role, p_societes: v.data.societes, p_pays: v.data.pays, p_delegue: v.data.delegue, p_actif: v.data.actif })))) { setSel(null); void l.recharger(); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p className="mute">{t('parametrage.aide_utilisateurs')}</p>
      <Bandeau type="err">{l.erreur}</Bandeau>
      <table className="t"><thead><tr><th>{t('champs.nom')}</th><th>E-mail</th><th>{t('parametrage.role')}</th><th>{t('parametrage.societes')}</th><th>{t('parametrage.delegue')}</th><th>{t('champs.statut')}</th></tr></thead>
        <tbody>{(l.data ?? []).map((p) => (
          <tr key={p.id} className="cliquable" onClick={() => setSel({ ...p })}><td>{p.nom}</td><td className="sec">{p.email}</td><td>{p.role ? t(`roles.${p.role}`) : t('parametrage.sans_role')}</td>
            <td className="sec">{p.societes.map((s) => societes.find((x) => x.id === s)?.code).filter(Boolean).join(', ')}</td><td>{p.delegue_validation ? t('commun.oui') : '—'}</td>
            <td><Statut statut={p.actif ? 'validee' : 'annulee'} libelle={p.actif ? t('parametrage.actif') : t('parametrage.inactif')} /></td></tr>))}</tbody></table>
      {sel && (
        <Tiroir titre={sel.nom} onClose={() => setSel(null)}>
          <Champ label={t('parametrage.role')}><select value={sel.role ?? ''} onChange={(e) => setSel({ ...sel, role: (e.target.value || null) as Profil['role'] })}>
            <option value="">{t('parametrage.sans_role')}</option>{ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}</select></Champ>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <legend className="sec" style={{ marginBottom: 6 }}>{t('parametrage.societes')}</legend>
            {societes.map((s) => (
              <label key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={sel.societes.includes(s.id)} onChange={(e) => setSel({ ...sel, societes: e.target.checked ? [...sel.societes, s.id] : sel.societes.filter((x) => x !== s.id) })} />
                {s.raison_sociale}</label>))}
          </fieldset>
          {sel.role === 'agent_pays' && <Champ label={t('champs.pays')}><select value={sel.pays ?? ''} onChange={(e) => setSel({ ...sel, pays: e.target.value || null })}>
            <option value="">—</option><option value="GA">GA</option><option value="CM">CM</option></select></Champ>}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={sel.delegue_validation} onChange={(e) => setSel({ ...sel, delegue_validation: e.target.checked })} />{t('parametrage.delegue_aide')}</label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={sel.actif} onChange={(e) => setSel({ ...sel, actif: e.target.checked })} />{t('parametrage.actif')}</label>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
        </Tiroir>
      )}
    </div>
  );
}

function Societes() {
  const { t } = useTranslation();
  const { societes, langue } = useAuth();
  return (
    <table className="t"><thead><tr><th>{t('champs.raison_sociale')}</th><th>{t('champs.pays')}</th><th>{t('champs.devise')}</th><th>{t('parametrage.creee_le')}</th><th>FNE</th></tr></thead>
      <tbody>{societes.map((s) => <tr key={s.id}><td>{s.raison_sociale}</td><td>{s.pays}</td><td>{s.devise}</td><td className="ref">{date(s.date_creation, langue)}</td><td>{s.fne ? t('commun.oui') : '—'}</td></tr>)}</tbody></table>
  );
}
