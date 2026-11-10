// Logistique · conformité à l'import (maquette IMP) : référentiel daté des documents exigés par pays et
// catégorie, liste de contrôle calculée par la base pour chaque expédition, dépôt des documents reçus.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date } from '../lib/format';
import { urlSignee } from '../lib/fichiers';
import { Bandeau, Bouton, Champ, Chargement, Entete, Statut, Tiroir, Vide } from '../components/ui';
import { Depot } from '../components/Depot';

interface Exigence { id: string; pays: string; categorie: string | null; document: string; emetteur: string | null; delai_jours: number; date_effet: string; actif: boolean }
interface Categorie { code: string; libelle: string }
interface ExpeditionC { id: string; reference: string; dossier_id: string; pays_destination: string; port_arrivee: string | null; statut: string; categorie_import: string | null }
interface Ligne { exigence_id: string; pays: string; categorie: string | null; document: string; emetteur: string | null; delai_jours: number; recu: boolean; chemin: string | null; recu_le: string | null }

export function ConformiteImport() {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const admin = profil?.role === 'admin';
  const ex = useAsync(async () => ok(await supabase.from('exigences_import').select('*').eq('actif', true).order('pays').order('document')) as Exigence[], []);
  const cats = useAsync(async () => ok(await supabase.from('categories_import').select('code, libelle').order('libelle')) as Categorie[], []);
  const exps = useAsync(async () => ok(await supabase.from('expeditions').select('id, reference, dossier_id, pays_destination, port_arrivee, statut, categorie_import')
    .neq('statut', 'livree').order('cree_le', { ascending: false }).limit(100)) as ExpeditionC[], []);
  const a = useAction();
  const [sel, setSel] = useState<string | null>(null);
  const [regle, setRegle] = useState(false);
  const [categorie, setCategorie] = useState(false);
  const x = (exps.data ?? []).find((e) => e.id === sel) ?? exps.data?.[0] ?? null;
  const liste = useAsync(async () => (x ? ok(await supabase.rpc('conformite_expedition', { p_expedition: x.id })) as Ligne[] : []), [x?.id, x?.categorie_import]);
  const libCat = (c: string | null) => (c === null ? t('imp.toutes') : (cats.data ?? []).find((y) => y.code === c)?.libelle ?? c);
  const libPays = (p: string) => (p === '*' ? t('imp.tous_pays') : t(`pays.${p}`, { defaultValue: p }));
  const manquants = (liste.data ?? []).filter((l) => !l.recu).length;
  const desactiver = async (id: string) => { if (await a.executer(async () => ok(await supabase.rpc('desactiver_exigence_import', { p_exigence: id })))) void ex.recharger(); };
  const definirCat = async (c: string) => {
    if (!x) return;
    if (await a.executer(async () => ok(await supabase.rpc('definir_categorie_import', { p_expedition: x.id, p_categorie: c || null })))) void exps.recharger();
  };
  const deposer = async (l: Ligne, chemin: string) => {
    if (!x) return;
    if (await a.executer(async () => ok(await supabase.rpc('deposer_document_conformite', { p_expedition: x.id, p_exigence: l.exigence_id, p_chemin: chemin })))) void liste.recharger();
  };
  const ouvrir = async (c: string) => { const u = await urlSignee(c); if (u) window.open(u, '_blank', 'noopener,noreferrer'); };
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.logistique')} · ${t('imp.surtitre')} · IMP`} titre={t('imp.titre')}
        actions={admin && <><Bouton onClick={() => setCategorie(true)}>{t('imp.nouvelle_categorie')}</Bouton><Bouton variante="primaire" onClick={() => setRegle(true)}>{t('imp.nouvelle_regle')}</Bouton></>} />
      <Bandeau type="err">{ex.erreur ?? cats.erreur ?? exps.erreur ?? liste.erreur ?? a.erreur}</Bandeau>
      <div className="ref-grille liv-grille imp-grille">
        <div className="cadre">
          {ex.chargement && !ex.data ? <Chargement /> : (ex.data ?? []).length === 0 ? <Vide>{t('imp.aucune_regle')}</Vide> : (
            <table className="t"><thead><tr><th>{t('imp.pays')}</th><th>{t('imp.categorie')}</th><th>{t('imp.document')}</th><th>{t('imp.emetteur')}</th><th className="num">{t('imp.delai')}</th>{admin && <th />}</tr></thead>
              <tbody>{(ex.data ?? []).map((r) => (
                <tr key={r.id}><td>{libPays(r.pays)}</td><td>{libCat(r.categorie)}</td><td>{r.document}{r.date_effet > new Date().toISOString().slice(0, 10) && <div className="txt-att">{t('imp.a_partir', { d: date(r.date_effet, langue) })}</div>}</td>
                  <td className="sec">{r.emetteur ?? '—'}</td><td className="num">{t('imp.jours', { n: r.delai_jours })}</td>
                  {admin && <td className="num"><Bouton petit disabled={a.enCours} onClick={() => void desactiver(r.id)}>{t('imp.desactiver')}</Bouton></td>}</tr>))}</tbody></table>
          )}
          <p className="mute" style={{ marginTop: 12 }}>{t('imp.aide')}</p>
        </div>
        <aside className="exp-aside">
          <section>
            <div className="surtitre">{t('imp.liste_controle')}</div>
            {(exps.data ?? []).length === 0 ? <span className="mute">{t('imp.aucune_expedition')}</span> : (
              <div className="imp-exps">{(exps.data ?? []).map((e) => (
                <button key={e.id} type="button" className={'chip' + (x?.id === e.id ? ' actif' : '')} onClick={() => setSel(e.id)}>{e.reference} · {e.port_arrivee ?? e.pays_destination}</button>))}</div>
            )}
          </section>
          {x && <section>
            <b className="liv-client">{x.reference} · {libPays(x.pays_destination)}</b>
            <Champ label={t('imp.categorie')}><select value={x.categorie_import ?? ''} onChange={(e) => void definirCat(e.target.value)}>
              <option value="">{t('imp.non_renseignee')}</option>{(cats.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.libelle}</option>)}</select></Champ>
            {liste.chargement && !liste.data ? <Chargement /> : (liste.data ?? []).length === 0 ? <span className="mute">{t('imp.aucune_exigence')}</span>
              : (liste.data ?? []).map((l) => (
                <div key={l.exigence_id} className="imp-ligne">
                  <span><b>{l.document}</b><span className="mute">{[l.emetteur, t('imp.jours', { n: l.delai_jours })].filter(Boolean).join(' · ')}</span></span>
                  {l.recu ? <button type="button" className="lien" onClick={() => l.chemin && void ouvrir(l.chemin)}><Statut statut="ok" libelle={t('imp.recu')} /></button>
                    : <Statut statut="err" libelle={t('imp.manquant')} />}
                  {!l.recu && <div className="imp-depot"><Depot dossierId={x.dossier_id} valeur={null} onChange={(c) => void deposer(l, c)} /></div>}
                </div>))}
            {(liste.data ?? []).length > 0 && (manquants > 0
              ? <Bandeau type="err">{t('imp.bloque', { n: manquants })}</Bandeau>
              : <Bandeau type="ok">{t('imp.complet')}</Bandeau>)}
            <Link to={`/expeditions/${x.id}`}>{t('livraison.voir_expedition')}</Link>
          </section>}
        </aside>
      </div>
      {regle && <NouvelleRegle categories={cats.data ?? []} onClose={() => setRegle(false)} onFait={() => { setRegle(false); void ex.recharger(); void liste.recharger(); }} />}
      {categorie && <NouvelleCategorie onClose={() => setCategorie(false)} onFait={() => { setCategorie(false); void cats.recharger(); }} />}
    </div>
  );
}

function NouvelleRegle({ categories, onClose, onFait }: { categories: Categorie[]; onClose: () => void; onFait: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [f, setF] = useState({ pays: '*', categorie: '', document: '', emetteur: '', delai_jours: '0', date_effet: new Date().toISOString().slice(0, 10) });
  const enregistrer = async () => {
    const v = z.object({ pays: z.string().regex(/^([A-Z]{2}|\*)$/), categorie: z.string().regex(/^[a-z_]{2,40}$/).nullable(), document: z.string().trim().min(3).max(200),
      emetteur: z.string().trim().max(200).nullable(), delai_jours: z.number().int().min(0).max(120), date_effet: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict()
      .safeParse({ ...f, pays: f.pays.trim().toUpperCase(), categorie: f.categorie || null, emetteur: f.emetteur.trim() || null, delai_jours: Number(f.delai_jours) });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('creer_exigence_import', { p: v.data })))) onFait();
  };
  return (
    <Tiroir titre={t('imp.nouvelle_regle')} onClose={onClose}>
      <p className="sec">{t('imp.aide_regle')}</p>
      <div className="grille2">
        <Champ label={t('imp.pays_code')}><input value={f.pays} maxLength={2} onChange={(e) => setF({ ...f, pays: e.target.value.toUpperCase() })} /></Champ>
        <Champ label={t('imp.categorie')}><select value={f.categorie} onChange={(e) => setF({ ...f, categorie: e.target.value })}>
          <option value="">{t('imp.toutes')}</option>{categories.map((c) => <option key={c.code} value={c.code}>{c.libelle}</option>)}</select></Champ>
      </div>
      <Champ label={t('imp.document')}><input value={f.document} maxLength={200} onChange={(e) => setF({ ...f, document: e.target.value })} /></Champ>
      <Champ label={t('imp.emetteur')}><input value={f.emetteur} maxLength={200} onChange={(e) => setF({ ...f, emetteur: e.target.value })} /></Champ>
      <div className="grille2">
        <Champ label={t('imp.delai_jours')}><input inputMode="numeric" value={f.delai_jours} onChange={(e) => setF({ ...f, delai_jours: e.target.value.replace(/\D/g, '') })} /></Champ>
        <Champ label={t('parametrage.date_effet')}><input type="date" value={f.date_effet} onChange={(e) => setF({ ...f, date_effet: e.target.value })} /></Champ>
      </div>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

function NouvelleCategorie({ onClose, onFait }: { onClose: () => void; onFait: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [f, setF] = useState({ code: '', libelle: '' });
  const enregistrer = async () => {
    const v = z.object({ p_code: z.string().regex(/^[a-z_]{2,40}$/), p_libelle: z.string().trim().min(2).max(120) }).strict().safeParse({ p_code: f.code, p_libelle: f.libelle });
    if (!v.success) { a.setErreur(t('imp.code_invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('creer_categorie_import', v.data)))) onFait();
  };
  return (
    <Tiroir titre={t('imp.nouvelle_categorie')} onClose={onClose}>
      <Champ label={t('imp.libelle')}><input value={f.libelle} maxLength={120} onChange={(e) => setF({ ...f, libelle: e.target.value })} /></Champ>
      <Champ label={t('imp.code')}><input value={f.code} maxLength={40} placeholder="equipements_froid" onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase().replace(/[^a-z_]/g, '') })} /></Champ>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}
