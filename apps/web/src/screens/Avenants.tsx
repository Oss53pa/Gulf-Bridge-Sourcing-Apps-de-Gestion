// Lot 1, M23 : avenants et demande des pièces manquantes. Les montants, les droits,
// la validation à quatre yeux et l'application sont tenus en base.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, montant } from '../lib/format';
import { deposer, FichierRefuse } from '../lib/fichiers';
import { useNoms } from '../lib/referentiels';
import type { Commande, Dossier, Piece } from '../lib/types';
import { Bandeau, Bouton, Champ, Statut, Tiroir, Vide } from '../components/ui';

const UUID = z.string().uuid();
const OBJETS = ['quantite', 'specification', 'prix', 'delai'] as const;

interface Avenant {
  id: string; reference: string; dossier_id: string; commande_id: string | null; objets: string[]; description: string;
  impact_jours: number; montant_avant: number | null; montant_apres: number | null; impact_prix: number | null;
  statut: 'brouillon' | 'valide' | 'signe' | 'refuse'; cree_par: string | null; motif_refus: string | null; signe_le: string | null;
}
interface Ligne { id: string; article_id: string; quantite: number; prix_unitaire: number; }

const STATUT_AVENANT: Record<Avenant['statut'], string> = { brouillon: 'neutre', valide: 'att', signe: 'ok', refuse: 'err' };

export function AvenantsDossier({ dossier }: { dossier: Dossier }) {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const role = profil?.role ?? '';
  const l = useAsync(async () => ok(await supabase.from('avenants').select('*').eq('dossier_id', dossier.id).order('cree_le', { ascending: false })) as Avenant[], [dossier.id]);
  const commandes = useAsync(async () => ok(await supabase.from('commandes').select('*').eq('dossier_id', dossier.id)
    .not('contrat_valide_le', 'is', null).not('statut', 'in', '(annulee,livree)').order('reference')) as Commande[], [dossier.id]);
  const a = useAction();
  const [nouveau, setNouveau] = useState(false);
  const [refus, setRefus] = useState<Avenant | null>(null);
  const [motif, setMotif] = useState('');
  const peutRediger = ['admin', 'achats_chine', 'hub_afrique'].includes(role) && dossier.statut === 'ouvert';
  const validateur = role === 'admin' || Boolean(profil?.delegue_validation);
  const refCommande = (id: string | null) => commandes.data?.find((c) => c.id === id)?.reference ?? '—';
  const devise = (id: string | null) => commandes.data?.find((c) => c.id === id)?.devise ?? 'USD';

  const valider = async (v: Avenant, decision: 'valide' | 'refuse', m?: string) => {
    if (await a.executer(async () => ok(await supabase.rpc('valider_avenant', { p_avenant: v.id, p_decision: decision, p_motif: m ?? null })))) {
      setRefus(null); setMotif(''); void l.recharger();
    }
  };
  const signer = async (v: Avenant, f: File | undefined) => {
    if (!f) return;
    const okk = await a.executer(async () => {
      let chemin: string;
      try { chemin = (await deposer(dossier.id, f)).chemin; } catch (err) {
        if (err instanceof FichierRefuse) throw new Error(err.message === 'type' ? 'GBS_FICHIER_TYPE' : 'GBS_FICHIER_TAILLE');
        throw err;
      }
      ok(await supabase.rpc('signer_avenant', { p_avenant: v.id, p_document: chemin, p_signe_le: new Date().toISOString().slice(0, 10) }));
    });
    if (okk) void l.recharger();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <p className="mute" style={{ margin: 0 }}>{t('avenants.aide')}</p>
        {peutRediger && <Bouton variante="primaire" onClick={() => setNouveau(true)}>{t('avenants.nouveau')}</Bouton>}
      </div>
      <Bandeau type="err">{l.erreur ?? a.erreur}</Bandeau>
      {(l.data ?? []).length === 0 ? <Vide>{t('avenants.aucun')}</Vide> : (
        <table className="t"><thead><tr><th>{t('avenants.reference')}</th><th>{t('avenants.commande')}</th><th>{t('avenants.objets')}</th>
          <th className="num">{t('avenants.impact_prix')}</th><th className="num">{t('avenants.impact_delai')}</th><th>{t('champs.statut')}</th><th /></tr></thead>
          <tbody>{(l.data ?? []).map((v) => (
            <tr key={v.id}>
              <td className="ref" title={v.description}>{v.reference}</td>
              <td className="ref">{refCommande(v.commande_id)}</td>
              <td>{v.objets.map((o) => t(`avenants.objet.${o}`)).join(', ')}</td>
              <td className="num">{v.impact_prix != null ? montant(v.impact_prix, devise(v.commande_id), langue) : '—'}</td>
              <td className="num">{v.impact_jours ? t('avenants.jours', { n: v.impact_jours }) : '—'}</td>
              <td><Statut statut={STATUT_AVENANT[v.statut]} libelle={t(`avenants.statut.${v.statut}`)} />
                {v.signe_le && <span className="mute"> {date(v.signe_le, langue)}</span>}</td>
              <td className="num"><span className="actions" style={{ justifyContent: 'flex-end' }}>
                {v.statut === 'brouillon' && validateur && v.cree_par !== profil?.id && <>
                  <Bouton petit disabled={a.enCours} onClick={() => void valider(v, 'valide')}>{t('commun.valider')}</Bouton>
                  <Bouton petit variante="danger" disabled={a.enCours} onClick={() => setRefus(v)}>{t('fiche.refuser')}</Bouton>
                </>}
                {v.statut === 'valide' && role === 'admin' && (
                  <label className="btn petit primaire" style={{ cursor: 'pointer' }}>
                    {t('avenants.deposer_signe')}
                    <input type="file" hidden accept="application/pdf,image/png,image/jpeg,image/webp"
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void signer(v, f); }} />
                  </label>
                )}
              </span></td>
            </tr>))}</tbody></table>
      )}
      {nouveau && <NouvelAvenant dossier={dossier} commandes={commandes.data ?? []}
        onClose={() => setNouveau(false)} onSaved={() => { setNouveau(false); void l.recharger(); }} />}
      {refus && (
        <Tiroir titre={t('avenants.refuser', { ref: refus.reference })} onClose={() => setRefus(null)}>
          <Champ label={t('champs.motif')}><textarea value={motif} maxLength={1000} onChange={(e) => setMotif(e.target.value)} /></Champ>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <Bouton variante="danger" disabled={motif.trim().length < 5 || a.enCours} onClick={() => void valider(refus, 'refuse', motif.trim())}>{t('commun.confirmer')}</Bouton>
        </Tiroir>
      )}
    </div>
  );
}

function NouvelAvenant({ dossier, commandes, onClose, onSaved }: { dossier: Dossier; commandes: Commande[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const articles = useNoms('articles');
  const a = useAction();
  const [commandeId, setCommandeId] = useState<string>(commandes[0]?.id ?? '');
  const [objets, setObjets] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [jours, setJours] = useState('0');
  const [saisie, setSaisie] = useState<Record<string, { quantite: string; prix_unitaire: string }>>({});
  const lignes = useAsync(async () => (commandeId ? ok(await supabase.from('lignes_commande').select('id, article_id, quantite, prix_unitaire')
    .eq('commande_id', commandeId).order('cree_le')) as Ligne[] : []), [commandeId]);
  const c = commandes.find((x) => x.id === commandeId);

  const enregistrer = async () => {
    const modifs = (lignes.data ?? []).flatMap((x) => {
      const s = saisie[x.id];
      if (!s) return [];
      const q = Number(s.quantite); const p = Number(s.prix_unitaire);
      if (q === Number(x.quantite) && p === Number(x.prix_unitaire)) return [];
      return [{ ligne_id: x.id, article_id: x.article_id, quantite: q, prix_unitaire: p }];
    });
    const ligneSchema = z.object({ ligne_id: UUID, article_id: UUID, quantite: z.number().positive().max(1e9), prix_unitaire: z.number().min(0).max(1e9) }).strict();
    const v = z.object({
      dossier_id: UUID, commande_id: UUID.nullable(), objets: z.array(z.enum(OBJETS)).min(1).max(4),
      description: z.string().trim().min(5).max(4000), lignes: z.array(ligneSchema).max(200), impact_jours: z.number().int().min(-365).max(365),
    }).strict().safeParse({ dossier_id: dossier.id, commande_id: commandeId || null, objets, description, lignes: modifs,
      impact_jours: objets.includes('delai') ? Number(jours) : 0 });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('avenants').insert(v.data)))) onSaved();
  };

  return (
    <Tiroir titre={t('avenants.nouveau')} onClose={onClose}>
      <Champ label={t('avenants.commande')}>
        <select value={commandeId} onChange={(e) => { setCommandeId(e.target.value); setSaisie({}); }}>
          <option value="">{t('avenants.sans_commande')}</option>
          {commandes.map((x) => <option key={x.id} value={x.id}>{x.reference}</option>)}
        </select>
      </Champ>
      <fieldset className="champ"><span>{t('avenants.objets')}</span>
        <div className="actions" style={{ flexWrap: 'wrap' }}>{OBJETS.map((o) => (
          <label key={o} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={objets.includes(o)} disabled={!commandeId && (o === 'quantite' || o === 'prix')}
              onChange={(e) => setObjets(e.target.checked ? [...objets, o] : objets.filter((x) => x !== o))} />{t(`avenants.objet.${o}`)}
          </label>))}</div>
      </fieldset>
      <Champ label={t('avenants.description')}><textarea value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} /></Champ>
      {objets.includes('delai') && (
        <Champ label={t('avenants.impact_delai_saisie')}><input type="number" min={-365} max={365} value={jours} onChange={(e) => setJours(e.target.value)} /></Champ>
      )}
      {c && (objets.includes('quantite') || objets.includes('prix')) && (
        <table className="t"><thead><tr><th>{t('champs.article')}</th><th className="num">{t('champs.quantite')}</th><th className="num">{t('avenants.prix_unitaire', { devise: c.devise })}</th></tr></thead>
          <tbody>{(lignes.data ?? []).map((x) => {
            const s = saisie[x.id] ?? { quantite: String(x.quantite), prix_unitaire: String(x.prix_unitaire) };
            return (
              <tr key={x.id}><td>{articles[x.article_id] ?? ''}</td>
                <td className="num"><input type="number" min={0} step="any" value={s.quantite} aria-label={t('champs.quantite')}
                  onChange={(e) => setSaisie({ ...saisie, [x.id]: { ...s, quantite: e.target.value } })} /></td>
                <td className="num"><input type="number" min={0} step="any" value={s.prix_unitaire} aria-label={t('avenants.prix_unitaire', { devise: c.devise })}
                  onChange={(e) => setSaisie({ ...saisie, [x.id]: { ...s, prix_unitaire: e.target.value } })} /></td></tr>);
          })}</tbody></table>
      )}
      {c && <p className="mute">{t('avenants.montant_actuel', { montant: montant(c.montant_marchandise, c.devise, langue) })}</p>}
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

/** Demande d'une pièce manquante à qui doit la fournir. */
export function DemanderPiece({ piece, onClose, onDone }: { piece: Piece; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const equipe = useAsync(async () => ok(await supabase.from('profils').select('id, nom')
    .in('role', ['admin', 'achats_chine', 'hub_afrique', 'agent_pays', 'inspecteur', 'comptable']).eq('actif', true).order('nom')) as { id: string; nom: string }[], []);
  const [qui, setQui] = useState<string>(piece.fournie_par ?? 'client');
  const [assigne, setAssigne] = useState('');
  const demander = async () => {
    const v = z.object({ p_piece: UUID, p_a: z.enum(['client', 'fournisseur', 'transitaire', 'equipe']), p_assigne: UUID.nullable() }).strict()
      .safeParse({ p_piece: piece.id, p_a: qui, p_assigne: qui === 'equipe' ? assigne : null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('demander_piece', v.data)))) onDone();
  };
  return (
    <Tiroir titre={t('pieces.demander_titre', { piece: piece.libelle })} onClose={onClose}>
      <p className="sec">{t('pieces.aide_demande')}</p>
      <Champ label={t('pieces.demander_a')}>
        <select value={qui} onChange={(e) => setQui(e.target.value)}>
          {['client', 'fournisseur', 'transitaire', 'equipe'].map((x) => <option key={x} value={x}>{t(`pieces.destinataire.${x}`)}</option>)}
        </select>
      </Champ>
      {qui === 'equipe' && (
        <Champ label={t('delais.assigne_a')}>
          <select value={assigne} onChange={(e) => setAssigne(e.target.value)}>
            <option value="" />
            {(equipe.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
          </select>
        </Champ>
      )}
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void demander()}>{t('pieces.demander')}</Bouton>
    </Tiroir>
  );
}
