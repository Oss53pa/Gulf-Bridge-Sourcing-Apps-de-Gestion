import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ok, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { compact, date, dateHeure, nombre, pourcent, type Langue } from '../lib/format';
import type { Dossier, PointBloquant, TableauDeBord as TDB } from '../lib/types';
import { Bandeau, CadreTableau, Chargement, Kpis, Onglets, Statut, Vide } from '../components/ui';
import { useNoms } from '../lib/referentiels';

interface MoisCa { mois: string; ca_xof: number | null; budget_xof: number | null; prevision_xof: number | null; en_cours: boolean }
interface PilotageCa {
  montants_visibles: boolean;
  mois?: MoisCa[];
  point_mort?: { charges_fixes_xof: number | null; ca_cumule_xof: number; taux: number | null; atteint_le: string | null };
  par_societe?: { societe_id: string; code: string; ca_xof: number }[];
}
type Onglet = 'ca' | 'dossiers' | 'arbitrer' | 'entonnoir' | 'activite';

const LOCALES: Record<Langue, string> = { fr: 'fr-FR', en: 'en-GB', zh: 'zh-CN' };
const moisNom = (aaaamm: string, langue: Langue, format: 'long' | 'short') =>
  new Intl.DateTimeFormat(LOCALES[langue], { month: format, timeZone: 'UTC' }).format(new Date(`${aaaamm}-15T00:00:00Z`));
const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Histogramme du chiffre d'affaires mensuel : barres pleines (réalisé), trait bronze (budget), pointillés (prévision). */
function Histogramme({ mois, langue }: { mois: MoisCa[]; langue: Langue }) {
  const max = Math.max(1, ...mois.flatMap((m) => [m.ca_xof ?? 0, m.budget_xof ?? 0, m.prevision_xof ?? 0]));
  const h = (v: number | null) => `${Math.max(0, Math.min(100, ((v ?? 0) / max) * 100))}%`;
  const m1 = (v: number | null) => (v === null ? '—' : nombre(v / 1e6, langue, 1).replace(/[.,]0$/, ''));
  return (
    <div className="histo" role="img" aria-label={mois.map((m) => `${m.mois} ${m1(m.ca_xof ?? m.prevision_xof)}`).join(', ')}>
      <div className="histo-barres">
        {mois.map((m) => (
          <div key={m.mois} className="histo-col">
            {m.ca_xof !== null && <div className={'histo-barre' + (m.en_cours ? ' en-cours' : '')} style={{ height: h(m.ca_xof) }} />}
            {m.ca_xof === null && m.prevision_xof !== null && <div className="histo-prev" style={{ height: h(m.prevision_xof) }} />}
            {m.budget_xof !== null && <div className="histo-budget" style={{ bottom: h(m.budget_xof) }} />}
          </div>
        ))}
      </div>
      <div className="histo-legendes">
        {mois.map((m) => (
          <div key={m.mois} className="histo-leg">
            <span>{majuscule(moisNom(m.mois, langue, 'short'))}</span>
            <span className="num">{m1(m.ca_xof ?? m.prevision_xof)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Barres horizontales simples (entonnoir, chiffre d'affaires par société). */
function Barres({ items }: { items: { lib: string; val: number; aff: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.val));
  return (
    <div className="barres">
      {items.map((i) => (
        <div key={i.lib} className="barre-l">
          <span className="lib">{i.lib}</span>
          <span className="piste"><span style={{ width: `${(i.val / max) * 100}%` }} /></span>
          <span className="num">{i.aff}</span>
        </div>
      ))}
    </div>
  );
}

export function TableauDeBord() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { profil, societeActive, langue, societes, fuseau } = useAuth();
  const role = profil?.role ?? '';
  const dossiersNoms = useNoms('dossiers');
  const clients = useNoms('clients');
  const { data, erreur } = useAsync(async () => ok(await supabase.rpc('tableau_de_bord', { p_societe: societeActive })) as TDB, [societeActive]);
  const pilotage = useAsync(async () => ok(await supabase.rpc('pilotage_ca', { p_societe: societeActive })) as PilotageCa, [societeActive]);
  const points = useAsync(async () => ok(await supabase.from('points_bloquants').select('*').is('resolu_le', null)
    .order('echeance').limit(50)) as PointBloquant[], []);
  const cadres = useAsync(async () => (['admin', 'hub_afrique', 'agent_pays', 'comptable'].includes(role)
    ? ok(await supabase.rpc('cadres_a_echeance')) as { dossier_id: string; reference: string; client: string; cadre_fin: string; jours_restants: number }[]
    : []), [role]);
  const montants = Boolean(pilotage.data?.montants_visibles);
  const voitEntonnoir = ['admin', 'hub_afrique', 'agent_pays'].includes(role);
  const voitActivite = ['admin', 'comptable'].includes(role);
  const [choix, setOnglet] = useState<Onglet | null>(null);
  const onglet: Onglet = choix ?? (montants ? 'ca' : 'dossiers');

  const enCours = useAsync(async () => (onglet === 'dossiers'
    ? ok(await supabase.from('dossiers').select('id, reference, intitule, client_id, societe_id, phase_courante, priorite, date_ouverture_site')
      .eq('statut', 'ouvert').order('ouvert_le', { ascending: false }).limit(200)) as Dossier[]
    : null), [onglet]);
  const entonnoir = useAsync(async () => (onglet === 'entonnoir' && voitEntonnoir
    ? ok(await supabase.rpc('entonnoir_prospects')) as { statut: string; nombre: number; site_web: number }[]
    : null), [onglet, voitEntonnoir]);
  const activite = useAsync(async () => (onglet === 'activite' && voitActivite
    ? ok(await supabase.from('journal_audit').select('id, horodatage, action, table_nom, dossier_id, motif').order('id', { ascending: false }).limit(60)) as
      { id: number; horodatage: string; action: string; table_nom: string; dossier_id: string | null; motif: string | null }[]
    : null), [onglet, voitActivite]);

  const societe = societes.find((s) => s.id === societeActive);
  const masque = data && !data.montants_visibles;
  const m = (v: number | null | undefined) => (masque || v === null || v === undefined ? '•••' : compact(v, langue));
  const courant = pilotage.data?.mois?.find((x) => x.en_cours);
  const nomMois = courant ? moisNom(courant.mois, langue, 'long') : '';
  const aArbitrer = data ? data.points_bloquants_escalades + data.fne_en_attente + (data.paiements_a_valider ?? 0) : 0;
  const prioritaire = (points.data ?? []).find((p) => p.escalade_le)?.dossier_id ?? (points.data ?? [])[0]?.dossier_id;
  const pm = pilotage.data?.point_mort;

  const aujourdhui = new Intl.DateTimeFormat(LOCALES[langue], { timeZone: fuseau, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const phrase = [
    montants && courant ? (courant.budget_xof
      ? t('tableau.phrase_budget', { mois: majuscule(nomMois), p: pourcent((courant.ca_xof ?? 0) / courant.budget_xof, langue, 0) })
      : t('tableau.phrase_ca', { mois: nomMois, v: compact(courant.ca_xof ?? 0, langue) })) : null,
    aArbitrer > 0 ? t('tableau.phrase_arbitrage', { n: aArbitrer }) : t('tableau.phrase_rien'),
  ].filter(Boolean).join(' ');

  const kpiCa = () => {
    const b = courant?.budget_xof;
    const ecart = b && courant?.ca_xof !== null && courant?.ca_xof !== undefined ? (courant.ca_xof - b) / b : null;
    return {
      lib: nomMois ? t('tableau.ca_de', { mois: nomMois }) : t('tableau.ca_mois'), val: m(data?.ca_mois_xof),
      sous: b ? `${t('tableau.budget')} ${compact(b, langue)} · ${ecart !== null && ecart > 0 ? '+' : ''}${pourcent(ecart, langue, 1)}` : 'XOF HT',
    };
  };
  const kpiPointMort = () => {
    if (!pm || pm.taux === null) return { lib: t('tableau.point_mort'), val: '—', sous: t('tableau.point_mort_a_parametrer') };
    const sous = pm.taux >= 1 ? t('tableau.point_mort_atteint')
      : pm.atteint_le ? t('tableau.point_mort_prevu', { date: `${pm.atteint_le.slice(5, 7)}.${pm.atteint_le.slice(0, 4)}` })
        : t('tableau.point_mort_non_atteint');
    return { lib: t('tableau.point_mort'), val: pourcent(Math.min(pm.taux, 9.99), langue, 0), sous };
  };

  return (
    <div className="screen tdb">
      <header className="entete tdb-entete">
        <div style={{ minWidth: 0 }}>
          <div className="surtitre">{aujourdhui} · {societe ? societe.raison_sociale : t('coque.vue_consolidee')}</div>
          <h1 className="tdb-h1">{t('tableau.bonjour', { nom: profil?.nom.split(' ')[0] ?? '' })}</h1>
          {data && <p className="tdb-desc">{phrase}</p>}
        </div>
        <div className="actions">
          <Link className="btn" to="/dossiers">{t('tableau.portefeuille')}</Link>
          {prioritaire && <Link className="btn primaire" to={`/dossiers/${prioritaire}`}>{t('tableau.dossier_prioritaire')}</Link>}
        </div>
      </header>
      <Bandeau type="err">{erreur}</Bandeau>
      {!data ? <Chargement /> : (
        <>
          <Kpis items={[
            kpiCa(),
            { lib: t('tableau.a_encaisser'), val: m(data.a_encaisser_xof), sous: t('tableau.dont_retard', { n: data.factures_en_retard }) },
            { lib: t('tableau.fob_production'), val: data.fob_en_production_xof === null ? '•••' : compact(data.fob_en_production_xof, langue),
              sous: t('tableau.commandes_production', { n: data.commandes_en_production }) },
            montants ? kpiPointMort()
              : { lib: t('tableau.dossiers_ouverts'), val: data.dossiers_ouverts, sous: t('tableau.pieces_manquantes', { n: data.pieces_manquantes }) },
          ]} />
          <Onglets actif={onglet} onChange={setOnglet} items={[
            ...(montants ? [{ id: 'ca' as Onglet, lib: t('tableau.onglet_ca') }] : []),
            { id: 'dossiers', lib: `${t('tableau.onglet_dossiers')} · ${data.dossiers_ouverts}` },
            { id: 'arbitrer', lib: `${t('tableau.a_arbitrer')} · ${aArbitrer}` },
            ...(voitEntonnoir || montants ? [{ id: 'entonnoir' as Onglet, lib: t('tableau.onglet_entonnoir') }] : []),
            ...(voitActivite ? [{ id: 'activite' as Onglet, lib: t('tableau.onglet_activite') }] : []),
          ]} />

          {onglet === 'ca' && (
            <section className="tdb-panneau">
              <div className="tdb-titre">
                <h2 className="section-titre">{t('tableau.ca_mensuel')}</h2>
                <span className="mute">{t('tableau.legende')}</span>
              </div>
              {pilotage.chargement ? <Chargement /> : pilotage.data?.mois?.length
                ? <Histogramme mois={pilotage.data.mois} langue={langue} /> : <Vide>{t('tableau.aucune_donnee')}</Vide>}
            </section>
          )}

          {onglet === 'dossiers' && (
            <CadreTableau titre={t('tableau.dossiers_cours')}>
              {enCours.chargement ? <Chargement /> : (enCours.data ?? []).length === 0 ? <Vide>{t('tableau.aucun_dossier')}</Vide> : (
                <table className="t">
                  <thead><tr><th>{t('champs.dossier')}</th><th>{t('champs.intitule')}</th><th>{t('champs.client')}</th>
                    <th>{t('champs.phase')}</th><th>{t('champs.priorite')}</th><th>{t('champs.ouverture_site')}</th></tr></thead>
                  <tbody>
                    {(enCours.data ?? []).map((d) => (
                      <tr key={d.id} className="cliquable" onClick={() => nav(`/dossiers/${d.id}`)}>
                        <td className="ref">{d.reference}</td>
                        <td>{d.intitule}</td>
                        <td className="sec">{clients[d.client_id] ?? '…'}</td>
                        <td>{t(`phases.${d.phase_courante}`)}</td>
                        <td>{d.priorite === 'haute' || d.priorite === 'critique'
                          ? <Statut statut="att" libelle={t(`priorites.${d.priorite}`)} /> : <span className="sec">{t(`priorites.${d.priorite}`)}</span>}</td>
                        <td className="ref">{date(d.date_ouverture_site, langue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CadreTableau>
          )}

          {onglet === 'arbitrer' && (
            <>
              <Kpis items={[
                { lib: t('tableau.points_bloquants'), val: data.points_bloquants_ouverts, sous: t('tableau.escalades', { n: data.points_bloquants_escalades }) },
                { lib: t('tableau.fne_attente'), val: data.fne_en_attente, sous: t('tableau.fne_sous') },
                { lib: t('tableau.paiements_valider'), val: data.paiements_a_valider ?? '—', sous: t('tableau.quatre_yeux') },
                { lib: t('tableau.dd_expirant'), val: data.dd_expirant_60j ?? '—', sous: t('tableau.dd_sous') },
              ]} />
              {(cadres.data ?? []).length > 0 && (
                <Bandeau>{t('tableau.cadres_echeance', { liste: (cadres.data ?? []).map((c) => `${c.reference} · ${c.client} (${t('tableau.jours', { n: c.jours_restants })})`).join(' ; ') })}</Bandeau>
              )}
              <CadreTableau titre={t('tableau.points_ouverts')}>
                {points.chargement ? <Chargement /> : (points.data ?? []).length === 0 ? <Vide>{t('tableau.aucun_point')}</Vide> : (
                  <table className="t">
                    <thead><tr><th>{t('champs.dossier')}</th><th>{t('champs.description')}</th><th>{t('champs.categorie')}</th>
                      <th>{t('champs.echeance')}</th><th>{t('champs.statut')}</th></tr></thead>
                    <tbody>
                      {(points.data ?? []).map((p) => (
                        <tr key={p.id} className="cliquable" onClick={() => nav(`/dossiers/${p.dossier_id}`)}>
                          <td className="ref">{dossiersNoms[p.dossier_id] ?? '…'}</td>
                          <td>{p.description}</td>
                          <td className="sec">{t(`categories.${p.categorie}`)}</td>
                          <td className="ref">{date(p.echeance, langue)}</td>
                          <td>{p.escalade_le ? <Statut statut="bloquee" libelle={t('tableau.escalade')} /> : <Statut statut="ouverte" />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CadreTableau>
            </>
          )}

          {onglet === 'entonnoir' && (
            <div className="tdb-deux">
              {voitEntonnoir && (
                <section>
                  <h2 className="section-titre">{t('tableau.entonnoir')}</h2>
                  {entonnoir.chargement ? <Chargement /> : (
                    <Barres items={(entonnoir.data ?? []).map((e) => ({ lib: t(`prospects.statuts.${e.statut}`), val: Number(e.nombre), aff: String(e.nombre) }))} />
                  )}
                  <p className="mute">{t('tableau.entonnoir_note')}</p>
                </section>
              )}
              {montants && (
                <section>
                  <h2 className="section-titre">{t('tableau.ca_societes')}</h2>
                  <Barres items={(pilotage.data?.par_societe ?? []).map((s) => ({
                    lib: societes.find((x) => x.id === s.societe_id)?.raison_sociale ?? s.code, val: Number(s.ca_xof), aff: `${compact(s.ca_xof, langue)} XOF`,
                  }))} />
                  <p className="mute">{t('tableau.ca_societes_note')}</p>
                </section>
              )}
            </div>
          )}

          {onglet === 'activite' && (
            <CadreTableau titre={t('tableau.activite')}>
              {activite.chargement ? <Chargement /> : (activite.data ?? []).length === 0 ? <Vide>{t('tableau.aucune_activite')}</Vide> : (
                <table className="t">
                  <thead><tr><th>{t('champs.date')}</th><th>{t('champs.module')}</th><th>{t('champs.action')}</th>
                    <th>{t('champs.dossier')}</th><th>{t('tableau.col_motif')}</th></tr></thead>
                  <tbody>
                    {(activite.data ?? []).map((a) => (
                      <tr key={a.id} className={a.dossier_id ? 'cliquable' : undefined} onClick={() => a.dossier_id && nav(`/dossiers/${a.dossier_id}`)}>
                        <td className="ref">{dateHeure(a.horodatage, langue, fuseau)}</td>
                        <td>{t(`tables.${a.table_nom}`, { defaultValue: a.table_nom })}</td>
                        <td className="sec">{a.action}</td>
                        <td className="ref">{a.dossier_id ? dossiersNoms[a.dossier_id] ?? '…' : '—'}</td>
                        <td className="sec">{a.motif ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CadreTableau>
          )}
        </>
      )}
    </div>
  );
}
