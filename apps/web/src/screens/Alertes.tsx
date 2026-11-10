// Supervision · Alertes (maquette « Alertes ») : les échéances de tous les modules qui attendent une action.
// Mêmes définitions que le compteur de l'en-tête (tableau_de_bord) ; chaque source est filtrée par les
// règles de lecture de la base, donc chacun ne voit que ce qui le concerne.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, montant } from '../lib/format';
import { Bandeau, Chargement, Entete, Onglets, Statut, Vide } from '../components/ui';
import { fermeturesEnAlerte, lireCommandesFermetures } from '../lib/fermetures';

type Categorie = 'point_bloquant' | 'retard_paiement' | 'fne' | 'paiement_a_valider' | 'due_diligence' | 'fermeture_usine';
interface Alerte { id: string; categorie: Categorie; critique: boolean; titre: string; detail: string; echeance: string | null; module: string; reference: string; lien: string }
const CATEGORIES: Categorie[] = ['point_bloquant', 'retard_paiement', 'fne', 'paiement_a_valider', 'due_diligence', 'fermeture_usine'];

const jour = () => new Date().toISOString().slice(0, 10);
const ecart = (d: string | null) => (d ? Math.round((Date.parse(d.slice(0, 10)) - Date.parse(jour())) / 86400000) : null);

export function Alertes() {
  const { t } = useTranslation();
  const { langue, societeActive } = useAuth();
  const l = useAsync(async () => {
    const auj = jour();
    const dans60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    // Chaque source est lue séparément : une source interdite au rôle revient vide, sans bloquer les autres.
    // Un refus de droits (42501) vide la source sans alerte ; toute autre erreur est comptée et signalée.
    let echecs = 0;
    const lire = async <T,>(q: PromiseLike<{ data: unknown; error: { code?: string } | null }>) => {
      const r = await q;
      if (r.error) { if (r.error.code !== '42501') echecs += 1; return [] as T[]; }
      return r.data as T[];
    };
    // Seuils « critique » : paramètres datés (validés par la direction), lus avec les autres sources.
    const prm = await lire<{ cle: string; valeur: unknown; date_effet: string }>(supabase.from('parametres').select('cle, valeur, date_effet')
      .in('cle', ['alertes.retard_critique_jours', 'alertes.dd_critique_jours']).lte('date_effet', auj).order('date_effet', { ascending: false }));
    const prmNum = (cle: string, defaut: number) => { const v = prm.find((x) => x.cle === cle)?.valeur; return typeof v === 'number' ? v : defaut; };
    const seuilRetard = prmNum('alertes.retard_critique_jours', 30), seuilDd = prmNum('alertes.dd_critique_jours', 15);
    const [pb, fr, fne, pay, dd, fe] = await Promise.all([
      lire<{ id: string; description: string; categorie: string; echeance: string; escalade_le: string; dossier_id: string; dossiers: { reference: string; societe_id: string } | null }>(
        supabase.from('points_bloquants').select('id, description, categorie, echeance, escalade_le, dossier_id, dossiers(reference, societe_id)').is('resolu_le', null).not('escalade_le', 'is', null).limit(200)),
      lire<{ id: string; numero: string | null; echeance: string; net_a_payer: number; encaisse: number; devise: string; societe_id: string; clients: { raison_sociale: string } | null }>(
        supabase.from('factures').select('id, numero, echeance, net_a_payer, encaisse, devise, societe_id, clients(raison_sociale)').in('statut', ['emise', 'partiellement_payee']).lt('echeance', auj).limit(200)),
      lire<{ id: string; numero: string | null; date_emission: string | null; ttc: number; devise: string; societe_id: string; clients: { raison_sociale: string } | null }>(
        supabase.from('factures').select('id, numero, date_emission, ttc, devise, societe_id, clients(raison_sociale)').eq('statut', 'en_attente_fne').limit(200)),
      lire<{ id: string; reference: string | null; nature: string; montant: number; devise: string; cree_le: string; dossiers: { reference: string } | null }>(
        supabase.from('paiements_fournisseurs').select('id, reference, nature, montant, devise, cree_le, dossiers(reference)').eq('statut', 'prepare').limit(200)),
      lire<{ id: string; reference: string | null; fournisseur_id: string; valide_jusqu_au: string; fournisseurs: { raison_sociale_en: string } | null }>(
        supabase.from('due_diligences').select('id, reference, fournisseur_id, valide_jusqu_au, fournisseurs(raison_sociale_en)').eq('statut', 'validee').gte('valide_jusqu_au', auj).lte('valide_jusqu_au', dans60).limit(200)),
      lireCommandesFermetures().then((r) => { if (r.erreur) echecs += 1; return fermeturesEnAlerte(r.rows, auj); }),
    ]);
    const a: Alerte[] = [
      ...pb.filter((x) => !societeActive || x.dossiers?.societe_id === societeActive).map((x) => ({
        id: `pb-${x.id}`, categorie: 'point_bloquant' as const, critique: true, titre: t('alertes.pb_titre', { ref: x.dossiers?.reference ?? '' }),
        detail: x.description, echeance: x.echeance, module: 'dossiers', reference: x.dossiers?.reference ?? '', lien: '/points-bloquants' })),
      ...fr.filter((x) => !societeActive || x.societe_id === societeActive).map((x) => ({
        id: `fr-${x.id}`, categorie: 'retard_paiement' as const, critique: (ecart(x.echeance) ?? 0) < -seuilRetard, titre: t('alertes.fr_titre', { ref: x.numero ?? '—', d: date(x.echeance, langue) }),
        detail: `${x.clients?.raison_sociale ?? '—'} · ${montant(Number(x.net_a_payer) - Number(x.encaisse), x.devise, langue)}`, echeance: x.echeance, module: 'finance', reference: x.numero ?? '', lien: `/factures/${x.id}` })),
      ...fne.filter((x) => !societeActive || x.societe_id === societeActive).map((x) => ({
        id: `fne-${x.id}`, categorie: 'fne' as const, critique: false, titre: t('alertes.fne_titre', { ref: x.numero ?? '—' }),
        detail: `${x.clients?.raison_sociale ?? '—'} · ${montant(Number(x.ttc), x.devise, langue)}`, echeance: x.date_emission, module: 'finance', reference: x.numero ?? '', lien: `/factures/${x.id}` })),
      ...pay.map((x) => ({
        id: `pay-${x.id}`, categorie: 'paiement_a_valider' as const, critique: false, titre: t('alertes.pay_titre', { ref: x.reference ?? '—', nature: t(`alertes.natures.${x.nature}`) }),
        detail: `${x.dossiers?.reference ?? ''} · ${montant(Number(x.montant), x.devise, langue)}`, echeance: x.cree_le?.slice(0, 10) ?? null, module: 'finance', reference: x.reference ?? '', lien: '/paiements' })),
      ...dd.map((x) => ({
        id: `dd-${x.id}`, categorie: 'due_diligence' as const, critique: (ecart(x.valide_jusqu_au) ?? 9999) <= seuilDd, titre: t('alertes.dd_titre', { f: x.fournisseurs?.raison_sociale_en ?? '—', d: date(x.valide_jusqu_au, langue) }),
        detail: t('alertes.dd_detail', { ref: x.reference ?? '' }), echeance: x.valide_jusqu_au, module: 'achats', reference: x.reference ?? '', lien: `/fournisseurs/${x.fournisseur_id}` })),
      // Fermeture d'usine : critique quand elle a commencé (la production est déjà arrêtée).
      ...fe.map((x) => ({
        id: `fe-${x.fermeture_id}-${x.commande_id}`, categorie: 'fermeture_usine' as const, critique: x.du <= auj,
        titre: t('alertes.fe_titre', { ref: x.commande_reference, motif: x.motif }),
        detail: t('alertes.fe_detail', { f: x.fournisseur, n: x.jours_chevauches, d: date(x.livraison_promise, langue), dos: x.dossier_reference }),
        echeance: x.du, module: 'achats', reference: x.commande_reference, lien: `/commandes/${x.commande_id}` })),
    ];
    // Critiques d'abord, puis par échéance la plus ancienne.
    return { alertes: a.sort((x, y) => Number(y.critique) - Number(x.critique) || (x.echeance ?? '9').localeCompare(y.echeance ?? '9')), echecs };
  }, [societeActive, langue]);
  const [cat, setCat] = useState<Categorie | 'toutes'>('toutes');
  const [sel, setSel] = useState<string | null>(null);
  const tous = l.data?.alertes ?? [];
  const liste = cat === 'toutes' ? tous : tous.filter((x) => x.categorie === cat);
  const x = liste.find((y) => y.id === sel) ?? liste[0] ?? null;
  const critiques = tous.filter((y) => y.critique).length;
  const delai = (d: string | null) => { const e = ecart(d); return e === null ? '—' : e < 0 ? t('alertes.depassee', { n: -e }) : e === 0 ? t('alertes.aujourdhui') : t('alertes.dans', { n: e }); };
  return (
    <div className="screen">
      <Entete surtitre={t('modules.supervision')} titre={l.data ? t('alertes.titre', { n: tous.length, c: critiques }) : t('ecrans.alertes')} />
      <p className="sec" style={{ marginTop: -8 }}>{t('alertes.aide')}</p>
      <Bandeau type="err">{l.erreur ?? (l.data?.echecs ? t('alertes.sources_echec', { n: l.data.echecs }) : null)}</Bandeau>
      <Onglets actif={cat} onChange={(c) => { setCat(c); setSel(null); }} items={[{ id: 'toutes' as const, lib: `${t('alertes.toutes')} · ${tous.length}` },
        ...CATEGORIES.filter((c) => tous.some((y) => y.categorie === c)).map((c) => ({ id: c, lib: `${t(`alertes.categories.${c}`)} · ${tous.filter((y) => y.categorie === c).length}` }))]} />
      {l.chargement && !l.data ? <Chargement /> : tous.length === 0 ? <Vide>{t('alertes.aucune')}</Vide> : (
        <div className="ref-grille alr-grille">
          <div className="cadre alr-liste">
            {liste.map((y) => (
              <button key={y.id} type="button" className={'alr-ligne' + (x?.id === y.id ? ' choisi' : '') + (y.critique ? ' critique' : '')} onClick={() => setSel(y.id)}>
                <span className="alr-cat">{t(`alertes.categories.${y.categorie}`)}</span>
                <span className="alr-txt"><b>{y.titre}</b><span className="sec">{y.detail}</span></span>
                <span className="ref mute">{y.echeance ? date(y.echeance, langue) : '—'}</span>
              </button>))}
          </div>
          {x && (
            <aside className="exp-aside alr-detail">
              <section>
                <div className="liv-pv"><span className="surtitre">{t(`alertes.categories.${x.categorie}`)}</span>
                  <Statut statut={x.critique ? 'err' : 'att'} libelle={t(x.critique ? 'alertes.critique' : 'alertes.a_traiter')} /></div>
                <b className="liv-client">{x.titre}</b>
                <span className="sec">{x.detail}</span>
              </section>
              <section>
                <dl className="dl">
                  <dt>{t('alertes.echeance')}</dt><dd>{x.echeance ? date(x.echeance, langue) : '—'}</dd>
                  <dt>{t('alertes.delai')}</dt><dd className={(ecart(x.echeance) ?? 0) < 0 ? 'txt-err' : ''}>{delai(x.echeance)}</dd>
                  <dt>{t('journal.module')}</dt><dd>{t(`modules.${x.module}`)}</dd>
                  <dt>{t('alertes.reference')}</dt><dd className="ref">{x.reference || '—'}</dd>
                </dl>
                <p className="mute">{t(`alertes.actions.${x.categorie}`)}</p>
                <Link className="btn primaire" to={x.lien}>{t('alertes.ouvrir')}</Link>
              </section>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
