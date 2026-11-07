// Lot 1, M5 : données de coût global des offres, rapport anonyme des 3 offres analysées
// et choix signé du client. Calculs, anonymat et droits sont tenus en base.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, dateHeure, montant } from '../lib/format';
import { deposer, FichierRefuse } from '../lib/fichiers';
import { Bandeau, Bouton, Champ, Chargement, Statut, Tiroir, Vide } from '../components/ui';

const UUID = z.string().uuid();
const CHAMPS_NUM = ['puissance_kw', 'heures_an', 'duree_vie_ans', 'entretien_heures_an', 'pieces_cout_an', 'pieces_disponibles_ans', 'delai_pieces_jours'] as const;

interface OffreRapport {
  lettre: string; incoterm: string; devise: string; montant: number; fob_xof: number; delai_jours: number | null; garantie_mois: number | null;
  conditions_paiement: string | null; note_totale: number; notes: Record<string, number>; points_forts: string[]; risques: string[];
  cout_global: { complet: boolean; manquants: string[]; horizon_ans: number; prix_xof: number; energie_xof?: number; entretien_xof?: number; pieces_xof?: number; total_xof: number | null };
}
interface Contenu {
  consultation: { reference: string; objet: string; quantite: number | null; incoterm: string; date_limite: string };
  critere_prix: 'fob' | 'cout_global'; grille: Record<string, number>; offres_recues: number; moins_de_trois_offres: boolean;
  offres: OffreRapport[]; recommandation: string;
  explication_prix: { lettre_moins_chere: string; surcout_achat_xof: number; ecart_cout_global_xof: number | null; ecart_note: number } | null;
  etabli_le: string;
}
interface Rapport { id: string; consultation_id: string; dossier_id: string; version: number; contenu: Contenu; choix_lettre: string | null; choix_signe_le: string | null; cree_le: string }

/** Données de coût global déclarées par le fournisseur, et notes de paiement et de capacité. */
export function DonneesCoutGlobal({ offreId, onClose, onSaved }: { offreId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const o = useAsync(async () => ok(await supabase.from('offres').select('cout_global, note_paiement, note_capacite').eq('id', offreId).single()) as
    { cout_global: Record<string, number | string> | null; note_paiement: number | null; note_capacite: number | null }, [offreId]);
  const a = useAction();
  const [f, setF] = useState<Record<string, string> | null>(null);
  const v0 = o.data;
  const valeurs = f ?? (v0 ? {
    ...Object.fromEntries([...CHAMPS_NUM, 'sav_afrique'].map((k) => [k, v0.cout_global?.[k] != null ? String(v0.cout_global[k]) : ''])),
    note_paiement: v0.note_paiement != null ? String(v0.note_paiement) : '', note_capacite: v0.note_capacite != null ? String(v0.note_capacite) : '',
  } : null);
  const enregistrer = async () => {
    if (!valeurs) return;
    const cg: Record<string, number | string> = {};
    for (const k of CHAMPS_NUM) if (valeurs[k].trim() !== '') cg[k] = Number(valeurs[k]);
    if (valeurs.sav_afrique.trim()) cg.sav_afrique = valeurs.sav_afrique.trim();
    const note = z.coerce.number().min(0).max(5).nullable();
    const v = z.object({
      cout_global: z.object({ puissance_kw: z.number().min(0).max(100000), heures_an: z.number().min(0).max(8784), duree_vie_ans: z.number().positive().max(50),
        entretien_heures_an: z.number().min(0).max(10000), pieces_cout_an: z.number().min(0).max(1e10), pieces_disponibles_ans: z.number().min(0).max(50),
        delai_pieces_jours: z.number().min(0).max(365), sav_afrique: z.string().min(2).max(200) }).partial().strict().nullable(),
      note_paiement: note, note_capacite: note,
    }).strict().safeParse({ cout_global: Object.keys(cg).length ? cg : null,
      note_paiement: valeurs.note_paiement === '' ? null : valeurs.note_paiement, note_capacite: valeurs.note_capacite === '' ? null : valeurs.note_capacite });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('offres').update(v.data).eq('id', offreId)))) onSaved();
  };
  return (
    <Tiroir titre={t('rapport.donnees_cout_global')} onClose={onClose}>
      {!valeurs ? <Chargement /> : (<>
        <p className="mute">{t('rapport.aide_cout_global')}</p>
        <div className="grille2">
          {CHAMPS_NUM.map((k) => (
            <Champ key={k} label={t(`rapport.cg.${k}`)}><input type="number" min={0} step="any" value={valeurs[k]}
              onChange={(e) => setF({ ...valeurs, [k]: e.target.value })} /></Champ>))}
        </div>
        <Champ label={t('rapport.cg.sav_afrique')}><input value={valeurs.sav_afrique} maxLength={200} onChange={(e) => setF({ ...valeurs, sav_afrique: e.target.value })} /></Champ>
        <div className="grille2">
          <Champ label={t('rapport.note_paiement')}><input type="number" min={0} max={5} step="0.5" value={valeurs.note_paiement} onChange={(e) => setF({ ...valeurs, note_paiement: e.target.value })} /></Champ>
          <Champ label={t('rapport.note_capacite')}><input type="number" min={0} max={5} step="0.5" value={valeurs.note_capacite} onChange={(e) => setF({ ...valeurs, note_capacite: e.target.value })} /></Champ>
        </div>
        <Bandeau type="err">{o.erreur ?? a.erreur}</Bandeau>
        <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
      </>)}
    </Tiroir>
  );
}

/** Rapports d'une consultation (écran Mise en concurrence) ou d'un dossier (fiche dossier). */
export function ListeRapports({ consultationId, dossierId, peutGenerer }: { consultationId?: string; dossierId?: string; peutGenerer?: boolean }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const l = useAsync(async () => {
    let q = supabase.from('rapports_offres').select('id, consultation_id, dossier_id, version, contenu, choix_lettre, choix_signe_le, cree_le').order('cree_le', { ascending: false });
    q = consultationId ? q.eq('consultation_id', consultationId) : q.eq('dossier_id', dossierId ?? '');
    return ok(await q) as Rapport[];
  }, [consultationId, dossierId]);
  const a = useAction();
  const generer = async () => {
    if (!consultationId) return;
    if (await a.executer(async () => ok(await supabase.rpc('generer_rapport_offres', { p_consultation: UUID.parse(consultationId) })))) void l.recharger();
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="section-titre">{t('rapport.rapports')}</span>
        {peutGenerer && <Bouton petit variante="primaire" disabled={a.enCours} onClick={() => void generer()}>{t('rapport.generer')}</Bouton>}
      </div>
      <Bandeau type="err">{l.erreur ?? a.erreur}</Bandeau>
      {(l.data ?? []).length === 0 ? <span className="mute">{t('rapport.aucun')}</span> : (
        <table className="t"><tbody>{(l.data ?? []).map((r) => (
          <tr key={r.id}><td className="ref">{r.contenu.consultation.reference} · V{r.version}</td><td className="ref">{date(r.cree_le, langue)}</td>
            <td>{r.choix_lettre ? <Statut statut="ok" libelle={t('rapport.choix', { lettre: r.choix_lettre })} /> : <Statut statut="att" libelle={t('rapport.en_attente_choix')} />}</td>
            <td className="num"><Link to={`/imprimer/rapport-offres/${r.id}`}>{t('commun.voir')}</Link></td></tr>))}</tbody></table>
      )}
    </div>
  );
}

/** Rapport au client, imprimable : fournisseurs anonymes, notes, coût global, recommandation. */
export function ImprimerRapportOffres() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { profil, langue, fuseau } = useAuth();
  const r = useAsync(async () => ok(await supabase.from('rapports_offres').select('id, consultation_id, dossier_id, version, contenu, choix_lettre, choix_signe_le, cree_le')
    .eq('id', id).single()) as Rapport, [id]);
  const [choix, setChoix] = useState(false);
  if (r.chargement && !r.data) return <Chargement />;
  if (!r.data) return <Vide>{r.erreur}</Vide>;
  const x = r.data;
  const c = x.contenu;
  const m = (v: number | null | undefined) => (v == null ? '—' : montant(v, 'XOF', langue));
  const peutChoisir = ['admin', 'hub_afrique'].includes(profil?.role ?? '') && !x.choix_lettre;
  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <div className="no-print actions" style={{ padding: 12 }}>
        <Bouton onClick={() => window.print()}>{t('commun.imprimer')}</Bouton>
        {peutChoisir && <Bouton variante="primaire" onClick={() => setChoix(true)}>{t('rapport.enregistrer_choix')}</Bouton>}
        <Link to={`/dossiers/${x.dossier_id}`}>{t('rapport.retour_dossier')}</Link>
      </div>
      <article className="doc">
        <header>
          <img src="/gbs-logo.png" alt="" width={44} height={44} />
          <h1>{t('rapport.titre')}</h1>
          <div className="mute">{c.consultation.reference} · V{x.version} · {t('rapport.etabli_le', { date: dateHeure(c.etabli_le, langue, fuseau) })}</div>
          <p>{c.consultation.objet}{c.consultation.quantite ? ` — ${t('rapport.quantite', { n: c.consultation.quantite })}` : ''} · {t('rapport.base', { incoterm: c.consultation.incoterm })}</p>
        </header>
        {c.moins_de_trois_offres && <Bandeau>{t('rapport.moins_de_trois', { n: c.offres_recues })}</Bandeau>}
        <p className="mute">{t(c.critere_prix === 'cout_global' ? 'rapport.critere_cout_global' : 'rapport.critere_fob')}</p>
        <div style={{ overflowX: 'auto' }}><table className="t"><thead><tr><th />{c.offres.map((o) => <th key={o.lettre} className="num">{t('rapport.fournisseur', { lettre: o.lettre })}</th>)}</tr></thead>
          <tbody>
            <tr><td>{t('rapport.prix_offre')}</td>{c.offres.map((o) => <td key={o.lettre} className="num">{montant(o.montant, o.devise, langue)} {o.incoterm}</td>)}</tr>
            <tr><td>{t('rapport.prix_fob')}</td>{c.offres.map((o) => <td key={o.lettre} className="num">{m(o.fob_xof)}</td>)}</tr>
            <tr><td>{t('rapport.cout_global', { n: c.offres[0]?.cout_global.horizon_ans ?? '' })}</td>{c.offres.map((o) => <td key={o.lettre} className="num">{o.cout_global.complet ? m(o.cout_global.total_xof) : t('rapport.incomplet')}</td>)}</tr>
            <tr><td>{t('rapport.delai')}</td>{c.offres.map((o) => <td key={o.lettre} className="num">{o.delai_jours ?? '—'}</td>)}</tr>
            <tr><td>{t('rapport.garantie')}</td>{c.offres.map((o) => <td key={o.lettre} className="num">{o.garantie_mois ?? '—'}</td>)}</tr>
            {Object.keys(c.grille).map((k) => (
              <tr key={k}><td className="mute">{t(`rapport.critere.${k}`)} ({c.grille[k]} %)</td>{c.offres.map((o) => <td key={o.lettre} className="num">{o.notes[k]}</td>)}</tr>))}
            <tr><td><strong>{t('rapport.note_totale')}</strong></td>{c.offres.map((o) => <td key={o.lettre} className="num"><strong>{o.note_totale}</strong></td>)}</tr>
          </tbody></table></div>
        {c.offres.map((o) => (
          <section key={o.lettre}>
            <h3>{t('rapport.fournisseur', { lettre: o.lettre })}{o.lettre === c.recommandation ? ` — ${t('rapport.recommande')}` : ''}</h3>
            <div><strong>{t('rapport.points_forts')} :</strong> {o.points_forts.map((p) => t(`rapport.fort.${p}`)).join(' ; ') || '—'}</div>
            <div><strong>{t('rapport.risques')} :</strong> {o.risques.map((p) => t(`rapport.risque.${p}`)).join(' ; ') || '—'}</div>
          </section>
        ))}
        <section>
          <h3>{t('rapport.recommandation')}</h3>
          <p>{t('rapport.texte_recommandation', { lettre: c.recommandation })}</p>
          {c.explication_prix && <p>{t('rapport.explication', { lettre: c.recommandation, moins_chere: c.explication_prix.lettre_moins_chere,
            surcout: m(c.explication_prix.surcout_achat_xof), ecart_note: c.explication_prix.ecart_note })}
            {c.explication_prix.ecart_cout_global_xof != null && c.explication_prix.ecart_cout_global_xof < 0 &&
              ` ${t('rapport.explication_cout_global', { economie: m(-c.explication_prix.ecart_cout_global_xof) })}`}</p>}
          <p className="mute">{t('rapport.anonymat')}</p>
        </section>
        {x.choix_lettre && <Bandeau type="ok">{t('rapport.choix_signe', { lettre: x.choix_lettre, date: date(x.choix_signe_le, langue) })}</Bandeau>}
      </article>
      {choix && <ChoixClient rapport={x} onClose={() => setChoix(false)} onDone={() => { setChoix(false); void r.recharger(); }} />}
    </div>
  );
}

function ChoixClient({ rapport, onClose, onDone }: { rapport: Rapport; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [lettre, setLettre] = useState(rapport.contenu.recommandation);
  const [fichier, setFichier] = useState<File | null>(null);
  const [signe, setSigne] = useState(new Date().toISOString().slice(0, 10));
  const valider = async () => {
    if (!fichier || !z.string().regex(/^[A-Z]$/).safeParse(lettre).success || !/^\d{4}-\d{2}-\d{2}$/.test(signe)) { a.setErreur(t('formulaire.invalide')); return; }
    const okk = await a.executer(async () => {
      let chemin: string;
      try { chemin = (await deposer(rapport.dossier_id, fichier)).chemin; } catch (err) {
        if (err instanceof FichierRefuse) throw new Error(err.message === 'type' ? 'GBS_FICHIER_TYPE' : 'GBS_FICHIER_TAILLE');
        throw err;
      }
      ok(await supabase.rpc('enregistrer_choix_client', { p_rapport: rapport.id, p_lettre: lettre, p_document: chemin, p_signe_le: signe }));
    });
    if (okk) onDone();
  };
  return (
    <Tiroir titre={t('rapport.enregistrer_choix')} onClose={onClose}>
      <Champ label={t('rapport.offre_choisie')}><select value={lettre} onChange={(e) => setLettre(e.target.value)}>
        {rapport.contenu.offres.map((o) => <option key={o.lettre} value={o.lettre}>{t('rapport.fournisseur', { lettre: o.lettre })}</option>)}</select></Champ>
      <Champ label={t('rapport.document_signe')}><input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFichier(e.target.files?.[0] ?? null)} /></Champ>
      <Champ label={t('rapport.signe_le')}><input type="date" value={signe} onChange={(e) => setSigne(e.target.value)} /></Champ>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void valider()}>{t('commun.confirmer')}</Bouton>
    </Tiroir>
  );
}
