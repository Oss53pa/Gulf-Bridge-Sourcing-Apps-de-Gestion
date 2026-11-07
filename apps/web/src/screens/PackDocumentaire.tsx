// Lot 1, M9 : pack documentaire banque et douane par expédition, et contrôle du projet de
// connaissement. Les fichiers sont lus par URL signée (droits appliqués par la base) puis
// assemblés en une archive dans le navigateur, sous des noms tirés des codes de pièces.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { dateHeure } from '../lib/format';
import { urlSignee } from '../lib/fichiers';
import { creerZip, type Entree } from '../lib/zip';
import { Bandeau, Bouton, Champ, Statut, Tiroir } from '../components/ui';
import { Depot } from '../components/Depot';

interface Element { ordre: number; code: string; obligatoire: boolean; present: boolean; chemin?: string | null; reference?: string | null;
  certificat_lc_id?: string | null; numero?: string | null; selon_lc?: boolean }
interface Pack { expedition: string; dossier: string; lettre_credit: string | null; complet: boolean; elements: Element[] }
interface Controle { id: string; conforme: boolean; ecarts: { code: string; projet?: unknown; reference?: unknown }[]; controle_le: string }
const MAX_PACK = 60 * 1024 * 1024;

export function PackDocumentaire({ expeditionId, dossierId }: { expeditionId: string; dossierId: string }) {
  const { t } = useTranslation();
  const { profil, langue, fuseau } = useAuth();
  const achats = ['admin', 'achats_chine'].includes(profil?.role ?? '');
  const p = useAsync(async () => ok(await supabase.rpc('pack_documentaire', { p_expedition: expeditionId })) as Pack, [expeditionId]);
  const c = useAsync(async () => ok(await supabase.from('controles_connaissement').select('id, conforme, ecarts, controle_le')
    .eq('expedition_id', expeditionId).order('controle_le', { ascending: false }).limit(5)) as Controle[], [expeditionId]);
  const a = useAction();
  const [projet, setProjet] = useState(false);
  const telecharger = async () => {
    const x = p.data;
    if (!x) return;
    await a.executer(async () => {
      const entrees: Entree[] = [];
      let total = 0;
      const sommaire: string[] = [`Pack documentaire ${x.expedition} — dossier ${x.dossier}${x.lettre_credit ? ` — ${x.lettre_credit}` : ''}`, ''];
      for (const el of x.elements) {
        const libelle = t(`pack.codes.${el.code}`);
        if (el.reference) sommaire.push(`${el.ordre}. ${libelle} : ${el.reference}`);
        if (el.certificat_lc_id) sommaire.push(`${el.ordre}. ${libelle} : ${el.numero ?? ''} (${t('pack.imprimer_certificat')})`);
        if (!el.chemin) { if (!el.reference && !el.certificat_lc_id) sommaire.push(`${el.ordre}. ${libelle} : ${el.present ? '' : t('pack.manquant')}`); continue; }
        const ext = el.chemin.split('.').pop() ?? 'pdf';
        const url = await urlSignee(el.chemin);
        if (!url) throw new Error('GBS_ACCES_REFUSE');
        const r = await fetch(url);
        if (!r.ok) throw new Error('GBS_ACCES_REFUSE');
        const octets = new Uint8Array(await r.arrayBuffer());
        total += octets.length;
        if (total > MAX_PACK) throw new Error('GBS_FICHIER_TAILLE');
        entrees.push({ nom: `${String(el.ordre).padStart(2, '0')}_${el.code}.${ext}`, octets });
        sommaire.push(`${el.ordre}. ${libelle} : ${String(el.ordre).padStart(2, '0')}_${el.code}.${ext}`);
      }
      entrees.push({ nom: 'sommaire.txt', octets: new TextEncoder().encode(sommaire.join('\r\n')) });
      const zip = creerZip(entrees, new Date());
      const lien = document.createElement('a');
      const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
      lien.href = url; lien.download = `pack_${x.expedition}.zip`;
      lien.click();
      URL.revokeObjectURL(url);
    });
  };
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="section-titre">{t('pack.titre')}</div>
      <Bandeau type="err">{p.erreur ?? c.erreur ?? a.erreur}</Bandeau>
      {p.data && <>
        <div><Statut statut={p.data.complet ? 'ok' : 'att'} libelle={p.data.complet ? t('pack.complet') : t('pack.incomplet')} />
          {p.data.lettre_credit && <span className="mute"> · {t('pack.selon_lc', { lc: p.data.lettre_credit })}</span>}</div>
        <table className="t"><tbody>{p.data.elements.map((el) => (
          <tr key={el.code}><td>{el.ordre}</td><td>{t(`pack.codes.${el.code}`)}{!el.obligatoire && <span className="mute"> · {t('pack.facultatif')}</span>}</td>
            <td>{el.present ? <Statut statut="ok" libelle={el.reference ?? el.numero ?? t('pack.present')} /> : <Statut statut={el.obligatoire ? 'err' : 'neutre'} libelle={t('pack.manquant')} />}</td>
            <td>{el.certificat_lc_id && <Link to={`/imprimer/certificat-lc/${el.certificat_lc_id}`}>{t('pack.imprimer_certificat')}</Link>}</td></tr>))}</tbody></table>
        <span className="actions"><Bouton variante="primaire" disabled={a.enCours} onClick={() => void telecharger()}>{t('pack.telecharger')}</Bouton></span>
        <p className="mute">{t('pack.aide')}</p>
      </>}
      <div className="section-titre">{t('pack.projet_connaissement')}</div>
      {(c.data ?? []).map((x) => (
        <div key={x.id}><Statut statut={x.conforme ? 'ok' : 'err'} libelle={x.conforme ? t('pack.projet_conforme') : t('pack.projet_ecarts')} />
          <span className="mute"> · {dateHeure(x.controle_le, langue, fuseau)}</span>
          {x.ecarts.map((y, k) => <div key={k} className="mute">{t(`pack.ecarts.${y.code}`)} : {JSON.stringify(y.projet ?? '')} ≠ {JSON.stringify(y.reference ?? '')}</div>)}</div>))}
      {achats && <span className="actions"><Bouton petit onClick={() => setProjet(true)}>{t('pack.controler_projet')}</Bouton></span>}
      {projet && <ControleProjet expeditionId={expeditionId} dossierId={dossierId} onClose={() => setProjet(false)} onSaved={() => { setProjet(false); void c.recharger(); void p.recharger(); }} />}
    </section>
  );
}

function ControleProjet({ expeditionId, dossierId, onClose, onSaved }: { expeditionId: string; dossierId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [f, setF] = useState({ expediteur: '', destinataire: '', notifier: '', port_chargement: '', port_dechargement: '', date_chargement: '',
    conteneurs: '', plombs: '', nombre_colis: '', poids_brut_kg: '', volume_m3: '', description: '', document: '' });
  const enregistrer = async () => {
    const txt = (n: number) => z.string().trim().min(1).max(n);
    const num = z.number().positive().max(1e8);
    const liste = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
    const donnees: Record<string, unknown> = {};
    for (const k of ['expediteur', 'destinataire', 'notifier', 'description', 'port_chargement', 'port_dechargement', 'date_chargement'] as const) if (f[k].trim()) donnees[k] = f[k].trim();
    for (const k of ['conteneurs', 'plombs'] as const) if (f[k].trim()) donnees[k] = liste(f[k]);
    for (const k of ['nombre_colis', 'poids_brut_kg', 'volume_m3'] as const) if (f[k].trim()) donnees[k] = Number(f[k].replace(',', '.'));
    const v = z.object({ expediteur: txt(1000).optional(), destinataire: txt(1000).optional(), notifier: txt(1000).optional(), description: txt(1000).optional(),
      port_chargement: txt(80).optional(), port_dechargement: txt(80).optional(), date_chargement: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      conteneurs: z.array(z.string().min(4).max(20)).max(50).optional(), plombs: z.array(z.string().min(4).max(20)).max(50).optional(),
      nombre_colis: num.optional(), poids_brut_kg: num.optional(), volume_m3: num.optional() }).strict().safeParse(donnees);
    if (!v.success || !f.document) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('controler_projet_connaissement', { p_expedition: expeditionId, p_donnees: v.data, p_document: f.document })))) onSaved();
  };
  const champ = (k: keyof typeof f, max: number, type = 'text') => (
    <Champ label={t(`pack.champs.${k}`)}><input type={type} value={f[k]} maxLength={max} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Champ>);
  return (
    <Tiroir titre={t('pack.controler_projet')} onClose={onClose}>
      <Champ label={t('pack.champs.document')}><Depot dossierId={dossierId} valeur={f.document || null} onChange={(c) => setF({ ...f, document: c })} /></Champ>
      {champ('expediteur', 1000)}{champ('destinataire', 1000)}{champ('notifier', 1000)}
      <div className="actions">{champ('port_chargement', 80)}{champ('port_dechargement', 80)}{champ('date_chargement', 10, 'date')}</div>
      {champ('conteneurs', 1000)}{champ('plombs', 1000)}
      <div className="actions">{champ('nombre_colis', 12)}{champ('poids_brut_kg', 12)}{champ('volume_m3', 12)}</div>
      {champ('description', 1000)}
      <p className="mute">{t('pack.aide_projet')}</p>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours || !f.document} onClick={() => void enregistrer()}>{t('pack.controler')}</Bouton>
    </Tiroir>
  );
}
