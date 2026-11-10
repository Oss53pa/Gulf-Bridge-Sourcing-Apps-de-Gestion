// Supervision · Recherche globale : tous les modules, selon les droits de lecture de la base.
// Chaque colonne est interrogée par un filtre « ilike » dont la valeur est passée en paramètre
// (aucun texte saisi n'est inséré dans la syntaxe de la requête) ; les jokers % et _ sont neutralisés.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync } from '../lib/data';
import { Bandeau, Chargement, Entete, Vide } from '../components/ui';

interface Resultat { cle: string; module: string; titre: string; sous: string; lien: string }
interface Source { module: string; table: string; colonnes: string[]; select: string; titre: (r: Rec) => string; sous: (r: Rec) => string; lien: (r: Rec) => string }
type Rec = Record<string, unknown> & { id: string };

const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const nom = (v: unknown, k: string) => (v && typeof v === 'object' ? s((v as Record<string, unknown>)[k]) : '');

/** Échappe les jokers du motif ilike : le texte saisi est cherché tel quel. */
export function motifRecherche(q: string) { return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`; }

const SOURCES: Source[] = [
  { module: 'commercial', table: 'clients', colonnes: ['raison_sociale', 'reference'], select: 'id, reference, raison_sociale, pays',
    titre: (r) => s(r.raison_sociale), sous: (r) => [s(r.reference), s(r.pays)].filter(Boolean).join(' · '), lien: (r) => `/clients/${r.id}` },
  { module: 'commercial', table: 'prospects', colonnes: ['raison_sociale', 'reference'], select: 'id, reference, raison_sociale',
    titre: (r) => s(r.raison_sociale), sous: (r) => s(r.reference), lien: (r) => `/prospection/${r.id}` },
  { module: 'commercial', table: 'appels_offres', colonnes: ['reference', 'objet', 'donneur_ordre'], select: 'id, reference, objet, donneur_ordre',
    titre: (r) => `${s(r.reference)} · ${s(r.donneur_ordre)}`, sous: (r) => s(r.objet), lien: (r) => `/appels-offres/${r.id}` },
  { module: 'dossiers', table: 'dossiers', colonnes: ['reference', 'intitule'], select: 'id, reference, intitule, clients(raison_sociale)',
    titre: (r) => `${s(r.reference)} · ${nom(r.clients, 'raison_sociale')}`, sous: (r) => s(r.intitule), lien: (r) => `/dossiers/${r.id}` },
  { module: 'achats', table: 'fournisseurs', colonnes: ['raison_sociale_en', 'raison_sociale_zh', 'reference'], select: 'id, reference, raison_sociale_en, raison_sociale_zh',
    titre: (r) => s(r.raison_sociale_en), sous: (r) => [s(r.reference), s(r.raison_sociale_zh)].filter(Boolean).join(' · '), lien: (r) => `/fournisseurs/${r.id}` },
  { module: 'achats', table: 'commandes', colonnes: ['reference'], select: 'id, reference, statut',
    titre: (r) => s(r.reference), sous: (r) => s(r.statut).replace(/_/g, ' '), lien: (r) => `/commandes/${r.id}` },
  { module: 'qualite', table: 'inspections', colonnes: ['reference', 'produit'], select: 'id, reference, produit',
    titre: (r) => s(r.reference), sous: (r) => s(r.produit), lien: (r) => `/inspections/${r.id}` },
  { module: 'qualite', table: 'non_conformites', colonnes: ['reference', 'description'], select: 'id, reference, description',
    titre: (r) => s(r.reference), sous: (r) => s(r.description).slice(0, 140), lien: () => '/non-conformites' },
  { module: 'logistique', table: 'expeditions', colonnes: ['reference', 'navire', 'numero_connaissement'], select: 'id, reference, port_arrivee, navire, numero_connaissement',
    titre: (r) => s(r.reference), sous: (r) => [s(r.port_arrivee), s(r.navire), s(r.numero_connaissement)].filter(Boolean).join(' · '), lien: (r) => `/expeditions/${r.id}` },
  { module: 'finance', table: 'factures', colonnes: ['numero', 'objet'], select: 'id, numero, objet, clients(raison_sociale)',
    titre: (r) => `${s(r.numero) || '—'} · ${nom(r.clients, 'raison_sociale')}`, sous: (r) => s(r.objet), lien: (r) => `/factures/${r.id}` },
];
const ESSAIS = ['GBS-2026', 'FNE-2026', 'EXP-', 'Foshan'];

export function Recherche() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') ?? '').trim().slice(0, 80);
  const [saisie, setSaisie] = useState(q);
  useEffect(() => setSaisie(q), [q]);
  const l = useAsync(async () => {
    if (q.length < 2) return { res: [] as Resultat[], echecs: 0 };
    let echecs = 0;
    const motif = motifRecherche(q);
    // Une requête par colonne ; une table interdite au rôle revient vide sans bloquer les autres.
    const lots = await Promise.all(SOURCES.flatMap((src) => src.colonnes.map(async (col) => {
      const r = await supabase.from(src.table).select(src.select).ilike(col, motif).limit(8);
      if (r.error) { if (r.error.code !== '42501') echecs += 1; return []; }
      return (r.data as unknown as Rec[]).map((x) => ({ cle: `${src.table}-${x.id}`, module: src.module, titre: src.titre(x), sous: src.sous(x), lien: src.lien(x) }));
    })));
    const vus = new Set<string>();
    return { res: lots.flat().filter((x) => (vus.has(x.cle) ? false : (vus.add(x.cle), true))), echecs };
  }, [q]);
  const res = l.data?.res ?? [];
  const modules = [...new Set(SOURCES.map((x) => x.module))].filter((m) => res.some((r) => r.module === m));
  const lancer = (v: string) => { const x = v.trim().slice(0, 80); if (x.length >= 2) setParams({ q: x }); };
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.supervision')} · ${t('recherche.tous_modules')}`} titre={t('ecrans.recherche')} />
      <form className="rch-form" role="search" onSubmit={(e) => { e.preventDefault(); lancer(saisie); }}>
        <input className="search" value={saisie} maxLength={80} autoFocus placeholder={t('recherche.placeholder')} aria-label={t('recherche.placeholder')} onChange={(e) => setSaisie(e.target.value)} />
      </form>
      <div className="rch-essais"><span className="mute">{t('recherche.essayez')}</span>
        {ESSAIS.map((e) => <button key={e} type="button" className="chip" onClick={() => { setSaisie(e); lancer(e); }}>{e}</button>)}</div>
      <Bandeau type="err">{l.erreur ?? (l.data?.echecs ? t('alertes.sources_echec', { n: l.data.echecs }) : null)}</Bandeau>
      {q.length < 2 ? <p className="mute">{t('recherche.aide')}</p> : l.chargement && !l.data ? <Chargement /> : res.length === 0 ? <Vide>{t('recherche.aucun', { q })}</Vide> : <>
        <p className="sec">{t('recherche.resultats', { n: res.length, m: modules.length })}</p>
        <div className="rch-groupes">
          {modules.map((m) => (
            <section key={m} className="rch-groupe">
              <div className="surtitre">{t(`modules.${m}`)} · {res.filter((r) => r.module === m).length}</div>
              {res.filter((r) => r.module === m).map((r) => (
                <Link key={r.cle} to={r.lien} className="rch-ligne"><span><b>{r.titre}</b><span className="sec">{r.sous}</span></span><span aria-hidden="true">→</span></Link>))}
            </section>))}
        </div>
      </>}
      <p className="mute">{t('recherche.droits')}</p>
    </div>
  );
}
