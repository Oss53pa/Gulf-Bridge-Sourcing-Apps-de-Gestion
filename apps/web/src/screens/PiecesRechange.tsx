// Lot 1, M6 : pièces de rechange — catalogue du fournisseur (achats, prix fournisseurs) et
// liste proposée au client dans le devis (prix client calculé par la base, sans le catalogue).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { montant } from '../lib/format';
import { Bandeau, Bouton, Statut } from '../components/ui';

const CRITICITES = ['strategique', 'rechange', 'usure'] as const;
interface LigneDevis { id: string; designation: string; reference_fabricant: string | null; criticite: string; disponibilite_ans: number | null;
  delai_jours: number | null; quantite: number; prix_unitaire_client: number; devise: string; montant: number; retenue_client: boolean }

/** Liste proposée au client dans un devis (Hub Afrique, agent pays, administratrice). */
export function PiecesDevis({ devisId, modifiable }: { devisId: string; modifiable: boolean }) {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const peut = modifiable && ['admin', 'hub_afrique', 'agent_pays'].includes(profil?.role ?? '');
  const l = useAsync(async () => ok(await supabase.from('devis_pieces').select('*').eq('devis_id', devisId)) as LigneDevis[], [devisId]);
  const a = useAction();
  const lignes = [...(l.data ?? [])].sort((x, y) => CRITICITES.indexOf(x.criticite as never) - CRITICITES.indexOf(y.criticite as never) || x.designation.localeCompare(y.designation));
  const proposer = async () => { if (await a.executer(async () => ok(await supabase.rpc('proposer_pieces_devis', { p_devis: devisId })))) void l.recharger(); };
  const maj = async (x: LigneDevis, p: { quantite?: number; retenue_client?: boolean }) => {
    const v = z.object({ quantite: z.number().positive().max(100000).optional(), retenue_client: z.boolean().optional() }).strict().safeParse(p);
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('devis_pieces').update(v.data).eq('id', x.id)))) void l.recharger();
  };
  const retirer = async (x: LigneDevis) => { if (await a.executer(async () => ok(await supabase.from('devis_pieces').delete().eq('id', x.id)))) void l.recharger(); };
  const totaux = lignes.filter((x) => x.retenue_client).reduce<Record<string, number>>((s, x) => ({ ...s, [x.devise]: (s[x.devise] ?? 0) + Number(x.montant) }), {});
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="section-titre">{t('pieces.titre_devis')}</span>
        {peut && <Bouton petit disabled={a.enCours} onClick={() => void proposer()}>{t('pieces.proposer')}</Bouton>}
      </div>
      <Bandeau type="err">{l.erreur ?? a.erreur}</Bandeau>
      {lignes.length === 0 ? <span className="mute">{t('pieces.aucune_devis')}</span> : (
        <table className="t"><thead><tr><th>{t('pieces.designation')}</th><th>{t('pieces.criticite')}</th><th>{t('pieces.disponibilite')}</th>
          <th className="num">{t('champs.quantite')}</th><th className="num">{t('pieces.prix')}</th><th className="num">{t('champs.montant')}</th><th>{t('pieces.retenue')}</th><th /></tr></thead>
          <tbody>{lignes.map((x) => (
            <tr key={x.id}><td>{x.designation}{x.reference_fabricant && <div className="mute">{x.reference_fabricant}</div>}</td>
              <td><Statut statut={x.criticite === 'strategique' ? 'att' : 'neutre'} libelle={t(`pieces.criticites.${x.criticite}`)} /></td>
              <td className="mute">{x.disponibilite_ans != null ? t('pieces.ans', { n: x.disponibilite_ans }) : '—'}{x.delai_jours != null ? ` · ${t('pieces.jours', { n: x.delai_jours })}` : ''}</td>
              <td className="num">{peut ? <input type="number" min={0.01} step="any" style={{ width: 80 }} defaultValue={x.quantite} aria-label={t('champs.quantite')}
                onBlur={(e) => { const q = Number(e.target.value); if (q !== Number(x.quantite)) void maj(x, { quantite: q }); }} /> : x.quantite}</td>
              <td className="num">{montant(x.prix_unitaire_client, x.devise, langue)}</td><td className="num">{montant(x.montant, x.devise, langue)}</td>
              <td><input type="checkbox" checked={x.retenue_client} disabled={!peut} aria-label={t('pieces.retenue')} onChange={(e) => void maj(x, { retenue_client: e.target.checked })} /></td>
              <td className="num">{peut && <Bouton petit onClick={() => void retirer(x)}>{t('commun.retirer')}</Bouton>}</td></tr>))}</tbody></table>
      )}
      {Object.keys(totaux).length > 0 && <div>{t('pieces.total_retenu')} : {Object.entries(totaux).map(([d, m]) => montant(m, d, langue)).join(' + ')}</div>}
      <p className="mute">{t('pieces.aide_devis')}</p>
    </section>
  );
}

/** Catalogue des pièces du fournisseur d'une commande (achats et administratrice). */
export function CataloguePieces({ dossierId, fournisseurId }: { dossierId: string; fournisseurId: string }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const l = useAsync(async () => ok(await supabase.from('pieces_rechange').select('*').eq('dossier_id', dossierId).eq('fournisseur_id', fournisseurId).order('designation')) as
    { id: string; designation: string; reference_fabricant: string | null; criticite: string; prix_fournisseur: number; devise: string; quantite_recommandee: number;
      disponibilite_ans: number | null; delai_jours: number | null }[], [dossierId, fournisseurId]);
  const a = useAction();
  const [f, setF] = useState({ designation: '', reference_fabricant: '', criticite: 'rechange', prix_fournisseur: '', devise: 'USD', quantite_recommandee: '1', disponibilite_ans: '', delai_jours: '' });
  const ajouter = async () => {
    const entier = (s: string) => (s.trim() === '' ? null : Number(s)) as number | null;
    const v = z.object({ dossier_id: z.string().uuid(), fournisseur_id: z.string().uuid(), designation: z.string().trim().min(2).max(200),
      reference_fabricant: z.string().trim().max(80).nullable(), criticite: z.enum(CRITICITES), prix_fournisseur: z.number().positive().max(1e10),
      devise: z.enum(['USD', 'CNY', 'EUR']), quantite_recommandee: z.number().positive().max(100000),
      disponibilite_ans: z.number().int().min(0).max(50).nullable(), delai_jours: z.number().int().min(0).max(365).nullable() }).strict()
      .safeParse({ dossier_id: dossierId, fournisseur_id: fournisseurId, designation: f.designation, reference_fabricant: f.reference_fabricant.trim() || null,
        criticite: f.criticite, prix_fournisseur: Number(f.prix_fournisseur.replace(',', '.')), devise: f.devise, quantite_recommandee: Number(f.quantite_recommandee.replace(',', '.')),
        disponibilite_ans: entier(f.disponibilite_ans), delai_jours: entier(f.delai_jours) });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('pieces_rechange').insert(v.data)))) {
      setF({ ...f, designation: '', reference_fabricant: '', prix_fournisseur: '', quantite_recommandee: '1' }); void l.recharger();
    }
  };
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="section-titre">{t('pieces.titre_catalogue')}</div>
      <Bandeau type="err">{l.erreur ?? a.erreur}</Bandeau>
      {(l.data ?? []).length === 0 ? <span className="mute">{t('pieces.aucune_catalogue')}</span> : (
        <table className="t"><tbody>{(l.data ?? []).map((x) => (
          <tr key={x.id}><td>{x.designation}<div className="mute">{x.reference_fabricant ?? ''}</div></td><td>{t(`pieces.criticites.${x.criticite}`)}</td>
            <td className="num">{montant(x.prix_fournisseur, x.devise, langue)}</td><td className="num">× {x.quantite_recommandee}</td>
            <td className="mute">{x.disponibilite_ans != null ? t('pieces.ans', { n: x.disponibilite_ans }) : '—'}{x.delai_jours != null ? ` · ${t('pieces.jours', { n: x.delai_jours })}` : ''}</td></tr>))}</tbody></table>
      )}
      <div className="actions" style={{ flexWrap: 'wrap' }}>
        <input placeholder={t('pieces.designation')} aria-label={t('pieces.designation')} maxLength={200} value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} />
        <input placeholder={t('pieces.reference')} aria-label={t('pieces.reference')} maxLength={80} value={f.reference_fabricant} onChange={(e) => setF({ ...f, reference_fabricant: e.target.value })} />
        <select value={f.criticite} aria-label={t('pieces.criticite')} onChange={(e) => setF({ ...f, criticite: e.target.value })}>{CRITICITES.map((c) => <option key={c} value={c}>{t(`pieces.criticites.${c}`)}</option>)}</select>
        <input inputMode="decimal" placeholder={t('pieces.prix_fournisseur')} aria-label={t('pieces.prix_fournisseur')} value={f.prix_fournisseur} onChange={(e) => setF({ ...f, prix_fournisseur: e.target.value })} style={{ width: 110 }} />
        <select value={f.devise} aria-label={t('lc.devise')} onChange={(e) => setF({ ...f, devise: e.target.value })}>{['USD', 'CNY', 'EUR'].map((d) => <option key={d}>{d}</option>)}</select>
        <input inputMode="decimal" placeholder={t('pieces.quantite_recommandee')} aria-label={t('pieces.quantite_recommandee')} value={f.quantite_recommandee} onChange={(e) => setF({ ...f, quantite_recommandee: e.target.value })} style={{ width: 80 }} />
        <input inputMode="numeric" placeholder={t('pieces.disponibilite_ans')} aria-label={t('pieces.disponibilite_ans')} value={f.disponibilite_ans} onChange={(e) => setF({ ...f, disponibilite_ans: e.target.value.replace(/\D/g, '') })} style={{ width: 90 }} />
        <input inputMode="numeric" placeholder={t('pieces.delai_jours')} aria-label={t('pieces.delai_jours')} value={f.delai_jours} onChange={(e) => setF({ ...f, delai_jours: e.target.value.replace(/\D/g, '') })} style={{ width: 90 }} />
        <Bouton petit disabled={a.enCours} onClick={() => void ajouter()}>{t('commun.ajouter')}</Bouton>
      </div>
      <p className="mute">{t('pieces.aide_catalogue')}</p>
    </section>
  );
}
