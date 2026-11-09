// Lot 1, M22 et M15 : notes de frais, coûts par dossier, marge directe et missions
// à perte. Les droits, la conversion en FCFA, la validation et la répartition sont
// appliqués en base ; l'écran valide la saisie avant envoi.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, montant } from '../lib/format';
import { deposer, FichierRefuse, urlSignee } from '../lib/fichiers';
import { useNoms } from '../lib/referentiels';
import type { Dossier } from '../lib/types';
import { Bandeau, Bouton, Champ, Chargement, Entete, Kpis, Onglets, Statut, Tiroir, Vide } from '../components/ui';
import { celluleCsv } from './Commissions';

const CATEGORIES = ['inspecteur', 'deplacement', 'hebergement', 'repas', 'echantillon', 'coursier', 'laboratoire', 'traduction',
  'sous_traitance', 'transitaire', 'frais_bancaires', 'change', 'installation', 'apres_livraison', 'autre'] as const;
const CAUSES = ['jours_depasses', 'contre_inspection_non_facturee', 'deplacement_imprevu'] as const;
const DEVISES = ['XOF', 'XAF', 'USD', 'CNY', 'EUR'] as const;
const UUID = z.string().uuid();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

interface Cout {
  id: string; nature: 'note_frais' | 'cout'; dossier_id: string | null; frais_generaux: boolean; categorie: string; libelle: string;
  date_cout: string; devise: string; montant_ht: number; montant_xof: number | null; cause_perte: string | null;
  justificatif_chemin: string | null; statut: 'soumise' | 'validee' | 'refusee' | 'remboursee'; depose_par: string | null; motif_refus: string | null;
}
interface Marge {
  honoraires_factures_xof: number; honoraires_encaisses_xof: number; couts_xof: number; marge_directe_facturee_xof: number;
  marge_directe_encaissee_xof: number; taux_marge_facturee: number | null; cause_perte: string | null; couts_par_categorie: Record<string, number>;
}
const STATUT_COUT = { soumise: 'att', validee: 'ok', refusee: 'err', remboursee: 'ok' } as const;

function erreurFichier(err: unknown): never {
  if (err instanceof FichierRefuse) throw new Error(err.message === 'type' ? 'GBS_FICHIER_TYPE' : 'GBS_FICHIER_TAILLE');
  throw err;
}

// ----------------------------------------------------------------------------- notes de frais
const ONGLETS_NDF = ['soumise', 'validee', 'remboursee', 'refusee', 'toutes'] as const;
type OngletNdf = typeof ONGLETS_NDF[number];

/** Notes de frais (maquette NDF) : file par statut, validation dans la liste, export comptable. La finance voit toutes les notes, chacun voit les siennes (règle en base). */
export function NotesFrais() {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const finance = ['admin', 'comptable'].includes(profil?.role ?? '');
  const [onglet, setOnglet] = useState<OngletNdf>('soumise');
  const dossiers = useNoms('dossiers');
  const noms = useNoms('profils');
  const l = useAsync(async () => ok(await supabase.from('couts').select('*').eq('nature', 'note_frais')
    .order('date_cout', { ascending: false }).limit(1000)) as Cout[], [profil?.id]);
  // Catégories exigeant un justificatif : paramètre en vigueur, appliqué en base à la validation.
  const pj = useAsync(async () => ok(await supabase.from('parametres').select('valeur, date_effet').eq('cle', 'frais.justificatif_obligatoire')
    .lte('date_effet', new Date().toISOString().slice(0, 10)).order('date_effet', { ascending: false }).limit(1)) as { valeur: unknown }[], []);
  const exige = Array.isArray(pj.data?.[0]?.valeur) ? (pj.data![0].valeur as string[]) : [];
  const a = useAction();
  const [nouvelle, setNouvelle] = useState(false);
  const [traiter, setTraiter] = useState<Cout | null>(null);
  const voir = async (c: Cout) => { if (c.justificatif_chemin) { const u = await urlSignee(c.justificatif_chemin); if (u) window.open(u, '_blank', 'noopener,noreferrer'); } };
  const tous = l.data ?? [];
  const liste = onglet === 'toutes' ? tous : tous.filter((c) => c.statut === onglet);
  const manque = (c: Cout) => !c.justificatif_chemin && exige.includes(c.categorie);
  const aValider = tous.filter((c) => c.statut === 'soumise');
  const parDevise = Object.entries(aValider.reduce<Record<string, number>>((m, c) => ({ ...m, [c.devise]: (m[c.devise] ?? 0) + Number(c.montant_ht) }), {}))
    .map(([d, v]) => montant(v, d, langue)).join(t('expeditions.et'));
  const sansPj = aValider.filter(manque).length;
  const titre = aValider.length === 0 ? t('couts.titre_rien') : [t('couts.titre_a_valider', { n: aValider.length, montants: parDevise }),
    sansPj ? t('couts.titre_sans_pj', { n: sansPj }) : null].filter(Boolean).join(' ; ');
  const valider = async (c: Cout) => { if (await a.executer(async () => ok(await supabase.rpc('statuer_cout', { p_cout: c.id, p_decision: 'validee', p_motif: null })))) void l.recharger(); };
  const rembourser = async (c: Cout) => { if (await a.executer(async () => ok(await supabase.rpc('statuer_cout', { p_cout: c.id, p_decision: 'remboursee', p_motif: null })))) void l.recharger(); };
  const exporter = () => {
    const cols = ['date', 'collaborateur', 'categorie', 'libelle', 'imputation', 'devise', 'montant', 'montant_xof', 'statut', 'justificatif'];
    const lignes = liste.map((c) => [c.date_cout, c.depose_par ? noms[c.depose_par] ?? '' : '', t(`couts.cat.${c.categorie}`), c.libelle,
      c.dossier_id ? dossiers[c.dossier_id] ?? '' : c.frais_generaux ? t('couts.frais_generaux') : '', c.devise, c.montant_ht, c.montant_xof ?? '',
      t(`couts.statut.${c.statut}`), c.justificatif_chemin ? 'oui' : 'non']);
    const csv = [cols.map(celluleCsv).join(';'), ...lignes.map((x) => x.map(celluleCsv).join(';'))].join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const lien = document.createElement('a'); lien.href = url; lien.download = `notes-de-frais_${onglet}_${new Date().toISOString().slice(0, 10)}.csv`; lien.click();
    URL.revokeObjectURL(url);
  };
  const ddmm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.finance')} · ${t('couts.surtitre')} · NDF`} titre={l.data ? titre : t('ecrans.notes_frais')}
        actions={<>
          <Bouton onClick={() => setNouvelle(true)}>{t('couts.nouvelle_note')}</Bouton>
          {finance && <Bouton disabled={liste.length === 0} onClick={exporter}>{t('couts.export')}</Bouton>}
        </>} />
      <Onglets actif={onglet} onChange={setOnglet} items={ONGLETS_NDF.map((o) => ({ id: o, lib: o === 'toutes' ? t('couts.toutes') : t(`couts.onglets.${o}`) }))} />
      <Bandeau type="err">{l.erreur ?? pj.erreur ?? a.erreur}</Bandeau>
      <div className="cadre">
        {l.chargement && !l.data ? <Chargement /> : liste.length === 0 ? <Vide>{t('couts.aucune_note')}</Vide> : (
          <div style={{ overflowX: 'auto' }}><table className="t"><thead><tr><th>{t('suivi.date')}</th><th>{t('couts.auteur')}</th>
            <th>{t('couts.nature_categorie')}</th><th>{t('couts.imputation')}</th><th className="num">{t('couts.montant')}</th>
            <th>{t('couts.justificatif')}</th><th>{t('champs.statut')}</th><th /></tr></thead>
            <tbody>{liste.map((c) => {
              const peut = finance && c.depose_par !== profil?.id;
              return (
                <tr key={c.id}><td className="ref">{ddmm(c.date_cout)}</td>
                  <td>{c.depose_par ? noms[c.depose_par] ?? '' : ''}</td>
                  <td>{c.libelle}<div className="mute">{t(`couts.cat.${c.categorie}`)}</div>
                    {c.motif_refus && <div className="txt-err" style={{ fontSize: 13 }}>{c.motif_refus}</div>}</td>
                  <td className="ref">{c.dossier_id ? dossiers[c.dossier_id] ?? '' : c.frais_generaux ? t('couts.frais_generaux') : <Statut statut="err" libelle={t('couts.non_affectee')} />}</td>
                  <td className="num">{montant(c.montant_ht, c.devise, langue)}{c.devise !== 'XOF' && c.montant_xof != null && <div className="mute">{montant(c.montant_xof, 'XOF', langue)}</div>}</td>
                  <td>{c.justificatif_chemin ? <button type="button" className="lien" onClick={() => void voir(c)}><Statut statut="ok" libelle={t('couts.photo')} /></button>
                    : manque(c) ? <Statut statut="err" libelle={t('couts.pj_manquant')} /> : <span className="mute">—</span>}</td>
                  <td><Statut statut={STATUT_COUT[c.statut]} libelle={t(`couts.statut.${c.statut}`)} /></td>
                  <td className="num"><span className="actions" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                    {peut && c.statut === 'soumise' && <>
                      <Bouton petit onClick={() => setTraiter(c)}>{t('couts.refuser_imputer')}</Bouton>
                      <Bouton petit variante="primaire" disabled={a.enCours || manque(c) || (!c.dossier_id && !c.frais_generaux)} onClick={() => void valider(c)}>{t('commun.valider')}</Bouton>
                    </>}
                    {peut && c.statut === 'validee' && <Bouton petit disabled={a.enCours} onClick={() => void rembourser(c)}>{t('couts.marquer_remboursee')}</Bouton>}
                  </span></td></tr>);
            })}</tbody></table></div>
        )}
        <p style={{ marginTop: 12 }} className="mute">{t('couts.aide_ndf', { liste: exige.map((k) => t(`couts.cat.${k}`).toLowerCase()).join(', ') || '—' })}</p>
      </div>
      {nouvelle && <NouvelleNote onClose={() => setNouvelle(false)} onSaved={() => { setNouvelle(false); void l.recharger(); }} />}
      {traiter && <TraiterNote note={traiter} onClose={() => setTraiter(null)} onDone={() => { setTraiter(null); void l.recharger(); }} />}
    </div>
  );
}

function NouvelleNote({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const dossiers = useAsync(async () => ok(await supabase.from('dossiers').select('id, reference, intitule').eq('statut', 'ouvert').order('reference')) as
    { id: string; reference: string; intitule: string }[], []);
  const a = useAction();
  const [f, setF] = useState({ dossier: '', categorie: 'deplacement', libelle: '', date_cout: new Date().toISOString().slice(0, 10), devise: 'CNY', montant: '' });
  const [fichier, setFichier] = useState<File | null>(null);
  const enregistrer = async () => {
    const generaux = f.dossier === 'frais_generaux';
    const v = z.object({ nature: z.literal('note_frais'), dossier_id: UUID.nullable(), frais_generaux: z.boolean(), categorie: z.enum(CATEGORIES),
      libelle: z.string().trim().min(3).max(300), date_cout: DATE, devise: z.enum(DEVISES), montant_ht: z.coerce.number().positive().max(1e11) }).strict()
      .safeParse({ nature: 'note_frais', dossier_id: f.dossier && !generaux ? f.dossier : null, frais_generaux: generaux, categorie: f.categorie,
        libelle: f.libelle, date_cout: f.date_cout, devise: f.devise, montant_ht: f.montant });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    const okk = await a.executer(async () => {
      let justificatif_chemin: string | null = null;
      if (fichier) { try { justificatif_chemin = (await deposer(null, fichier)).chemin; } catch (err) { erreurFichier(err); } }
      ok(await supabase.from('couts').insert({ ...v.data, justificatif_chemin }));
    });
    if (okk) onSaved();
  };
  return (
    <Tiroir titre={t('couts.nouvelle_note')} onClose={onClose}>
      <Champ label={t('couts.imputation')}>
        <select value={f.dossier} onChange={(e) => setF({ ...f, dossier: e.target.value })}>
          <option value="">{t('couts.a_affecter')}</option>
          <option value="frais_generaux">{t('couts.frais_generaux')}</option>
          {(dossiers.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.reference} — {d.intitule}</option>)}
        </select>
      </Champ>
      <Champ label={t('couts.categorie')}><select value={f.categorie} onChange={(e) => setF({ ...f, categorie: e.target.value })}>
        {CATEGORIES.map((c) => <option key={c} value={c}>{t(`couts.cat.${c}`)}</option>)}</select></Champ>
      <Champ label={t('couts.libelle')}><input value={f.libelle} maxLength={300} onChange={(e) => setF({ ...f, libelle: e.target.value })} /></Champ>
      <Champ label={t('suivi.date')}><input type="date" value={f.date_cout} onChange={(e) => setF({ ...f, date_cout: e.target.value })} /></Champ>
      <div className="actions">
        <Champ label={t('couts.montant_ht')}><input type="number" min={0} step="any" value={f.montant} onChange={(e) => setF({ ...f, montant: e.target.value })} /></Champ>
        <Champ label={t('couts.devise')}><select value={f.devise} onChange={(e) => setF({ ...f, devise: e.target.value })}>{DEVISES.map((d) => <option key={d}>{d}</option>)}</select></Champ>
      </div>
      <Champ label={t('couts.photo_justificatif')}>
        <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" capture="environment" onChange={(e) => setFichier(e.target.files?.[0] ?? null)} />
      </Champ>
      <p className="mute">{t('couts.aide_note')}</p>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

function TraiterNote({ note, onClose, onDone }: { note: Cout; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const dossiers = useAsync(async () => ok(await supabase.from('dossiers').select('id, reference').order('reference')) as { id: string; reference: string }[], []);
  const a = useAction();
  const [imputation, setImputation] = useState(note.dossier_id ?? (note.frais_generaux ? 'frais_generaux' : ''));
  const [motif, setMotif] = useState('');
  const affecter = async () => {
    const generaux = imputation === 'frais_generaux';
    const v = z.object({ dossier_id: UUID.nullable(), frais_generaux: z.boolean() }).strict()
      .safeParse({ dossier_id: imputation && !generaux ? imputation : null, frais_generaux: generaux });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('couts').update(v.data).eq('id', note.id)))) onDone();
  };
  const statuer = async (decision: 'validee' | 'refusee' | 'remboursee') => {
    if (await a.executer(async () => ok(await supabase.rpc('statuer_cout', { p_cout: note.id, p_decision: decision, p_motif: decision === 'refusee' ? motif.trim() : null })))) onDone();
  };
  return (
    <Tiroir titre={note.libelle} onClose={onClose}>
      {note.statut === 'soumise' && (<>
        <Champ label={t('couts.imputation')}>
          <select value={imputation} onChange={(e) => setImputation(e.target.value)}>
            <option value="">{t('couts.a_affecter')}</option><option value="frais_generaux">{t('couts.frais_generaux')}</option>
            {(dossiers.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.reference}</option>)}
          </select>
        </Champ>
        <Bouton disabled={a.enCours} onClick={() => void affecter()}>{t('couts.affecter')}</Bouton>
        <Bouton variante="primaire" disabled={a.enCours} onClick={() => void statuer('validee')}>{t('commun.valider')}</Bouton>
        <Champ label={t('champs.motif')}><textarea value={motif} maxLength={1000} onChange={(e) => setMotif(e.target.value)} /></Champ>
        <Bouton variante="danger" disabled={a.enCours || motif.trim().length < 5} onClick={() => void statuer('refusee')}>{t('fiche.refuser')}</Bouton>
      </>)}
      {note.statut === 'validee' && <Bouton variante="primaire" disabled={a.enCours} onClick={() => void statuer('remboursee')}>{t('couts.marquer_remboursee')}</Bouton>}
      <Bandeau type="err">{a.erreur}</Bandeau>
    </Tiroir>
  );
}

// ----------------------------------------------------------------------------- fiche dossier
export function CoutsMarge({ dossier }: { dossier: Dossier }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const m = useAsync(async () => ok(await supabase.rpc('marge_directe', { p_dossier: dossier.id })) as Marge, [dossier.id]);
  const l = useAsync(async () => ok(await supabase.from('couts').select('*').eq('dossier_id', dossier.id).order('date_cout', { ascending: false })) as Cout[], [dossier.id]);
  const [nouveau, setNouveau] = useState(false);
  const [partage, setPartage] = useState<Cout | null>(null);
  const recharger = () => { void m.recharger(); void l.recharger(); };
  const x = m.data;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Bandeau type="err">{m.erreur ?? l.erreur}</Bandeau>
      {x && <Kpis items={[
        { lib: t('couts.honoraires_factures'), val: montant(x.honoraires_factures_xof, 'XOF', langue), sous: t('couts.encaisses', { m: montant(x.honoraires_encaisses_xof, 'XOF', langue) }) },
        { lib: t('couts.couts'), val: montant(x.couts_xof, 'XOF', langue) },
        { lib: t('couts.marge_facturee'), val: montant(x.marge_directe_facturee_xof, 'XOF', langue),
          sous: x.taux_marge_facturee != null ? `${(Number(x.taux_marge_facturee) * 100).toFixed(1)} %` : '—' },
        { lib: t('couts.marge_encaissee'), val: montant(x.marge_directe_encaissee_xof, 'XOF', langue),
          sous: x.cause_perte ? t(`couts.cause.${x.cause_perte}`) : undefined },
      ]} />}
      {x?.cause_perte && <Bandeau type="err">{t('couts.mission_a_perte', { cause: t(`couts.cause.${x.cause_perte}`) })}</Bandeau>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="section-titre">{t('couts.couts_du_dossier')}</div>
        <Bouton petit onClick={() => setNouveau(true)}>{t('couts.nouveau_cout')}</Bouton>
      </div>
      {(l.data ?? []).length === 0 ? <Vide>{t('couts.aucun_cout')}</Vide> : (
        <div style={{ overflowX: 'auto' }}><table className="t"><thead><tr><th>{t('suivi.date')}</th><th>{t('couts.libelle')}</th><th>{t('couts.categorie')}</th>
          <th className="num">FCFA</th><th>{t('champs.statut')}</th><th /></tr></thead>
          <tbody>{(l.data ?? []).map((c) => (
            <tr key={c.id}><td className="ref">{date(c.date_cout, langue)}</td><td>{c.libelle}{c.cause_perte && <span className="mute"> · {t(`couts.cause.${c.cause_perte}`)}</span>}</td>
              <td>{t(`couts.cat.${c.categorie}`)}</td><td className="num">{c.montant_xof != null ? montant(c.montant_xof, 'XOF', langue) : '—'}</td>
              <td><Statut statut={STATUT_COUT[c.statut]} libelle={t(`couts.statut.${c.statut}`)} /></td>
              <td className="num">{['validee', 'remboursee'].includes(c.statut) && <Bouton petit onClick={() => setPartage(c)}>{t('couts.repartir')}</Bouton>}</td></tr>))}</tbody></table></div>
      )}
      <p className="mute">{t('couts.aide_marge')}</p>
      {nouveau && <NouveauCout dossierId={dossier.id} onClose={() => setNouveau(false)} onSaved={() => { setNouveau(false); recharger(); }} />}
      {partage && <Repartition cout={partage} dossierId={dossier.id} onClose={() => setPartage(null)} onDone={() => { setPartage(null); recharger(); }} />}
    </div>
  );
}

function NouveauCout({ dossierId, onClose, onSaved }: { dossierId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [f, setF] = useState({ categorie: 'inspecteur', libelle: '', date_cout: new Date().toISOString().slice(0, 10), devise: 'XOF', montant: '', cause: '' });
  const enregistrer = async () => {
    const v = z.object({ nature: z.literal('cout'), dossier_id: UUID, categorie: z.enum(CATEGORIES), libelle: z.string().trim().min(3).max(300),
      date_cout: DATE, devise: z.enum(DEVISES), montant_ht: z.coerce.number().positive().max(1e11), cause_perte: z.enum(CAUSES).nullable() }).strict()
      .safeParse({ nature: 'cout', dossier_id: dossierId, categorie: f.categorie, libelle: f.libelle, date_cout: f.date_cout, devise: f.devise,
        montant_ht: f.montant, cause_perte: f.cause || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('couts').insert(v.data)))) onSaved();
  };
  return (
    <Tiroir titre={t('couts.nouveau_cout')} onClose={onClose}>
      <Champ label={t('couts.categorie')}><select value={f.categorie} onChange={(e) => setF({ ...f, categorie: e.target.value })}>
        {CATEGORIES.map((c) => <option key={c} value={c}>{t(`couts.cat.${c}`)}</option>)}</select></Champ>
      <Champ label={t('couts.libelle')}><input value={f.libelle} maxLength={300} onChange={(e) => setF({ ...f, libelle: e.target.value })} /></Champ>
      <Champ label={t('suivi.date')}><input type="date" value={f.date_cout} onChange={(e) => setF({ ...f, date_cout: e.target.value })} /></Champ>
      <div className="actions">
        <Champ label={t('couts.montant_ht')}><input type="number" min={0} step="any" value={f.montant} onChange={(e) => setF({ ...f, montant: e.target.value })} /></Champ>
        <Champ label={t('couts.devise')}><select value={f.devise} onChange={(e) => setF({ ...f, devise: e.target.value })}>{DEVISES.map((d) => <option key={d}>{d}</option>)}</select></Champ>
      </div>
      <Champ label={t('couts.cause_imprevu')}><select value={f.cause} onChange={(e) => setF({ ...f, cause: e.target.value })}>
        <option value="">{t('couts.aucune_cause')}</option>{CAUSES.map((c) => <option key={c} value={c}>{t(`couts.cause.${c}`)}</option>)}</select></Champ>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

function Repartition({ cout, dossierId, onClose, onDone }: { cout: Cout; dossierId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const dossiers = useAsync(async () => ok(await supabase.from('dossiers').select('id, reference').order('reference')) as { id: string; reference: string }[], []);
  const a = useAction();
  const [parts, setParts] = useState([{ dossier_id: dossierId, heures: '' }, { dossier_id: '', heures: '' }]);
  const [motif, setMotif] = useState('');
  const valider = async () => {
    const v = z.object({ p_cout: UUID, p_parts: z.array(z.object({ dossier_id: UUID, heures: z.coerce.number().positive().max(10000) }).strict()).min(2).max(20),
      p_motif: z.string().trim().min(5).max(1000) }).strict().safeParse({ p_cout: cout.id, p_parts: parts.filter((p) => p.dossier_id), p_motif: motif });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('repartir_cout', v.data)))) onDone();
  };
  return (
    <Tiroir titre={t('couts.repartir_titre', { libelle: cout.libelle })} onClose={onClose}>
      <p className="sec">{t('couts.aide_repartition')}</p>
      {parts.map((p, i) => (
        <div className="actions" key={i}>
          <Champ label={t('champs.dossier')}><select value={p.dossier_id} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, dossier_id: e.target.value } : x)))}>
            <option value="" />{(dossiers.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.reference}</option>)}</select></Champ>
          <Champ label={t('couts.heures')}><input type="number" min={0} step="any" value={p.heures} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, heures: e.target.value } : x)))} /></Champ>
        </div>
      ))}
      {parts.length < 20 && <Bouton petit onClick={() => setParts([...parts, { dossier_id: '', heures: '' }])}>{t('commun.ajouter')}</Bouton>}
      <Champ label={t('champs.motif')}><textarea value={motif} maxLength={1000} onChange={(e) => setMotif(e.target.value)} /></Champ>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void valider()}>{t('commun.confirmer')}</Bouton>
    </Tiroir>
  );
}

// ----------------------------------------------------------------------------- rentabilité
export function Rentabilite() {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const l = useAsync(async () => ok(await supabase.rpc('missions_a_perte')) as
    { dossier_id: string; reference: string; modele: string; client: string; honoraires_factures_xof: number; couts_xof: number;
      marge_directe_facturee_xof: number; marge_directe_encaissee_xof: number; cause_perte: string }[], []);
  return (
    <div className="screen">
      <Entete surtitre={t('modules.supervision')} titre={t('couts.missions_a_perte')} />
      <div className="cadre">
        <p className="mute">{t('couts.aide_rentabilite')}</p>
        <Bandeau type="err">{l.erreur}</Bandeau>
        {l.chargement && !l.data ? <Chargement /> : (l.data ?? []).length === 0 ? <Vide>{t('couts.aucune_perte')}</Vide> : (
          <div style={{ overflowX: 'auto' }}><table className="t"><thead><tr><th>{t('champs.dossier')}</th><th>{t('couts.client')}</th>
            <th className="num">{t('couts.honoraires_factures')}</th><th className="num">{t('couts.couts')}</th><th className="num">{t('couts.marge_facturee')}</th>
            <th className="num">{t('couts.marge_encaissee')}</th><th>{t('couts.cause_principale')}</th></tr></thead>
            <tbody>{(l.data ?? []).map((x) => (
              <tr key={x.dossier_id}><td className="ref"><Link to={`/dossiers/${x.dossier_id}`}>{x.reference}</Link></td><td>{x.client}</td>
                <td className="num">{montant(x.honoraires_factures_xof, 'XOF', langue)}</td><td className="num">{montant(x.couts_xof, 'XOF', langue)}</td>
                <td className="num">{montant(x.marge_directe_facturee_xof, 'XOF', langue)}</td><td className="num">{montant(x.marge_directe_encaissee_xof, 'XOF', langue)}</td>
                <td><Statut statut="err" libelle={t(`couts.cause.${x.cause_perte}`)} /></td></tr>))}</tbody></table></div>
        )}
      </div>
    </div>
  );
}
