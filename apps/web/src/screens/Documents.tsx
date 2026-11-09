// Échanges · documents du dossier et leurs versions (maquette « Documents »).
// Numérotation des versions, circuit de statut et archivage tenus par la base (migration 53).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date } from '../lib/format';
import { urlSignee } from '../lib/fichiers';
import { useNoms } from '../lib/referentiels';
import { Bandeau, Bouton, Champ, Chargement, Entete, Statut, Tiroir, Vide } from '../components/ui';
import { Depot } from '../components/Depot';

type Statut = 'brouillon' | 'en_revue' | 'en_signature' | 'en_vigueur' | 'archive';
interface Doc { id: string; dossier_id: string; type: string; titre: string; partie: string | null; statut: Statut; version_courante: number; modifie_le: string;
  dossiers: { reference: string } | null }
interface Version { id: string; version: number; chemin: string; commentaire: string; cree_le: string; cree_par: string | null }
const TYPES = ['contrat', 'mandat', 'rapport', 'facture', 'avenant', 'autre'] as const;
const TON: Record<Statut, string> = { brouillon: 'neutre', en_revue: 'att', en_signature: 'info', en_vigueur: 'ok', archive: 'neutre' };
const SUIVANT: Partial<Record<Statut, Statut>> = { brouillon: 'en_revue', en_revue: 'en_signature', en_signature: 'en_vigueur' };

export function Documents() {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const ecrit = ['admin', 'achats_chine', 'hub_afrique'].includes(profil?.role ?? '');
  const noms = useNoms('profils');
  const [type, setType] = useState<string>('');
  const l = useAsync(async () => {
    let q = supabase.from('documents_dossier').select('*, dossiers(reference)').order('modifie_le', { ascending: false }).limit(500);
    if (type) q = q.eq('type', type);
    return ok(await q) as unknown as Doc[];
  }, [type]);
  const [sel, setSel] = useState<string | null>(null);
  const [nouveau, setNouveau] = useState(false);
  const tous = l.data ?? [];
  const x = tous.find((d) => d.id === sel) ?? tous[0] ?? null;
  const v = useAsync(async () => (x ? ok(await supabase.from('documents_versions').select('*').eq('document_id', x.id).order('version', { ascending: false })) as Version[] : []), [x?.id, x?.version_courante]);
  const a = useAction();
  const [dep, setDep] = useState({ chemin: '', commentaire: '' });
  const ouvrir = async (c: string) => { const u = await urlSignee(c); if (u) window.open(u, '_blank', 'noopener,noreferrer'); };
  const deposer = async () => {
    if (!x) return;
    const p = z.object({ p_document: z.string().uuid(), p_chemin: z.string().min(1).max(400), p_commentaire: z.string().trim().min(3).max(300) }).strict()
      .safeParse({ p_document: x.id, p_chemin: dep.chemin, p_commentaire: dep.commentaire });
    if (!p.success) { a.setErreur(t('docs.version_invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('deposer_version_document', p.data)))) { setDep({ chemin: '', commentaire: '' }); void l.recharger(); }
  };
  const statut = async (s: Statut) => { if (x && await a.executer(async () => ok(await supabase.rpc('changer_statut_document', { p_document: x.id, p_statut: s })))) void l.recharger(); };
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.echanges')} · ${t('docs.surtitre')} · DOC`} titre={t('docs.titre')}
        actions={ecrit && <Bouton variante="primaire" onClick={() => setNouveau(true)}>{t('docs.nouveau')}</Bouton>} />
      <div className="aud-filtres"><div className="segment">
        {['', ...TYPES].map((k) => <button key={k || 'tous'} type="button" aria-pressed={type === k} onClick={() => { setType(k); setSel(null); }}>{k ? t(`docs.types.${k}`) : t('journal.tous')}</button>)}
      </div></div>
      <Bandeau type="err">{l.erreur ?? v.erreur ?? a.erreur}</Bandeau>
      <div className="ref-grille liv-grille">
        <div className="cadre">
          {l.chargement && !l.data ? <Chargement /> : tous.length === 0 ? <Vide>{t('docs.aucun')}</Vide> : (
            <table className="t"><thead><tr><th>{t('docs.document')}</th><th>{t('docs.type')}</th><th>{t('champs.dossier')}</th><th>{t('docs.version')}</th><th>{t('champs.statut')}</th></tr></thead>
              <tbody>{tous.map((d) => (
                <tr key={d.id} className={'cliquable' + (x?.id === d.id ? ' choisi' : '')} onClick={() => setSel(d.id)}>
                  <td>{d.titre}<div className="mute">{d.partie ?? ''}</div></td><td>{t(`docs.types.${d.type}`)}</td>
                  <td className="ref">{d.dossiers?.reference ?? '—'}</td><td className="ref">{d.version_courante ? `v${d.version_courante}` : '—'}</td>
                  <td><Statut statut={TON[d.statut]} libelle={t(`docs.statuts.${d.statut}`)} /></td></tr>))}</tbody></table>
          )}
        </div>
        {x && (
          <aside className="exp-aside">
            <section>
              <span className="mute">{t(`docs.types.${x.type}`)} · <Link to={`/dossiers/${x.dossier_id}`}>{x.dossiers?.reference ?? ''}</Link></span>
              <b className="liv-client">{x.titre}</b>
              {x.partie && <span className="sec">{x.partie}</span>}
              <div className="liv-pv"><Statut statut={TON[x.statut]} libelle={t(`docs.statuts.${x.statut}`)} />
                {ecrit && x.statut !== 'archive' && <span className="actions">
                  {SUIVANT[x.statut] && <Bouton petit variante="primaire" disabled={a.enCours || x.version_courante === 0} onClick={() => void statut(SUIVANT[x.statut]!)}>{t(`docs.passer.${SUIVANT[x.statut]}`)}</Bouton>}
                  <Bouton petit disabled={a.enCours} onClick={() => void statut('archive')}>{t('docs.archiver')}</Bouton></span>}</div>
            </section>
            {ecrit && x.statut !== 'archive' && <section>
              <div className="surtitre">{t('docs.deposer')}</div>
              <Depot dossierId={x.dossier_id} valeur={dep.chemin || null} onChange={(c) => setDep({ ...dep, chemin: c })} />
              <input value={dep.commentaire} maxLength={300} placeholder={t('docs.commentaire')} aria-label={t('docs.commentaire')} onChange={(e) => setDep({ ...dep, commentaire: e.target.value })} />
              <Bouton disabled={a.enCours || !dep.chemin} onClick={() => void deposer()}>{t('docs.enregistrer_version')}</Bouton>
              {x.statut === 'en_vigueur' && <span className="mute">{t('docs.aide_revue')}</span>}
            </section>}
            <section>
              <div className="surtitre">{t('docs.versions')}</div>
              {(v.data ?? []).length === 0 ? <span className="mute">{t('docs.aucune_version')}</span> : (v.data ?? []).map((y) => (
                <div key={y.id} className="grl-version"><b>v{y.version}</b><span>
                  <span>{y.version === x.version_courante ? <span className="txt-ok">{t('docs.courante')}</span> : <span className="mute">{t('docs.remplacee')}</span>} · {y.commentaire}</span>
                  <span className="mute">{date(y.cree_le, langue)}{y.cree_par ? ` · ${noms[y.cree_par] ?? ''}` : ''} · <button type="button" className="lien" onClick={() => void ouvrir(y.chemin)}>PDF</button></span></span></div>))}
            </section>
          </aside>
        )}
      </div>
      {nouveau && <NouveauDocument onClose={() => setNouveau(false)} onFait={(id) => { setNouveau(false); setSel(id); void l.recharger(); }} />}
    </div>
  );
}

function NouveauDocument({ onClose, onFait }: { onClose: () => void; onFait: (id: string) => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const ds = useAsync(async () => ok(await supabase.from('dossiers').select('id, reference, intitule').order('reference', { ascending: false }).limit(500)) as { id: string; reference: string; intitule: string }[], []);
  const [f, setF] = useState({ dossier_id: '', type: 'contrat', titre: '', partie: '' });
  const enregistrer = async () => {
    const v = z.object({ dossier_id: z.string().uuid(), type: z.enum(TYPES), titre: z.string().trim().min(3).max(200), partie: z.string().trim().max(200).nullable() }).strict()
      .safeParse({ ...f, partie: f.partie.trim() || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    let id = '';
    if (await a.executer(async () => { id = ok(await supabase.rpc('creer_document', { p: v.data })) as string; }) && id) onFait(id);
  };
  return (
    <Tiroir titre={t('docs.nouveau')} onClose={onClose}>
      <Champ label={t('champs.dossier')}><select value={f.dossier_id} onChange={(e) => setF({ ...f, dossier_id: e.target.value })}>
        <option value="">—</option>{(ds.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.reference} — {d.intitule}</option>)}</select></Champ>
      <Champ label={t('docs.type')}><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{TYPES.map((k) => <option key={k} value={k}>{t(`docs.types.${k}`)}</option>)}</select></Champ>
      <Champ label={t('docs.document')}><input value={f.titre} maxLength={200} onChange={(e) => setF({ ...f, titre: e.target.value })} /></Champ>
      <Champ label={t('docs.partie')}><input value={f.partie} maxLength={200} onChange={(e) => setF({ ...f, partie: e.target.value })} /></Champ>
      <p className="mute">{t('docs.aide_creation')}</p>
      <Bandeau type="err">{ds.erreur ?? a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}
