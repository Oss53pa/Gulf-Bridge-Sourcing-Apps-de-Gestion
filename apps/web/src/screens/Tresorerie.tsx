// Finance · trésorerie prévisionnelle et risque de change (maquette TRC). Prévision, scénarios et
// exposition calculés par la base (migration 55) ; l'écran saisit les flux prévus et les couvertures.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, montant } from '../lib/format';
import { Bandeau, Bouton, Champ, Chargement, Entete, Kpis, Statut, Tiroir, Vide } from '../components/ui';

interface Semaine { semaine: string; entrees: number; sorties: number; solde: number; principal: string | null }
interface Expo { origine: string; ref_id: string; societe_id: string; devise: string; montant: number; libelle: string; couverture: string | null }
interface Flux { id: string; societe_id: string; sens: string; categorie: string; libelle: string; montant: number; devise: string; date_prevue: string; mensuel: boolean; jusqu_au: string | null }
type Scenario = 'base' | 'retard' | 'choc';
const CATS = ['salaires', 'loyers', 'impots', 'fournisseur', 'client', 'autre'] as const;
const DEVISES = ['XOF', 'XAF', 'USD', 'CNY', 'EUR'] as const;

/** Numéro de semaine ISO (S46…). */
function semaineIso(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`); const j = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - j + 3);
  const p = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); return 1 + Math.round(((d.getTime() - p.getTime()) / 86400000 - 3 + ((p.getUTCDay() + 6) % 7)) / 7);
}

export function Tresorerie() {
  const { t } = useTranslation();
  const { langue, societeActive } = useAuth();
  const [sc, setSc] = useState<Scenario>('base');
  const args = { p_societe: societeActive ?? null, p_semaines: 9, p_retard_client: sc === 'retard' ? 15 : 0, p_choc_devise: sc === 'choc' ? 'CNY' : null, p_choc: sc === 'choc' ? 0.03 : 0 };
  const p = useAsync(async () => ok(await supabase.rpc('prevision_tresorerie', args)) as Semaine[], [societeActive, sc]);
  const ex = useAsync(async () => ok(await supabase.rpc('exposition_change', { p_societe: societeActive ?? null })) as Expo[], [societeActive]);
  const fl = useAsync(async () => { let q = supabase.from('flux_prevus').select('*').eq('actif', true).order('date_prevue'); if (societeActive) q = q.eq('societe_id', societeActive); return ok(await q) as Flux[]; }, [societeActive]);
  const taux = useAsync(async () => ok(await supabase.from('taux_change').select('devise, date_taux, taux_xof').eq('devise', 'CNY').order('date_taux', { ascending: false }).limit(1)) as
    { devise: string; date_taux: string; taux_xof: number }[], []);
  const a = useAction();
  const [nouveau, setNouveau] = useState(false);
  const [couvrir, setCouvrir] = useState<Expo | null>(null);
  const sem = p.data ?? [];
  const m = (v: number) => `${(v / 1e6).toLocaleString(langue, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}`;
  const depart = sem.length ? Number(sem[0].solde) - Number(sem[0].entrees) + Number(sem[0].sorties) : 0;
  const bas = sem.length ? sem.reduce((x, y) => (Number(y.solde) < Number(x.solde) ? y : x)) : null;
  const fin = sem[sem.length - 1];
  const negatif = sem.some((x) => Number(x.solde) < 0);
  const titre = !bas ? t('trc.titre_court') : t(negatif ? 'trc.titre_negatif' : 'trc.titre_positif', { n: sem.length, m: m(Number(bas.solde)), s: `S${semaineIso(bas.semaine)}`, p: bas.principal ?? '—' });
  const max = Math.max(1, ...sem.map((x) => Math.abs(Number(x.solde))));
  const desactiver = async (id: string) => { if (await a.executer(async () => ok(await supabase.rpc('desactiver_flux_prevu', { p_flux: id })))) { void fl.recharger(); void p.recharger(); void ex.recharger(); } };
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.finance')} · ${t('trc.surtitre')} · TRC`} titre={p.data ? titre : t('trc.titre_court')}
        actions={<><div className="segment trc-sc">{(['base', 'retard', 'choc'] as const).map((k) => <button key={k} type="button" aria-pressed={sc === k} onClick={() => setSc(k)}>{t(`trc.scenarios.${k}`)}</button>)}</div>
          <Bouton variante="primaire" onClick={() => setNouveau(true)}>{t('trc.nouveau_flux')}</Bouton></>} />
      <Bandeau type="err">{p.erreur ?? ex.erreur ?? fl.erreur ?? a.erreur}</Bandeau>
      {p.chargement && !p.data ? <Chargement /> : sem.length === 0 ? <Vide>{t('trc.aucune')}</Vide> : <>
        <Kpis items={[
          { lib: t('trc.solde_actuel'), val: `${m(depart)} M`, sous: t('trc.consolide') },
          { lib: t('trc.point_bas'), val: `${m(Number(bas!.solde))} M`, sous: `S${semaineIso(bas!.semaine)}` },
          { lib: t('trc.solde_fin', { s: `S${semaineIso(fin.semaine)}` }), val: `${m(Number(fin.solde))} M`, sous: date(fin.semaine, langue) },
          { lib: t('trc.taux_cny'), val: taux.data?.[0] ? Number(taux.data[0].taux_xof).toLocaleString(langue, { maximumFractionDigits: 2 }) : '—', sous: taux.data?.[0] ? date(taux.data[0].date_taux, langue) : t('trc.taux_manquant') },
        ]} />
        <div className="trc-barres" role="img" aria-label={t('trc.graphique')}>
          {sem.map((x) => (
            <div key={x.semaine} className="trc-col"><span className="trc-val">{m(Number(x.solde))}</span>
              <span className={'trc-barre' + (Number(x.solde) < 0 ? ' neg' : x === bas ? ' bas' : '')} style={{ height: `${Math.max(4, (Math.abs(Number(x.solde)) / max) * 120)}px` }} />
              <span className="mute">S{semaineIso(x.semaine)}</span></div>))}
        </div>
        <div className="ref-grille liv-grille">
          <div className="cadre">
            <table className="t"><thead><tr><th>{t('trc.semaine')}</th><th className="num">{t('trc.entrees')}</th><th className="num">{t('trc.sorties')}</th><th className="num">{t('trc.solde')}</th><th>{t('trc.principal')}</th></tr></thead>
              <tbody>{sem.map((x) => (
                <tr key={x.semaine}><td className="ref">S{semaineIso(x.semaine)}<div className="mute">{date(x.semaine, langue)}</div></td>
                  <td className="num">{m(Number(x.entrees))}</td><td className="num">{m(Number(x.sorties))}</td>
                  <td className={'num' + (Number(x.solde) < 0 ? ' txt-err' : '')}><b>{m(Number(x.solde))}</b></td><td className="sec">{x.principal ?? '—'}</td></tr>))}</tbody></table>
            <p className="mute" style={{ marginTop: 12 }}>{t('trc.aide')}</p>
          </div>
          <aside className="exp-aside">
            <section>
              <div className="surtitre">{t('trc.exposition')}</div>
              {(ex.data ?? []).length === 0 ? <span className="mute">{t('trc.aucune_exposition')}</span> : (ex.data ?? []).map((y) => (
                <div key={`${y.origine}-${y.ref_id}`} className="grl-regle"><span><b>{montant(Number(y.montant), y.devise, langue)}</b><span className="mute">{y.libelle}</span></span>
                  <span className="actions" style={{ flexWrap: 'nowrap' }}><Statut statut={y.couverture ? 'ok' : 'att'} libelle={y.couverture ? t('trc.couverte', { c: y.couverture }) : t('trc.non_couverte')} />
                    {!y.couverture && y.origine === 'paiement' && <Bouton petit onClick={() => setCouvrir(y)}>{t('trc.couvrir')}</Bouton>}</span></div>))}
            </section>
            <section>
              <div className="surtitre">{t('trc.flux_prevus')}</div>
              {(fl.data ?? []).length === 0 ? <span className="mute">{t('trc.aucun_flux')}</span> : (fl.data ?? []).map((y) => (
                <div key={y.id} className="grl-regle"><span><b>{y.libelle}</b><span className="mute">{t(`trc.cats.${y.categorie}`)} · {date(y.date_prevue, langue)}{y.mensuel ? ` → ${date(y.jusqu_au, langue)} · ${t('trc.mensuel')}` : ''}</span></span>
                  <span className="actions" style={{ flexWrap: 'nowrap' }}><b className={y.sens === 'sortie' ? 'txt-err' : 'txt-ok'}>{y.sens === 'sortie' ? '−' : '+'}{montant(Number(y.montant), y.devise, langue)}</b>
                    <Bouton petit disabled={a.enCours} onClick={() => void desactiver(y.id)}>{t('imp.desactiver')}</Bouton></span></div>))}
            </section>
          </aside>
        </div>
      </>}
      {couvrir && <Couvrir e={couvrir} onClose={() => setCouvrir(null)} onFait={() => { setCouvrir(null); void ex.recharger(); }} />}
      {nouveau && <NouveauFlux onClose={() => setNouveau(false)} onFait={() => { setNouveau(false); void fl.recharger(); void p.recharger(); void ex.recharger(); }} />}
    </div>
  );
}

function NouveauFlux({ onClose, onFait }: { onClose: () => void; onFait: () => void }) {
  const { t } = useTranslation();
  const { societes } = useAuth();
  const a = useAction();
  const [f, setF] = useState({ societe_id: societes[0]?.id ?? '', sens: 'sortie', categorie: 'salaires', libelle: '', montant: '', devise: 'XOF', date_prevue: '', mensuel: false, jusqu_au: '' });
  const enregistrer = async () => {
    const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
    const v = z.object({ societe_id: z.string().uuid(), sens: z.enum(['entree', 'sortie']), categorie: z.enum(CATS), libelle: z.string().trim().min(3).max(200),
      montant: z.number().positive().max(1e13), devise: z.enum(DEVISES), date_prevue: DATE, mensuel: z.boolean(), jusqu_au: DATE.nullable() }).strict()
      .refine((x) => !x.mensuel || (x.jusqu_au !== null && x.jusqu_au >= x.date_prevue))
      .safeParse({ ...f, montant: Number(f.montant.replace(/\s/g, '').replace(',', '.')), jusqu_au: f.mensuel ? f.jusqu_au || null : null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('creer_flux_prevu', { p: v.data })))) onFait();
  };
  return (
    <Tiroir titre={t('trc.nouveau_flux')} onClose={onClose}>
      <div className="grille2">
        <Champ label={t('champs.raison_sociale')}><select value={f.societe_id} onChange={(e) => setF({ ...f, societe_id: e.target.value })}>{societes.map((x) => <option key={x.id} value={x.id}>{x.raison_sociale}</option>)}</select></Champ>
        <Champ label={t('trc.sens')}><select value={f.sens} onChange={(e) => setF({ ...f, sens: e.target.value })}><option value="sortie">{t('trc.sorties')}</option><option value="entree">{t('trc.entrees')}</option></select></Champ>
      </div>
      <Champ label={t('trc.categorie')}><select value={f.categorie} onChange={(e) => setF({ ...f, categorie: e.target.value })}>{CATS.map((k) => <option key={k} value={k}>{t(`trc.cats.${k}`)}</option>)}</select></Champ>
      <Champ label={t('trc.libelle')}><input value={f.libelle} maxLength={200} onChange={(e) => setF({ ...f, libelle: e.target.value })} /></Champ>
      <div className="grille2">
        <Champ label={t('gar.montant')}><input inputMode="decimal" value={f.montant} onChange={(e) => setF({ ...f, montant: e.target.value })} /></Champ>
        <Champ label={t('champs.devise')}><select value={f.devise} onChange={(e) => setF({ ...f, devise: e.target.value })}>{DEVISES.map((d) => <option key={d}>{d}</option>)}</select></Champ>
      </div>
      <Champ label={t('trc.date_prevue')}><input type="date" value={f.date_prevue} onChange={(e) => setF({ ...f, date_prevue: e.target.value })} /></Champ>
      <label className="bascule"><input type="checkbox" checked={f.mensuel} onChange={(e) => setF({ ...f, mensuel: e.target.checked })} /> {t('trc.mensuel')}</label>
      {f.mensuel && <Champ label={t('trc.jusqu_au')}><input type="date" value={f.jusqu_au} onChange={(e) => setF({ ...f, jusqu_au: e.target.value })} /></Champ>}
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

function Couvrir({ e, onClose, onFait }: { e: Expo; onClose: () => void; onFait: () => void }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const a = useAction();
  const [f, setF] = useState({ type: 'terme', taux: '', echeance: '', banque: '' });
  const enregistrer = async () => {
    const v = z.object({ societe_id: z.string().uuid(), devise: z.enum(['USD', 'CNY', 'EUR']), montant: z.number().positive().max(1e13), type: z.enum(['terme', 'option']),
      taux: z.number().positive().max(100000), echeance: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), banque: z.string().trim().min(2).max(200), paiement_id: z.string().uuid() }).strict()
      .safeParse({ societe_id: e.societe_id, devise: e.devise, montant: Number(e.montant), type: f.type, taux: Number(f.taux.replace(',', '.')), echeance: f.echeance, banque: f.banque, paiement_id: e.ref_id });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('creer_couverture', { p: v.data })))) onFait();
  };
  return (
    <Tiroir titre={`${t('trc.couvrir')} · ${montant(Number(e.montant), e.devise, langue)}`} onClose={onClose}>
      <p className="sec">{e.libelle}</p>
      <Champ label={t('trc.type_couverture')}><select value={f.type} onChange={(x) => setF({ ...f, type: x.target.value })}><option value="terme">{t('trc.terme')}</option><option value="option">{t('trc.option')}</option></select></Champ>
      <div className="grille2">
        <Champ label={t('trc.taux_couvert', { d: e.devise })}><input inputMode="decimal" value={f.taux} onChange={(x) => setF({ ...f, taux: x.target.value })} /></Champ>
        <Champ label={t('gar.echeance')}><input type="date" value={f.echeance} onChange={(x) => setF({ ...f, echeance: x.target.value })} /></Champ>
      </div>
      <Champ label={t('gar.banque')}><input value={f.banque} maxLength={200} onChange={(x) => setF({ ...f, banque: x.target.value })} /></Champ>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}
