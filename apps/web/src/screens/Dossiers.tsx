import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { nombre } from '../lib/format';
import { normaliser as _n } from '../lib/droits';
import type { Client, Piece } from '../lib/types';
import { Bandeau, Bouton, Champ, Chargement, Entete, Onglets, Statut, Vide } from '../components/ui';
import { useNoms } from '../lib/referentiels';

interface LignePortefeuille {
  id: string; reference: string; intitule: string; client_id: string; client: string; segment: string | null; pays: string;
  societe_id: string; modele: string; mode_financier: string; phase_courante: string; statut: string; priorite: string;
  ouvert_le: string; date_ouverture_site: string | null; chef_id: string | null; completude: number; fob_xof: number | null;
  marge_jours: number | null; marge_alerte: boolean; etat: string;
}
const ETATS: Record<string, string> = {
  bloquant: 'err', intenable: 'err', nc_ouverte: 'att', attente_tiers: 'att', dans_les_delais: 'ok',
  suspendu: 'att', clos: 'neutre', annule: 'neutre',
};
const ORDRE_PHASES = ['consultation', 'verification', 'mise_en_concurrence', 'devis_mandat', 'contrat', 'approbation_technique',
  'production', 'inspection', 'expedition', 'livraison', 'cloture'];
const initiales = (nom: string | undefined) => (nom ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('');

function Completude({ v }: { v: number }) {
  const pc = Math.round(v * 100);
  const cls = pc >= 90 ? 'ok' : pc < 50 ? 'bas' : '';
  return (
    <span className="compl">
      <span className={'compl-piste ' + cls}><span style={{ width: `${pc}%` }} /></span>
      <span className="compl-pc">{pc} %</span>
    </span>
  );
}

export function Portefeuille() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { societeActive, langue, profil, societes } = useAuth();
  const [statut, setStatut] = useState<'ouvert' | 'clos' | 'tous'>('ouvert');
  const [modele, setModele] = useState<string>('tous');
  const [vue, setVue] = useState<'liste' | 'colonnes'>('liste');
  const [plein, setPlein] = useState(false);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [sel, setSel] = useState<string | null>(null);
  const profils = useNoms('profils');
  const { data, erreur, chargement } = useAsync(async () =>
    ok(await supabase.rpc('portefeuille', { p_statut: statut === 'tous' ? null : statut })) as LignePortefeuille[], [statut]);
  const parSociete = useMemo(() => (data ?? []).filter((d) => !societeActive || d.societe_id === societeActive), [data, societeActive]);
  const modeles = useMemo(() => [...new Set(parSociete.map((d) => d.modele))], [parSociete]);
  const liste = useMemo(() => {
    const n = _n(q.trim());
    return parSociete.filter((d) => (modele === 'tous' || d.modele === modele)
      && (!n || _n(d.reference).includes(n) || _n(d.intitule).includes(n) || _n(d.client).includes(n)));
  }, [parSociete, modele, q]);
  const choisi = liste.find((d) => d.id === sel) ?? liste[0] ?? null;
  const peutCreer = ['admin', 'hub_afrique', 'agent_pays'].includes(profil?.role ?? '');
  const m = (v: number | null) => (v === null ? '—' : `${nombre(v / 1e6, langue, 1)} M`);
  const fobTotal = parSociete.reduce((a, d) => a + (d.fob_xof ?? 0), 0);
  const fobVisible = parSociete.some((d) => d.fob_xof !== null);
  const alertes = parSociete.filter((d) => d.marge_alerte).length;
  const titre = [
    t('portefeuille.titre_n', { n: parSociete.length, statut: t(`portefeuille.statut_${statut}`) }),
    fobVisible ? t('portefeuille.titre_fob', { v: nombre(fobTotal / 1e6, langue, 1) }) : null,
  ].filter(Boolean).join(', ') + (alertes > 0 ? ` ; ${t('portefeuille.titre_marge', { n: alertes })}` : '');
  const ddmmyyyy = (d: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '—');
  const etat = (d: LignePortefeuille) => <Statut statut={ETATS[d.etat] ?? 'neutre'} libelle={t(`portefeuille.etats.${d.etat}`)} />;

  const exporter = () => {
    const echap = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lignes = [['reference', 'client', 'pays', 'phase', 'etat', 'completude', 'fob_xof', 'ouverture_site', 'marge_jours'].join(';'),
      ...liste.map((d) => [d.reference, d.client, d.pays, d.phase_courante, d.etat, Math.round(d.completude * 100), d.fob_xof ?? '',
        d.date_ouverture_site ?? '', d.marge_jours ?? ''].map(echap).join(';'))];
    const url = URL.createObjectURL(new Blob(['﻿' + lignes.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `portefeuille-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.dossiers')} · ${t('sections.portefeuille')} · PTF`} titre={chargement ? t('ecrans.portefeuille') : titre}
        actions={<>
          <Bouton onClick={exporter} disabled={liste.length === 0}>{t('portefeuille.exporter')}</Bouton>
          {peutCreer && <Link className="btn primaire" to="/dossiers/nouveau">{t('dossiers.nouveau')}</Link>}
        </>} />
      <div className="pf-barre">
        <Onglets actif={modele} onChange={setModele} items={[
          { id: 'tous', lib: t('dossiers.tous') }, ...modeles.map((x) => ({ id: x, lib: t(`modeles.${x}`) }))]} />
        <input className="pf-recherche" placeholder={t('portefeuille.rechercher')} value={q} maxLength={80}
          onChange={(e) => setQ(e.target.value)} aria-label={t('portefeuille.rechercher')} />
        <span className="pf-droite">
          <select className="pf-statut" value={statut} onChange={(e) => setStatut(e.target.value as typeof statut)} aria-label={t('champs.statut')}>
            <option value="ouvert">{t('dossiers.ouverts')}</option><option value="clos">{t('dossiers.clos')}</option><option value="tous">{t('dossiers.tous')}</option>
          </select>
          <span className="mute">{t('portefeuille.lignes', { n: liste.length })}</span>
          <span className="pf-vues" role="tablist">
            <button role="tab" aria-selected={vue === 'liste'} onClick={() => setVue('liste')}>{t('portefeuille.liste')}</button>
            <button role="tab" aria-selected={vue === 'colonnes'} onClick={() => setVue('colonnes')}>{t('portefeuille.colonnes')}</button>
          </span>
          <Bouton petit onClick={() => setPlein(true)}>{t('commun.plein_ecran')}</Bouton>
        </span>
      </div>
      <Bandeau type="err">{erreur}</Bandeau>
      <div className="liste-detail pf">
        <div className={plein ? 'plein-ecran' : 'liste'}>
          {plein && <div className="actions" style={{ justifyContent: 'flex-end' }}><Bouton petit onClick={() => setPlein(false)}>{t('commun.quitter_plein_ecran')}</Bouton></div>}
          {chargement ? <Chargement /> : liste.length === 0 ? <Vide>{t('dossiers.aucun')}</Vide> : vue === 'liste' ? (
            <div className="cadre">
              <table className="t">
                <thead><tr><th>{t('champs.reference')}</th><th>{t('champs.client')}</th><th>{t('champs.pays')}</th><th>{t('champs.phase')}</th>
                  <th>{t('champs.statut')}</th><th>{t('portefeuille.completude')}</th><th className="num">FOB</th>
                  <th className="num">{t('portefeuille.ouverture')}</th><th className="num">{t('portefeuille.marge')}</th></tr></thead>
                <tbody>
                  {liste.map((d) => (
                    <tr key={d.id} className="cliquable" aria-selected={d.id === choisi?.id} onClick={() => setSel(d.id)} onDoubleClick={() => nav(`/dossiers/${d.id}`)}>
                      <td className="ref">{d.reference}</td>
                      <td className="ellipse" title={d.intitule}>{d.client}</td>
                      <td className="sec">{d.pays}</td>
                      <td>{t(`phases.${d.phase_courante}`)}</td>
                      <td>{etat(d)}</td>
                      <td><Completude v={Number(d.completude)} /></td>
                      <td className="num">{m(d.fob_xof)}</td>
                      <td className="num">{ddmmyyyy(d.date_ouverture_site)}</td>
                      <td className={'num' + (d.marge_alerte ? ' alerte' : '')}>{d.marge_jours === null ? '—' : t('portefeuille.jours', { n: d.marge_jours })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="pf-kanban">
              {ORDRE_PHASES.filter((ph) => liste.some((d) => d.phase_courante === ph)).map((ph) => (
                <section key={ph} className="pf-col">
                  <h3>{t(`phases.${ph}`)} <span className="mute">{liste.filter((d) => d.phase_courante === ph).length}</span></h3>
                  {liste.filter((d) => d.phase_courante === ph).map((d) => (
                    <button key={d.id} className={'pf-carte' + (d.id === choisi?.id ? ' on' : '')} onClick={() => setSel(d.id)} onDoubleClick={() => nav(`/dossiers/${d.id}`)}>
                      <span className="ref">{d.reference}</span>
                      <span className="pf-carte-client">{d.client}</span>
                      {etat(d)}
                      <Completude v={Number(d.completude)} />
                    </button>
                  ))}
                </section>
              ))}
            </div>
          )}
        </div>
        <aside className="detail pf-detail">
          {!choisi ? <Vide>{t('dossiers.choisir')}</Vide> : (
            <>
              <div className="surtitre">{t('portefeuille.selectionne')}</div>
              <h2 className="pf-nom">{choisi.client}</h2>
              <div className="sec">{choisi.reference}{choisi.chef_id ? ` · ${t('portefeuille.chef')} ${initiales(profils[choisi.chef_id])}` : ''} · {t('champs.phase').toLowerCase()} {t(`phases.${choisi.phase_courante}`)}</div>
              <div className="pf-champs">
                <div><span>{t('champs.pays')}</span><b>{choisi.pays}</b></div>
                <div><span>{t('portefeuille.segment')}</span><b>{choisi.segment ?? '—'}</b></div>
                <div><span>{t('portefeuille.mode')}</span><b>{t(`modes.${choisi.mode_financier}`)}</b></div>
                <div><span>{t('portefeuille.societe')}</span><b>{societes.find((x) => x.id === choisi.societe_id)?.raison_sociale ?? '—'}</b></div>
                <div><span>{t('portefeuille.valeur_fob')}</span><b>{m(choisi.fob_xof)}</b></div>
                <div><span>{t('portefeuille.ouverture_site')}</span><b>{ddmmyyyy(choisi.date_ouverture_site)}</b></div>
                <div><span>{t('portefeuille.marge_restante')}</span><b>{choisi.marge_jours === null ? '—' : t('portefeuille.jours', { n: choisi.marge_jours })}</b></div>
                <div><span>{t('portefeuille.completude')}</span><b>{Math.round(Number(choisi.completude) * 100)} %</b></div>
              </div>
              <div className="pf-lecture">
                <div className="surtitre">{t('portefeuille.lecture')}</div>
                <p>{t(`portefeuille.lectures.${choisi.etat}`, { defaultValue: t('portefeuille.lectures.dans_les_delais') })} {choisi.date_ouverture_site ? t('portefeuille.lecture_marge') : ''}</p>
              </div>
              <div className="actions">
                <Link className="btn primaire" to={`/dossiers/${choisi.id}`}>{t('dossiers.ouvrir')}</Link>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

const MODELES = ['achat_accompagne', 'equipement_site', 'negoce', 'due_diligence', 'consultation', 'inspection_seule',
  'visite_usines', 'logistique', 'installation', 'accord_cadre'] as const;

const schemaDossier = z.object({
  intitule: z.string().trim().min(2).max(200),
  client_id: z.string().uuid(),
  societe_id: z.string().uuid(),
  modele: z.enum(MODELES),
  priorite: z.enum(['basse', 'normale', 'haute', 'critique']),
  specialite: z.enum(['equipement_site', 'approvisionnement_industriel', 'autre']).nullable(),
  date_ouverture_site: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  forfait_projet_ht: z.number().int().min(0).max(1e12).nullable(),
  taux_commission_projet: z.number().min(0).max(0.3).nullable(),
  forfait_consultation_ht: z.number().int().min(0).max(1e8).nullable(),
  lettre_credit: z.boolean(),
  cadre_debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  cadre_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  forfait_mensuel_ht: z.number().int().min(0).max(1e9).nullable(),
}).strict();

export function NouveauDossier() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { societes } = useAuth();
  const clients = useAsync(async () => ok(await supabase.from('clients').select('*').is('archive_le', null).order('raison_sociale')) as Client[], []);
  const [f, setF] = useState({ intitule: '', client_id: '', societe_id: '', modele: 'achat_accompagne', priorite: 'normale', specialite: '',
    date_ouverture_site: '', forfait_projet_ht: '', taux_commission_projet: '', forfait_consultation_ht: '', lettre_credit: false,
    cadre_debut: '', cadre_fin: '', forfait_mensuel_ht: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const a = useAction();
  const maj = (k: keyof typeof f, v: string | boolean) => setF({ ...f, [k]: v });
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/\s/g, '').replace(',', '.')));

  const envoyer = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = schemaDossier.safeParse({
      intitule: f.intitule, client_id: f.client_id, societe_id: f.societe_id, modele: f.modele, priorite: f.priorite,
      specialite: f.specialite || null, date_ouverture_site: f.date_ouverture_site || null, forfait_projet_ht: num(f.forfait_projet_ht),
      taux_commission_projet: f.taux_commission_projet ? (num(f.taux_commission_projet) ?? 0) / 100 : null,
      forfait_consultation_ht: num(f.forfait_consultation_ht), lettre_credit: f.lettre_credit,
      cadre_debut: f.cadre_debut || null, cadre_fin: f.cadre_fin || null, forfait_mensuel_ht: num(f.forfait_mensuel_ht),
    });
    const err: Record<string, string> = {};
    if (!v.success) for (const i of v.error.issues) err[String(i.path[0])] = t('formulaire.invalide');
    if (f.modele === 'equipement_site' && !f.date_ouverture_site) err.date_ouverture_site = t('dossiers.date_obligatoire');
    setErrs(err);
    if (!v.success || Object.keys(err).length) return;
    await a.executer(async () => {
      const r = ok(await supabase.from('dossiers').insert(v.data).select('id').single()) as { id: string };
      nav(`/dossiers/${r.id}`);
    });
  };

  return (
    <div className="screen" style={{ overflow: 'auto' }}>
      <Entete surtitre={`${t('modules.dossiers')} · ${t('ecrans.nouveau_dossier')}`} titre={t('dossiers.nouveau_titre')} />
      <form onSubmit={envoyer} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 860 }}>
        <div className="grille2">
          <Champ label={t('champs.intitule')} erreur={errs.intitule}><input value={f.intitule} maxLength={200} onChange={(e) => maj('intitule', e.target.value)} /></Champ>
          <Champ label={t('champs.client')} erreur={errs.client_id}>
            <select value={f.client_id} onChange={(e) => maj('client_id', e.target.value)}>
              <option value="">—</option>
              {(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.raison_sociale} · {c.pays}</option>)}
            </select>
          </Champ>
          <Champ label={t('champs.societe_contractante')} erreur={errs.societe_id}>
            <select value={f.societe_id} onChange={(e) => maj('societe_id', e.target.value)}>
              <option value="">—</option>
              {societes.map((s) => <option key={s.id} value={s.id}>{s.raison_sociale}</option>)}
            </select>
          </Champ>
          <Champ label={t('champs.modele')} erreur={errs.modele}>
            <select value={f.modele} onChange={(e) => maj('modele', e.target.value)}>
              {MODELES.map((m) => <option key={m} value={m}>{t(`modeles.${m}`)}</option>)}
            </select>
          </Champ>
          <Champ label={t('champs.priorite')}>
            <select value={f.priorite} onChange={(e) => maj('priorite', e.target.value)}>
              {['basse', 'normale', 'haute', 'critique'].map((p) => <option key={p} value={p}>{t(`priorites.${p}`)}</option>)}
            </select>
          </Champ>
          <Champ label={t('champs.specialite')}>
            <select value={f.specialite} onChange={(e) => maj('specialite', e.target.value)}>
              <option value="">—</option>
              {['equipement_site', 'approvisionnement_industriel', 'autre'].map((s) => <option key={s} value={s}>{t(`specialites.${s}`)}</option>)}
            </select>
          </Champ>
          {!['equipement_site', 'accord_cadre'].includes(f.modele) && (
            <Champ label={t('champs.forfait_consultation')} erreur={errs.forfait_consultation_ht}>
              <input inputMode="numeric" value={f.forfait_consultation_ht} onChange={(e) => maj('forfait_consultation_ht', e.target.value)} />
            </Champ>
          )}
          <label className="champ" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={f.lettre_credit} onChange={(e) => maj('lettre_credit', e.target.checked)} style={{ width: 18, height: 18 }} />
            <span>{t('champs.lettre_credit')}</span>
          </label>
        </div>
        {f.modele === 'equipement_site' && (
          <div className="grille3">
            <Champ label={t('champs.date_ouverture_site')} erreur={errs.date_ouverture_site}><input type="date" value={f.date_ouverture_site} onChange={(e) => maj('date_ouverture_site', e.target.value)} /></Champ>
            <Champ label={t('champs.forfait_projet')} erreur={errs.forfait_projet_ht}><input inputMode="numeric" value={f.forfait_projet_ht} onChange={(e) => maj('forfait_projet_ht', e.target.value)} /></Champ>
            <Champ label={t('champs.taux_projet')} erreur={errs.taux_commission_projet}><input inputMode="decimal" value={f.taux_commission_projet} onChange={(e) => maj('taux_commission_projet', e.target.value)} /></Champ>
          </div>
        )}
        {f.modele === 'accord_cadre' && (
          <div className="grille3">
            <Champ label={t('champs.cadre_debut')} erreur={errs.cadre_debut}><input type="date" value={f.cadre_debut} onChange={(e) => maj('cadre_debut', e.target.value)} /></Champ>
            <Champ label={t('champs.cadre_fin')} erreur={errs.cadre_fin}><input type="date" value={f.cadre_fin} onChange={(e) => maj('cadre_fin', e.target.value)} /></Champ>
            <Champ label={t('champs.forfait_mensuel')} erreur={errs.forfait_mensuel_ht}><input inputMode="numeric" value={f.forfait_mensuel_ht} onChange={(e) => maj('forfait_mensuel_ht', e.target.value)} /></Champ>
          </div>
        )}
        <p className="mute">{t('dossiers.aide_mode')}</p>
        <Bandeau type="err">{a.erreur}</Bandeau>
        <div className="actions"><Bouton type="submit" variante="primaire" disabled={a.enCours}>{t('dossiers.creer')}</Bouton></div>
      </form>
    </div>
  );
}

export function useCompletude(pieces: Piece[] | null) {
  return useMemo(() => {
    const p = pieces ?? [];
    const ob = p.filter((x) => x.obligatoire);
    return ob.length ? Math.round((100 * ob.filter((x) => x.statut === 'validee').length) / ob.length) : 100;
  }, [pieces]);
}
