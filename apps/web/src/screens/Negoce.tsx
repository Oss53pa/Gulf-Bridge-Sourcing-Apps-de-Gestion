// Dossiers · pilotage du négoce clé en main (maquette NEG). Marge, acomptes, change et couverture du
// risque calculés par la base (migration 56) ; l'écran saisit les conditions convenues avec le client.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { montant } from '../lib/format';
import { Bandeau, Bouton, Champ, Chargement, Entete, Statut, Tiroir, Vide } from '../components/ui';

interface Achat { reference: string; fournisseur: string; montant: number | null; devise: string; montant_xof: number }
interface Ligne { dossier_id: string; reference: string; intitule: string; client: string; statut: string; prix_vente_xof: number | null; achats_xof: number; couts_xof: number;
  cout_complet_xof: number; marge_xof: number | null; taux_marge: number | null; acompte_recu_xof: number; acompte_verse_xof: number; clause_revision: boolean;
  seuil_revision: number | null; garantie_restitution: boolean; marge_min: number; taux_manquant: boolean; achats: Achat[] }
const CHOC = 0.03;

export function Negoce() {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const finance = ['admin', 'comptable'].includes(profil?.role ?? '');
  const l = useAsync(async () => ok(await supabase.rpc('pilotage_negoce', { p_choc_cny: 0 })) as Ligne[], []);
  const choc = useAsync(async () => ok(await supabase.rpc('pilotage_negoce', { p_choc_cny: CHOC })) as Ligne[], [l.data?.length]);
  const [sel, setSel] = useState<string | null>(null);
  const [cond, setCond] = useState(false);
  const tous = l.data ?? [];
  const x = tous.find((d) => d.dossier_id === sel) ?? tous[0] ?? null;
  const xc = (choc.data ?? []).find((d) => d.dossier_id === x?.dossier_id);
  const mx = (v: number | null) => (v === null ? '—' : montant(Number(v), 'XOF', langue));
  const pct = (v: number | null) => (v === null ? '—' : `${(Number(v) * 100).toLocaleString(langue, { maximumFractionDigits: 1 })} %`);
  const ecartAcompte = (d: Ligne) => Number(d.acompte_verse_xof) - Number(d.acompte_recu_xof);
  const controles = (d: Ligne) => [
    { k: 'clause', ok: d.clause_revision },
    { k: 'garantie', ok: d.garantie_restitution },
    { k: 'acompte', ok: ecartAcompte(d) <= 0 },
    { k: 'marge', ok: d.taux_marge !== null && Number(d.taux_marge) >= Number(d.marge_min) },
  ];
  const etat = (d: Ligne): { ton: string; lib: string } => {
    if (d.prix_vente_xof === null) return { ton: 'neutre', lib: t('neg.prix_a_saisir') };
    if (d.taux_manquant) return { ton: 'att', lib: t('neg.taux_manquant') };
    if (ecartAcompte(d) > 0) return { ton: 'att', lib: t('neg.ecart_acompte') };
    return controles(d).every((c) => c.ok) ? { ton: 'ok', lib: t('neg.couvert') } : { ton: 'att', lib: t('neg.a_couvrir') };
  };
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.dossiers')} · ${t('neg.surtitre')} · NEG`} titre={t('neg.titre')} />
      <Bandeau type="err">{l.erreur ?? choc.erreur}</Bandeau>
      {l.chargement && !l.data ? <Chargement /> : tous.length === 0 ? <Vide>{t('neg.aucun')}</Vide> : <>
        <div className="neg-cartes">{tous.map((d) => { const e = etat(d); return (
          <button key={d.dossier_id} type="button" className={'soc-carte' + (x?.dossier_id === d.dossier_id ? ' choisi' : '')} onClick={() => setSel(d.dossier_id)}>
            <span className="liv-pv"><span className="ref">{d.reference}</span><b className={d.taux_marge !== null && Number(d.taux_marge) < Number(d.marge_min) ? 'txt-err' : ''}>{pct(d.taux_marge)}</b></span>
            <b>{d.client}</b><span className="sec">{d.intitule}</span>
            <span className="liv-pv"><span>{mx(d.prix_vente_xof)}</span><Statut statut={e.ton} libelle={e.lib} /></span></button>); })}</div>
        {x && (
          <div className="neg-detail">
            <div className="liv-pv">
              <span><span className="ref">{x.reference}</span> · <b>{x.client}</b> · <span className="sec">{x.intitule}</span> · <Link to={`/dossiers/${x.dossier_id}`}>{t('rnt.ouvrir_dossier')}</Link></span>
              {finance && <Bouton onClick={() => setCond(true)}>{t('neg.conditions')}</Bouton>}
            </div>
            {x.taux_manquant && <Bandeau type="err">{t('neg.alerte_taux')}</Bandeau>}
            <div className="ref-chiffres neg-chiffres">
              <div><span>{t('neg.prix_vente')}</span><b>{mx(x.prix_vente_xof)}</b></div>
              <div><span>{t('neg.cout_complet')}</span><b>{mx(x.cout_complet_xof)}</b></div>
              <div><span>{t('neg.marge')}</span><b className={x.marge_xof !== null && Number(x.marge_xof) < 0 ? 'txt-err' : ''}>{mx(x.marge_xof)}</b><small className="mute">{pct(x.taux_marge)}</small></div>
            </div>
            <div className="neg-grille">
              <section>
                <table className="t"><thead><tr><th>{t('neg.achats_couts')}</th><th className="num">{t('gar.montant')}</th><th className="num">{t('neg.en_xof')}</th></tr></thead>
                  <tbody>
                    {x.achats.map((a) => <tr key={a.reference}><td>{a.fournisseur}<div className="mute ref">{a.reference}</div></td><td className="num">{a.montant === null ? '—' : montant(Number(a.montant), a.devise, langue)}</td><td className="num">{mx(a.montant_xof)}</td></tr>)}
                    <tr><td>{t('neg.couts_valides')}</td><td className="num">—</td><td className="num">{mx(x.couts_xof)}</td></tr>
                  </tbody></table>
                {xc && x.marge_xof !== null && <p className="mute">{t('neg.simulation', { p: pct(CHOC), m: mx(xc.marge_xof), t: pct(xc.taux_marge) })}</p>}
              </section>
              <aside className="exp-aside">
                <section>
                  <div className="surtitre">{t('neg.acomptes')}</div>
                  <div className="grl-regle"><span>{t('neg.recu_client')}</span><b>{mx(x.acompte_recu_xof)}</b></div>
                  <div className="grl-regle"><span>{t('neg.verse_fournisseurs')}</span><b>{mx(x.acompte_verse_xof)}</b></div>
                  {ecartAcompte(x) > 0 && <Bandeau type="err">{t('neg.alerte_acompte', { m: mx(ecartAcompte(x)) })}</Bandeau>}
                </section>
                <section>
                  <div className="surtitre">{t('neg.couverture')}</div>
                  {controles(x).map((c) => <div key={c.k} className="grl-regle"><span>{t(`neg.controles.${c.k}`, { p: pct(x.marge_min) })}</span>
                    <Statut statut={c.ok ? 'ok' : 'err'} libelle={t(c.ok ? 'commun.oui' : 'commun.non')} /></div>)}
                </section>
              </aside>
            </div>
          </div>
        )}
      </>}
      {cond && x && <Conditions d={x} onClose={() => setCond(false)} onFait={() => { setCond(false); void l.recharger(); void choc.recharger(); }} />}
    </div>
  );
}

function Conditions({ d, onClose, onFait }: { d: Ligne; onClose: () => void; onFait: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [f, setF] = useState({ prix: '', devise: 'XOF', clause: d.clause_revision, seuil: d.seuil_revision === null ? '3' : String(Number(d.seuil_revision) * 100) });
  const enregistrer = async () => {
    const v = z.object({ prix_vente_ht: z.number().positive().max(1e13), devise: z.enum(['XOF', 'XAF', 'USD', 'EUR']), clause_revision: z.boolean(),
      seuil_revision: z.number().min(0).max(0.5).nullable() }).strict()
      .safeParse({ prix_vente_ht: Number(f.prix.replace(/\s/g, '').replace(',', '.')), devise: f.devise, clause_revision: f.clause,
        seuil_revision: f.clause ? Number((Number(f.seuil.replace(',', '.')) / 100).toFixed(4)) : null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('definir_conditions_negoce', { p_dossier: d.dossier_id, p: v.data })))) onFait();
  };
  return (
    <Tiroir titre={`${t('neg.conditions')} · ${d.reference}`} onClose={onClose}>
      <div className="grille2">
        <Champ label={t('neg.prix_vente_ht')}><input inputMode="decimal" value={f.prix} onChange={(e) => setF({ ...f, prix: e.target.value })} /></Champ>
        <Champ label={t('champs.devise')}><select value={f.devise} onChange={(e) => setF({ ...f, devise: e.target.value })}>{['XOF', 'XAF', 'USD', 'EUR'].map((x) => <option key={x}>{x}</option>)}</select></Champ>
      </div>
      <label className="bascule"><input type="checkbox" checked={f.clause} onChange={(e) => setF({ ...f, clause: e.target.checked })} /> {t('neg.clause')}</label>
      {f.clause && <Champ label={t('neg.seuil')}><input inputMode="decimal" value={f.seuil} onChange={(e) => setF({ ...f, seuil: e.target.value })} /></Champ>}
      <p className="mute">{t('neg.aide_conditions')}</p>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}
