// Achats Chine · calendrier des fermetures d'usines (maquette « FRM », cahier des charges M7).
// Les commandes touchées sont calculées par la base (gbs.commandes_fermetures) ; saisie et annulation
// passent par des fonctions réservées à l'administratrice et aux achats Chine.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date } from '../lib/format';
import { useNoms } from '../lib/referentiels';
import type { CommandeTouchee } from '../lib/fermetures';
import { Bandeau, Bouton, Champ, Chargement, Entete, Onglets, Statut, Tiroir, Vide } from '../components/ui';

interface Fermeture { id: string; fournisseur_id: string | null; motif: string; du: string; au: string; annulee_le: string | null; motif_annulation: string | null }

const jour = () => new Date().toISOString().slice(0, 10);
const jours = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

const Saisie = z.object({
  fournisseur_id: z.string().uuid().nullable(),
  motif: z.string().trim().min(3).max(160),
  du: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  au: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict().refine((x) => x.au >= x.du && jours(x.du, x.au) < 120);

export function Fermetures() {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const fournisseurs = useNoms('fournisseurs');
  const l = useAsync(async () => ok(await supabase.from('fermetures_usines').select('id, fournisseur_id, motif, du, au, annulee_le, motif_annulation')
    .order('du', { ascending: true }).limit(500)) as Fermeture[], []);
  const touchees = useAsync(async () => ok(await supabase.rpc('commandes_fermetures')) as CommandeTouchee[], []);
  const [vue, setVue] = useState<'actives' | 'annulees'>('actives');
  const [nouvelle, setNouvelle] = useState(false);
  const [annuler, setAnnuler] = useState<Fermeture | null>(null);
  const auj = jour();
  const actives = (l.data ?? []).filter((x) => !x.annulee_le);
  const liste = vue === 'actives' ? actives : (l.data ?? []).filter((x) => x.annulee_le);
  const parFermeture = (id: string) => (touchees.data ?? []).filter((x) => x.fermeture_id === id);
  const dossiersDe = (id: string) => [...new Map(parFermeture(id).map((x) => [x.dossier_id, x.dossier_reference])).entries()];
  // Titre : la prochaine fermeture (en cours ou à venir) qui touche au moins un dossier.
  const prochaine = actives.find((x) => x.au >= auj && dossiersDe(x.id).length > 0);
  const recharger = () => { void l.recharger(); void touchees.recharger(); };
  const statut = (x: Fermeture) => {
    if (x.annulee_le) return <Statut statut="neutre" libelle={t('fermetures.annulee')} />;
    if (x.au < auj) return <Statut statut="neutre" libelle={t('fermetures.passee')} />;
    if (x.du <= auj) return <Statut statut="err" libelle={t('fermetures.en_cours')} />;
    const n = jours(auj, x.du);
    return n <= 120 ? <Statut statut="att" libelle={t('fermetures.dans', { n })} /> : <Statut statut="info" libelle={t('fermetures.planifiee')} />;
  };
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.achats')} · ${t('fermetures.surtitre')} · FRM`}
        titre={!l.data ? t('ecrans.fermetures') : prochaine
          ? t('fermetures.titre', { motif: prochaine.motif, du: date(prochaine.du, langue), au: date(prochaine.au, langue), n: dossiersDe(prochaine.id).length })
          : t('fermetures.titre_aucun', { n: actives.filter((x) => x.au >= auj).length })}
        actions={<Bouton variante="primaire" onClick={() => setNouvelle(true)}>{t('fermetures.ajouter')}</Bouton>} />
      <Bandeau>{t('fermetures.conseil')}</Bandeau>
      <Bandeau type="err">{l.erreur ?? touchees.erreur}</Bandeau>
      <Onglets actif={vue} onChange={setVue} items={[{ id: 'actives', lib: t('fermetures.actives') }, { id: 'annulees', lib: t('fermetures.annulees') }]} />
      <div className="cadre">
        {l.chargement && !l.data ? <Chargement /> : liste.length === 0 ? <Vide>{t('fermetures.aucune')}</Vide> : (
          <table className="t">
            <thead><tr><th>{t('fermetures.usine')}</th><th>{t('fermetures.motif')}</th><th>{t('fermetures.du')}</th><th>{t('fermetures.au')}</th>
              <th className="num">{t('fermetures.duree')}</th><th>{t('fermetures.dossiers_touches')}</th><th>{t('fermetures.statut')}</th><th /></tr></thead>
            <tbody>{liste.map((x) => {
              const ds = dossiersDe(x.id), cs = parFermeture(x.id);
              return (
                <tr key={x.id}>
                  <td>{x.fournisseur_id ? fournisseurs[x.fournisseur_id] ?? '—' : t('fermetures.toutes_usines')}</td>
                  <td>{x.motif}{x.motif_annulation && <div className="mute">{x.motif_annulation}</div>}</td>
                  <td className="ref nowrap">{date(x.du, langue)}</td>
                  <td className="ref nowrap">{date(x.au, langue)}</td>
                  <td className="num">{t('fermetures.n_jours', { n: jours(x.du, x.au) + 1 })}</td>
                  <td>{x.annulee_le || ds.length === 0 ? <span className="mute">—</span> : (<>
                    {ds.map(([id, ref], i) => <span key={id}>{i > 0 && ', '}<Link to={`/dossiers/${id}`}>{ref}</Link></span>)}
                    <div className="mute">{cs.map((c) => t('fermetures.commande_jours', { ref: c.commande_reference, n: c.jours_chevauches })).join(' · ')}</div>
                  </>)}</td>
                  <td>{statut(x)}</td>
                  <td className="num">{!x.annulee_le && x.au >= auj && <Bouton petit onClick={() => setAnnuler(x)}>{t('fermetures.annuler')}</Bouton>}</td>
                </tr>);
            })}</tbody>
          </table>
        )}
      </div>
      {nouvelle && <NouvelleFermeture fournisseurs={fournisseurs} onClose={() => setNouvelle(false)} onSaved={() => { setNouvelle(false); recharger(); }} />}
      {annuler && <AnnulerFermeture f={annuler} onClose={() => setAnnuler(null)} onDone={() => { setAnnuler(null); recharger(); }} />}
    </div>
  );
}

function NouvelleFermeture({ fournisseurs, onClose, onSaved }: { fournisseurs: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [f, setF] = useState({ fournisseur_id: '', motif: '', du: '', au: '' });
  const ordre = f.du && f.au && f.au < f.du;
  const valider = async () => {
    const v = Saisie.safeParse({ ...f, fournisseur_id: f.fournisseur_id || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('ajouter_fermeture_usine', { p: v.data })))) onSaved();
  };
  return (
    <Tiroir titre={t('fermetures.nouvelle')} onClose={onClose}>
      <p className="sec">{t('fermetures.aide_saisie')}</p>
      <Champ label={t('fermetures.usine')}>
        <select value={f.fournisseur_id} onChange={(e) => setF({ ...f, fournisseur_id: e.target.value })}>
          <option value="">{t('fermetures.toutes_usines')}</option>
          {Object.entries(fournisseurs).sort((x, y) => x[1].localeCompare(y[1])).map(([id, nom]) => <option key={id} value={id}>{nom}</option>)}
        </select>
      </Champ>
      <Champ label={t('fermetures.motif')}><input value={f.motif} maxLength={160} onChange={(e) => setF({ ...f, motif: e.target.value })} /></Champ>
      <Champ label={t('fermetures.du')}><input type="date" value={f.du} onChange={(e) => setF({ ...f, du: e.target.value })} /></Champ>
      <Champ label={t('fermetures.au')} erreur={ordre ? t('fermetures.ordre') : null}><input type="date" value={f.au} onChange={(e) => setF({ ...f, au: e.target.value })} /></Champ>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours || !f.motif.trim() || !f.du || !f.au || Boolean(ordre)} onClick={() => void valider()}>{t('fermetures.ajouter')}</Bouton>
    </Tiroir>
  );
}

function AnnulerFermeture({ f, onClose, onDone }: { f: Fermeture; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [motif, setMotif] = useState('');
  const valider = async () => {
    const v = z.object({ p_fermeture: z.string().uuid(), p_motif: z.string().trim().min(5).max(1000) }).strict().safeParse({ p_fermeture: f.id, p_motif: motif });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('annuler_fermeture_usine', v.data)))) onDone();
  };
  return (
    <Tiroir titre={t('fermetures.annuler_titre', { motif: f.motif })} onClose={onClose}>
      <Champ label={t('champs.motif')}><textarea value={motif} maxLength={1000} onChange={(e) => setMotif(e.target.value)} /></Champ>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours || motif.trim().length < 5} onClick={() => void valider()}>{t('commun.confirmer')}</Bouton>
    </Tiroir>
  );
}
