// Lot 1, M21 : commissions des agents pays — contrats, relevés mensuels, paiement, export comptable.
// Calcul, cloisonnement, quatre yeux et écritures appliqués en base ; l'écran n'en est que le reflet.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, montant, pourcent } from '../lib/format';
import { useNoms } from '../lib/referentiels';
import { Bandeau, Bouton, CadreTableau, Champ, Entete, Onglets, Statut, Tiroir, Vide } from '../components/ui';

interface Contrat { id: string; agent_id: string; pays: string; taux: number; debut: string; fin: string | null; reference: string; commentaire: string | null }
interface Releve { id: string; agent_id: string; societe_id: string; mois: string; nb_lignes: number; lignes_sans_contrat: number; total_xof: number;
  valide_par: string; valide_le: string; paye_le: string | null; paye_par: string | null; reference_paiement: string | null }
interface AReleve { agent_id: string; agent: string; societe_id: string; societe: string; mois_max: string; nb_lignes: number; lignes_sans_contrat: number; total_xof: number }
type Onglet = 'releves' | 'contrats' | 'export';
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Cellule CSV : guillemets doublés, et neutralisation des formules (=, +, -, @) à l'ouverture dans un tableur. */
export function celluleCsv(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function Commissions() {
  const { t } = useTranslation();
  const { profil } = useAuth();
  const role = profil?.role ?? '';
  const finance = role === 'admin' || role === 'comptable';
  const [onglet, setOnglet] = useState<Onglet>('releves');
  const items: { id: Onglet; lib: string }[] = [{ id: 'releves', lib: t('commissions.releves') }, { id: 'contrats', lib: t('commissions.contrats') }];
  if (finance) items.push({ id: 'export', lib: t('commissions.export') });
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.finance')} · M21`} titre={t('commissions.titre')} />
      <Onglets items={items} actif={onglet} onChange={setOnglet} />
      {onglet === 'releves' && <Releves />}
      {onglet === 'contrats' && <Contrats />}
      {onglet === 'export' && finance && <Export />}
    </div>
  );
}

function Releves() {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const role = profil?.role ?? '';
  const admin = role === 'admin';
  const finance = admin || role === 'comptable';
  const profils = useNoms('profils');
  const societes = useNoms('societes');
  const r = useAsync(async () => ok(await supabase.from('releves_agents').select('*').order('mois', { ascending: false }).limit(200)) as Releve[], []);
  const ar = useAsync(async () => (finance ? ok(await supabase.rpc('commissions_a_relever')) as AReleve[] : []), [finance]);
  const a = useAction();
  const [payer, setPayer] = useState<Releve | null>(null);
  const valider = async (x: AReleve) => {
    if (await a.executer(async () => ok(await supabase.rpc('valider_releve_agent', { p_agent: x.agent_id, p_mois: x.mois_max })))) {
      void r.recharger(); void ar.recharger();
    }
  };
  return (
    <>
      <Bandeau type="err">{r.erreur ?? ar.erreur ?? a.erreur}</Bandeau>
      {finance && (
        <CadreTableau titre={t('commissions.a_relever')}>
          {(ar.data ?? []).length === 0 ? <Vide>{t('commissions.rien_a_relever')}</Vide> : (
            <table className="t"><thead><tr><th>{t('commissions.agent')}</th><th>{t('commissions.societe')}</th><th>{t('commissions.jusqu_a')}</th>
              <th className="num">{t('commissions.lignes')}</th><th className="num">{t('champs.montant')}</th><th /></tr></thead>
              <tbody>{(ar.data ?? []).map((x) => (
                <tr key={`${x.agent_id}-${x.societe_id}`}><td>{x.agent}</td><td className="sec">{x.societe}</td><td className="ref">{x.mois_max.slice(0, 7)}</td>
                  <td className="num">{x.nb_lignes}{x.lignes_sans_contrat > 0 && <div className="mute">{t('commissions.sans_contrat', { n: x.lignes_sans_contrat })}</div>}</td>
                  <td className="num">{montant(x.total_xof, 'XOF', langue)}</td>
                  <td className="num">{admin && <Bouton petit variante="primaire" disabled={a.enCours} onClick={() => void valider(x)}>{t('commissions.valider')}</Bouton>}</td></tr>))}</tbody></table>
          )}
          <p className="mute">{t('commissions.aide_releve')}</p>
        </CadreTableau>
      )}
      <CadreTableau titre={t('commissions.releves')}>
        {(r.data ?? []).length === 0 ? <Vide>{t('commissions.aucun_releve')}</Vide> : (
          <table className="t"><thead><tr><th>{t('commissions.mois')}</th><th>{t('commissions.agent')}</th><th>{t('commissions.societe')}</th>
            <th className="num">{t('commissions.lignes')}</th><th className="num">{t('champs.montant')}</th><th>{t('commissions.statut')}</th><th /></tr></thead>
            <tbody>{(r.data ?? []).map((x) => (
              <tr key={x.id}><td className="ref">{x.mois.slice(0, 7)}</td><td>{profils[x.agent_id] ?? '—'}</td><td className="sec">{societes[x.societe_id] ?? ''}</td>
                <td className="num">{x.nb_lignes}</td><td className="num">{montant(x.total_xof, 'XOF', langue)}</td>
                <td>{x.paye_le
                  ? <><Statut statut="ok" libelle={t('commissions.paye')} /><div className="mute">{date(x.paye_le, langue)} · {x.reference_paiement}</div></>
                  : <><Statut statut="att" libelle={t('commissions.valide_a_payer')} /><div className="mute">{date(x.valide_le, langue)} · {profils[x.valide_par] ?? ''}</div></>}</td>
                <td className="num">{finance && !x.paye_le && x.valide_par !== profil?.id && <Bouton petit onClick={() => setPayer(x)}>{t('commissions.payer')}</Bouton>}</td></tr>))}</tbody></table>
        )}
      </CadreTableau>
      {payer && <Paiement releve={payer} onClose={() => setPayer(null)} onSaved={() => { setPayer(null); void r.recharger(); }} />}
    </>
  );
}

function Paiement({ releve, onClose, onSaved }: { releve: Releve; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const a = useAction();
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ paye_le: aujourdhui, reference: '' });
  const enregistrer = async () => {
    const v = z.object({ p_releve: z.string().uuid(), p_paye_le: DATE, p_reference: z.string().trim().min(3).max(80) }).strict()
      .safeParse({ p_releve: releve.id, p_paye_le: f.paye_le, p_reference: f.reference });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('payer_releve_agent', v.data)))) onSaved();
  };
  return (
    <Tiroir titre={t('commissions.payer')} onClose={onClose}>
      <p>{releve.mois.slice(0, 7)} · {montant(releve.total_xof, 'XOF', langue)}</p>
      <Champ label={t('commissions.paye_le')}><input type="date" max={aujourdhui} value={f.paye_le} onChange={(e) => setF({ ...f, paye_le: e.target.value })} /></Champ>
      <Champ label={t('commissions.reference_paiement')}><input value={f.reference} maxLength={80} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Champ>
      <p className="mute">{t('commissions.aide_paiement')}</p>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

function Contrats() {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const admin = profil?.role === 'admin';
  const profils = useNoms('profils');
  const c = useAsync(async () => ok(await supabase.from('contrats_agents').select('*').order('debut', { ascending: false })) as Contrat[], []);
  const a = useAction();
  const [nouveau, setNouveau] = useState(false);
  const [cloture, setCloture] = useState<Record<string, string>>({});
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const cloturer = async (x: Contrat) => {
    const v = DATE.safeParse(cloture[x.id] ?? '');
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('contrats_agents').update({ fin: v.data }).eq('id', x.id)))) void c.recharger();
  };
  return (
    <>
      <Bandeau type="err">{c.erreur ?? a.erreur}</Bandeau>
      <CadreTableau titre={t('commissions.contrats')} outils={admin ? <Bouton petit variante="primaire" onClick={() => setNouveau(true)}>{t('commissions.nouveau_contrat')}</Bouton> : undefined}>
        {(c.data ?? []).length === 0 ? <Vide>{t('commissions.aucun_contrat')}</Vide> : (
          <table className="t"><thead><tr><th>{t('commissions.reference')}</th><th>{t('commissions.agent')}</th><th>{t('commissions.pays')}</th>
            <th className="num">{t('flux.taux')}</th><th>{t('commissions.validite')}</th><th /></tr></thead>
            <tbody>{(c.data ?? []).map((x) => {
              const actif = x.debut <= aujourdhui && (!x.fin || x.fin >= aujourdhui);
              return (
                <tr key={x.id}><td className="ref">{x.reference}</td><td>{profils[x.agent_id] ?? '—'}</td><td>{x.pays}</td>
                  <td className="num">{pourcent(x.taux, langue, 1)}</td>
                  <td><Statut statut={actif ? 'ok' : 'neutre'} libelle={actif ? t('commissions.en_vigueur') : t('commissions.hors_vigueur')} />
                    <div className="mute">{date(x.debut, langue)} → {x.fin ? date(x.fin, langue) : t('commissions.sans_fin')}</div></td>
                  <td className="num">{admin && !x.fin && <span className="actions">
                    <input type="date" min={x.debut} value={cloture[x.id] ?? ''} aria-label={t('commissions.fin')}
                      onChange={(e) => setCloture({ ...cloture, [x.id]: e.target.value })} />
                    <Bouton petit disabled={a.enCours || !cloture[x.id]} onClick={() => void cloturer(x)}>{t('commissions.cloturer')}</Bouton></span>}</td></tr>);
            })}</tbody></table>
        )}
        <p className="mute">{t('commissions.aide_contrat')}</p>
      </CadreTableau>
      {nouveau && <NouveauContrat onClose={() => setNouveau(false)} onSaved={() => { setNouveau(false); void c.recharger(); }} />}
    </>
  );
}

function NouveauContrat({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const agents = useAsync(async () => ok(await supabase.from('profils').select('id, nom, pays').eq('role', 'agent_pays').eq('actif', true).order('nom')) as
    { id: string; nom: string; pays: string | null }[], []);
  const [f, setF] = useState({ agent_id: '', taux: '15', debut: new Date().toISOString().slice(0, 10), fin: '', reference: '', commentaire: '' });
  const agent = (agents.data ?? []).find((x) => x.id === f.agent_id);
  const enregistrer = async () => {
    const v = z.object({ agent_id: z.string().uuid(), pays: z.string().regex(/^[A-Z]{2}$/), taux: z.number().positive().max(0.5), debut: DATE,
      fin: DATE.nullable(), reference: z.string().trim().min(3).max(80), commentaire: z.string().trim().max(1000).nullable() }).strict()
      .safeParse({ agent_id: f.agent_id, pays: agent?.pays ?? '', taux: Math.round(Number(f.taux) * 100) / 10000, debut: f.debut,
        fin: f.fin || null, reference: f.reference, commentaire: f.commentaire.trim() || null });
    if (!v.success || (v.data.fin && v.data.fin < v.data.debut)) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('contrats_agents').insert(v.data)))) onSaved();
  };
  return (
    <Tiroir titre={t('commissions.nouveau_contrat')} onClose={onClose}>
      <Champ label={t('commissions.agent')}><select value={f.agent_id} onChange={(e) => setF({ ...f, agent_id: e.target.value })}>
        <option value="">—</option>{(agents.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.nom} ({x.pays ?? '?'})</option>)}</select></Champ>
      <Champ label={t('commissions.taux_pct')}><input type="number" min={0.01} max={50} step="0.01" value={f.taux} onChange={(e) => setF({ ...f, taux: e.target.value })} /></Champ>
      <Champ label={t('commissions.debut')}><input type="date" value={f.debut} onChange={(e) => setF({ ...f, debut: e.target.value })} /></Champ>
      <Champ label={t('commissions.fin')}><input type="date" value={f.fin} min={f.debut} onChange={(e) => setF({ ...f, fin: e.target.value })} /></Champ>
      <Champ label={t('commissions.reference')}><input value={f.reference} maxLength={80} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Champ>
      <Champ label={t('champs.commentaire')}><input value={f.commentaire} maxLength={1000} onChange={(e) => setF({ ...f, commentaire: e.target.value })} /></Champ>
      <p className="mute">{t('commissions.aide_contrat')}</p>
      <Bandeau type="err">{agents.erreur ?? a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

function Export() {
  const { t } = useTranslation();
  const { societes, profil } = useAuth();
  const visibles = profil?.role === 'admin' ? societes : societes.filter((s) => profil?.societes?.includes(s.id));
  const a = useAction();
  const fin = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ societe: visibles[0]?.id ?? '', du: `${fin.slice(0, 8)}01`, au: fin });
  const exporter = async () => {
    const v = z.object({ p_societe: z.string().uuid(), p_du: DATE, p_au: DATE }).strict().safeParse({ p_societe: f.societe, p_du: f.du, p_au: f.au });
    if (!v.success || v.data.p_au < v.data.p_du) { a.setErreur(t('formulaire.invalide')); return; }
    await a.executer(async () => {
      const lignes = ok(await supabase.rpc('export_commissions_agents', v.data)) as Record<string, unknown>[];
      const cols = ['date_ecriture', 'journal', 'compte', 'compte_tiers', 'piece', 'libelle', 'debit_xof', 'credit_xof', 'devise_tenue', 'debit_devise', 'credit_devise'];
      const csv = [cols.map(celluleCsv).join(';'), ...lignes.map((l) => cols.map((c) => celluleCsv(l[c])).join(';'))].join('\r\n');
      const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
      const lien = document.createElement('a');
      const code = societes.find((s) => s.id === v.data.p_societe)?.code ?? 'societe';
      lien.href = url; lien.download = `commissions-agents_${code}_${v.data.p_du}_${v.data.p_au}.csv`;
      lien.click();
      URL.revokeObjectURL(url);
    });
  };
  return (
    <CadreTableau titre={t('commissions.export')}>
      <Champ label={t('commissions.societe')}><select value={f.societe} onChange={(e) => setF({ ...f, societe: e.target.value })}>
        {visibles.map((s) => <option key={s.id} value={s.id}>{s.raison_sociale}</option>)}</select></Champ>
      <div className="actions">
        <Champ label={t('commissions.du')}><input type="date" value={f.du} onChange={(e) => setF({ ...f, du: e.target.value })} /></Champ>
        <Champ label={t('commissions.au')}><input type="date" value={f.au} min={f.du} onChange={(e) => setF({ ...f, au: e.target.value })} /></Champ>
      </div>
      <p className="mute">{t('commissions.aide_export')}</p>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours || !f.societe} onClick={() => void exporter()}>{t('commissions.telecharger')}</Bouton>
    </CadreTableau>
  );
}
