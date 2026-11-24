// Logistique · assurance transport et sinistres (maquette « ASS », cahier des charges M9).
// Valeur assurée, prime de référence, couverture et suite des sinistres : règles en base
// (gbs.enregistrer_police, gbs.declarer_sinistre, gbs.traiter_sinistre).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, montant } from '../lib/format';
import { Bandeau, Bouton, Champ, Chargement, Entete, Onglets, Statut, Tiroir, Vide } from '../components/ui';
import { Depot } from '../components/Depot';

interface Exp { id: string; reference: string | null; dossier_id: string; port_arrivee: string | null; statut: string; dossiers: { reference: string } | null }
interface Police { id: string; expedition_id: string; assureur: string; numero: string; garantie: string; devise: string; valeur_cif: number; valeur_assuree: number;
  prime: number; prime_reelle: boolean; du: string; au: string; attestation: string | null }
type StatutSin = 'declare' | 'expertise' | 'indemnise' | 'refuse';
interface Sinistre { id: string; reference: string; expedition_id: string; dossier_id: string; nature: string; description: string; constate_le: string; declare_le: string;
  tardif: boolean; montant_reclame: number; devise: string; preuves: string[]; statut: StatutSin; reference_assureur: string | null; indemnite: number | null;
  indemnise_le: string | null; motif_refus: string | null }
const NATURES = ['avarie', 'manquant', 'perte_totale', 'vol', 'mouille', 'autre'] as const;
const GARANTIES = ['icc_a', 'icc_b', 'icc_c'] as const;
const auj = () => new Date().toISOString().slice(0, 10);
const STATUT: Record<StatutSin, string> = { declare: 'info', expertise: 'att', indemnise: 'ok', refuse: 'err' };

export function Assurances() {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const role = profil?.role ?? '';
  const gere = ['admin', 'achats_chine', 'hub_afrique'].includes(role);
  const traite = ['admin', 'achats_chine'].includes(role);
  const exps = useAsync(async () => ok(await supabase.from('expeditions').select('id, reference, dossier_id, port_arrivee, statut, dossiers(reference)')
    .order('cree_le', { ascending: false }).limit(300)) as unknown as Exp[], []);
  const pols = useAsync(async () => ok(await supabase.from('polices_assurance').select('*').limit(500)) as Police[], []);
  const sins = useAsync(async () => ok(await supabase.from('sinistres').select('*').order('declare_le', { ascending: false }).limit(300)) as Sinistre[], []);
  const [onglet, setOnglet] = useState<'polices' | 'sinistres'>('polices');
  const [edPolice, setEdPolice] = useState<Exp | null>(null);
  const [declarer, setDeclarer] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const recharger = () => { void pols.recharger(); void sins.recharger(); };
  const police = (e: string) => (pols.data ?? []).find((p) => p.expedition_id === e);
  const refExp = (id: string) => { const e = (exps.data ?? []).find((x) => x.id === id); return e ? e.reference ?? e.dossiers?.reference ?? '—' : '—'; };
  const enCours = (sins.data ?? []).filter((s) => s.statut === 'declare' || s.statut === 'expertise').length;
  const couvertes = (exps.data ?? []).filter((e) => police(e.id)).length;
  const s = (sins.data ?? []).find((x) => x.id === sel) ?? (sins.data ?? [])[0] ?? null;
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.logistique')} · ${t('assurance.surtitre')} · ASS`}
        titre={t('assurance.titre', { n: enCours, c: couvertes, e: (exps.data ?? []).length })}
        actions={gere && <Bouton variante="primaire" onClick={() => setDeclarer(true)}>{t('assurance.declarer')}</Bouton>} />
      <Bandeau type="err">{exps.erreur ?? pols.erreur ?? sins.erreur}</Bandeau>
      <Onglets actif={onglet} onChange={setOnglet} items={[{ id: 'polices', lib: t('assurance.polices') }, { id: 'sinistres', lib: `${t('assurance.sinistres')} · ${(sins.data ?? []).length}` }]} />
      {onglet === 'polices' && (exps.chargement && !exps.data ? <Chargement /> : (exps.data ?? []).length === 0 ? <Vide>{t('assurance.aucune_expedition')}</Vide> : (
        <div className="cadre">
          <table className="t">
            <thead><tr><th>{t('assurance.expedition')}</th><th>{t('assurance.assureur_police')}</th><th className="num">{t('assurance.valeur_assuree')}</th>
              <th>{t('assurance.garantie')}</th><th className="num">{t('assurance.prime')}</th><th>{t('assurance.validite')}</th><th /></tr></thead>
            <tbody>{(exps.data ?? []).map((e) => {
              const p = police(e.id);
              const echue = p && p.au < auj();
              return (
                <tr key={e.id}>
                  <td className="ref">{e.reference ?? '—'}<div className="mute">{e.dossiers?.reference ?? ''}{e.port_arrivee ? ` · ${e.port_arrivee}` : ''}</div></td>
                  <td>{p ? <>{p.assureur}<div className="mute ref">{p.numero}</div></> : <span className="mute">{t('assurance.sans_police')}</span>}</td>
                  <td className="num nowrap">{p ? montant(p.valeur_assuree, p.devise, langue) : '—'}</td>
                  <td>{p ? t(`assurance.garanties.${p.garantie}`) : '—'}</td>
                  <td className="num nowrap">{p ? <>{montant(p.prime, p.devise, langue)}<div className="mute">{t(p.prime_reelle ? 'assurance.prime_reelle' : 'assurance.prime_reference')}</div></> : '—'}</td>
                  <td>{p ? <><Statut statut={echue ? 'neutre' : 'ok'} libelle={t(echue ? 'assurance.echue' : 'assurance.en_cours')} />
                    <div className="mute">{date(p.du, langue)} → {date(p.au, langue)}</div></> : <Statut statut="att" libelle={t('assurance.a_assurer')} />}</td>
                  <td className="num">{gere && <Bouton petit onClick={() => setEdPolice(e)}>{t(p ? 'assurance.modifier' : 'assurance.enregistrer_police')}</Bouton>}</td>
                </tr>);
            })}</tbody>
          </table>
          <p className="mute">{t('assurance.aide_valeur')}</p>
        </div>))}
      {onglet === 'sinistres' && (sins.chargement && !sins.data ? <Chargement /> : (sins.data ?? []).length === 0 ? <Vide>{t('assurance.aucun_sinistre')}</Vide> : (
        <div className="ref-grille alr-grille">
          <div className="cadre alr-liste">
            {(sins.data ?? []).map((x) => (
              <button key={x.id} type="button" className={'alr-ligne' + (s?.id === x.id ? ' choisi' : '')} onClick={() => setSel(x.id)}>
                <span className="alr-cat ref">{x.reference}</span>
                <span className="alr-txt"><b>{t(`assurance.natures.${x.nature}`)} · {x.description}</b>
                  <span className="sec">{refExp(x.expedition_id)} · {t('assurance.declare_le', { d: date(x.declare_le, langue) })}{x.tardif ? ` · ${t('assurance.tardif')}` : ''}</span></span>
                <span className="nowrap"><Statut statut={STATUT[x.statut]} libelle={t(`assurance.statuts.${x.statut}`)} /></span>
              </button>))}
          </div>
          {s && <DetailSinistre s={s} expRef={refExp(s.expedition_id)} peutTraiter={traite} onDone={recharger} />}
        </div>))}
      {edPolice && <SaisiePolice exp={edPolice} existante={police(edPolice.id) ?? null} onClose={() => setEdPolice(null)} onSaved={() => { setEdPolice(null); recharger(); }} />}
      {declarer && <DeclarerSinistre exps={(exps.data ?? []).filter((e) => police(e.id))} onClose={() => setDeclarer(false)} onSaved={() => { setDeclarer(false); setOnglet('sinistres'); recharger(); }} />}
    </div>
  );
}

function DetailSinistre({ s, expRef, peutTraiter, onDone }: { s: Sinistre; expRef: string; peutTraiter: boolean; onDone: () => void }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const a = useAction();
  const [f, setF] = useState({ reference_assureur: '', indemnite: '', indemnise_le: auj(), motif: '' });
  const traiter = async (action: 'expertise' | 'indemniser' | 'refuser') => {
    const p = action === 'expertise' ? { reference_assureur: f.reference_assureur.trim() }
      : action === 'indemniser' ? { indemnite: Number(f.indemnite.replace(/\s/g, '').replace(',', '.')), indemnise_le: f.indemnise_le } : { motif: f.motif.trim() };
    const v = z.object({ p_sinistre: z.string().uuid(), p_action: z.enum(['expertise', 'indemniser', 'refuser']), p: z.union([
      z.object({ reference_assureur: z.string().min(2).max(80) }).strict(),
      z.object({ indemnite: z.number().min(0).max(1e12), indemnise_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
      z.object({ motif: z.string().min(5).max(1000) }).strict()]) }).strict().safeParse({ p_sinistre: s.id, p_action: action, p });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('traiter_sinistre', v.data)))) onDone();
  };
  const etapes: StatutSin[] = ['declare', 'expertise', s.statut === 'refuse' ? 'refuse' : 'indemnise'];
  const rang = { declare: 0, expertise: 1, indemnise: 2, refuse: 2 }[s.statut];
  return (
    <aside className="exp-aside alr-detail">
      <section>
        <span className="surtitre">{s.reference} · {expRef}</span>
        <b className="liv-client">{t(`assurance.natures.${s.nature}`)}</b>
        <span className="sec">{s.description}</span>
        {s.tardif && <Bandeau type="err">{t('assurance.aide_tardif')}</Bandeau>}
      </section>
      <section>
        <ol className="sin-etapes">{etapes.map((e, i) => <li key={e} className={i <= rang ? 'fait' : ''}>{t(`assurance.statuts.${e}`)}</li>)}</ol>
        <dl className="dl">
          <dt>{t('assurance.constate_le')}</dt><dd>{date(s.constate_le, langue)}</dd>
          <dt>{t('assurance.montant_reclame')}</dt><dd>{montant(s.montant_reclame, s.devise, langue)}</dd>
          <dt>{t('assurance.reference_assureur')}</dt><dd className="ref">{s.reference_assureur ?? '—'}</dd>
          <dt>{t('assurance.indemnite')}</dt><dd>{s.indemnite != null ? `${montant(s.indemnite, s.devise, langue)} · ${s.indemnise_le ? date(s.indemnise_le, langue) : ''}` : '—'}</dd>
          <dt>{t('assurance.preuves')}</dt><dd>{t('assurance.n_preuves', { n: s.preuves.length })}</dd>
          {s.motif_refus && <><dt>{t('assurance.motif_refus')}</dt><dd>{s.motif_refus}</dd></>}
        </dl>
      </section>
      {peutTraiter && (s.statut === 'declare' || s.statut === 'expertise') && (
        <section>
          <Bandeau type="err">{a.erreur}</Bandeau>
          {s.statut === 'declare' ? (<>
            <Champ label={t('assurance.reference_assureur')}><input value={f.reference_assureur} maxLength={80} onChange={(e) => setF({ ...f, reference_assureur: e.target.value })} /></Champ>
            <Bouton variante="primaire" disabled={a.enCours || f.reference_assureur.trim().length < 2} onClick={() => void traiter('expertise')}>{t('assurance.transmettre_expert')}</Bouton>
          </>) : (<>
            <Champ label={`${t('assurance.indemnite')} (${s.devise})`}><input inputMode="decimal" value={f.indemnite} onChange={(e) => setF({ ...f, indemnite: e.target.value })} /></Champ>
            <Champ label={t('assurance.indemnise_le')}><input type="date" value={f.indemnise_le} max={auj()} onChange={(e) => setF({ ...f, indemnise_le: e.target.value })} /></Champ>
            <Bouton variante="primaire" disabled={a.enCours || !f.indemnite} onClick={() => void traiter('indemniser')}>{t('assurance.enregistrer_indemnite')}</Bouton>
            <Champ label={t('assurance.motif_refus')}><textarea value={f.motif} maxLength={1000} onChange={(e) => setF({ ...f, motif: e.target.value })} /></Champ>
            <Bouton variante="danger" disabled={a.enCours || f.motif.trim().length < 5} onClick={() => void traiter('refuser')}>{t('assurance.refus_assureur')}</Bouton>
          </>)}
        </section>)}
    </aside>
  );
}

function SaisiePolice({ exp, existante, onClose, onSaved }: { exp: Exp; existante: Police | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [f, setF] = useState({ assureur: existante?.assureur ?? '', numero: existante?.numero ?? '', garantie: existante?.garantie ?? 'icc_a', devise: existante?.devise ?? 'USD',
    valeur_cif: existante ? String(existante.valeur_cif) : '', prime: existante?.prime_reelle ? String(existante.prime) : '', du: existante?.du ?? auj(), au: existante?.au ?? '',
    attestation: existante?.attestation ?? null as string | null });
  const valider = async () => {
    const num = (x: string) => Number(x.replace(/\s/g, '').replace(',', '.'));
    const v = z.object({ p_expedition: z.string().uuid(), p: z.object({ assureur: z.string().trim().min(2).max(120), numero: z.string().trim().regex(/^[A-Za-z0-9 ./_-]{3,60}$/),
      garantie: z.enum(GARANTIES), devise: z.enum(['USD', 'CNY', 'XOF', 'XAF', 'EUR']), valeur_cif: z.number().positive().max(1e12), prime: z.number().min(0).max(1e12).nullable(),
      du: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), au: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), attestation: z.string().max(400).nullable() }).strict() }).strict()
      .safeParse({ p_expedition: exp.id, p: { ...f, valeur_cif: num(f.valeur_cif), prime: f.prime.trim() ? num(f.prime) : null } });
    if (!v.success || v.data.p.au < v.data.p.du) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('enregistrer_police', v.data)))) onSaved();
  };
  return (
    <Tiroir titre={`${t('assurance.enregistrer_police')} · ${exp.reference ?? exp.dossiers?.reference ?? ''}`} onClose={onClose}>
      <Champ label={t('assurance.assureur')}><input value={f.assureur} maxLength={120} onChange={(e) => setF({ ...f, assureur: e.target.value })} /></Champ>
      <Champ label={t('assurance.numero')}><input value={f.numero} maxLength={60} onChange={(e) => setF({ ...f, numero: e.target.value })} /></Champ>
      <Champ label={t('assurance.garantie')}><select value={f.garantie} onChange={(e) => setF({ ...f, garantie: e.target.value })}>
        {GARANTIES.map((g) => <option key={g} value={g}>{t(`assurance.garanties.${g}`)}</option>)}</select></Champ>
      <Champ label={t('assurance.devise')}><select value={f.devise} onChange={(e) => setF({ ...f, devise: e.target.value })}>
        {['USD', 'CNY', 'XOF', 'XAF', 'EUR'].map((d) => <option key={d} value={d}>{d}</option>)}</select></Champ>
      <Champ label={t('assurance.valeur_cif')}><input inputMode="decimal" value={f.valeur_cif} onChange={(e) => setF({ ...f, valeur_cif: e.target.value })} /></Champ>
      <Champ label={t('assurance.prime_saisie')}><input inputMode="decimal" value={f.prime} placeholder={t('assurance.prime_vide')} onChange={(e) => setF({ ...f, prime: e.target.value })} /></Champ>
      <Champ label={t('assurance.du')}><input type="date" value={f.du} onChange={(e) => setF({ ...f, du: e.target.value })} /></Champ>
      <Champ label={t('assurance.au')}><input type="date" value={f.au} min={f.du} onChange={(e) => setF({ ...f, au: e.target.value })} /></Champ>
      <Champ label={t('assurance.attestation')}><Depot dossierId={exp.dossier_id} valeur={f.attestation} onChange={(c) => setF({ ...f, attestation: c })} /></Champ>
      <p className="mute">{t('assurance.aide_valeur')}</p>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours || !f.assureur.trim() || !f.numero.trim() || !f.valeur_cif || !f.au} onClick={() => void valider()}>{t('assurance.enregistrer')}</Bouton>
    </Tiroir>
  );
}

function DeclarerSinistre({ exps, onClose, onSaved }: { exps: Exp[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [f, setF] = useState({ expedition: exps[0]?.id ?? '', nature: 'avarie', description: '', constate_le: auj(), montant_reclame: '', preuves: [] as string[] });
  const e = exps.find((x) => x.id === f.expedition);
  const valider = async () => {
    const v = z.object({ p_expedition: z.string().uuid(), p: z.object({ nature: z.enum(NATURES), description: z.string().trim().min(10).max(2000),
      constate_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), montant_reclame: z.number().positive().max(1e12), preuves: z.array(z.string().max(400)).max(20) }).strict() }).strict()
      .safeParse({ p_expedition: f.expedition, p: { nature: f.nature, description: f.description, constate_le: f.constate_le,
        montant_reclame: Number(f.montant_reclame.replace(/\s/g, '').replace(',', '.')), preuves: f.preuves } });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('declarer_sinistre', v.data)))) onSaved();
  };
  return (
    <Tiroir titre={t('assurance.declarer')} onClose={onClose}>
      {exps.length === 0 ? <Vide>{t('assurance.aucune_police')}</Vide> : (<>
        <Champ label={t('assurance.expedition')}><select value={f.expedition} onChange={(x) => setF({ ...f, expedition: x.target.value, preuves: [] })}>
          {exps.map((x) => <option key={x.id} value={x.id}>{x.reference ?? x.dossiers?.reference ?? x.id.slice(0, 8)}</option>)}</select></Champ>
        <Champ label={t('assurance.nature')}><select value={f.nature} onChange={(x) => setF({ ...f, nature: x.target.value })}>
          {NATURES.map((n) => <option key={n} value={n}>{t(`assurance.natures.${n}`)}</option>)}</select></Champ>
        <Champ label={t('assurance.description')}><textarea value={f.description} maxLength={2000} onChange={(x) => setF({ ...f, description: x.target.value })} /></Champ>
        <Champ label={t('assurance.constate_le')}><input type="date" value={f.constate_le} max={auj()} onChange={(x) => setF({ ...f, constate_le: x.target.value })} /></Champ>
        <Champ label={t('assurance.montant_reclame')}><input inputMode="decimal" value={f.montant_reclame} onChange={(x) => setF({ ...f, montant_reclame: x.target.value })} /></Champ>
        {e && <Champ label={t('assurance.preuves')}><Depot dossierId={e.dossier_id} valeur={null} onChange={(c) => setF({ ...f, preuves: [...f.preuves, c].slice(0, 20) })} />
          <span className="mute">{t('assurance.n_preuves', { n: f.preuves.length })}</span></Champ>}
        <p className="mute">{t('assurance.aide_declaration')}</p>
        <Bandeau type="err">{a.erreur}</Bandeau>
        <Bouton variante="primaire" disabled={a.enCours || f.description.trim().length < 10 || !f.montant_reclame} onClick={() => void valider()}>{t('assurance.declarer')}</Bouton>
      </>)}
    </Tiroir>
  );
}
