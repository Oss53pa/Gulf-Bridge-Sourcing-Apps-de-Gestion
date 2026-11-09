// Après-vente : stock de pièces (maquette STK) et garantie / SAV (maquette SAV).
// Quantités, coûts, numérotation, recours et clôture tenus par la base (migration 51) ; l'écran
// valide la saisie avant envoi et n'écrit que par les fonctions dédiées.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, montant, type Langue } from '../lib/format';
import { useNoms } from '../lib/referentiels';
import { Bandeau, Bouton, Champ, Chargement, Entete, Kpis, Statut, Tiroir, Vide } from '../components/ui';
import { Depot } from '../components/Depot';

interface Article { id: string; site: string; reference: string; designation: string; fournisseur_id: string | null; quantite: number; seuil: number; cout_unitaire_xof: number; actif: boolean }
interface Reclamation { id: string; reference: string; dossier_id: string; equipement: string; numero_serie: string | null; defaut: string; urgent: boolean; fin_garantie: string | null;
  declaree_le: string; statut: 'declaree' | 'en_cours' | 'cloturee'; recours: 'aucun' | 'ouvert' | 'accepte' | 'refuse'; recours_motif: string | null; article_id: string | null;
  intervention_id: string | null; cloture_signataire: string | null; cloturee_le: string | null; dossiers: { reference: string; clients: { raison_sociale: string } | null } | null }
const UUID = z.string().uuid();
const etatStock = (a: Article) => (Number(a.quantite) <= 0 ? 'rupture' : Number(a.quantite) <= Number(a.seuil) ? 'reassort' : 'disponible');
const TON_STOCK = { rupture: 'err', reassort: 'att', disponible: 'ok' } as const;

// ----------------------------------------------------------------------------- stock
export function StockPieces() {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const gere = ['admin', 'hub_afrique'].includes(profil?.role ?? '');
  const fournisseurs = useNoms('fournisseurs');
  const l = useAsync(async () => ok(await supabase.from('stock_articles').select('*').eq('actif', true).order('reference')) as Article[], []);
  const [nouveau, setNouveau] = useState(false);
  const [mvt, setMvt] = useState<{ a: Article; sens: 'entree' | 'sortie' } | null>(null);
  const tous = l.data ?? [];
  const alerte = tous.filter((a) => etatStock(a) !== 'disponible');
  const ruptures = tous.filter((a) => etatStock(a) === 'rupture').length;
  const valeur = tous.reduce((n, a) => n + Number(a.quantite) * Number(a.cout_unitaire_xof), 0);
  const sites = [...new Set(tous.map((a) => a.site))].join(', ') || '—';
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.apres_vente')} · ${t('stock.surtitre')} · ${sites} · STK`}
        titre={l.data ? t('stock.titre', { site: sites, n: alerte.length }) : t('ecrans.stock')}
        actions={gere && <Bouton variante="primaire" onClick={() => setNouveau(true)}>{t('stock.nouvelle_reference')}</Bouton>} />
      <Kpis items={[
        { lib: t('stock.references'), val: String(tous.length), sous: t('stock.pieces_rechange') },
        { lib: t('stock.au_seuil'), val: String(alerte.length), sous: t('stock.en_rupture', { n: ruptures }) },
        { lib: t('stock.valeur'), val: montant(valeur, 'XOF', langue), sous: t('stock.cout_moyen') },
      ]} />
      <Bandeau type="err">{l.erreur}</Bandeau>
      <div className="cadre">
        {l.chargement && !l.data ? <Chargement /> : tous.length === 0 ? <Vide>{t('stock.aucune')}</Vide> : (
          <div style={{ overflowX: 'auto' }}><table className="t"><thead><tr><th>{t('stock.reference')}</th><th>{t('stock.article')}</th><th>{t('stock.fabricant')}</th>
            <th className="num">{t('stock.stock')}</th><th className="num">{t('stock.seuil')}</th><th className="num">{t('stock.cout')}</th><th>{t('stock.etat')}</th><th /></tr></thead>
            <tbody>{tous.map((a) => { const e = etatStock(a); return (
              <tr key={a.id}><td className="ref">{a.reference}</td><td>{a.designation}<div className="mute">{a.site}</div></td>
                <td className="sec">{a.fournisseur_id ? fournisseurs[a.fournisseur_id] ?? '' : '—'}</td>
                <td className={'num' + (e === 'rupture' ? ' txt-err' : '')}>{Number(a.quantite)}</td><td className="num">{Number(a.seuil)}</td>
                <td className="num">{montant(Number(a.cout_unitaire_xof), 'XOF', langue)}</td>
                <td><Statut statut={TON_STOCK[e]} libelle={t(`stock.etats.${e}`)} /></td>
                <td className="num">{gere && <span className="actions" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                  <Bouton petit onClick={() => setMvt({ a, sens: 'entree' })}>{t('stock.entree')}</Bouton>
                  <Bouton petit disabled={Number(a.quantite) <= 0} onClick={() => setMvt({ a, sens: 'sortie' })}>{t('stock.sortie')}</Bouton></span>}</td></tr>); })}</tbody></table></div>
        )}
        <p className="mute" style={{ marginTop: 12 }}>{t('stock.aide')} <Link to="/interventions">{t('stock.voir_interventions')}</Link></p>
      </div>
      {nouveau && <NouvelArticle onClose={() => setNouveau(false)} onFait={() => { setNouveau(false); void l.recharger(); }} />}
      {mvt && <Mouvement article={mvt.a} sens={mvt.sens} onClose={() => setMvt(null)} onFait={() => { setMvt(null); void l.recharger(); }} />}
    </div>
  );
}

function NouvelArticle({ onClose, onFait }: { onClose: () => void; onFait: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const fs = useAsync(async () => ok(await supabase.from('fournisseurs').select('id, raison_sociale_en').order('raison_sociale_en').limit(500)) as { id: string; raison_sociale_en: string }[], []);
  const [f, setF] = useState({ reference: 'PR-', designation: '', fournisseur_id: '', seuil: '1', site: 'Abidjan' });
  const enregistrer = async () => {
    const v = z.object({ reference: z.string().trim().toUpperCase().regex(/^PR-[A-Z0-9-]{2,30}$/), designation: z.string().trim().min(2).max(200),
      fournisseur_id: UUID.nullable(), seuil: z.number().min(0).max(100000), site: z.string().trim().min(2).max(60) }).strict()
      .safeParse({ ...f, fournisseur_id: f.fournisseur_id || null, seuil: Number(f.seuil.replace(',', '.')) });
    if (!v.success) { a.setErreur(t('stock.reference_invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('creer_article_stock', { p: v.data })))) onFait();
  };
  return (
    <Tiroir titre={t('stock.nouvelle_reference')} onClose={onClose}>
      <Champ label={t('stock.reference')}><input value={f.reference} maxLength={33} onChange={(e) => setF({ ...f, reference: e.target.value.toUpperCase() })} /></Champ>
      <Champ label={t('stock.article')}><input value={f.designation} maxLength={200} onChange={(e) => setF({ ...f, designation: e.target.value })} /></Champ>
      <Champ label={t('stock.fabricant')}><select value={f.fournisseur_id} onChange={(e) => setF({ ...f, fournisseur_id: e.target.value })}>
        <option value="">—</option>{(fs.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.raison_sociale_en}</option>)}</select></Champ>
      <div className="grille2">
        <Champ label={t('stock.seuil')}><input inputMode="decimal" value={f.seuil} onChange={(e) => setF({ ...f, seuil: e.target.value })} /></Champ>
        <Champ label={t('stock.site')}><input value={f.site} maxLength={60} onChange={(e) => setF({ ...f, site: e.target.value })} /></Champ>
      </div>
      <p className="mute">{t('stock.aide_creation')}</p>
      <Bandeau type="err">{fs.erreur ?? a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

function Mouvement({ article, sens, onClose, onFait }: { article: Article; sens: 'entree' | 'sortie'; onClose: () => void; onFait: () => void }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const a = useAction();
  const [f, setF] = useState({ quantite: '1', motif: '', cout: '' });
  const enregistrer = async () => {
    const v = z.object({ p_article: UUID, p_sens: z.enum(['entree', 'sortie']), p_quantite: z.number().positive().max(100000), p_motif: z.string().trim().min(3).max(300),
      p_cout: z.number().min(0).max(1e11).nullable() }).strict()
      .refine((x) => x.p_sens === 'sortie' || x.p_cout !== null)
      .safeParse({ p_article: article.id, p_sens: sens, p_quantite: Number(f.quantite.replace(',', '.')), p_motif: f.motif,
        p_cout: sens === 'entree' && f.cout.trim() !== '' ? Number(f.cout.replace(/\s/g, '').replace(',', '.')) : null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('mouvement_stock', v.data)))) onFait();
  };
  return (
    <Tiroir titre={`${t(sens === 'entree' ? 'stock.entree_titre' : 'stock.sortie_titre')} · ${article.reference}`} onClose={onClose}>
      <p className="sec">{article.designation} · {t('stock.en_stock', { n: Number(article.quantite) })} · {t('stock.cout_actuel', { c: montant(Number(article.cout_unitaire_xof), 'XOF', langue) })}</p>
      <Champ label={t('stock.quantite')}><input inputMode="decimal" value={f.quantite} onChange={(e) => setF({ ...f, quantite: e.target.value })} /></Champ>
      {sens === 'entree' && <Champ label={t('stock.cout_unitaire')}><input inputMode="numeric" value={f.cout} onChange={(e) => setF({ ...f, cout: e.target.value })} /></Champ>}
      <Champ label={t('champs.motif')}><input value={f.motif} maxLength={300} placeholder={t(sens === 'entree' ? 'stock.motif_entree' : 'stock.motif_sortie')} onChange={(e) => setF({ ...f, motif: e.target.value })} /></Champ>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

// ----------------------------------------------------------------------------- garantie et SAV
export function GarantieSav() {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const role = profil?.role ?? '';
  const gere = ['admin', 'hub_afrique'].includes(role);
  const l = useAsync(async () => ok(await supabase.from('reclamations_sav').select('*, dossiers(reference, clients(raison_sociale))')
    .order('declaree_le', { ascending: false }).limit(500)) as unknown as Reclamation[], []);
  const stock = useAsync(async () => ok(await supabase.from('stock_articles').select('*').eq('actif', true).order('reference')) as Article[], []);
  const [sel, setSel] = useState<string | null>(null);
  const [nouvelle, setNouvelle] = useState(false);
  const tous = l.data ?? [];
  const x = tous.find((r) => r.id === sel) ?? tous[0] ?? null;
  const ouvertes = tous.filter((r) => r.statut !== 'cloturee');
  const garantie = (r: Reclamation) => (r.fin_garantie === null ? 'inconnue' : r.fin_garantie >= r.declaree_le ? 'sous' : 'expiree');
  const titre = t('sav.titre', { n: ouvertes.length, u: ouvertes.filter((r) => r.urgent).length, r: ouvertes.filter((r) => r.recours === 'ouvert').length });
  const mmaa = (d: string | null) => (d ? `${d.slice(5, 7)}.${d.slice(0, 4)}` : '—');
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.apres_vente')} · ${t('sav.surtitre')} · SAV`} titre={l.data ? titre : t('ecrans.sav')}
        actions={gere && <Bouton variante="primaire" onClick={() => setNouvelle(true)}>{t('sav.nouvelle')}</Bouton>} />
      <Bandeau type="err">{l.erreur ?? stock.erreur}</Bandeau>
      <div className="ref-grille liv-grille">
        <div className="cadre">
          {l.chargement && !l.data ? <Chargement /> : tous.length === 0 ? <Vide>{t('sav.aucune')}</Vide> : (
            <table className="t"><thead><tr><th>{t('sav.reclamation')}</th><th>{t('sav.client')}</th><th>{t('sav.equipement_defaut')}</th><th>{t('sav.garantie')}</th><th>{t('champs.statut')}</th></tr></thead>
              <tbody>{tous.map((r) => { const g = garantie(r); return (
                <tr key={r.id} className={'cliquable' + (x?.id === r.id ? ' choisi' : '')} onClick={() => setSel(r.id)}>
                  <td className="ref">{r.reference}</td><td>{r.dossiers?.clients?.raison_sociale ?? '—'}</td>
                  <td>{r.equipement}<div className="mute">{r.defaut}</div></td>
                  <td><Statut statut={g === 'sous' ? 'ok' : g === 'expiree' ? 'neutre' : 'att'} libelle={`${t(`sav.garanties.${g}`)}${r.fin_garantie ? ` · ${mmaa(r.fin_garantie)}` : ''}`} /></td>
                  <td><Statut statut={r.statut === 'cloturee' ? 'ok' : r.urgent ? 'err' : 'info'} libelle={r.statut === 'cloturee' ? t('sav.statuts.cloturee') : r.urgent ? t('sav.urgent') : t(`sav.statuts.${r.statut}`)} /></td>
                </tr>); })}</tbody></table>
          )}
        </div>
        {x && <FicheReclamation r={x} articles={stock.data ?? []} gere={gere} recours={['admin', 'hub_afrique', 'achats_chine'].includes(role)} langue={langue}
          onChange={() => { void l.recharger(); void stock.recharger(); }} />}
      </div>
      {nouvelle && <NouvelleReclamation onClose={() => setNouvelle(false)} onFait={(id) => { setNouvelle(false); setSel(id); void l.recharger(); }} />}
    </div>
  );
}

function FicheReclamation({ r, articles, gere, recours, langue, onChange }: { r: Reclamation; articles: Article[]; gere: boolean; recours: boolean; langue: Langue; onChange: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [motif, setMotif] = useState('');
  const [piece, setPiece] = useState('');
  const [inter, setInter] = useState('');
  const [cl, setCl] = useState({ signataire: '', document: '' });
  const interventions = useAsync(async () => ok(await supabase.from('interventions').select('id, reference, statut, date_debut').eq('dossier_id', r.dossier_id).neq('statut', 'annulee')) as
    { id: string; reference: string; statut: string; date_debut: string }[], [r.dossier_id]);
  const close = r.statut === 'cloturee';
  const appel = async (fn: string, args: Record<string, unknown>) => { if (await a.executer(async () => ok(await supabase.rpc(fn, args)))) { setMotif(''); onChange(); } };
  const art = articles.find((y) => y.id === r.article_id);
  const it = (interventions.data ?? []).find((y) => y.id === r.intervention_id);
  const etapes = [
    { k: 'declaree', fait: true },
    { k: 'recours', fait: r.recours !== 'aucun' },
    { k: 'piece', fait: Boolean(r.article_id) },
    { k: 'intervention', fait: Boolean(r.intervention_id) },
    { k: 'cloture', fait: close },
  ];
  return (
    <aside className="exp-aside">
      <section>
        <span className="mute">{r.reference} · {r.dossiers?.reference ?? ''} · {date(r.declaree_le, langue)}</span>
        <b className="liv-client">{r.equipement}</b>
        <span className="sec">{r.defaut}{r.numero_serie ? ` · n° ${r.numero_serie}` : ''}</span>
        <div className="liv-douane sav-etapes">{etapes.map((e) => <div key={e.k} className={e.fait ? 'fait' : ''}><span />{t(`sav.etapes.${e.k}`)}</div>)}</div>
      </section>
      <Bandeau type="err">{a.erreur ?? interventions.erreur}</Bandeau>
      <section>
        <div className="liv-pv"><span className="surtitre">{t('sav.recours_titre')}</span>
          <Statut statut={r.recours === 'accepte' ? 'ok' : r.recours === 'refuse' ? 'err' : r.recours === 'ouvert' ? 'att' : 'neutre'} libelle={t(`sav.recours.${r.recours}`)} /></div>
        {r.recours_motif && <span className="mute">{r.recours_motif}</span>}
        {!close && recours && r.recours === 'aucun' && <Bouton petit disabled={a.enCours} onClick={() => void appel('recours_reclamation', { p_rec: r.id, p_etat: 'ouvert' })}>{t('sav.ouvrir_recours')}</Bouton>}
        {!close && recours && r.recours === 'ouvert' && <>
          <input value={motif} maxLength={1000} placeholder={t('sav.motif_refus')} aria-label={t('sav.motif_refus')} onChange={(e) => setMotif(e.target.value)} />
          <span className="actions">
            <Bouton petit disabled={a.enCours || motif.trim().length < 5} onClick={() => void appel('recours_reclamation', { p_rec: r.id, p_etat: 'refuse', p_motif: motif.trim() })}>{t('sav.refuse')}</Bouton>
            <Bouton petit variante="primaire" disabled={a.enCours} onClick={() => void appel('recours_reclamation', { p_rec: r.id, p_etat: 'accepte' })}>{t('sav.accepte')}</Bouton>
          </span>
        </>}
      </section>
      <section>
        <div className="surtitre">{t('sav.piece')}</div>
        {art ? <span>{art.designation} · <span className="ref">{art.reference}</span></span> : !close && gere ? <>
          <select value={piece} onChange={(e) => setPiece(e.target.value)} aria-label={t('sav.piece')}>
            <option value="">—</option>{articles.map((y) => <option key={y.id} value={y.id} disabled={Number(y.quantite) <= 0}>{y.reference} · {y.designation} · {t('stock.en_stock', { n: Number(y.quantite) })}</option>)}</select>
          <Bouton petit disabled={a.enCours || !piece} onClick={() => void appel('reserver_piece_reclamation', { p_rec: r.id, p_article: piece })}>{t('sav.reserver')}</Bouton>
        </> : <span className="mute">—</span>}
      </section>
      <section>
        <div className="surtitre">{t('sav.intervention')}</div>
        {it ? <span><Link to="/interventions">{it.reference}</Link> · {date(it.date_debut, langue)}</span> : !close && gere ? <>
          <select value={inter} onChange={(e) => setInter(e.target.value)} aria-label={t('sav.intervention')}>
            <option value="">—</option>{(interventions.data ?? []).map((y) => <option key={y.id} value={y.id}>{y.reference} · {date(y.date_debut, langue)}</option>)}</select>
          <Bouton petit disabled={a.enCours || !inter} onClick={() => void appel('lier_intervention_reclamation', { p_rec: r.id, p_intervention: inter })}>{t('sav.lier')}</Bouton>
          {(interventions.data ?? []).length === 0 && <span className="mute">{t('sav.aucune_intervention')}</span>}
        </> : <span className="mute">{t('sav.non_planifiee')}</span>}
      </section>
      <section>
        <div className="surtitre">{t('sav.cloture')}</div>
        {close ? <span>{t('sav.cloturee_par', { nom: r.cloture_signataire ?? '', d: date(r.cloturee_le, langue) })}</span> : gere ? <>
          <input value={cl.signataire} maxLength={120} placeholder={t('sav.signataire')} aria-label={t('sav.signataire')} onChange={(e) => setCl({ ...cl, signataire: e.target.value })} />
          <Depot dossierId={r.dossier_id} valeur={cl.document || null} onChange={(c) => setCl({ ...cl, document: c })} />
          <Bouton variante="primaire" disabled={a.enCours || cl.signataire.trim().length < 2 || !cl.document || r.recours === 'ouvert'}
            onClick={() => void appel('cloturer_reclamation', { p_rec: r.id, p_signataire: cl.signataire.trim(), p_document: cl.document })}>{t('sav.cloturer')}</Bouton>
          {r.recours === 'ouvert' && <span className="mute">{t('sav.aide_recours_ouvert')}</span>}
        </> : <span className="mute">—</span>}
      </section>
    </aside>
  );
}

function NouvelleReclamation({ onClose, onFait }: { onClose: () => void; onFait: (id: string) => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const ds = useAsync(async () => ok(await supabase.from('dossiers').select('id, reference, intitule').order('reference', { ascending: false }).limit(500)) as { id: string; reference: string; intitule: string }[], []);
  const [f, setF] = useState({ dossier_id: '', equipement: '', numero_serie: '', defaut: '', urgent: false, fin_garantie: '' });
  const enregistrer = async () => {
    const v = z.object({ dossier_id: UUID, equipement: z.string().trim().min(2).max(200), numero_serie: z.string().trim().max(80).nullable(), defaut: z.string().trim().min(3).max(2000),
      urgent: z.boolean(), fin_garantie: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }).strict()
      .safeParse({ ...f, numero_serie: f.numero_serie.trim() || null, fin_garantie: f.fin_garantie || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    let id = '';
    if (await a.executer(async () => { id = ok(await supabase.rpc('declarer_reclamation', { p: v.data })) as string; }) && id) onFait(id);
  };
  return (
    <Tiroir titre={t('sav.nouvelle')} onClose={onClose}>
      <Champ label={t('champs.dossier')}><select value={f.dossier_id} onChange={(e) => setF({ ...f, dossier_id: e.target.value })}>
        <option value="">—</option>{(ds.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.reference} — {d.intitule}</option>)}</select></Champ>
      <Champ label={t('sav.equipement')}><input value={f.equipement} maxLength={200} onChange={(e) => setF({ ...f, equipement: e.target.value })} /></Champ>
      <Champ label={t('sav.numero_serie')}><input value={f.numero_serie} maxLength={80} onChange={(e) => setF({ ...f, numero_serie: e.target.value })} /></Champ>
      <Champ label={t('sav.defaut')}><textarea rows={3} maxLength={2000} value={f.defaut} onChange={(e) => setF({ ...f, defaut: e.target.value })} /></Champ>
      <Champ label={t('sav.fin_garantie')}><input type="date" value={f.fin_garantie} onChange={(e) => setF({ ...f, fin_garantie: e.target.value })} /></Champ>
      <label className="bascule"><input type="checkbox" checked={f.urgent} onChange={(e) => setF({ ...f, urgent: e.target.checked })} /> {t('sav.urgent')}</label>
      <Bandeau type="err">{ds.erreur ?? a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}
