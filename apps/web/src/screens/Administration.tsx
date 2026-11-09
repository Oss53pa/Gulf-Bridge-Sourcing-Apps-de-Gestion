import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, dateHeure, montant } from '../lib/format';
import type { Audit, Parametre, Profil } from '../lib/types';
import { Bandeau, Bouton, Champ, Chargement, Entete, Onglets, Statut, Tiroir, Vide } from '../components/ui';
import { CalendrierParam, DelaisCiblesParam } from './Delais';

// Module de chaque table journalisée (filtre « module » du journal).
const MODULES_AUDIT: Record<string, string[]> = {
  commercial: ['prospects', 'prospects_actions', 'clients', 'verifications_clients', 'appels_offres', 'appels_offres_pieces', 'appels_offres_questions', 'fiches_reference', 'satisfactions', 'devis', 'devis_pieces'],
  dossiers: ['dossiers', 'pieces', 'derogations', 'dossier_phases', 'points_bloquants', 'taches', 'phase_attentes', 'echeances_projet', 'avenants', 'calendrier', 'delais_cibles', 'modeles_dossier', 'pieces_modele'],
  achats: ['commandes', 'lignes_commande', 'fournisseurs', 'comptes_paiement', 'beneficiaires_effectifs', 'liens_fournisseurs', 'liens_due_diligence', 'pieces_due_diligence', 'due_diligences',
    'questions_consultation', 'rapports_offres', 'plis', 'registre_presentations', 'echantillons'],
  qualite: ['inspections', 'non_conformites', 'dossiers_qualite_emis', 'listes_qualite_client'],
  logistique: ['expeditions', 'expedition_etapes', 'expedition_commandes', 'liens_transitaires', 'documents_transitaires', 'receptions', 'reserves_reception', 'lettres_credit', 'certificats_lc'],
  finance: ['factures', 'lignes_facture', 'encaissements', 'paiements_fournisseurs', 'couts', 'couts_repartition', 'partages', 'series_factures', 'releves_bancaires', 'lignes_releve',
    'releves_valides', 'comptes_bancaires', 'taux_change', 'mensualites_cadre'],
  apres_vente: ['interventions', 'numeros_serie', 'pieces_rechange'],
  parametrage: ['parametres', 'profils', 'societes', 'rattachements_pays'],
};
const moduleDe = (table: string) => Object.entries(MODULES_AUDIT).find(([, ts]) => ts.includes(table))?.[0] ?? 'parametrage';
// Validation : passage d'un statut vers un état validé, approuvé ou libéré.
const VALIDES = ['validee', 'valide', 'validees', 'approuvee', 'approuve', 'accepte', 'acceptee', 'liberation', 'signee', 'definitive', 'payee', 'verifie', 'agree', 'emise'];
const statutDe = (v: unknown) => (v && typeof v === 'object' && 'statut' in v ? String((v as { statut: unknown }).statut) : null);
const objetDe = (v: unknown) => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  for (const k of ['reference', 'numero', 'raison_sociale', 'libelle', 'cle', 'nom', 'intitule']) if (typeof o[k] === 'string' && o[k]) return String(o[k]);
  return null;
};
const lisible = (x: string) => x.replace(/_/g, ' ');

export function Journal() {
  const { t } = useTranslation();
  const { langue, fuseau } = useAuth();
  const [module, setModule] = useState('');
  const [type, setType] = useState<'tout' | 'validations' | 'derogations'>('tout');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Audit | null>(null);
  const profils = useAsync(async () => ok(await supabase.from('profils').select('id, nom, role')) as { id: string; nom: string; role: string }[], []);
  const l = useAsync(async () => {
    let r = supabase.from('journal_audit').select('*').order('id', { ascending: false }).limit(500);
    if (type === 'derogations') r = r.eq('table_nom', 'derogations');
    else if (module) r = r.in('table_nom', MODULES_AUDIT[module] ?? []);
    return ok(await r) as Audit[];
  }, [module, type]);
  const a = useAction();
  const [verif, setVerif] = useState<{ premiere_ligne_alteree: number | null; lignes_verifiees: number } | null>(null);
  const verifier = async () => {
    await a.executer(async () => {
      const r = ok(await supabase.rpc('audit_verifier')) as { premiere_ligne_alteree: number | null; lignes_verifiees: number }[];
      setVerif(r[0] ?? null);
    });
  };
  useEffect(() => { void verifier(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const qui = (u: string | null) => {
    const p = u ? (profils.data ?? []).find((x) => x.id === u) : null;
    return u ? (p ? `${p.nom} · ${t(`roles.${p.role}`)}` : '…') : t('journal.systeme');
  };
  const action = (j: Audit) => {
    const av = statutDe(j.avant), ap = statutDe(j.apres);
    if (j.action === 'update' && av !== ap && ap) return t('journal.statut_change', { objet: t(`tables.${j.table_nom}`, { defaultValue: lisible(j.table_nom) }), de: lisible(av ?? '—'), a: lisible(ap) });
    return `${t(`journal.actions.${j.action}`, { defaultValue: j.action })} · ${t(`tables.${j.table_nom}`, { defaultValue: lisible(j.table_nom) })}`;
  };
  const estValidation = (j: Audit) => { const ap = statutDe(j.apres); return j.action === 'update' && ap !== statutDe(j.avant) && ap !== null && VALIDES.includes(ap); };
  const terme = q.trim().toLowerCase();
  const liste = (l.data ?? []).filter((j) => (type !== 'validations' || estValidation(j))
    && (!terme || [qui(j.utilisateur), action(j), objetDe(j.apres) ?? objetDe(j.avant) ?? '', j.motif ?? ''].join(' ').toLowerCase().includes(terme)));
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.supervision')} · ${t('journal.non_modifiable')}`} titre={t('journal.titre_court')} />
      <p className="sec" style={{ marginTop: -8 }}>{t('journal.aide')}</p>
      {verif ? (verif.premiere_ligne_alteree === null
        ? <div className="aud-integrite ok"><span className="pt" />{t('journal.integre', { n: verif.lignes_verifiees })}</div>
        : <Bandeau type="err">{t('journal.chaine_ko', { id: verif.premiere_ligne_alteree })}</Bandeau>)
        : <Bouton disabled={a.enCours} onClick={() => void verifier()}>{t('journal.verifier')}</Bouton>}
      <Bandeau type="err">{l.erreur ?? profils.erreur ?? a.erreur}</Bandeau>
      <div className="aud-filtres">
        <div className="segment">
          {['', ...Object.keys(MODULES_AUDIT)].map((m) => <button key={m || 'tous'} type="button" aria-pressed={module === m} disabled={type === 'derogations'} onClick={() => setModule(m)}>{m ? t(`modules.${m}`) : t('journal.tous')}</button>)}
        </div>
        <div className="segment">
          {(['tout', 'validations', 'derogations'] as const).map((x) => <button key={x} type="button" aria-pressed={type === x} onClick={() => setType(x)}>{t(`journal.types.${x}`)}</button>)}
        </div>
      </div>
      <div className="aud-recherche">
        <input className="search" value={q} maxLength={100} placeholder={t('journal.rechercher')} onChange={(e) => setQ(e.target.value)} aria-label={t('journal.rechercher')} />
        <span className="mute">{t('journal.entrees', { n: liste.length })}</span>
      </div>
      <div className="cadre">
        {l.chargement && !l.data ? <Chargement /> : liste.length === 0 ? <Vide>{t('journal.vide')}</Vide> : (
          <table className="t aud-table"><thead><tr><th>{t('champs.horodatage')}</th><th>{t('champs.utilisateur')}</th><th>{t('journal.module')}</th><th>{t('champs.action')}</th>
            <th className="num">{t('journal.empreinte_court')}</th></tr></thead>
            <tbody>{liste.map((j) => {
              const derog = j.table_nom === 'derogations';
              const objet = objetDe(j.apres) ?? objetDe(j.avant);
              return (
                <tr key={j.id} className={'cliquable' + (derog ? ' aud-derog' : '')} onClick={() => setSel(j)}>
                  <td className="ref">{dateHeure(j.horodatage, langue, fuseau)}</td>
                  <td>{qui(j.utilisateur)}</td>
                  <td className="aud-module">{t(`modules.${moduleDe(j.table_nom)}`)}</td>
                  <td><b className={derog ? 'txt-err' : ''}>{action(j)}</b>
                    {objet && <div className="sec">{objet}</div>}
                    {j.motif && <div>{t('journal.motif', { m: j.motif })}</div>}</td>
                  <td className="num ref mute">{j.empreinte.slice(0, 8)}</td>
                </tr>);
            })}</tbody></table>
        )}
      </div>
      {sel && (
        <Tiroir titre={`#${sel.id} · ${action(sel)}`} onClose={() => setSel(null)}>
          <dl className="dl"><dt>{t('champs.horodatage')}</dt><dd>{dateHeure(sel.horodatage, langue, fuseau)}</dd>
            <dt>{t('champs.utilisateur')}</dt><dd>{qui(sel.utilisateur)}</dd>
            <dt>{t('journal.empreinte')}</dt><dd style={{ wordBreak: 'break-all' }}><code>{sel.empreinte}</code></dd></dl>
          <div className="section-titre">{t('journal.avant')}</div>
          <pre className="aud-json">{sel.avant ? JSON.stringify(sel.avant, null, 2) : '—'}</pre>
          <div className="section-titre">{t('journal.apres')}</div>
          <pre className="aud-json">{sel.apres ? JSON.stringify(sel.apres, null, 2) : '—'}</pre>
        </Tiroir>
      )}
    </div>
  );
}

type OngletParam = 'grille' | 'parametres' | 'taux' | 'calendrier' | 'delais' | 'utilisateurs' | 'societes';

export function Parametrage() {
  const { t } = useTranslation();
  const [onglet, setOnglet] = useState<OngletParam>('grille');
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.parametrage')} · ${t('parametrage.dates')}`} titre={t('parametrage.titre')} />
      <Onglets actif={onglet} onChange={setOnglet} items={(['grille', 'parametres', 'taux', 'calendrier', 'delais', 'utilisateurs', 'societes'] as OngletParam[]).map((id) => ({ id, lib: t(`parametrage.onglets.${id}`) }))} />
      <div className="cadre">
        {onglet === 'grille' && <GrilleTarifaire />}
        {onglet === 'parametres' && <Parametres />}
        {onglet === 'taux' && <Taux />}
        {onglet === 'calendrier' && <CalendrierParam />}
        {onglet === 'delais' && <DelaisCiblesParam />}
        {onglet === 'utilisateurs' && <Utilisateurs />}
        {onglet === 'societes' && <Societes />}
      </div>
    </div>
  );
}

interface Tranche { jusqu_a: number | null; taux: number }

/** Grille tarifaire (maquette « Services et barèmes ») : barème de commission par tranches, règles d'application,
 *  autres tarifs et versions datées. Une nouvelle version s'enregistre comme un paramètre daté ; la base la valide. */
function GrilleTarifaire() {
  const { t } = useTranslation();
  const { langue, profil } = useAuth();
  const admin = profil?.role === 'admin';
  const cat = useAsync(async () => ok(await supabase.rpc('catalogue_parametres')) as ParamCatalogue[], []);
  const versions = useAsync(async () => ok(await supabase.from('parametres').select('id, valeur, date_effet, commentaire, cree_par').eq('cle', 'commission.bareme')
    .order('date_effet', { ascending: false })) as { id: string; valeur: unknown; date_effet: string; commentaire: string | null; cree_par: string | null }[], []);
  const noms = useAsync(async () => ok(await supabase.from('profils').select('id, nom')) as { id: string; nom: string }[], []);
  const a = useAction();
  const [ed, setEd] = useState<{ tranches: { jusqu_a: string; taux: string }[]; date_effet: string; commentaire: string } | null>(null);
  const val = (cle: string) => (cat.data ?? []).find((p) => p.cle === cle);
  const bareme = (Array.isArray(val('commission.bareme')?.valeur) ? val('commission.bareme')!.valeur : []) as Tranche[];
  const mx = (n: number) => montant(n, 'XOF', langue);
  const pct = (n: number) => `${(n * 100).toLocaleString(langue, { maximumFractionDigits: 2 })} %`;
  const enVigueur = (versions.data ?? []).findIndex((v) => v.date_effet <= new Date().toISOString().slice(0, 10));
  const nbV = (versions.data ?? []).length;
  const regles: { cle: string; lib: string; aide: string; aff: (v: number) => string }[] = [
    { cle: 'commission.majoration_sur_mesure', lib: t('grille.sur_mesure'), aide: t('grille.sur_mesure_aide'), aff: (v) => `+${(v * 100).toLocaleString(langue)} ${t('grille.points')}` },
    { cle: 'commission.minimum_xof', lib: t('grille.minimum'), aide: t('grille.minimum_aide'), aff: mx },
    { cle: 'commission.reduction_reassort', lib: t('grille.reassort'), aide: t('grille.reassort_aide'), aff: (v) => `−${pct(v)}` },
    { cle: 'commission.part_premiere_facture', lib: t('grille.premiere_facture'), aide: t('grille.premiere_facture_aide'), aff: pct },
  ];
  const tarifs = (cat.data ?? []).filter((p) => p.cle.startsWith('tarif.'));
  const preparer = () => setEd({ date_effet: new Date(Date.now() + 86400000).toISOString().slice(0, 10), commentaire: '',
    tranches: bareme.map((x) => ({ jusqu_a: x.jusqu_a === null ? '' : String(x.jusqu_a), taux: String(Number((x.taux * 100).toFixed(4))) })) });
  const enregistrer = async () => {
    if (!ed) return;
    const tranches = ed.tranches.map((x, i) => ({ jusqu_a: i === ed.tranches.length - 1 ? null : Number(x.jusqu_a.replace(/\s/g, '')), taux: Number((Number(x.taux.replace(',', '.')) / 100).toFixed(6)) }));
    // Contrôle de saisie : bornes croissantes, dernière tranche ouverte, taux entre 0 et 100 % ; la base revalide (validateur bareme_commission).
    const v = z.object({ cle: z.literal('commission.bareme'), valeur: z.array(z.object({ jusqu_a: z.number().positive().max(1e13).nullable(), taux: z.number().min(0).max(1) }).strict()).min(1).max(20),
      date_effet: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), commentaire: z.string().trim().min(3).max(500) }).strict()
      .refine((x) => x.valeur.every((y, i) => i === 0 || y.jusqu_a === null || (x.valeur[i - 1].jusqu_a ?? Infinity) < y.jusqu_a))
      .safeParse({ cle: 'commission.bareme', valeur: tranches, date_effet: ed.date_effet, commentaire: ed.commentaire });
    if (!v.success) { a.setErreur(t('grille.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('parametres').insert(v.data)))) { setEd(null); void cat.recharger(); void versions.recharger(); }
  };
  let bas = 0;
  return (
    <div className="grl">
      <p className="mute">{t('grille.aide')}</p>
      <Bandeau type="err">{cat.erreur ?? versions.erreur ?? a.erreur}</Bandeau>
      <div className="grl-grille">
        <section className="grl-carte">
          <div className="liv-pv"><b className="liv-client">{t('grille.commission')}</b>
            {enVigueur >= 0 && <span className="mute">{t('grille.version', { v: nbV - enVigueur, d: date(versions.data![enVigueur].date_effet, langue) })}</span>}</div>
          <table className="t"><thead><tr><th>{t('grille.valeur_fob')}</th><th className="num">{t('grille.taux')}</th></tr></thead>
            <tbody>{bareme.map((x, i) => {
              const lib = x.jusqu_a === null ? t('grille.au_dela', { m: mx(bas) }) : i === 0 ? t('grille.jusqu_a', { m: mx(x.jusqu_a) }) : t('grille.de_a', { de: mx(bas), a: mx(x.jusqu_a) });
              if (x.jusqu_a !== null) bas = x.jusqu_a;
              return <tr key={i}><td>{lib}</td><td className="num"><b>{pct(x.taux)}</b></td></tr>;
            })}</tbody></table>
          <p className="mute">{t('grille.lecture')}</p>
          <div className="section-titre">{t('grille.regles')}</div>
          {regles.map((r) => { const p = val(r.cle); return (
            <div key={r.cle} className="grl-regle"><span><b>{r.lib}</b><span className="mute">{r.aide}</span></span><b>{p && typeof p.valeur === 'number' ? r.aff(p.valeur) : '—'}</b></div>); })}
          {admin && <Bouton variante="primaire" onClick={preparer}>{t('grille.preparer')}</Bouton>}
        </section>
        <aside className="exp-aside">
          <section>
            <div className="surtitre">{t('grille.historique')}</div>
            {(versions.data ?? []).map((v, i) => (
              <div key={v.id} className="grl-version"><b>v{nbV - i}</b><span>{date(v.date_effet, langue)}{i === enVigueur && <> · <span className="txt-ok">{t('grille.en_vigueur')}</span></>}
                {v.date_effet > new Date().toISOString().slice(0, 10) && <> · <span className="txt-att">{t('grille.a_venir')}</span></>}
                <span className="mute">{v.commentaire ?? ''}{v.cree_par ? ` · ${(noms.data ?? []).find((n) => n.id === v.cree_par)?.nom ?? ''}` : ''}</span></span></div>))}
          </section>
          <section>
            <div className="surtitre">{t('grille.autres_tarifs')}</div>
            {tarifs.map((p) => <div key={p.cle} className="grl-regle"><span>{p.libelle}</span><b>{afficherParam(p, langue)}</b></div>)}
            <span className="mute">{t('grille.modifier_ailleurs')}</span>
          </section>
        </aside>
      </div>
      {ed && (
        <Tiroir titre={t('grille.preparer')} onClose={() => setEd(null)}>
          <p className="sec">{t('grille.aide_version')}</p>
          {ed.tranches.map((x, i) => (
            <div key={i} className="grille3" style={{ gridTemplateColumns: '1fr 120px auto', alignItems: 'end' }}>
              <Champ label={i === ed.tranches.length - 1 ? t('grille.tranche_ouverte') : t('grille.jusqu_a_xof')}>
                <input inputMode="numeric" disabled={i === ed.tranches.length - 1} value={i === ed.tranches.length - 1 ? '' : x.jusqu_a}
                  onChange={(e) => setEd({ ...ed, tranches: ed.tranches.map((y, j) => (j === i ? { ...y, jusqu_a: e.target.value.replace(/[^\d\s]/g, '') } : y)) })} /></Champ>
              <Champ label={t('grille.taux_pct')}><input inputMode="decimal" value={x.taux} onChange={(e) => setEd({ ...ed, tranches: ed.tranches.map((y, j) => (j === i ? { ...y, taux: e.target.value } : y)) })} /></Champ>
              <Bouton petit disabled={ed.tranches.length <= 1} onClick={() => setEd({ ...ed, tranches: ed.tranches.filter((_, j) => j !== i) })}>{t('grille.retirer')}</Bouton>
            </div>))}
          <Bouton petit disabled={ed.tranches.length >= 20} onClick={() => setEd({ ...ed, tranches: [...ed.tranches.slice(0, -1), { jusqu_a: '', taux: '' }, ...ed.tranches.slice(-1)] })}>{t('grille.ajouter_tranche')}</Bouton>
          <Champ label={t('parametrage.date_effet')}><input type="date" value={ed.date_effet} onChange={(e) => setEd({ ...ed, date_effet: e.target.value })} /></Champ>
          <Champ label={t('grille.motif')}><input value={ed.commentaire} maxLength={500} onChange={(e) => setEd({ ...ed, commentaire: e.target.value })} /></Champ>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
        </Tiroir>
      )}
    </div>
  );
}

interface ParamCatalogue { cle: string; definition: string; type: 'taux' | 'nombre' | 'entier' | 'json'; minimum: number | null; maximum: number | null;
  module: string; libelle: string; valeur: unknown; date_effet: string; commentaire: string | null }
interface Saisie { cle: string; type: ParamCatalogue['type']; libelle: string; minimum: number | null; maximum: number | null; valeur: string; date_effet: string; commentaire: string }

/** Valeur lisible : les taux en pourcentage, les nombres formatés, le JSON abrégé. */
function afficherParam(p: { type: string; valeur: unknown }, langue: string) {
  if (p.type === 'taux' && typeof p.valeur === 'number') return `${(p.valeur * 100).toLocaleString(langue, { maximumFractionDigits: 4 })} %`;
  if (typeof p.valeur === 'number') return p.valeur.toLocaleString(langue);
  return JSON.stringify(p.valeur).slice(0, 120);
}

function Parametres() {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const l = useAsync(async () => ok(await supabase.rpc('catalogue_parametres')) as ParamCatalogue[], []);
  const [filtre, setFiltre] = useState('');
  const [f, setF] = useState<Saisie | null>(null);
  const h = useAsync(async () => (f ? ok(await supabase.from('parametres').select('*').eq('cle', f.cle).order('date_effet', { ascending: false })) as Parametre[] : []), [f?.cle]);
  const a = useAction();
  const aujourdhui = () => new Date().toISOString().slice(0, 10);
  const ouvrir = (p: ParamCatalogue) => setF({ cle: p.cle, type: p.type, libelle: p.libelle, minimum: p.minimum, maximum: p.maximum, date_effet: aujourdhui(), commentaire: '',
    valeur: p.type === 'taux' && typeof p.valeur === 'number' ? String(Number((p.valeur * 100).toFixed(6))) : p.type === 'json' ? JSON.stringify(p.valeur, null, 2) : String(p.valeur) });
  const enregistrer = async () => {
    if (!f) return;
    let val: unknown;
    if (f.type === 'json') {
      try { val = JSON.parse(f.valeur); } catch { a.setErreur(t('parametrage.json_invalide')); return; }
    } else {
      const n = Number(f.valeur.replace(',', '.').trim());
      // Le taux se saisit en pourcentage : 25 signifie 25 %, enregistré 0,25.
      val = f.type === 'taux' ? Number((n / 100).toFixed(8)) : n;
      if (f.valeur.trim() === '' || !Number.isFinite(n) || (f.type === 'entier' && !Number.isInteger(n))) { a.setErreur(t('formulaire.invalide')); return; }
    }
    // Contrôle indicatif ; la base applique la définition (type, bornes, validateur) et refuse le reste.
    const v = z.object({ cle: z.string().regex(/^[a-zA-Z0-9_.]{2,80}$/), valeur: z.unknown(), date_effet: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), commentaire: z.string().max(500).nullable() }).strict()
      .safeParse({ cle: f.cle.trim(), valeur: val, date_effet: f.date_effet, commentaire: f.commentaire.trim() || null });
    if (!v.success || JSON.stringify(val).length > 10000) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('parametres').insert(v.data)))) { setF(null); void l.recharger(); }
  };
  const q = filtre.trim().toLowerCase();
  const liste = (l.data ?? []).filter((p) => !q || p.cle.toLowerCase().includes(q) || p.libelle.toLowerCase().includes(q));
  const modules = [...new Set(liste.map((p) => p.module))];
  const bornes = f && f.type !== 'json' && (f.minimum != null || f.maximum != null)
    ? t('parametrage.bornes', { min: f.type === 'taux' ? `${(f.minimum ?? 0) * 100} %` : f.minimum ?? '—', max: f.type === 'taux' ? `${(f.maximum ?? 0) * 100} %` : f.maximum ?? '—' }) : '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p className="mute">{t('parametrage.aide')}</p>
      <div className="actions">
        <input placeholder={t('parametrage.filtrer')} aria-label={t('parametrage.filtrer')} maxLength={80} value={filtre} onChange={(e) => setFiltre(e.target.value)} />
        <Bouton petit onClick={() => setF({ cle: '', type: 'json', libelle: '', minimum: null, maximum: null, valeur: '', date_effet: aujourdhui(), commentaire: '' })}>{t('parametrage.nouvelle_cle')}</Bouton>
      </div>
      <Bandeau type="err">{l.erreur}</Bandeau>
      {modules.map((m) => (
        <section key={m} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="section-titre">{t(`parametrage.modules.${m}`, { defaultValue: m })}</div>
          <table className="t"><thead><tr><th>{t('parametrage.libelle')}</th><th>{t('parametrage.valeur')}</th><th>{t('parametrage.date_effet')}</th><th>{t('champs.commentaire')}</th><th /></tr></thead>
            <tbody>{liste.filter((p) => p.module === m).map((p) => (
              <tr key={p.cle}><td>{p.libelle}<div className="mute ref">{p.cle}</div></td>
                <td><code style={{ fontSize: 12 }}>{afficherParam(p, langue)}</code></td><td className="ref">{date(p.date_effet, langue)}</td>
                <td className="mute">{p.commentaire ?? ''}</td>
                <td className="num"><Bouton petit onClick={() => ouvrir(p)}>{t('parametrage.nouvelle_valeur')}</Bouton></td></tr>))}</tbody></table>
        </section>
      ))}
      {f && (
        <Tiroir titre={t('parametrage.nouvelle_valeur')} onClose={() => setF(null)}>
          <p className="sec">{t('parametrage.aide_date')}</p>
          {f.libelle ? <Champ label={t('parametrage.cle')}><div>{f.libelle}<div className="mute ref">{f.cle}</div></div></Champ>
            : <Champ label={t('parametrage.cle')}><input value={f.cle} maxLength={80} onChange={(e) => setF({ ...f, cle: e.target.value })} /><div className="mute">{t('parametrage.aide_cle')}</div></Champ>}
          {f.type === 'json'
            ? <Champ label={t('parametrage.valeur_json')}><textarea rows={8} value={f.valeur} maxLength={10000} onChange={(e) => setF({ ...f, valeur: e.target.value })} /></Champ>
            : <Champ label={f.type === 'taux' ? t('parametrage.valeur_pourcent') : t('parametrage.valeur')}>
                <input inputMode="decimal" value={f.valeur} onChange={(e) => setF({ ...f, valeur: e.target.value })} />{bornes && <div className="mute">{bornes}</div>}</Champ>}
          <Champ label={t('parametrage.date_effet')}><input type="date" value={f.date_effet} onChange={(e) => setF({ ...f, date_effet: e.target.value })} /></Champ>
          <Champ label={t('champs.commentaire')}><input value={f.commentaire} maxLength={500} onChange={(e) => setF({ ...f, commentaire: e.target.value })} /></Champ>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
          {(h.data ?? []).length > 0 && (
            <table className="t" style={{ marginTop: 12 }}><thead><tr><th>{t('parametrage.historique')}</th><th>{t('parametrage.date_effet')}</th></tr></thead>
              <tbody>{(h.data ?? []).map((x) => (
                <tr key={x.id}><td><code style={{ fontSize: 12 }}>{afficherParam({ type: f.type, valeur: x.valeur }, langue)}</code>{x.commentaire && <div className="mute">{x.commentaire}</div>}</td>
                  <td className="ref">{date(x.date_effet, langue)}</td></tr>))}</tbody></table>
          )}
        </Tiroir>
      )}
    </div>
  );
}

function Taux() {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const l = useAsync(async () => ok(await supabase.from('taux_change').select('*').order('date_taux', { ascending: false }).limit(200)) as { devise: string; date_taux: string; taux_xof: number; source: string | null }[], []);
  const [f, setF] = useState({ devise: 'USD', date_taux: new Date().toISOString().slice(0, 10), taux_xof: '', source: '' });
  const a = useAction();
  const ajouter = async () => {
    const v = z.object({ devise: z.enum(['USD', 'CNY', 'EUR', 'XAF']), date_taux: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), taux_xof: z.number().positive().max(1e6), source: z.string().max(120).nullable() }).strict()
      .safeParse({ ...f, taux_xof: Number(f.taux_xof.replace(',', '.')), source: f.source || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('taux_change').insert(v.data)))) { setF({ ...f, taux_xof: '' }); void l.recharger(); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p className="mute">{t('parametrage.aide_taux')}</p>
      <div className="grille3" style={{ alignItems: 'end', gridTemplateColumns: '1fr 1fr 1fr 2fr auto' }}>
        <Champ label={t('champs.devise')}><select value={f.devise} onChange={(e) => setF({ ...f, devise: e.target.value })}>{['USD', 'CNY', 'EUR', 'XAF'].map((d) => <option key={d}>{d}</option>)}</select></Champ>
        <Champ label={t('champs.date')}><input type="date" value={f.date_taux} onChange={(e) => setF({ ...f, date_taux: e.target.value })} /></Champ>
        <Champ label={t('parametrage.taux_xof')}><input inputMode="decimal" value={f.taux_xof} onChange={(e) => setF({ ...f, taux_xof: e.target.value })} /></Champ>
        <Champ label={t('parametrage.source')}><input value={f.source} maxLength={120} onChange={(e) => setF({ ...f, source: e.target.value })} /></Champ>
        <Bouton onClick={() => void ajouter()}>{t('commun.ajouter')}</Bouton>
      </div>
      <Bandeau type="err">{a.erreur ?? l.erreur}</Bandeau>
      <table className="t"><thead><tr><th>{t('champs.devise')}</th><th>{t('champs.date')}</th><th className="num">1 = … XOF</th><th>{t('parametrage.source')}</th></tr></thead>
        <tbody>{(l.data ?? []).map((x) => <tr key={x.devise + x.date_taux}><td>{x.devise}</td><td className="ref">{date(x.date_taux, langue)}</td><td className="num">{x.taux_xof}</td><td className="mute">{x.source ?? ''}</td></tr>)}</tbody></table>
    </div>
  );
}

const ROLES = ['admin', 'achats_chine', 'hub_afrique', 'agent_pays', 'inspecteur', 'comptable'] as const;

function Utilisateurs() {
  const { t } = useTranslation();
  const { societes } = useAuth();
  const l = useAsync(async () => ok(await supabase.from('profils').select('*').order('nom')) as Profil[], []);
  const [sel, setSel] = useState<Profil | null>(null);
  const a = useAction();
  const enregistrer = async () => {
    if (!sel) return;
    const v = z.object({ role: z.enum(ROLES).nullable(), societes: z.array(z.string().uuid()), pays: z.string().regex(/^[A-Z]{2}$/).nullable(), delegue: z.boolean(), actif: z.boolean() })
      .safeParse({ role: sel.role, societes: sel.societes, pays: sel.pays || null, delegue: sel.delegue_validation, actif: sel.actif });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('admin_definir_profil', { p_user: sel.id, p_role: v.data.role, p_societes: v.data.societes, p_pays: v.data.pays, p_delegue: v.data.delegue, p_actif: v.data.actif })))) { setSel(null); void l.recharger(); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p className="mute">{t('parametrage.aide_utilisateurs')}</p>
      <Bandeau type="err">{l.erreur}</Bandeau>
      <table className="t"><thead><tr><th>{t('champs.nom')}</th><th>E-mail</th><th>{t('parametrage.role')}</th><th>{t('parametrage.societes')}</th><th>{t('parametrage.delegue')}</th><th>{t('champs.statut')}</th></tr></thead>
        <tbody>{(l.data ?? []).map((p) => (
          <tr key={p.id} className="cliquable" onClick={() => setSel({ ...p })}><td>{p.nom}</td><td className="sec">{p.email}</td><td>{p.role ? t(`roles.${p.role}`) : t('parametrage.sans_role')}</td>
            <td className="sec">{p.societes.map((s) => societes.find((x) => x.id === s)?.code).filter(Boolean).join(', ')}</td><td>{p.delegue_validation ? t('commun.oui') : '—'}</td>
            <td><Statut statut={p.actif ? 'validee' : 'annulee'} libelle={p.actif ? t('parametrage.actif') : t('parametrage.inactif')} /></td></tr>))}</tbody></table>
      {sel && (
        <Tiroir titre={sel.nom} onClose={() => setSel(null)}>
          <Champ label={t('parametrage.role')}><select value={sel.role ?? ''} onChange={(e) => setSel({ ...sel, role: (e.target.value || null) as Profil['role'] })}>
            <option value="">{t('parametrage.sans_role')}</option>{ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}</select></Champ>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <legend className="sec" style={{ marginBottom: 6 }}>{t('parametrage.societes')}</legend>
            {societes.map((s) => (
              <label key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={sel.societes.includes(s.id)} onChange={(e) => setSel({ ...sel, societes: e.target.checked ? [...sel.societes, s.id] : sel.societes.filter((x) => x !== s.id) })} />
                {s.raison_sociale}</label>))}
          </fieldset>
          {sel.role === 'agent_pays' && <Champ label={t('champs.pays')}><select value={sel.pays ?? ''} onChange={(e) => setSel({ ...sel, pays: e.target.value || null })}>
            <option value="">—</option><option value="GA">GA</option><option value="CM">CM</option></select></Champ>}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={sel.delegue_validation} onChange={(e) => setSel({ ...sel, delegue_validation: e.target.checked })} />{t('parametrage.delegue_aide')}</label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={sel.actif} onChange={(e) => setSel({ ...sel, actif: e.target.checked })} />{t('parametrage.actif')}</label>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
        </Tiroir>
      )}
    </div>
  );
}

function Societes() {
  const { t } = useTranslation();
  const { societes, langue } = useAuth();
  const nom = (id: string) => societes.find((s) => s.id === id)?.raison_sociale ?? '';
  const r = useAsync(async () => ok(await supabase.from('rattachements_pays').select('*').order('pays').order('date_effet', { ascending: false })) as
    { id: string; pays: string; societe_id: string; date_effet: string; commentaire: string | null }[], []);
  const a = useAction();
  const [f, setF] = useState({ pays: '', societe_id: '', date_effet: new Date().toISOString().slice(0, 10), commentaire: '' });
  const ajouter = async () => {
    const v = z.object({ pays: z.string().regex(/^([A-Z]{2}|defaut)$/), societe_id: z.string().uuid(), date_effet: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      commentaire: z.string().max(500).nullable() }).strict()
      .safeParse({ ...f, pays: f.pays.trim() === 'defaut' ? 'defaut' : f.pays.trim().toUpperCase(), commentaire: f.commentaire.trim() || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('rattachements_pays').insert(v.data)))) { setF({ ...f, pays: '', commentaire: '' }); void r.recharger(); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <table className="t"><thead><tr><th>{t('champs.raison_sociale')}</th><th>{t('champs.pays')}</th><th>{t('champs.devise')}</th><th>{t('parametrage.creee_le')}</th><th>FNE</th></tr></thead>
        <tbody>{societes.map((s) => <tr key={s.id}><td>{s.raison_sociale}</td><td>{s.pays}</td><td>{s.devise}</td><td className="ref">{date(s.date_creation, langue)}</td><td>{s.fne ? t('commun.oui') : '—'}</td></tr>)}</tbody></table>
      <div className="section-titre">{t('parametrage.rattachements')}</div>
      <p className="mute">{t('parametrage.aide_rattachements')}</p>
      <Bandeau type="err">{r.erreur ?? a.erreur}</Bandeau>
      <table className="t"><thead><tr><th>{t('champs.pays')}</th><th>{t('champs.raison_sociale')}</th><th>{t('parametrage.date_effet')}</th><th>{t('champs.commentaire')}</th></tr></thead>
        <tbody>{(r.data ?? []).map((x) => (
          <tr key={x.id}><td className="ref">{x.pays === 'defaut' ? t('parametrage.autres_pays') : x.pays}</td><td>{nom(x.societe_id)}</td>
            <td className="ref">{date(x.date_effet, langue)}</td><td className="mute">{x.commentaire ?? ''}</td></tr>))}</tbody></table>
      <div className="actions" style={{ flexWrap: 'wrap' }}>
        <input placeholder={t('parametrage.code_pays')} aria-label={t('champs.pays')} maxLength={6} value={f.pays} onChange={(e) => setF({ ...f, pays: e.target.value })} style={{ width: 120 }} />
        <select aria-label={t('champs.raison_sociale')} value={f.societe_id} onChange={(e) => setF({ ...f, societe_id: e.target.value })}>
          <option value="">—</option>{societes.map((s) => <option key={s.id} value={s.id}>{s.raison_sociale}</option>)}</select>
        <input type="date" aria-label={t('parametrage.date_effet')} value={f.date_effet} onChange={(e) => setF({ ...f, date_effet: e.target.value })} />
        <input placeholder={t('champs.commentaire')} aria-label={t('champs.commentaire')} maxLength={500} value={f.commentaire} onChange={(e) => setF({ ...f, commentaire: e.target.value })} />
        <Bouton petit disabled={a.enCours} onClick={() => void ajouter()}>{t('parametrage.nouvelle_valeur')}</Bouton>
      </div>
    </div>
  );
}
