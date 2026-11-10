// Paramétrage du guide d'expression du besoin : versions des questionnaires (activation par
// l'administratrice après validation de la fondatrice) et réseau électrique par pays.
// La structure d'un questionnaire est revalidée par la base (gbs_private.etapes_besoin_valides).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { dateHeure } from '../lib/format';
import { Bandeau, Bouton, Champ, Chargement, Statut, Tiroir, Vide } from '../components/ui';

interface Questionnaire { id: string; categorie: string; libelle: string; version: number; statut: 'brouillon' | 'actif' | 'retire'; etapes: { champs: unknown[] }[]; active_le: string | null }
interface Reseau { pays: string; tensions: number[]; frequence: number; prises: string[]; confirme: boolean; source: string | null }

export function QuestionnairesBesoin() {
  const { t } = useTranslation();
  const { profil, langue, fuseau } = useAuth();
  const admin = profil?.role === 'admin';
  const q = useAsync(async () => ok(await supabase.from('questionnaires_besoin').select('id, categorie, libelle, version, statut, etapes, active_le')
    .order('categorie').order('version', { ascending: false })) as Questionnaire[], []);
  const r = useAsync(async () => ok(await supabase.from('pays_electricite').select('pays, tensions, frequence, prises, confirme, source').order('pays')) as Reseau[], []);
  const a = useAction();
  const [ed, setEd] = useState<{ categorie: string; libelle: string; json: string } | null>(null);
  const [reseau, setReseau] = useState<{ pays: string; tensions: string; frequence: string; prises: string; confirme: boolean; source: string } | null>(null);
  const activer = async (id: string) => { if (await a.executer(async () => ok(await supabase.rpc('activer_questionnaire_besoin', { p_questionnaire: id })))) void q.recharger(); };
  const enregistrer = async () => {
    if (!ed) return;
    let etapes: unknown;
    try { etapes = JSON.parse(ed.json); } catch { a.setErreur(t('besoin_param.json_invalide')); return; }
    const v = z.object({ p_categorie: z.string().regex(/^[a-z0-9_]{2,40}$/), p_libelle: z.string().trim().min(2).max(120), p_etapes: z.array(z.unknown()).min(1).max(12) }).strict()
      .safeParse({ p_categorie: ed.categorie, p_libelle: ed.libelle, p_etapes: etapes });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('enregistrer_questionnaire_besoin', v.data)))) { setEd(null); void q.recharger(); }
  };
  const enregistrerReseau = async () => {
    if (!reseau) return;
    const v = z.object({ p_pays: z.string().regex(/^[A-Z]{2}$/), p: z.object({ tensions: z.array(z.number().int().min(1).max(999)).min(1).max(6),
      frequence: z.union([z.literal(50), z.literal(60)]), prises: z.array(z.string().regex(/^[A-N]$/)).min(1).max(10), confirme: z.boolean(),
      source: z.string().trim().max(300).nullable() }).strict() }).strict().safeParse({ p_pays: reseau.pays.trim().toUpperCase(), p: {
        tensions: reseau.tensions.split(/[,;\s]+/).filter(Boolean).map(Number), frequence: Number(reseau.frequence),
        prises: reseau.prises.toUpperCase().split(/[,;\s]+/).filter(Boolean), confirme: reseau.confirme, source: reseau.source.trim() || null } });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('enregistrer_pays_electricite', v.data)))) { setReseau(null); void r.recharger(); }
  };
  const nbChamps = (x: Questionnaire) => x.etapes.reduce((s, e) => s + (e.champs?.length ?? 0), 0);
  return (
    <section>
      <p className="sec">{t('besoin_param.aide')}</p>
      <Bandeau type="err">{q.erreur ?? r.erreur ?? a.erreur}</Bandeau>
      {q.chargement && !q.data ? <Chargement /> : (q.data ?? []).length === 0 ? <Vide>{t('besoin_param.aucun')}</Vide> : (
        <table className="t">
          <thead><tr><th>{t('besoin_param.categorie')}</th><th>{t('besoin_param.libelle')}</th><th className="num">{t('besoin_param.version')}</th>
            <th className="num">{t('besoin_param.etapes_champs')}</th><th>{t('besoin_param.statut')}</th><th /></tr></thead>
          <tbody>{(q.data ?? []).map((x) => (
            <tr key={x.id}>
              <td className="ref">{x.categorie}</td><td>{x.libelle}</td><td className="num">v{x.version}</td>
              <td className="num">{x.etapes.length} · {nbChamps(x)}</td>
              <td><Statut statut={x.statut === 'actif' ? 'ok' : x.statut === 'brouillon' ? 'att' : 'neutre'} libelle={t(`besoin_param.statuts.${x.statut}`)} />
                {x.active_le && <div className="mute">{dateHeure(x.active_le, langue, fuseau)}</div>}</td>
              <td className="num nowrap">
                <Bouton petit onClick={() => setEd({ categorie: x.categorie, libelle: x.libelle, json: JSON.stringify(x.etapes, null, 2) })}>{t('besoin_param.nouvelle_version')}</Bouton>
                {admin && x.statut === 'brouillon' && <> <Bouton petit variante="primaire" disabled={a.enCours} onClick={() => void activer(x.id)}>{t('besoin_param.activer')}</Bouton></>}
              </td>
            </tr>))}</tbody>
        </table>)}
      {admin && <div className="besoin-param-actions"><Bouton onClick={() => setEd({ categorie: '', libelle: '', json: '[]' })}>{t('besoin_param.nouvelle_categorie')}</Bouton></div>}

      <h3 className="surtitre" style={{ marginTop: 28 }}>{t('besoin_param.reseaux')}</h3>
      <table className="t">
        <thead><tr><th>{t('besoin_param.pays')}</th><th>{t('besoin_param.tensions')}</th><th>{t('besoin_param.frequence')}</th><th>{t('besoin_param.prises')}</th>
          <th>{t('besoin_param.statut')}</th><th /></tr></thead>
        <tbody>{(r.data ?? []).map((x) => (
          <tr key={x.pays}>
            <td className="ref">{x.pays}</td><td>{x.tensions.join(' / ')} V</td><td>{x.frequence} Hz</td><td>{x.prises.join(', ')}</td>
            <td><Statut statut={x.confirme ? 'ok' : 'att'} libelle={t(x.confirme ? 'besoin_param.confirme' : 'besoin_param.a_confirmer')} />
              {x.source && <div className="mute">{x.source}</div>}</td>
            <td className="num">{admin && <Bouton petit onClick={() => setReseau({ pays: x.pays, tensions: x.tensions.join(', '), frequence: String(x.frequence),
              prises: x.prises.join(', '), confirme: x.confirme, source: x.source ?? '' })}>{t('besoin_param.modifier')}</Bouton>}</td>
          </tr>))}</tbody>
      </table>
      {admin && <div className="besoin-param-actions"><Bouton onClick={() => setReseau({ pays: '', tensions: '', frequence: '50', prises: '', confirme: false, source: '' })}>{t('besoin_param.ajouter_pays')}</Bouton></div>}

      {ed && (
        <Tiroir titre={t('besoin_param.nouvelle_version')} onClose={() => setEd(null)}>
          <p className="sec">{t('besoin_param.aide_version')}</p>
          <Champ label={t('besoin_param.categorie')}><input value={ed.categorie} maxLength={40} onChange={(e) => setEd({ ...ed, categorie: e.target.value })} /></Champ>
          <Champ label={t('besoin_param.libelle')}><input value={ed.libelle} maxLength={120} onChange={(e) => setEd({ ...ed, libelle: e.target.value })} /></Champ>
          <Champ label={t('besoin_param.structure')}><textarea className="ref" rows={18} value={ed.json} maxLength={100000} onChange={(e) => setEd({ ...ed, json: e.target.value })} /></Champ>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <Bouton variante="primaire" disabled={a.enCours || !admin} onClick={() => void enregistrer()}>{t('besoin_param.enregistrer_brouillon')}</Bouton>
        </Tiroir>)}
      {reseau && (
        <Tiroir titre={t('besoin_param.reseaux')} onClose={() => setReseau(null)}>
          <Champ label={t('besoin_param.pays')}><input value={reseau.pays} maxLength={2} onChange={(e) => setReseau({ ...reseau, pays: e.target.value })} /></Champ>
          <Champ label={t('besoin_param.tensions')}><input value={reseau.tensions} maxLength={40} placeholder="230, 400" onChange={(e) => setReseau({ ...reseau, tensions: e.target.value })} /></Champ>
          <Champ label={t('besoin_param.frequence')}>
            <select value={reseau.frequence} onChange={(e) => setReseau({ ...reseau, frequence: e.target.value })}><option value="50">50 Hz</option><option value="60">60 Hz</option></select>
          </Champ>
          <Champ label={t('besoin_param.prises')}><input value={reseau.prises} maxLength={40} placeholder="C, E" onChange={(e) => setReseau({ ...reseau, prises: e.target.value })} /></Champ>
          <Champ label={t('besoin_param.source')}><input value={reseau.source} maxLength={300} onChange={(e) => setReseau({ ...reseau, source: e.target.value })} /></Champ>
          <label className="nowrap"><input type="checkbox" checked={reseau.confirme} onChange={(e) => setReseau({ ...reseau, confirme: e.target.checked })} /> {t('besoin_param.confirme')}</label>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrerReseau()}>{t('besoin_param.enregistrer')}</Bouton>
        </Tiroir>)}
    </section>
  );
}
