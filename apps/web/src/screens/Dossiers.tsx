import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date } from '../lib/format';
import { normaliser as _n } from '../lib/droits';
import type { Client, Dossier, Phase, Piece } from '../lib/types';
import { Bandeau, Bouton, CadreTableau, Champ, Chargement, Entete, Onglets, Statut, Vide } from '../components/ui';
import { useNoms } from '../lib/referentiels';

export function Portefeuille() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { societeActive, langue, profil } = useAuth();
  const [filtre, setFiltre] = useState<'ouvert' | 'clos' | 'tous'>('ouvert');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [sel, setSel] = useState<string | null>(null);
  const clients = useNoms('clients');
  const { data, erreur, chargement } = useAsync(async () => {
    let r = supabase.from('dossiers').select('*').order('cree_le', { ascending: false }).limit(500);
    if (societeActive) r = r.eq('societe_id', societeActive);
    if (filtre !== 'tous') r = r.eq('statut', filtre);
    return ok(await r) as Dossier[];
  }, [societeActive, filtre]);
  const liste = useMemo(() => {
    const n = _n(q.trim());
    return (data ?? []).filter((d) => !n || _n(d.reference).includes(n) || _n(d.intitule).includes(n) || _n(clients[d.client_id] ?? '').includes(n));
  }, [data, q, clients]);
  const choisi = liste.find((d) => d.id === sel) ?? null;
  const phases = useAsync(async () => (choisi ? (ok(await supabase.from('dossier_phases').select('*').eq('dossier_id', choisi.id).order('ordre')) as Phase[]) : []), [choisi?.id]);
  const peutCreer = ['admin', 'hub_afrique', 'agent_pays'].includes(profil?.role ?? '');

  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.dossiers')} · M23`} titre={t('dossiers.titre', { n: liste.length })}
        actions={peutCreer && <Link className="btn primaire" to="/dossiers/nouveau">{t('dossiers.nouveau')}</Link>} />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flex: 'none' }}>
        <Onglets actif={filtre} onChange={setFiltre} items={[
          { id: 'ouvert', lib: t('dossiers.ouverts') }, { id: 'clos', lib: t('dossiers.clos') }, { id: 'tous', lib: t('dossiers.tous') }]} />
        <input className="search" placeholder={t('dossiers.filtrer')} value={q} maxLength={80} onChange={(e) => setQ(e.target.value)} aria-label={t('dossiers.filtrer')} />
      </div>
      <Bandeau type="err">{erreur}</Bandeau>
      <div className="liste-detail">
        <div className="liste">
          <CadreTableau>
            {chargement ? <Chargement /> : liste.length === 0 ? <Vide>{t('dossiers.aucun')}</Vide> : (
              <table className="t">
                <thead><tr><th>{t('champs.reference')}</th><th>{t('champs.client')} · {t('champs.intitule')}</th><th>{t('champs.mode')}</th>
                  <th>{t('champs.phase')}</th><th>{t('champs.priorite')}</th><th>{t('champs.ouvert_le')}</th></tr></thead>
                <tbody>
                  {liste.map((d) => (
                    <tr key={d.id} className="cliquable" aria-selected={d.id === sel} onClick={() => setSel(d.id)} onDoubleClick={() => nav(`/dossiers/${d.id}`)}>
                      <td className="ref">{d.reference}</td>
                      <td><div>{clients[d.client_id] ?? '…'}</div><div className="mute">{d.intitule}</div></td>
                      <td className="sec">{t(`modes.${d.mode_financier}`)}</td>
                      <td><Statut statut={d.statut === 'ouvert' ? 'en_cours' : d.statut} libelle={t(`phases.${d.phase_courante}`)} /></td>
                      <td className="sec">{t(`priorites.${d.priorite}`)}</td>
                      <td className="ref">{date(d.ouvert_le, langue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CadreTableau>
        </div>
        <aside className="detail">
          {!choisi ? <Vide>{t('dossiers.choisir')}</Vide> : (
            <>
              <div className="surtitre">{choisi.reference}</div>
              <h2 style={{ fontSize: 22 }}>{choisi.intitule}</h2>
              <dl className="dl">
                <dt>{t('champs.client')}</dt><dd>{clients[choisi.client_id]}</dd>
                <dt>{t('champs.modele')}</dt><dd>{t(`modeles.${choisi.modele}`)}</dd>
                <dt>{t('champs.mode')}</dt><dd>{t(`modes.${choisi.mode_financier}`)}</dd>
                <dt>{t('champs.pays')}</dt><dd>{choisi.pays}</dd>
                {choisi.date_ouverture_site && <><dt>{t('champs.date_ouverture_site')}</dt><dd>{date(choisi.date_ouverture_site, langue)}</dd></>}
              </dl>
              <div className="phases">
                {(phases.data ?? []).map((p) => <span key={p.id} className={'phase ' + p.statut}>{t(`phases.${p.phase}`)}</span>)}
              </div>
              <Link className="btn primaire" to={`/dossiers/${choisi.id}`}>{t('dossiers.ouvrir')}</Link>
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
