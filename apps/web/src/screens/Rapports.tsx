// Section Rapports du module Dossiers (maquette « Productivité » PRD et « Clôture et archivage » ARC).
// Lecture par gbs.productivite_chefs / productivite_phases / dossiers_cloture / conditions_cloture ;
// écritures par gbs.enregistrer_satisfaction, gbs.avancer_phase et gbs.archiver_dossier (droits en base).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { pourcent } from '../lib/format';
import { useNoms } from '../lib/referentiels';
import { Bandeau, Bouton, Champ, Chargement, Entete, Onglets, Statut, Vide } from '../components/ui';

interface Chef { chef_id: string; actifs: number; jours_reels: number; jours_cibles: number; pieces_ok: number; pieces_total: number;
  blocages_a_temps: number; blocages_resolus: number; satisfaction: number | null }
interface PhaseProd { phase: string; ordre: number; cible_moyenne: number; reel_moyen: number; nombre: number }
const initiales = (nom: string | undefined) => (nom ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('');

export function Productivite() {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const annee = new Date().getFullYear();
  const [an, setAn] = useState(annee);
  const profils = useAsync(async () => ok(await supabase.from('profils').select('id, nom, role')) as { id: string; nom: string; role: string | null }[], []);
  const chefs = useAsync(async () => ok(await supabase.rpc('productivite_chefs', { p_annee: an })) as Chef[], [an]);
  const phases = useAsync(async () => ok(await supabase.rpc('productivite_phases', { p_annee: an })) as PhaseProd[], [an]);
  const nom = (id: string) => profils.data?.find((p) => p.id === id);
  const reels = (chefs.data ?? []).reduce((s, c) => s + c.jours_reels, 0);
  const cibles = (chefs.data ?? []).reduce((s, c) => s + c.jours_cibles, 0);
  const pire = [...(phases.data ?? [])].sort((x, y) => (y.reel_moyen - y.cible_moyenne) - (x.reel_moyen - x.cible_moyenne))[0];
  const ecartPire = pire ? Math.round(pire.reel_moyen - pire.cible_moyenne) : 0;
  const titre = cibles ? [t('rapports.prd_titre', { p: pourcent(reels / cibles, langue, 0) }),
    ecartPire > 0 ? t('rapports.prd_pire', { phase: t(`phases.${pire.phase}`), n: ecartPire }) : null].filter(Boolean).join(' ; ')
    : t('rapports.prd_sans');
  const taux = (a: number, b: number) => (b ? a / b : null);

  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.dossiers')} · ${t('rapports.prd_surtitre')} · ${an} · PRD`} titre={chefs.data ? titre : t('ecrans.productivite')}
        actions={<select className="pf-statut" value={an} onChange={(e) => setAn(Number(e.target.value))} aria-label={t('rapports.annee')}>
          {[annee, annee - 1, annee - 2].map((x) => <option key={x} value={x}>{x}</option>)}
        </select>} />
      <Bandeau type="err">{chefs.erreur ?? phases.erreur}</Bandeau>
      <div className="fiche-grille prd" style={{ flex: 1, minHeight: 0 }}>
        <div className="cadre">
          <div className="surtitre">{t('rapports.par_chef')}</div>
          {chefs.chargement && !chefs.data ? <Chargement /> : (chefs.data ?? []).length === 0 ? <Vide>{t('rapports.aucun_chef')}</Vide> : (
            <table className="t">
              <thead><tr><th>{t('rapports.chef')}</th><th className="num">{t('rapports.actifs')}</th><th className="num">{t('rapports.delai_cible')}</th>
                <th>{t('rapports.pieces_completes')}</th><th className="num">{t('rapports.blocages_temps')}</th><th className="num">{t('rapports.satisf')}</th></tr></thead>
              <tbody>
                {(chefs.data ?? []).map((c) => {
                  const p = nom(c.chef_id); const dc = taux(c.jours_reels, c.jours_cibles); const pc = taux(c.pieces_ok, c.pieces_total);
                  const bt = taux(c.blocages_a_temps, c.blocages_resolus);
                  return (
                    <tr key={c.chef_id}>
                      <td><span className="prd-chef"><span className="pastille-nom">{initiales(p?.nom)}</span>
                        <span><b>{p?.nom ?? '…'}</b><span className="mute">{p?.role ? t(`roles.${p.role}`) : ''}</span></span></span></td>
                      <td className="num">{c.actifs}</td>
                      <td className={'num ' + (dc === null ? '' : dc > 1.1 ? 'txt-err' : dc > 1 ? 'txt-att' : 'txt-ok')}>{dc === null ? '—' : pourcent(dc, langue, 0)}</td>
                      <td>{pc === null ? '—' : <span className="compl"><span className="compl-piste"><span style={{ width: `${pc * 100}%` }} /></span><span className="compl-pc">{pourcent(pc, langue, 0)}</span></span>}</td>
                      <td className={'num ' + (bt !== null && bt < 0.7 ? 'txt-err' : '')}>{bt === null ? '—' : pourcent(bt, langue, 0)}</td>
                      <td className="num">{c.satisfaction === null ? '—' : String(c.satisfaction).replace('.', langue === 'fr' ? ',' : '.')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="mute">{t('rapports.note_chefs')}</p>
        </div>
        <aside className="fiche-cote">
          <section>
            <div className="surtitre">{t('rapports.par_phase')}</div>
            {(phases.data ?? []).length === 0 ? <span className="mute">{t('rapports.aucune_phase')}</span> : (() => {
              const max = Math.max(1, ...(phases.data ?? []).flatMap((x) => [Number(x.cible_moyenne), Number(x.reel_moyen)]));
              return (phases.data ?? []).map((x) => {
                const ecart = Math.round(Number(x.reel_moyen) - Number(x.cible_moyenne));
                const cls = ecart <= 0 ? 'ok' : Number(x.reel_moyen) > Number(x.cible_moyenne) * 1.2 ? 'err' : 'att';
                return (
                  <div key={x.phase} className="prd-phase">
                    <div><b>{t(`phases.${x.phase}`)}</b><span className="mute">{t('rapports.cible_reel', { c: Math.round(Number(x.cible_moyenne)), r: Math.round(Number(x.reel_moyen)) })}</span></div>
                    <div className="prd-barres">
                      <span className="cible" style={{ width: `${(Number(x.cible_moyenne) / max) * 100}%` }} />
                      <span className={'reel ' + cls} style={{ width: `${(Number(x.reel_moyen) / max) * 100}%` }} />
                    </div>
                    <span className={'num txt-' + cls}>{ecart > 0 ? '+' : ''}{ecart} j</span>
                  </div>
                );
              });
            })()}
            <p className="mute">{t('rapports.note_phases')}</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

interface LigneCloture {
  dossier_id: string; reference: string; intitule: string; client: string; statut: string; phase_courante: string;
  livre_le: string | null; clos_le: string | null; archive_le: string | null; conserve_jusqu_au: string | null;
  conditions_ok: number; conditions_total: number; bloquantes_manquantes: number; satisfaction: number | null;
}
interface Condition { code: string; ok: boolean; bloquante: boolean; nombre: number }
const ddmmyyyy = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '—');

export function ClotureArchivage() {
  const { t } = useTranslation();
  const { profil } = useAuth();
  const role = profil?.role ?? '';
  const dossiersNoms = useNoms('dossiers');
  const a = useAction();
  const [onglet, setOnglet] = useState<'a_cloturer' | 'clos'>('a_cloturer');
  const [sel, setSel] = useState<string | null>(null);
  const [note, setNote] = useState<number | null>(null);
  const [commentaire, setCommentaire] = useState('');
  const l = useAsync(async () => ok(await supabase.rpc('dossiers_cloture')) as LigneCloture[], []);
  const aCloturer = (l.data ?? []).filter((x) => x.statut === 'ouvert');
  const clos = (l.data ?? []).filter((x) => x.statut === 'clos');
  const liste = onglet === 'a_cloturer' ? aCloturer : clos;
  const choisi = liste.find((x) => x.dossier_id === sel) ?? liste[0] ?? null;
  const conds = useAsync(async () => (choisi ? ok(await supabase.rpc('conditions_cloture', { p_dossier: choisi.dossier_id })) as Condition[] : []), [choisi?.dossier_id, l.data]);
  const manquantes = (c: LigneCloture) => c.bloquantes_manquantes;
  const prets = aCloturer.filter((x) => x.phase_courante === 'cloture' && manquantes(x) === 0).length;
  const archives = clos.filter((x) => x.archive_le).length;
  const bloquantesOk = (conds.data ?? []).every((c) => c.ok || !c.bloquante);
  const recharger = () => { void l.recharger(); void conds.recharger(); };
  const satisfaction = async () => {
    const v = z.object({ p_dossier: z.string().uuid(), p_note: z.number().int().min(1).max(5), p_commentaire: z.string().max(2000).nullable() }).strict()
      .safeParse({ p_dossier: choisi?.dossier_id, p_note: note, p_commentaire: commentaire.trim() || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('enregistrer_satisfaction', v.data)))) { setNote(null); setCommentaire(''); recharger(); }
  };
  const cloturer = async () => {
    if (!choisi) return;
    if (await a.executer(async () => ok(await supabase.rpc('avancer_phase', { p_dossier: choisi.dossier_id, p_motif_derogation: null })))) recharger();
  };
  const archiver = async () => {
    if (!choisi || !window.confirm(t('rapports.confirmer_archivage'))) return;
    if (await a.executer(async () => ok(await supabase.rpc('archiver_dossier', { p_dossier: choisi.dossier_id })))) recharger();
  };
  const icone = (c: Condition) => (c.ok ? <span className="cond ok">✓</span> : c.bloquante ? <span className="cond err">▲</span> : <span className="cond att">!</span>);
  const titre = [t('rapports.arc_prets', { n: prets }), t('rapports.arc_archives', { n: archives })].join(' · ');

  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.dossiers')} · ${t('ecrans.cloture')} · ARC`} titre={l.data ? titre : t('ecrans.cloture')} />
      <Onglets actif={onglet} onChange={(o) => { setOnglet(o); setSel(null); }} items={[
        { id: 'a_cloturer', lib: `${t('rapports.o_a_cloturer')} · ${aCloturer.length}` }, { id: 'clos', lib: `${t('rapports.o_clos')} · ${clos.length}` }]} />
      <Bandeau type="err">{l.erreur ?? a.erreur}</Bandeau>
      <div className="liste-detail pf">
        <div className="liste">
          {l.chargement && !l.data ? <Chargement /> : liste.length === 0 ? <Vide>{t('rapports.aucun_dossier')}</Vide> : (
            <div className="cadre">
              <table className="t">
                <tbody>
                  {liste.map((x) => (
                    <tr key={x.dossier_id} className="cliquable" aria-selected={x.dossier_id === choisi?.dossier_id} onClick={() => setSel(x.dossier_id)}>
                      <td className="ref">{x.reference.split('-').pop()}</td>
                      <td><div>{x.client}</div><div className="mute">{x.intitule}</div></td>
                      <td><span className="compl"><span className="compl-piste"><span style={{ width: `${(x.conditions_ok / Math.max(1, x.conditions_total)) * 100}%` }} /></span>
                        <span className="compl-pc">{x.conditions_ok} / {x.conditions_total}</span></span></td>
                      <td>{x.statut === 'clos'
                        ? (x.archive_le ? <span className="chip">{t('rapports.archive_jusqu', { date: ddmmyyyy(x.conserve_jusqu_au) })}</span> : <span className="chip ok">{t('rapports.clos_le', { date: ddmmyyyy(x.clos_le) })}</span>)
                        : manquantes(x) === 0 ? <span className="chip ok">✓ {t('rapports.pret')}</span>
                          : <span className="chip att">⧗ {t('rapports.conditions_manquantes', { n: manquantes(x) })}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <aside className="detail pf-detail">
          {!choisi ? <Vide>{t('rapports.choisir')}</Vide> : (
            <>
              <div className="sec">{choisi.reference}{choisi.livre_le ? ` · ${t('rapports.livre_le', { date: ddmmyyyy(choisi.livre_le) })}` : ''}</div>
              <h2 className="pf-nom">{choisi.client}</h2>
              <div className="conds">
                {(conds.data ?? []).map((c) => (
                  <div key={c.code} className="cond-l">{icone(c)}
                    <span><b>{t(`rapports.conditions.${c.code}`)}</b>
                      <span className="mute">{c.ok ? t(`rapports.ok.${c.code}`) : t(`rapports.manque.${c.code}`, { n: c.nombre })}</span></span>
                  </div>
                ))}
              </div>
              {choisi.satisfaction === null && ['admin', 'hub_afrique', 'agent_pays'].includes(role) && !choisi.archive_le && (
                <section className="satisf">
                  <div className="surtitre">{t('rapports.satisfaction_client')}</div>
                  <div className="notes" role="radiogroup" aria-label={t('rapports.satisfaction_client')}>
                    {[1, 2, 3, 4, 5].map((n) => <button key={n} role="radio" aria-checked={note === n} onClick={() => setNote(n)}>{n} / 5</button>)}
                  </div>
                  <Champ label={t('rapports.commentaire')}><textarea value={commentaire} maxLength={2000} onChange={(e) => setCommentaire(e.target.value)} /></Champ>
                  <Bouton disabled={note === null || a.enCours} onClick={() => void satisfaction()}>{t('rapports.enregistrer_note')}</Bouton>
                </section>
              )}
              {choisi.satisfaction !== null && <div className="sec">{t('rapports.note_saisie', { n: choisi.satisfaction })}</div>}
              <div className="actions">
                {choisi.statut === 'ouvert' && choisi.phase_courante === 'cloture' && ['admin', 'achats_chine', 'hub_afrique', 'agent_pays'].includes(role) &&
                  <Bouton variante="primaire" disabled={!bloquantesOk || a.enCours} onClick={() => void cloturer()}>{t('rapports.cloturer')}</Bouton>}
                {choisi.statut === 'ouvert' && choisi.phase_courante !== 'cloture' &&
                  <Link className="btn" to={`/dossiers/${choisi.dossier_id}`}>{t('rapports.ouvrir_livraison', { ref: dossiersNoms[choisi.dossier_id] ?? choisi.reference })}</Link>}
                {choisi.statut === 'clos' && !choisi.archive_le && role === 'admin' &&
                  <Bouton disabled={a.enCours} onClick={() => void archiver()}>{t('rapports.archiver')}</Bouton>}
              </div>
              <p className="mute">{t('rapports.note_archivage')}</p>
              {choisi.statut === 'ouvert' && <Statut statut={bloquantesOk ? 'ok' : 'att'} libelle={bloquantesOk ? t('rapports.peut_cloturer') : t('rapports.ne_peut_pas')} />}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
