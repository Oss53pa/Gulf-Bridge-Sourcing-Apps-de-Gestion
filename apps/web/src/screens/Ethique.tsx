// Qualité · éthique et conformité (M30 ; maquette ETH) : registre des déclarations (cadeaux, invitations,
// conflits d'intérêts, sollicitations) et engagements de non-commission des fournisseurs. Seuil, décision
// et droits tenus par la base (migration 57).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, montant } from '../lib/format';
import { useNoms } from '../lib/referentiels';
import { Bandeau, Bouton, Champ, Chargement, Entete, Onglets, Statut, Tiroir, Vide } from '../components/ui';

type Decision = 'a_decider' | 'accepte' | 'refuse_restitue' | 'mise_a_ecart' | 'prise_acte';
interface Declaration { id: string; reference: string; declarant_id: string; date_fait: string; type: string; tiers: string; valeur: number | null; devise: string | null;
  description: string; decision: Decision; motif_decision: string | null }
interface Engagement { fournisseur_id: string; fournisseur: string; signe_le: string | null }
const TYPES = ['cadeau', 'invitation', 'conflit_interets', 'sollicitation', 'autre'] as const;
const TON: Record<Decision, string> = { a_decider: 'att', accepte: 'ok', refuse_restitue: 'err', mise_a_ecart: 'ok', prise_acte: 'ok' };

export function Ethique() {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const admin = profil?.role === 'admin';
  const noms = useNoms('profils');
  const l = useAsync(async () => ok(await supabase.from('declarations_ethique').select('*').order('date_fait', { ascending: false }).limit(500)) as Declaration[], []);
  const eng = useAsync(async () => ok(await supabase.rpc('engagements_non_commission')) as Engagement[], []);
  const seuil = useAsync(async () => ok(await supabase.from('parametres').select('valeur, date_effet').eq('cle', 'ethique.seuil_cadeau_cny')
    .lte('date_effet', new Date().toISOString().slice(0, 10)).order('date_effet', { ascending: false }).limit(1)) as { valeur: unknown }[], []);
  const [filtre, setFiltre] = useState<'toutes' | 'a_decider' | 'refuse_restitue'>('toutes');
  const [nouvelle, setNouvelle] = useState(false);
  const [decider, setDecider] = useState<Declaration | null>(null);
  const tous = l.data ?? [];
  const liste = filtre === 'toutes' ? tous : tous.filter((d) => d.decision === filtre);
  const debutTrimestre = (() => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1)).toISOString().slice(0, 10); })();
  const trimestre = tous.filter((d) => d.date_fait >= debutTrimestre).length;
  const signes = (eng.data ?? []).filter((e) => e.signe_le).length;
  const s = seuil.data?.[0] ? Number(seuil.data[0].valeur) : null;
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.qualite')} · ${t('eth.surtitre')} · ETH`}
        titre={l.data ? t('eth.titre', { n: trimestre, s: signes, f: (eng.data ?? []).length }) : t('ecrans.ethique')}
        actions={<Bouton variante="primaire" onClick={() => setNouvelle(true)}>{t('eth.declarer')}</Bouton>} />
      <p className="sec" style={{ marginTop: -8 }}>{t('eth.regle', { s: s === null ? '—' : montant(s, 'CNY', langue) })}</p>
      <Onglets actif={filtre} onChange={setFiltre} items={[{ id: 'toutes' as const, lib: t('eth.toutes') }, { id: 'a_decider' as const, lib: t('eth.decisions.a_decider') }, { id: 'refuse_restitue' as const, lib: t('eth.refusees') }]} />
      <Bandeau type="err">{l.erreur ?? eng.erreur}</Bandeau>
      <div className="ref-grille liv-grille">
        <div className="cadre">
          {l.chargement && !l.data ? <Chargement /> : liste.length === 0 ? <Vide>{t('eth.aucune')}</Vide> : (
            <table className="t"><thead><tr><th>{t('eth.ref')}</th><th>{t('champs.date')}</th><th>{t('eth.type')}</th><th>{t('eth.declarant')}</th><th>{t('eth.tiers')}</th>
              <th className="num">{t('eth.valeur')}</th><th>{t('eth.decision')}</th></tr></thead>
              <tbody>{liste.map((d) => (
                <tr key={d.id} className={admin && d.decision === 'a_decider' && d.declarant_id !== profil?.id ? 'cliquable' : ''}
                  onClick={() => admin && d.decision === 'a_decider' && d.declarant_id !== profil?.id && setDecider(d)}>
                  <td className="ref">{d.reference}</td><td className="ref">{date(d.date_fait, langue)}</td><td>{t(`eth.types.${d.type}`)}<div className="mute">{d.description}</div></td>
                  <td>{noms[d.declarant_id] ?? ''}</td><td>{d.tiers}</td>
                  <td className="num">{d.valeur === null || d.devise === null ? '—' : montant(Number(d.valeur), d.devise, langue)}</td>
                  <td><Statut statut={TON[d.decision]} libelle={t(`eth.decisions.${d.decision}`)} />{d.motif_decision && <div className="mute">{d.motif_decision}</div>}</td></tr>))}</tbody></table>
          )}
          {admin && <p className="mute" style={{ marginTop: 12 }}>{t('eth.aide_admin')}</p>}
        </div>
        <aside className="exp-aside">
          <section>
            <div className="surtitre">{t('eth.engagements')}</div>
            {eng.chargement && !eng.data ? <Chargement /> : (eng.data ?? []).length === 0 ? <span className="mute">{t('eth.engagements_hors_droits')}</span> : (eng.data ?? []).map((e) => (
              <div key={e.fournisseur_id} className="grl-regle"><span><Link to={`/fournisseurs/${e.fournisseur_id}`}>{e.fournisseur}</Link>{e.signe_le && <span className="mute">{date(e.signe_le, langue)}</span>}</span>
                <Statut statut={e.signe_le ? 'ok' : 'att'} libelle={t(e.signe_le ? 'eth.signe' : 'eth.en_attente')} /></div>))}
            <span className="mute">{t('eth.aide_engagement')}</span>
          </section>
        </aside>
      </div>
      {nouvelle && <Declarer onClose={() => setNouvelle(false)} onFait={() => { setNouvelle(false); void l.recharger(); }} />}
      {decider && <Decider d={decider} onClose={() => setDecider(null)} onFait={() => { setDecider(null); void l.recharger(); }} />}
    </div>
  );
}

function Declarer({ onClose, onFait }: { onClose: () => void; onFait: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ date_fait: aujourdhui, type: 'cadeau', tiers: '', valeur: '', devise: 'CNY', description: '' });
  const enregistrer = async () => {
    const avecValeur = f.valeur.trim() !== '';
    const v = z.object({ date_fait: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), type: z.enum(TYPES), tiers: z.string().trim().min(2).max(200), valeur: z.number().min(0).max(1e10).nullable(),
      devise: z.enum(['CNY', 'XOF', 'XAF', 'USD', 'EUR']).nullable(), description: z.string().trim().min(5).max(2000) }).strict()
      .safeParse({ ...f, valeur: avecValeur ? Number(f.valeur.replace(/\s/g, '').replace(',', '.')) : null, devise: avecValeur ? f.devise : null });
    if (!v.success || v.data.date_fait > aujourdhui) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('declarer_ethique', { p: v.data })))) onFait();
  };
  return (
    <Tiroir titre={t('eth.declarer')} onClose={onClose}>
      <p className="sec">{t('eth.aide_declaration')}</p>
      <div className="grille2">
        <Champ label={t('eth.type')}><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{TYPES.map((k) => <option key={k} value={k}>{t(`eth.types.${k}`)}</option>)}</select></Champ>
        <Champ label={t('champs.date')}><input type="date" max={aujourdhui} value={f.date_fait} onChange={(e) => setF({ ...f, date_fait: e.target.value })} /></Champ>
      </div>
      <Champ label={t('eth.tiers')}><input value={f.tiers} maxLength={200} onChange={(e) => setF({ ...f, tiers: e.target.value })} /></Champ>
      <div className="grille2">
        <Champ label={t('eth.valeur_estimee')}><input inputMode="decimal" value={f.valeur} onChange={(e) => setF({ ...f, valeur: e.target.value })} /></Champ>
        <Champ label={t('champs.devise')}><select value={f.devise} onChange={(e) => setF({ ...f, devise: e.target.value })}>{['CNY', 'XOF', 'XAF', 'USD', 'EUR'].map((d) => <option key={d}>{d}</option>)}</select></Champ>
      </div>
      <Champ label={t('eth.description')}><textarea rows={3} maxLength={2000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Champ>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

function Decider({ d, onClose, onFait }: { d: Declaration; onClose: () => void; onFait: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [motif, setMotif] = useState('');
  const decider = async (dec: Decision) => {
    if (await a.executer(async () => ok(await supabase.rpc('decider_ethique', { p_declaration: d.id, p_decision: dec, p_motif: motif.trim() })))) onFait();
  };
  return (
    <Tiroir titre={`${t('eth.decider')} · ${d.reference}`} onClose={onClose}>
      <p><b>{t(`eth.types.${d.type}`)}</b> · {d.tiers}</p>
      <p className="sec">{d.description}</p>
      <Champ label={t('champs.motif')}><textarea rows={3} maxLength={1000} value={motif} onChange={(e) => setMotif(e.target.value)} /></Champ>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <div className="actions" style={{ flexWrap: 'wrap' }}>
        {(['accepte', 'refuse_restitue', 'mise_a_ecart', 'prise_acte'] as Decision[]).map((x) => (
          <Bouton key={x} variante={x === 'refuse_restitue' ? 'danger' : undefined} disabled={a.enCours || motif.trim().length < 5} onClick={() => void decider(x)}>{t(`eth.decisions.${x}`)}</Bouton>))}
      </div>
    </Tiroir>
  );
}
