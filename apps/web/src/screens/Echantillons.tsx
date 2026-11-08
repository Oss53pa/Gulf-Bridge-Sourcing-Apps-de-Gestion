// Lot 1, M5 : échantillons d'un dossier — demande, envoi, réception, évaluation, coût, refacturation
// au client ou prise en charge par GBS. Les règles (états, justificatif, refacturation unique) sont en base.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date } from '../lib/format';
import { useNoms } from '../lib/referentiels';
import { Depot } from '../components/Depot';
import { Bandeau, Bouton, Champ, Statut, Tiroir, Vide } from '../components/ui';

interface Echantillon { id: string; dossier_id: string; fournisseur_id: string; designation: string; quantite: number; statut: string; demande_le: string;
  transporteur: string | null; numero_suivi: string | null; envoye_le: string | null; recu_le: string | null; lieu_reception: string | null;
  evaluation: string | null; avis: string | null; motif_annulation: string | null; cout_id: string | null; prise_en_charge: string | null;
  motif_prise_en_charge: string | null; ligne_facture_id: string | null }
const STATUT = { demande: 'neutre', expedie: 'info', recu: 'att', evalue: 'ok', annule: 'err' } as const;
const aujourdhui = () => new Date().toISOString().slice(0, 10);

export function EchantillonsDossier({ dossierId }: { dossierId: string }) {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const role = profil?.role ?? '';
  const achats = ['admin', 'achats_chine'].includes(role);
  const reception = achats || role === 'hub_afrique';
  const facture = ['admin', 'hub_afrique'].includes(role);
  const fournisseurs = useNoms('fournisseurs');
  const l = useAsync(async () => ok(await supabase.from('echantillons').select('*').eq('dossier_id', dossierId).order('demande_le')) as Echantillon[], [dossierId]);
  const fs = useAsync(async () => (achats ? ok(await supabase.from('fournisseurs').select('id, raison_sociale_en').is('archive_le', null).order('raison_sociale_en')) as { id: string; raison_sociale_en: string }[] : []), [achats]);
  const brouillons = useAsync(async () => (facture ? ok(await supabase.from('factures').select('id, objet, devise').eq('dossier_id', dossierId).eq('statut', 'brouillon').is('societe_dest_id', null)) as { id: string; objet: string; devise: string }[] : []), [dossierId, facture]);
  const a = useAction();
  const [n, setN] = useState({ fournisseur_id: '', designation: '', quantite: '1' });
  const [sel, setSel] = useState<Echantillon | null>(null);
  const creer = async () => {
    const v = z.object({ dossier_id: z.string().uuid(), fournisseur_id: z.string().uuid(), designation: z.string().trim().min(2).max(200), quantite: z.number().positive().max(10000) }).strict()
      .safeParse({ dossier_id: dossierId, fournisseur_id: n.fournisseur_id, designation: n.designation, quantite: Number(n.quantite.replace(',', '.')) });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('echantillons').insert(v.data)))) { setN({ ...n, designation: '', quantite: '1' }); void l.recharger(); }
  };
  const refacturer = async (x: Echantillon, f: string) => {
    if (await a.executer(async () => ok(await supabase.rpc('refacturer_echantillon', { p_echantillon: x.id, p_facture: f })))) void l.recharger();
  };
  const liste = l.data ?? [];
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Bandeau type="err">{l.erreur ?? a.erreur}</Bandeau>
      {liste.length === 0 ? <Vide>{t('echantillons.aucun')}</Vide> : (
        <table className="t"><thead><tr><th>{t('echantillons.designation')}</th><th>{t('champs.fournisseur')}</th><th>{t('champs.statut')}</th><th>{t('echantillons.suivi')}</th><th>{t('echantillons.cout')}</th><th /></tr></thead>
          <tbody>{liste.map((x) => (
            <tr key={x.id}><td>{x.designation}<div className="mute">× {x.quantite} · {date(x.demande_le, langue)}</div></td>
              <td className="sec">{fournisseurs[x.fournisseur_id] ?? ''}</td>
              <td><Statut statut={STATUT[x.statut as keyof typeof STATUT] ?? 'neutre'} libelle={t(`echantillons.statuts.${x.statut}`)} />
                {x.evaluation && <div className="mute">{t(`echantillons.evaluations.${x.evaluation}`)}</div>}</td>
              <td className="mute">{x.numero_suivi ? `${x.transporteur} · ${x.numero_suivi}` : '—'}{x.recu_le && <div>{t('echantillons.recu_le', { d: date(x.recu_le, langue) })}</div>}</td>
              <td>{x.prise_en_charge ? t(`echantillons.prises.${x.prise_en_charge}`) : '—'}
                {x.prise_en_charge === 'client' && <div className="mute">{x.ligne_facture_id ? t('echantillons.refacture') : t('echantillons.a_refacturer')}</div>}</td>
              <td className="num"><span className="actions" style={{ justifyContent: 'flex-end' }}>
                {(achats || reception) && <Bouton petit onClick={() => setSel(x)}>{t('echantillons.gerer')}</Bouton>}
                {facture && x.prise_en_charge === 'client' && !x.ligne_facture_id && (brouillons.data ?? []).length > 0 && (
                  <select aria-label={t('echantillons.refacturer')} value="" onChange={(e) => e.target.value && void refacturer(x, e.target.value)}>
                    <option value="">{t('echantillons.refacturer')}</option>
                    {(brouillons.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.objet} ({f.devise})</option>)}</select>)}
              </span></td></tr>))}</tbody></table>
      )}
      {achats && (
        <div className="actions" style={{ flexWrap: 'wrap' }}>
          <select aria-label={t('champs.fournisseur')} value={n.fournisseur_id} onChange={(e) => setN({ ...n, fournisseur_id: e.target.value })}>
            <option value="">{t('champs.fournisseur')}</option>{(fs.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.raison_sociale_en}</option>)}</select>
          <input placeholder={t('echantillons.designation')} aria-label={t('echantillons.designation')} maxLength={200} value={n.designation} onChange={(e) => setN({ ...n, designation: e.target.value })} />
          <input inputMode="decimal" aria-label={t('champs.quantite')} value={n.quantite} onChange={(e) => setN({ ...n, quantite: e.target.value })} style={{ width: 70 }} />
          <Bouton petit disabled={a.enCours} onClick={() => void creer()}>{t('echantillons.demander')}</Bouton>
        </div>
      )}
      <p className="mute">{t('echantillons.aide')}</p>
      {sel && <GestionEchantillon x={sel} achats={achats} onClose={() => setSel(null)} onFait={() => { setSel(null); void l.recharger(); }} />}
    </section>
  );
}

function GestionEchantillon({ x, achats, onClose, onFait }: { x: Echantillon; achats: boolean; onClose: () => void; onFait: () => void }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const a = useAction();
  const [f, setF] = useState({ transporteur: '', numero_suivi: '', envoye_le: aujourdhui(), recu_le: aujourdhui(), lieu_reception: '', evaluation: 'conforme', avis: '', motif: '' });
  const [c, setC] = useState({ montant: '', devise: 'CNY', date: aujourdhui(), justificatif: null as string | null, prise: 'client', motif: '' });
  const suivre = async (statut: string, infos: Record<string, string>) => {
    if (await a.executer(async () => ok(await supabase.rpc('suivre_echantillon', { p_echantillon: x.id, p_statut: statut, p_infos: infos })))) onFait();
  };
  const cout = async () => {
    const v = z.object({ p_echantillon: z.string().uuid(), p_montant: z.number().positive().max(1e9), p_devise: z.enum(['CNY', 'USD', 'XOF', 'XAF', 'EUR']),
      p_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), p_justificatif: z.string().min(10), p_prise_en_charge: z.enum(['client', 'gbs']),
      p_motif: z.string().trim().max(1000).nullable() }).strict()
      .safeParse({ p_echantillon: x.id, p_montant: Number(c.montant.replace(',', '.')), p_devise: c.devise, p_date: c.date, p_justificatif: c.justificatif ?? '',
        p_prise_en_charge: c.prise, p_motif: c.prise === 'gbs' ? c.motif : null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('enregistrer_cout_echantillon', v.data)))) onFait();
  };
  return (
    <Tiroir titre={x.designation} onClose={onClose}>
      <div className="sec">{t(`echantillons.statuts.${x.statut}`)} · {date(x.demande_le, langue)}</div>
      {x.avis && <p>{x.avis}</p>}
      {x.motif_annulation && <p className="mute">{x.motif_annulation}</p>}
      <Bandeau type="err">{a.erreur}</Bandeau>
      {achats && x.statut === 'demande' && <>
        <div className="section-titre">{t('echantillons.envoi')}</div>
        <Champ label={t('echantillons.transporteur')}><input maxLength={80} value={f.transporteur} onChange={(e) => setF({ ...f, transporteur: e.target.value })} /></Champ>
        <Champ label={t('echantillons.numero_suivi')}><input maxLength={40} value={f.numero_suivi} onChange={(e) => setF({ ...f, numero_suivi: e.target.value })} /></Champ>
        <Champ label={t('echantillons.envoye_le')}><input type="date" max={aujourdhui()} value={f.envoye_le} onChange={(e) => setF({ ...f, envoye_le: e.target.value })} /></Champ>
        <Bouton variante="primaire" disabled={a.enCours} onClick={() => void suivre('expedie', { transporteur: f.transporteur, numero_suivi: f.numero_suivi.trim(), envoye_le: f.envoye_le })}>{t('echantillons.marquer_expedie')}</Bouton>
      </>}
      {x.statut === 'expedie' && <>
        <div className="section-titre">{t('echantillons.reception')}</div>
        <Champ label={t('echantillons.recu_le_champ')}><input type="date" max={aujourdhui()} value={f.recu_le} onChange={(e) => setF({ ...f, recu_le: e.target.value })} /></Champ>
        <Champ label={t('echantillons.lieu')}><input maxLength={120} value={f.lieu_reception} onChange={(e) => setF({ ...f, lieu_reception: e.target.value })} /></Champ>
        <Bouton variante="primaire" disabled={a.enCours} onClick={() => void suivre('recu', { recu_le: f.recu_le, lieu_reception: f.lieu_reception })}>{t('echantillons.marquer_recu')}</Bouton>
      </>}
      {x.statut === 'recu' && <>
        <div className="section-titre">{t('echantillons.evaluation')}</div>
        <Champ label={t('echantillons.evaluation')}><select value={f.evaluation} onChange={(e) => setF({ ...f, evaluation: e.target.value })}>
          {['conforme', 'non_conforme'].map((v) => <option key={v} value={v}>{t(`echantillons.evaluations.${v}`)}</option>)}</select></Champ>
        <Champ label={t('echantillons.avis')}><textarea maxLength={2000} value={f.avis} onChange={(e) => setF({ ...f, avis: e.target.value })} /></Champ>
        <Bouton variante="primaire" disabled={a.enCours} onClick={() => void suivre('evalue', { evaluation: f.evaluation, avis: f.avis })}>{t('echantillons.enregistrer_avis')}</Bouton>
      </>}
      {achats && ['demande', 'expedie'].includes(x.statut) && <>
        <Champ label={t('echantillons.motif_annulation')}><input maxLength={1000} value={f.motif} onChange={(e) => setF({ ...f, motif: e.target.value })} /></Champ>
        <Bouton variante="danger" disabled={a.enCours} onClick={() => void suivre('annule', { motif: f.motif })}>{t('echantillons.annuler')}</Bouton>
      </>}
      {achats && !x.cout_id && <>
        <div className="section-titre">{t('echantillons.cout')}</div>
        <div className="actions">
          <input inputMode="decimal" aria-label={t('champs.montant')} placeholder={t('champs.montant')} value={c.montant} onChange={(e) => setC({ ...c, montant: e.target.value })} style={{ width: 110 }} />
          <select aria-label={t('champs.devise')} value={c.devise} onChange={(e) => setC({ ...c, devise: e.target.value })}>{['CNY', 'USD', 'XOF', 'XAF', 'EUR'].map((d) => <option key={d}>{d}</option>)}</select>
          <input type="date" aria-label={t('champs.date')} max={aujourdhui()} value={c.date} onChange={(e) => setC({ ...c, date: e.target.value })} />
        </div>
        <Champ label={t('echantillons.justificatif')}><Depot dossierId={x.dossier_id} valeur={c.justificatif} onChange={(ch) => setC({ ...c, justificatif: ch })} /></Champ>
        <Champ label={t('echantillons.prise_en_charge')}><select value={c.prise} onChange={(e) => setC({ ...c, prise: e.target.value })}>
          {['client', 'gbs'].map((v) => <option key={v} value={v}>{t(`echantillons.prises.${v}`)}</option>)}</select></Champ>
        {c.prise === 'gbs' && <Champ label={t('echantillons.motif_prise')}><input maxLength={1000} value={c.motif} onChange={(e) => setC({ ...c, motif: e.target.value })} /></Champ>}
        <Bouton disabled={a.enCours} onClick={() => void cout()}>{t('echantillons.enregistrer_cout')}</Bouton>
      </>}
      {x.cout_id && <p className="mute">{t(`echantillons.prises.${x.prise_en_charge}`)}{x.motif_prise_en_charge ? ` — ${x.motif_prise_en_charge}` : ''}</p>}
    </Tiroir>
  );
}
