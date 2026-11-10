// Section Planning du module Dossiers (maquette « Gantt du portefeuille » GNT, « Rétroplanning » RPL,
// « Jours ouvrés et fériés » CAL). Lecture par les fonctions gbs.gantt_portefeuille, gbs.planning_ouverture,
// gbs.echeances_en_cours et gbs.calculer_echeance ; la seule écriture (appliquer le planning) passe par sa fonction.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import type { Langue } from '../lib/format';
import { useNoms } from '../lib/referentiels';
import { Bandeau, Bouton, Champ, Chargement, Entete, Kpis, Onglets, Statut, Vide } from '../components/ui';

interface LigneGantt {
  dossier_id: string; reference: string; client: string; chef_id: string | null; date_ouverture: string | null;
  marge_jours: number | null; intenable: boolean; phase: string; ordre: number; statut: string;
  debut: string | null; fin: string | null; en_retard: boolean;
}
interface Planning {
  date_ouverture: string | null; cibles_manquantes?: string[]; debut_au_plus_tard?: string | null; fin_projetee?: string | null;
  marge_jours_ouvres?: number | null; intenable?: boolean;
  phases?: { phase: string; ordre: number; statut: string; cible: number | null; debut_au_plus_tard: string | null; fin_au_plus_tard: string | null;
    debut_projete: string | null; fin_projetee: string | null; en_retard: boolean }[];
}

const LOCALES: Record<Langue, string> = { fr: 'fr-FR', en: 'en-GB', zh: 'zh-CN' };
const ms = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
const ddmm = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '—');
const ddmmyyyy = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '—');
const initiales = (nom: string | undefined) => (nom ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('');
const aujourdhuiIso = (fuseau: string) => new Intl.DateTimeFormat('en-CA', { timeZone: fuseau }).format(new Date());

/** Échelle de temps commune : début au 1er du mois, une colonne par mois. */
function useEchelle(dates: string[], langue: Langue) {
  return useMemo(() => {
    const valides = dates.filter(Boolean).map(ms);
    if (!valides.length) return null;
    const d0 = new Date(Math.min(...valides)); const d1 = new Date(Math.max(...valides));
    const debut = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), 1);
    const fin = Date.UTC(d1.getUTCFullYear(), d1.getUTCMonth() + 1, 1);
    const mois: { lib: string; g: number }[] = [];
    for (let m = new Date(debut); m.getTime() < fin; m.setUTCMonth(m.getUTCMonth() + 1)) {
      const lib = new Intl.DateTimeFormat(LOCALES[langue], { month: 'short', timeZone: 'UTC', ...(m.getUTCMonth() === 0 ? { year: 'numeric' } : {}) }).format(m);
      mois.push({ lib, g: ((m.getTime() - debut) / (fin - debut)) * 100 });
    }
    const pos = (d: string) => Math.max(0, Math.min(100, ((ms(d) - debut) / (fin - debut)) * 100));
    return { mois, pos };
  }, [dates.join('|'), langue]); // eslint-disable-line react-hooks/exhaustive-deps
}

function EnteteMois({ mois }: { mois: { lib: string; g: number }[] }) {
  return <div className="gantt-mois">{mois.map((m) => <span key={m.g} style={{ left: `${m.g}%` }}>{m.lib}</span>)}</div>;
}
function Grille({ mois }: { mois: { lib: string; g: number }[] }) {
  return <>{mois.map((m) => <span key={m.g} className="gantt-trait" style={{ left: `${m.g}%` }} />)}</>;
}
const classeBarre = (l: { statut: string; en_retard: boolean }) =>
  (l.statut === 'validee' || l.statut === 'complete' ? 'faite' : l.en_retard ? 'retard' : l.statut === 'en_cours' || l.statut === 'attente_tiers' || l.statut === 'bloquee' ? 'cours' : 'prevue');

export function GanttPortefeuille() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { langue, fuseau, societeActive } = useAuth();
  const profils = useNoms('profils');
  const [vue, setVue] = useState<'tout' | 'trimestre'>('tout');
  const auj = aujourdhuiIso(fuseau);
  const g = useAsync(async () => ok(await supabase.rpc('gantt_portefeuille')) as LigneGantt[], []);
  const pf = useAsync(async () => ok(await supabase.rpc('portefeuille', { p_statut: 'ouvert' })) as { id: string; societe_id: string; marge_alerte: boolean }[], []);
  const alerte = new Map((pf.data ?? []).map((x) => [x.id, x.marge_alerte]));
  const societe = new Map((pf.data ?? []).map((x) => [x.id, x.societe_id]));
  const lignes = (g.data ?? []).filter((l) => !societeActive || societe.get(l.dossier_id) === societeActive);
  const dossiers = [...new Map(lignes.map((l) => [l.dossier_id, l])).values()];
  const borne = (mois: number) => { const x = new Date(ms(auj)); x.setUTCMonth(x.getUTCMonth() + mois); return x.toISOString().slice(0, 10); };
  const dates = vue === 'trimestre' ? [borne(-1), borne(2)]
    : [...lignes.flatMap((l) => [l.debut, l.fin]), ...dossiers.map((d) => d.date_ouverture), auj].filter((x): x is string => Boolean(x));
  const ech = useEchelle(dates, langue);
  const intenables = dossiers.filter((d) => d.intenable);
  const serres = dossiers.filter((d) => !d.intenable && alerte.get(d.dossier_id));
  const titre = [t('planning.gnt_titre', { n: dossiers.length }),
    ...intenables.map((d) => t('planning.gnt_intenable', { client: d.client })),
    ...serres.map((d) => t('planning.gnt_marge', { client: d.client, n: d.marge_jours ?? 0 }))].join(intenables.length || serres.length ? ' ; ' : '');

  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.dossiers')} · ${t('ecrans.gantt')} · GNT`} titre={g.data ? titre : t('ecrans.gantt')}
        actions={<span className="pf-vues" role="tablist">
          <button role="tab" aria-selected={vue === 'tout'} onClick={() => setVue('tout')}>{t('planning.tout')}</button>
          <button role="tab" aria-selected={vue === 'trimestre'} onClick={() => setVue('trimestre')}>{t('planning.trimestre')}</button>
        </span>} />
      <Bandeau type="err">{g.erreur}</Bandeau>
      <div className="cadre">
        {g.chargement && !g.data ? <Chargement /> : !ech || dossiers.length === 0 ? <Vide>{t('planning.aucun_dossier')}</Vide> : (
          <div className="gantt">
            <div className="gantt-ligne gantt-tete">
              <span className="gantt-gauche surtitre">{t('champs.dossier')}</span>
              <div className="gantt-zone"><EnteteMois mois={ech.mois} /></div>
            </div>
            {dossiers.map((d) => {
              const ph = lignes.filter((l) => l.dossier_id === d.dossier_id && l.debut && l.fin);
              const marge = d.date_ouverture === null ? <span className="mute">● {t('planning.sans_date')}</span>
                : d.intenable ? <span className="txt-err">● {t('planning.intenable', { n: d.marge_jours ?? 0 })}</span>
                  : d.marge_jours === null ? <span className="mute">● {t('planning.cibles_manquantes')}</span>
                    : <span className={alerte.get(d.dossier_id) ? 'txt-att' : 'txt-ok'}>● {t('planning.marge', { n: d.marge_jours })}</span>;
              return (
                <div key={d.dossier_id} className="gantt-ligne cliquable" onClick={() => nav(`/retroplanning?dossier=${d.dossier_id}`)}>
                  <div className="gantt-gauche">
                    <b>{d.client}</b>
                    <span className="sec">{d.reference}{d.chef_id ? ` · ${initiales(profils[d.chef_id])}` : ''} {marge}</span>
                  </div>
                  <div className="gantt-zone">
                    <Grille mois={ech.mois} />
                    {ph.map((l) => {
                      const a = ech.pos(l.debut!); const b = ech.pos(l.fin!);
                      if (b <= 0 || a >= 100) return null;
                      return (
                        <span key={l.phase} className={'gantt-barre ' + classeBarre(l)} style={{ left: `${a}%`, width: `max(${b - a}%, 14px)` }}
                          title={`${t(`phases.${l.phase}`)} · ${ddmm(l.debut)} → ${ddmm(l.fin)}`}>{t(`phases.${l.phase}`)}</span>
                      );
                    })}
                    {d.date_ouverture && <span className="gantt-ouverture" style={{ left: `${ech.pos(d.date_ouverture)}%` }} title={ddmmyyyy(d.date_ouverture)} />}
                    <span className="gantt-auj" style={{ left: `${ech.pos(auj)}%` }} />
                  </div>
                </div>
              );
            })}
            <Legende t={t} />
          </div>
        )}
      </div>
    </div>
  );
}

function Legende({ t, extra }: { t: (k: string) => string; extra?: string }) {
  return (
    <div className="gantt-legende">
      <span><i className="gantt-barre faite" /> {t('planning.l_terminee')}</span>
      <span><i className="gantt-barre cours" /> {t('planning.l_en_cours')}</span>
      <span><i className="gantt-barre retard" /> {t('planning.l_retard')}</span>
      <span><i className="gantt-barre prevue" /> {t('planning.l_planifiee')}</span>
      <span><i className="l-auj" /> {t('planning.l_aujourdhui')}</span>
      <span><i className="l-ouv" /> {extra ?? t('planning.l_ouverture')}</span>
    </div>
  );
}

export function Retroplanning() {
  const { t } = useTranslation();
  const { langue, fuseau, profil } = useAuth();
  const [params, setParams] = useSearchParams();
  const a = useAction();
  const auj = aujourdhuiIso(fuseau);
  const g = useAsync(async () => ok(await supabase.rpc('gantt_portefeuille')) as LigneGantt[], []);
  const dates = [...new Map((g.data ?? []).filter((l) => l.date_ouverture).map((l) => [l.dossier_id, l])).values()]
    .sort((x, y) => (x.date_ouverture ?? '').localeCompare(y.date_ouverture ?? ''));
  const choisi = params.get('dossier') ?? dates[0]?.dossier_id ?? null;
  const d = dates.find((x) => x.dossier_id === choisi) ?? null;
  const p = useAsync(async () => (choisi ? ok(await supabase.rpc('planning_ouverture', { p_dossier: choisi })) as Planning : null), [choisi]);
  const pl = p.data;
  const phases = pl?.phases ?? [];
  const ech = useEchelle([...phases.flatMap((x) => [x.debut_au_plus_tard, x.fin_au_plus_tard, x.debut_projete, x.fin_projetee]), pl?.date_ouverture ?? null, auj]
    .filter((x): x is string => Boolean(x)), langue);
  const peutAppliquer = ['admin', 'achats_chine', 'hub_afrique'].includes(profil?.role ?? '');
  const appliquer = async () => {
    if (!choisi) return;
    if (await a.executer(async () => ok(await supabase.rpc('appliquer_planning_ouverture', { p_dossier: z.string().uuid().parse(choisi) })))) void p.recharger();
  };
  const marge = pl?.marge_jours_ouvres ?? null;
  const titre = !d || !pl?.date_ouverture ? t('ecrans.retroplanning')
    : marge === null ? t('planning.rpl_titre_sans', { client: d.client, date: ddmmyyyy(pl.date_ouverture) })
      : pl.intenable ? t('planning.rpl_titre_intenable', { client: d.client, date: ddmmyyyy(pl.date_ouverture), n: -marge })
        : t('planning.rpl_titre', { client: d.client, date: ddmmyyyy(pl.date_ouverture), n: marge });

  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.dossiers')} · ${t('ecrans.retroplanning')}${d ? ` · ${d.reference}` : ''} · RPL`} titre={titre}
        actions={<>
          <select className="pf-statut" value={choisi ?? ''} onChange={(e) => setParams({ dossier: e.target.value })} aria-label={t('champs.dossier')}>
            {dates.map((x) => <option key={x.dossier_id} value={x.dossier_id}>{x.reference} · {x.client}</option>)}
          </select>
          {d && <Link className="btn" to={`/dossiers/${d.dossier_id}`}>{t('dossiers.ouvrir')}</Link>}
          {peutAppliquer && pl?.date_ouverture && !(pl.cibles_manquantes ?? []).length &&
            <Bouton variante="primaire" disabled={a.enCours} onClick={() => void appliquer()}>{t('ouverture.appliquer')}</Bouton>}
        </>} />
      <Bandeau type="err">{g.erreur ?? p.erreur ?? a.erreur}</Bandeau>
      {g.chargement && !g.data ? <Chargement /> : dates.length === 0 ? <Vide>{t('planning.aucune_date')}</Vide> : !pl ? <Chargement /> : (
        <>
          {(pl.cibles_manquantes ?? []).length > 0 &&
            <Bandeau>{t('ouverture.cibles_manquantes', { liste: (pl.cibles_manquantes ?? []).map((x) => t(`phases.${x}`)).join(', ') })}</Bandeau>}
          <Kpis items={[
            { lib: t('planning.k_ouverture'), val: ddmmyyyy(pl.date_ouverture), sous: t('planning.k_ouverture_sous') },
            { lib: t('portefeuille.marge_restante'), val: marge === null ? '—' : `${marge} j`, sous: t('planning.jours_ouvres') },
            { lib: t('planning.k_debut'), val: ddmmyyyy(pl.debut_au_plus_tard), sous: t('planning.k_debut_sous') },
            { lib: t('planning.k_fin'), val: ddmmyyyy(pl.fin_projetee), sous: t('planning.k_fin_sous') },
          ]} />
          <div className="fiche-grille">
            <div className="cadre">
              {!ech ? <Vide>{t('planning.aucune_date')}</Vide> : (
                <div className="gantt rpl">
                  <div className="gantt-ligne gantt-tete">
                    <span className="gantt-gauche surtitre">{t('champs.phase')}</span>
                    <span className="rpl-cible surtitre">{t('planning.cible')}</span>
                    <div className="gantt-zone"><EnteteMois mois={ech.mois} /></div>
                  </div>
                  {phases.map((x) => {
                    const deb = x.debut_projete ?? x.debut_au_plus_tard; const fin = x.fin_projetee ?? x.fin_au_plus_tard;
                    return (
                      <div key={x.phase} className="gantt-ligne">
                        <div className="gantt-gauche"><b>{t(`phases.${x.phase}`)}</b><span className="sec">{t(`statuts_phase.${x.statut}`)}</span></div>
                        <span className="rpl-cible sec">{x.cible === null ? '—' : `${x.cible} j`}</span>
                        <div className="gantt-zone">
                          <Grille mois={ech.mois} />
                          {x.debut_au_plus_tard && x.fin_au_plus_tard &&
                            <span className="rpl-plan" style={{ left: `${ech.pos(x.debut_au_plus_tard)}%`, width: `${Math.max(0.5, ech.pos(x.fin_au_plus_tard) - ech.pos(x.debut_au_plus_tard))}%` }} />}
                          {deb && fin && <span className={'gantt-barre ' + classeBarre(x)} style={{ left: `${ech.pos(deb)}%`, width: `max(${ech.pos(fin) - ech.pos(deb)}%, 14px)` }} />}
                          {deb && fin && <span className="rpl-dates" style={{ left: `calc(${ech.pos(fin)}% + 6px)` }}>{ddmm(deb)} → {ddmm(fin)}</span>}
                          {pl.date_ouverture && <span className="gantt-ouverture" style={{ left: `${ech.pos(pl.date_ouverture)}%` }} />}
                          <span className="gantt-auj" style={{ left: `${ech.pos(auj)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  <Legende t={t} extra={`${t('planning.l_ouverture')} ${ddmmyyyy(pl.date_ouverture)}`} />
                  <p className="mute">{t('planning.plan_initial')}</p>
                </div>
              )}
            </div>
            <aside className="fiche-cote">
              <section>
                <div className="surtitre">{t('planning.marge_avant')}</div>
                <div className={'rpl-grand ' + (marge === null ? '' : pl.intenable ? 'txt-err' : 'txt-ok')}>{marge === null ? '—' : marge}</div>
                <span className="sec">{t('planning.jours_ouvres')}</span>
              </section>
              <section>
                <div className="surtitre">{t('planning.autres')}</div>
                {dates.filter((x) => x.dossier_id !== choisi).map((x) => (
                  <button key={x.dossier_id} className="rpl-autre" onClick={() => setParams({ dossier: x.dossier_id })}>
                    <span><b>{x.reference} · {x.client}</b><span className="mute">{t('planning.ouverture_le', { date: ddmmyyyy(x.date_ouverture) })}</span></span>
                    {x.marge_jours === null ? <span className="mute">—</span> : x.intenable
                      ? <Statut statut="err" libelle={`${x.marge_jours} j`} /> : <Statut statut="ok" libelle={`${x.marge_jours} j`} />}
                  </button>
                ))}
                <p className="mute">{t('ouverture.aide')}</p>
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

interface Echeance {
  dossier_id: string; reference: string; client: string; phase: string; pays: string; debut: string; cible: number;
  jours_arretes: number; echeance: string; reste_jours: number; feries: number; voyant: string | null;
}
const PAYS = ['CI', 'GA', 'CM', 'CN'] as const;

export function JoursOuvres() {
  const { t } = useTranslation();
  const { langue, fuseau } = useAuth();
  const nav = useNavigate();
  const auj = aujourdhuiIso(fuseau);
  const l = useAsync(async () => ok(await supabase.rpc('echeances_en_cours')) as Echeance[], []);
  const [pays, setPays] = useState<(typeof PAYS)[number]>('CI');
  const [depart, setDepart] = useState(auj);
  const [nb, setNb] = useState('20');
  const [resultat, setResultat] = useState<string | null>(null);
  const a = useAction();
  const feries = useAsync(async () => ok(await supabase.from('calendrier').select('jour, libelle').eq('pays', pays).eq('nature', 'ferie')
    .gte('jour', auj).order('jour').limit(8)) as { jour: string; libelle: string }[], [pays, auj]);
  const items = [...(l.data ?? [])].sort((x, y) => x.reste_jours - y.reste_jours);
  const reportees = items.filter((x) => x.feries > 0).length;
  const suspendus = items.filter((x) => x.jours_arretes > 0).length;
  const calculer = async () => {
    const v = z.object({ p_pays: z.enum(PAYS), p_debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), p_jours: z.number().int().min(0).max(365) }).strict()
      .safeParse({ p_pays: pays, p_debut: depart, p_jours: Number(nb) });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    await a.executer(async () => setResultat(ok(await supabase.rpc('calculer_echeance', v.data)) as string));
  };
  const jourLong = (d: string) => new Intl.DateTimeFormat(LOCALES[langue], { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
  const titre = [t('planning.cal_reportees', { n: reportees }), t('planning.cal_suspendus', { n: suspendus })].join(' · ');

  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.dossiers')} · ${t('planning.cal_surtitre')} · CAL`} titre={l.data ? titre : t('ecrans.calendrier')} />
      <Bandeau type="err">{l.erreur}</Bandeau>
      <div className="fiche-grille" style={{ flex: 1, minHeight: 0 }}>
        <div className="cadre">
          {l.chargement && !l.data ? <Chargement /> : items.length === 0 ? <Vide>{t('planning.aucune_echeance')}</Vide> : (
            <table className="t">
              <thead><tr><th>{t('champs.dossier')}</th><th>{t('champs.phase')}</th><th>{t('champs.pays')}</th><th>{t('planning.debut')}</th>
                <th className="num">{t('planning.cible')}</th><th className="num">{t('planning.horloge')}</th><th>{t('champs.echeance')}</th><th>{t('planning.reste')}</th></tr></thead>
              <tbody>
                {items.map((x) => (
                  <tr key={x.dossier_id} className="cliquable" onClick={() => nav(`/dossiers/${x.dossier_id}`)}>
                    <td className="ref">{x.reference.split('-').pop()}</td>
                    <td><div>{t(`phases.${x.phase}`)}</div><div className="mute">{x.client}</div></td>
                    <td className="sec">{x.pays}</td>
                    <td className="ref">{ddmm(x.debut)}</td>
                    <td className="num">{x.cible} j</td>
                    <td className="num">{x.jours_arretes > 0 ? `+${x.jours_arretes} j` : '—'}</td>
                    <td><div className="ref">{ddmmyyyy(x.echeance)}</div>{x.feries > 0 && <div className="txt-att" style={{ fontSize: 12 }}>{t('planning.feries', { n: x.feries })}</div>}</td>
                    <td>{x.reste_jours < 0 ? <span className="chip err">▲ {t('planning.retard_j', { n: -x.reste_jours })}</span>
                      : x.reste_jours <= 1 ? <span className="chip att">⧗ {t('planning.reste_j', { n: x.reste_jours })}</span>
                        : <span className="chip ok">✓ {t('planning.reste_j', { n: x.reste_jours })}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <aside className="fiche-cote">
          <section>
            <h2 className="section-titre">{t('planning.calculer')}</h2>
            <Onglets actif={pays} onChange={(p) => { setPays(p); setResultat(null); }} items={PAYS.map((p) => ({ id: p, lib: t(`planning.pays.${p}`) }))} />
            <div className="grille2">
              <Champ label={t('planning.date_depart')}><input type="date" value={depart} onChange={(e) => { setDepart(e.target.value); setResultat(null); }} /></Champ>
              <Champ label={t('planning.jours_ouvres_maj')}><input type="number" min={0} max={365} value={nb} onChange={(e) => { setNb(e.target.value); setResultat(null); }} /></Champ>
            </div>
            <Bouton disabled={a.enCours} onClick={() => void calculer()}>{t('planning.calculer_btn')}</Bouton>
            <Bandeau type="err">{a.erreur}</Bandeau>
            {resultat && (
              <div className="rpl-resultat">
                <span className="sec">{t('planning.echeance_calculee')}</span>
                <b>{jourLong(resultat)} {ddmmyyyy(resultat)}</b>
                <span className="mute">{t('planning.regle_calcul')}</span>
              </div>
            )}
          </section>
          <section>
            <div className="surtitre">{t('planning.feries_titre', { pays: t(`planning.pays.${pays}`) })}</div>
            {(feries.data ?? []).length === 0 ? <span className="mute">{t('planning.aucun_ferie')}</span> : (feries.data ?? []).map((f) => (
              <div key={f.jour} className="ferie"><span className="ref">{ddmmyyyy(f.jour)}</span><span>{f.libelle}</span><span className="mute">{jourLong(f.jour)}</span></div>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
