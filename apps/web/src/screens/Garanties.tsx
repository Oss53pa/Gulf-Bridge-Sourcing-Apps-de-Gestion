// Finance · garanties bancaires (maquette GAR). Cycle, échéances et commission courue tenus par la base
// (migration 54) ; l'écran valide la saisie et n'écrit que par les fonctions dédiées.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, montant } from '../lib/format';
import { Bandeau, Bouton, Champ, Chargement, Entete, Statut, Tiroir, Vide } from '../components/ui';

type StatutG = 'demandee' | 'emise' | 'mainlevee_demandee' | 'levee' | 'appelee' | 'refusee';
interface Garantie { id: string; reference: string; societe_id: string; type: string; beneficiaire: string; banque: string; montant: number; devise: string; taux_commission: number;
  dossier_id: string | null; ao_id: string | null; statut: StatutG; demandee_le: string; emise_le: string | null; echeance: string | null; mainlevee_le: string | null; motif: string | null;
  dossiers: { reference: string } | null; appels_offres: { reference: string } | null }
interface Suivi { id: string; jours_restants: number | null; echue_sans_mainlevee: boolean; commission_courue: number }
const TYPES = ['soumission', 'bonne_execution', 'restitution_acompte', 'retenue_garantie', 'autre'] as const;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function Garanties() {
  const { t } = useTranslation();
  const { profil, langue, societeActive } = useAuth();
  const finance = ['admin', 'comptable'].includes(profil?.role ?? '');
  const l = useAsync(async () => {
    let q = supabase.from('garanties_bancaires').select('*, dossiers(reference), appels_offres(reference)').order('demandee_le', { ascending: false }).limit(500);
    if (societeActive) q = q.eq('societe_id', societeActive);
    return ok(await q) as unknown as Garantie[];
  }, [societeActive]);
  const s = useAsync(async () => ok(await supabase.rpc('garanties_suivi')) as Suivi[], [l.data?.length]);
  const [sel, setSel] = useState<string | null>(null);
  const [nouvelle, setNouvelle] = useState(false);
  const tous = l.data ?? [];
  const suivi = (id: string) => (s.data ?? []).find((x) => x.id === id);
  const actives = tous.filter((g) => ['demandee', 'emise', 'mainlevee_demandee'].includes(g.statut));
  const echues = actives.filter((g) => suivi(g.id)?.echue_sans_mainlevee).length;
  const sous30 = actives.filter((g) => { const j = suivi(g.id)?.jours_restants; return j !== null && j !== undefined && j >= 0 && j <= 30; }).length;
  const totaux = Object.entries(actives.reduce<Record<string, number>>((m, g) => ({ ...m, [g.devise]: (m[g.devise] ?? 0) + Number(g.montant) }), {}))
    .map(([d, v]) => montant(v, d, langue)).join(t('expeditions.et'));
  const titre = t('gar.titre', { n: actives.length, m: totaux || '0' }) + [echues ? t('gar.titre_echues', { n: echues }) : '', sous30 ? t('gar.titre_sous30', { n: sous30 }) : ''].filter(Boolean).map((x) => ` ; ${x}`).join('');
  const etat = (g: Garantie): { ton: string; lib: string } => {
    const x = suivi(g.id);
    if (g.statut === 'emise' || g.statut === 'mainlevee_demandee') {
      if (x?.echue_sans_mainlevee) return { ton: 'err', lib: t('gar.echue') };
      if (x?.jours_restants !== null && x?.jours_restants !== undefined && x.jours_restants <= 30) return { ton: 'att', lib: t('gar.echeance_j', { n: x.jours_restants }) };
    }
    const ton: Record<StatutG, string> = { demandee: 'info', emise: 'ok', mainlevee_demandee: 'att', levee: 'neutre', appelee: 'err', refusee: 'neutre' };
    return { ton: ton[g.statut], lib: t(`gar.statuts.${g.statut}`) };
  };
  const x = tous.find((g) => g.id === sel) ?? tous[0] ?? null;
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.finance')} · ${t('gar.surtitre')} · GAR`} titre={l.data ? titre : t('ecrans.garanties')}
        actions={finance && <Bouton variante="primaire" onClick={() => setNouvelle(true)}>{t('gar.nouvelle')}</Bouton>} />
      <Bandeau type="err">{l.erreur ?? s.erreur}</Bandeau>
      <div className="ref-grille liv-grille">
        <div className="cadre">
          {l.chargement && !l.data ? <Chargement /> : tous.length === 0 ? <Vide>{t('gar.aucune')}</Vide> : (
            <div style={{ overflowX: 'auto' }}><table className="t"><thead><tr><th>{t('gar.garantie')}</th><th>{t('gar.type')}</th><th>{t('gar.beneficiaire')}</th><th>{t('gar.banque')}</th>
              <th className="num">{t('gar.montant')}</th><th>{t('gar.echeance')}</th><th>{t('champs.statut')}</th></tr></thead>
              <tbody>{tous.map((g) => { const e = etat(g); return (
                <tr key={g.id} className={'cliquable' + (x?.id === g.id ? ' choisi' : '')} onClick={() => setSel(g.id)}>
                  <td className="ref">{g.reference}</td><td>{t(`gar.types.${g.type}`)}</td><td>{g.beneficiaire}</td><td className="sec">{g.banque}</td>
                  <td className="num">{montant(Number(g.montant), g.devise, langue)}</td><td className="ref">{g.echeance ? date(g.echeance, langue) : '—'}</td>
                  <td><Statut statut={e.ton} libelle={e.lib} /></td></tr>); })}</tbody></table></div>
          )}
        </div>
        {x && <FicheGarantie g={x} s={suivi(x.id)} etat={etat(x)} finance={finance} onChange={() => { void l.recharger(); void s.recharger(); }} />}
      </div>
      {nouvelle && <NouvelleGarantie onClose={() => setNouvelle(false)} onFait={(id) => { setNouvelle(false); setSel(id); void l.recharger(); }} />}
    </div>
  );
}

function FicheGarantie({ g, s, etat, finance, onChange }: { g: Garantie; s: Suivi | undefined; etat: { ton: string; lib: string }; finance: boolean; onChange: () => void }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const a = useAction();
  const auj = new Date().toISOString().slice(0, 10);
  const [em, setEm] = useState({ emise_le: auj, echeance: '' });
  const [lev, setLev] = useState(auj);
  const [motif, setMotif] = useState('');
  const appel = async (fn: string, args: Record<string, unknown>) => { if (await a.executer(async () => ok(await supabase.rpc(fn, args)))) { setMotif(''); onChange(); } };
  const emettre = async () => {
    const v = z.object({ p_garantie: z.string().uuid(), p_emise_le: DATE, p_echeance: DATE }).strict().refine((y) => y.p_echeance > y.p_emise_le && y.p_emise_le <= auj)
      .safeParse({ p_garantie: g.id, p_emise_le: em.emise_le, p_echeance: em.echeance });
    if (!v.success) { a.setErreur(t('gar.dates_invalides')); return; }
    await appel('emettre_garantie', v.data);
  };
  const active = ['emise', 'mainlevee_demandee'].includes(g.statut);
  return (
    <aside className="exp-aside">
      <section>
        <span className="mute">{g.reference} · {t(`gar.types.${g.type}`)}</span>
        <div className="liv-pv"><b className="liv-client">{g.beneficiaire}</b><Statut statut={etat.ton} libelle={etat.lib} /></div>
        <dl className="dl">
          <dt>{t('gar.banque')}</dt><dd>{g.banque}</dd>
          <dt>{t('gar.montant')}</dt><dd>{montant(Number(g.montant), g.devise, langue)}</dd>
          <dt>{t('gar.emise_le')}</dt><dd>{g.emise_le ? date(g.emise_le, langue) : '—'}</dd>
          <dt>{t('gar.echeance')}</dt><dd>{g.echeance ? date(g.echeance, langue) : '—'}{s?.jours_restants !== null && s?.jours_restants !== undefined && s.jours_restants >= 0 ? ` · J−${s.jours_restants}` : ''}</dd>
          {g.dossier_id && <><dt>{t('champs.dossier')}</dt><dd><Link to={`/dossiers/${g.dossier_id}`}>{g.dossiers?.reference ?? ''}</Link></dd></>}
          {g.ao_id && <><dt>{t('gar.ao')}</dt><dd><Link to={`/appels-offres/${g.ao_id}`}>{g.appels_offres?.reference ?? ''}</Link></dd></>}
          <dt>{t('gar.commission')}</dt><dd>{montant(Number(s?.commission_courue ?? 0), g.devise, langue)} · {t('gar.taux', { p: (Number(g.taux_commission) * 100).toLocaleString(langue) })}</dd>
          {g.mainlevee_le && <><dt>{t('gar.mainlevee_le')}</dt><dd>{date(g.mainlevee_le, langue)}</dd></>}
          {g.motif && <><dt>{t('champs.motif')}</dt><dd>{g.motif}</dd></>}
        </dl>
        {s?.echue_sans_mainlevee && <Bandeau type="err">{t('gar.alerte_commission', { p: (Number(g.taux_commission) * 100).toLocaleString(langue) })}</Bandeau>}
      </section>
      <Bandeau type="err">{a.erreur}</Bandeau>
      {finance && g.statut === 'demandee' && <section>
        <div className="surtitre">{t('gar.emission')}</div>
        <div className="grille2">
          <Champ label={t('gar.emise_le')}><input type="date" max={auj} value={em.emise_le} onChange={(e) => setEm({ ...em, emise_le: e.target.value })} /></Champ>
          <Champ label={t('gar.echeance')}><input type="date" value={em.echeance} onChange={(e) => setEm({ ...em, echeance: e.target.value })} /></Champ>
        </div>
        <Bouton variante="primaire" disabled={a.enCours} onClick={() => void emettre()}>{t('gar.enregistrer_emission')}</Bouton>
        <input value={motif} maxLength={1000} placeholder={t('gar.motif_refus')} aria-label={t('gar.motif_refus')} onChange={(e) => setMotif(e.target.value)} />
        <Bouton petit disabled={a.enCours || motif.trim().length < 5} onClick={() => void appel('suivre_garantie', { p_garantie: g.id, p_etape: 'refusee', p_motif: motif.trim() })}>{t('gar.refusee_banque')}</Bouton>
      </section>}
      {finance && active && <section>
        <div className="surtitre">{t('gar.suivi')}</div>
        {g.statut === 'emise' && <Bouton disabled={a.enCours} onClick={() => void appel('suivre_garantie', { p_garantie: g.id, p_etape: 'mainlevee_demandee' })}>{t('gar.demander_mainlevee')}</Bouton>}
        <div className="actions" style={{ alignItems: 'end' }}>
          <Champ label={t('gar.mainlevee_le')}><input type="date" max={auj} min={g.emise_le ?? undefined} value={lev} onChange={(e) => setLev(e.target.value)} /></Champ>
          <Bouton disabled={a.enCours || !lev} onClick={() => void appel('suivre_garantie', { p_garantie: g.id, p_etape: 'levee', p_date: lev })}>{t('gar.constater_mainlevee')}</Bouton>
        </div>
        <input value={motif} maxLength={1000} placeholder={t('gar.motif_appel')} aria-label={t('gar.motif_appel')} onChange={(e) => setMotif(e.target.value)} />
        <Bouton petit variante="danger" disabled={a.enCours || motif.trim().length < 5} onClick={() => void appel('suivre_garantie', { p_garantie: g.id, p_etape: 'appelee', p_motif: motif.trim() })}>{t('gar.appelee')}</Bouton>
      </section>}
      <p className="mute">{t('gar.aide')}</p>
    </aside>
  );
}

function NouvelleGarantie({ onClose, onFait }: { onClose: () => void; onFait: (id: string) => void }) {
  const { t } = useTranslation();
  const { societes } = useAuth();
  const a = useAction();
  const ds = useAsync(async () => ok(await supabase.from('dossiers').select('id, reference, societe_id').order('reference', { ascending: false }).limit(500)) as { id: string; reference: string; societe_id: string }[], []);
  const aos = useAsync(async () => { const r = await supabase.from('appels_offres').select('id, reference, societe_id, objet').order('cree_le', { ascending: false }).limit(200);
    return r.error ? [] : r.data as { id: string; reference: string; societe_id: string; objet: string }[]; }, []);
  const [f, setF] = useState({ societe_id: societes[0]?.id ?? '', type: 'bonne_execution', beneficiaire: '', banque: '', montant: '', devise: 'XOF', taux: '1.5', dossier_id: '', ao_id: '' });
  const enregistrer = async () => {
    const v = z.object({ societe_id: z.string().uuid(), type: z.enum(TYPES), beneficiaire: z.string().trim().min(2).max(200), banque: z.string().trim().min(2).max(200),
      montant: z.number().positive().max(1e13), devise: z.enum(['XOF', 'XAF', 'USD', 'EUR']), taux_commission: z.number().min(0).max(0.2),
      dossier_id: z.string().uuid().nullable(), ao_id: z.string().uuid().nullable() }).strict()
      .safeParse({ societe_id: f.societe_id, type: f.type, beneficiaire: f.beneficiaire, banque: f.banque, montant: Number(f.montant.replace(/\s/g, '')), devise: f.devise,
        taux_commission: Number((Number(f.taux.replace(',', '.')) / 100).toFixed(4)), dossier_id: f.dossier_id || null, ao_id: f.ao_id || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    let id = '';
    if (await a.executer(async () => { id = ok(await supabase.rpc('demander_garantie', { p: v.data })) as string; }) && id) onFait(id);
  };
  return (
    <Tiroir titre={t('gar.nouvelle')} onClose={onClose}>
      <div className="grille2">
        <Champ label={t('champs.raison_sociale')}><select value={f.societe_id} onChange={(e) => setF({ ...f, societe_id: e.target.value, dossier_id: '', ao_id: '' })}>
          {societes.map((x) => <option key={x.id} value={x.id}>{x.raison_sociale}</option>)}</select></Champ>
        <Champ label={t('gar.type')}><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{TYPES.map((k) => <option key={k} value={k}>{t(`gar.types.${k}`)}</option>)}</select></Champ>
      </div>
      <Champ label={t('gar.beneficiaire')}><input value={f.beneficiaire} maxLength={200} onChange={(e) => setF({ ...f, beneficiaire: e.target.value })} /></Champ>
      <Champ label={t('gar.banque')}><input value={f.banque} maxLength={200} onChange={(e) => setF({ ...f, banque: e.target.value })} /></Champ>
      <div className="grille3">
        <Champ label={t('gar.montant')}><input inputMode="numeric" value={f.montant} onChange={(e) => setF({ ...f, montant: e.target.value })} /></Champ>
        <Champ label={t('champs.devise')}><select value={f.devise} onChange={(e) => setF({ ...f, devise: e.target.value })}>{['XOF', 'XAF', 'USD', 'EUR'].map((d) => <option key={d}>{d}</option>)}</select></Champ>
        <Champ label={t('gar.taux_pct')}><input inputMode="decimal" value={f.taux} onChange={(e) => setF({ ...f, taux: e.target.value })} /></Champ>
      </div>
      <Champ label={t('champs.dossier')}><select value={f.dossier_id} onChange={(e) => setF({ ...f, dossier_id: e.target.value })}>
        <option value="">—</option>{(ds.data ?? []).filter((d) => d.societe_id === f.societe_id).map((d) => <option key={d.id} value={d.id}>{d.reference}</option>)}</select></Champ>
      <Champ label={t('gar.ao')}><select value={f.ao_id} onChange={(e) => setF({ ...f, ao_id: e.target.value })}>
        <option value="">—</option>{(aos.data ?? []).filter((d) => d.societe_id === f.societe_id).map((d) => <option key={d.id} value={d.id}>{d.reference} · {d.objet}</option>)}</select></Champ>
      <Bandeau type="err">{ds.erreur ?? a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}
