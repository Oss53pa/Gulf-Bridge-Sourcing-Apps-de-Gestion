// Lot 1, M32 : dossier qualité de fin de fabrication au format du client final — contenu
// rassemblé par la base, PDF assemblé dans le navigateur (URL signées), remise tracée.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, dateHeure } from '../lib/format';
import { urlSignee } from '../lib/fichiers';
import type { Piece, Section } from '../lib/pdfQualite';
import { Bandeau, Bouton, Champ, Statut, Tiroir } from '../components/ui';

type Element = Record<string, unknown> & { titre?: string; chemin?: string | null };
interface SectionQ { code: string; libelle: string | null; obligatoire: boolean; present: boolean; elements: Element[] }
interface Contenu { dossier: string; intitule: string; client: string; referentiel: string; reference_client: string | null; complet: boolean; sections: SectionQ[] }
const CODES = ['certificats', 'rapports_inspection', 'essais', 'non_conformites', 'approbation', 'tracabilite', 'due_diligence', 'engagement_ethique', 'reception'] as const;
const MAX = 80 * 1024 * 1024;

export function DossierQualite({ dossierId, clientId }: { dossierId: string; clientId: string }) {
  const { t } = useTranslation();
  const { profil, langue, fuseau } = useAuth();
  const role = profil?.role ?? '';
  const q = useAsync(async () => ok(await supabase.rpc('dossier_qualite', { p_dossier: dossierId })) as Contenu, [dossierId]);
  const em = useAsync(async () => ok(await supabase.from('dossiers_qualite_emis').select('version, complet, emis_le').eq('dossier_id', dossierId).order('version', { ascending: false })) as
    { version: number; complet: boolean; emis_le: string }[], [dossierId]);
  const a = useAction();
  const [motif, setMotif] = useState('');
  const [series, setSeries] = useState(false);
  const [referentiel, setReferentiel] = useState(false);
  const titre = (s: SectionQ) => s.libelle || t(`qualite.sections.${s.code}`);
  const ligne = (s: SectionQ, e: Element): string => {
    switch (s.code) {
      case 'rapports_inspection': return `${e.titre} · ${t(`types_inspection.${e.type}`)} · ${date(e.date as string, langue)} · ${e.decision ? t(`decisions.${e.decision}`) : '—'} · ${t('qualite.lot', { n: e.taille_lot, niveau: e.niveau })} · ${t('qualite.defauts', { d: (e.defauts as number[]).join(' / ') })}`;
      case 'essais': return `${e.titre} · ${date(e.date as string, langue)} · ${e.conforme ? t('essais.conforme') : t('essais.non_conforme')}\n${((e.resultats as { critere: string; attendu: string; mesure: string; conforme: boolean }[]) ?? []).map((r) => `  ${r.conforme ? '✓' : '✗'} ${r.critere} : ${r.attendu || '—'} / ${r.mesure || '—'}`).join('\n')}`;
      case 'non_conformites': return `${e.titre} · ${t(`gravites.${e.gravite}`)} · ${t(`statuts_nc.${e.statut}`)} · ${e.description}${e.correction ? ` → ${e.correction}` : ''}`;
      case 'approbation': return `${e.titre} · ${e.signataire ?? ''} · ${date(e.date as string, langue)}`;
      case 'tracabilite': return `${e.commande} · ${e.article} · ${e.numero}`;
      case 'due_diligence': return `${e.titre} · ${e.fournisseur} · ${t('qualite.note', { n: e.note ?? '—' })} · ${t('qualite.validite', { d: date(e.valide_jusqu_au as string, langue) })}${e.conclusion ? `\n${e.conclusion}` : ''}`;
      case 'engagement_ethique': return `${e.titre} · ${t('qualite.signe_le', { d: date(e.signe_le as string, langue) })}`;
      case 'reception': return `${e.titre} · ${date(e.date as string, langue)} · ${t(`reception.statuts.${e.statut}`)}`;
      default: return String(e.titre ?? '');
    }
  };
  const generer = async () => {
    const c = q.data;
    if (!c) return;
    await a.executer(async () => {
      const pieces: Piece[] = [];
      let total = 0;
      for (const s of c.sections) for (const e of s.elements) {
        if (!e.chemin) continue;
        const ext = (e.chemin.split('.').pop() ?? '').toLowerCase();
        if (!['pdf', 'jpg', 'png'].includes(ext)) continue;
        const url = await urlSignee(e.chemin);
        if (!url) throw new Error('GBS_ACCES_REFUSE');
        const r = await fetch(url);
        if (!r.ok) throw new Error('GBS_ACCES_REFUSE');
        const octets = new Uint8Array(await r.arrayBuffer());
        total += octets.length;
        if (total > MAX) throw new Error('GBS_FICHIER_TAILLE');
        pieces.push({ section: s.code, titre: String(e.titre ?? s.code), octets, type: ext as Piece['type'] });
      }
      const sections: Section[] = c.sections.map((s) => ({ code: s.code, titre: titre(s), obligatoire: s.obligatoire, present: s.present, lignes: s.elements.map((e) => ligne(s, e)) }));
      // pdf-lib n'est chargé qu'à la génération (bundle principal allégé).
      const { assemblerDossierQualite } = await import('../lib/pdfQualite');
      const pdf = await assemblerDossierQualite({
        titre: `${t('qualite.titre_pdf')} — ${c.dossier}`,
        sousTitre: [c.intitule, c.client, `${t('qualite.referentiel')} : ${c.referentiel}${c.reference_client ? ` (${c.reference_client})` : ''}`, date(new Date().toISOString(), langue)],
        sections, libelles: { sommaire: t('qualite.sommaire'), manquant: t('pack.manquant'), present: t('pack.present'), annexe: t('qualite.annexe'), page: t('qualite.page') },
      }, pieces);
      const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
      const lien = document.createElement('a');
      lien.href = url; lien.download = `dossier_qualite_${c.dossier}.pdf`; lien.click();
      URL.revokeObjectURL(url);
    });
  };
  const emettre = async () => {
    if (await a.executer(async () => ok(await supabase.rpc('emettre_dossier_qualite', { p_dossier: dossierId, p_motif: motif.trim() || null })))) { setMotif(''); void em.recharger(); }
  };
  const c = q.data;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="section-titre">{t('qualite.titre')}</div>
      <Bandeau type="err">{q.erreur ?? em.erreur ?? a.erreur}</Bandeau>
      {c && <>
        <div><Statut statut={c.complet ? 'ok' : 'att'} libelle={c.complet ? t('pack.complet') : t('pack.incomplet')} />
          <span className="mute"> · {t('qualite.referentiel')} : {c.referentiel}{c.reference_client ? ` (${c.reference_client})` : ''}</span></div>
        <table className="t"><tbody>{c.sections.map((s, i) => (
          <tr key={s.code}><td>{i + 1}</td><td>{titre(s)}{!s.obligatoire && <span className="mute"> · {t('pack.facultatif')}</span>}</td>
            <td>{s.present ? <Statut statut="ok" libelle={t('qualite.elements', { n: s.elements.length })} /> : <Statut statut={s.obligatoire ? 'err' : 'neutre'} libelle={t('pack.manquant')} />}</td></tr>))}</tbody></table>
        <span className="actions" style={{ flexWrap: 'wrap' }}>
          <Bouton variante="primaire" disabled={a.enCours} onClick={() => void generer()}>{t('qualite.generer_pdf')}</Bouton>
          {['admin', 'achats_chine'].includes(role) && <Bouton onClick={() => setSeries(true)}>{t('qualite.numeros_serie')}</Bouton>}
          {['admin', 'hub_afrique'].includes(role) && <Bouton onClick={() => setReferentiel(true)}>{t('qualite.referentiel_client')}</Bouton>}
        </span>
        <div className="actions" style={{ flexWrap: 'wrap' }}>
          {!c.complet && role === 'admin' && <input value={motif} maxLength={1000} placeholder={t('champs.motif')} aria-label={t('champs.motif')} onChange={(e) => setMotif(e.target.value)} />}
          <Bouton disabled={a.enCours || (!c.complet && (role !== 'admin' || motif.trim().length < 5))} onClick={() => void emettre()}>{t('qualite.enregistrer_remise')}</Bouton>
        </div>
        {(em.data ?? []).map((x) => <div key={x.version} className="mute">v{x.version} · {dateHeure(x.emis_le, langue, fuseau)}{x.complet ? '' : ` · ${t('pack.incomplet')}`}</div>)}
        <p className="mute">{t('qualite.aide')}</p>
      </>}
      {series && <NumerosSerie dossierId={dossierId} onClose={() => setSeries(false)} onSaved={() => { setSeries(false); void q.recharger(); }} />}
      {referentiel && <Referentiel clientId={clientId} onClose={() => setReferentiel(false)} onSaved={() => { setReferentiel(false); void q.recharger(); }} />}
    </section>
  );
}

function NumerosSerie({ dossierId, onClose, onSaved }: { dossierId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const lignes = useAsync(async () => ok(await supabase.from('lignes_commande').select('id, quantite, commandes(reference), articles(designation)').eq('dossier_id', dossierId)) as unknown as
    { id: string; quantite: number; commandes: { reference: string } | null; articles: { designation: string } | null }[], [dossierId]);
  const [f, setF] = useState({ ligne: '', numeros: '' });
  const enregistrer = async () => {
    const nums = f.numeros.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    const v = z.object({ ligne: z.string().uuid(), numeros: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9./_-]{0,79}$/)).min(1).max(500) }).strict()
      .safeParse({ ligne: f.ligne, numeros: nums });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('numeros_serie').insert(v.data.numeros.map((numero) => ({ ligne_commande_id: v.data.ligne, numero })))))) onSaved();
  };
  return (
    <Tiroir titre={t('qualite.numeros_serie')} onClose={onClose}>
      <Champ label={t('qualite.ligne')}><select value={f.ligne} onChange={(e) => setF({ ...f, ligne: e.target.value })}>
        <option value="">—</option>{(lignes.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.commandes?.reference} · {l.articles?.designation} · {l.quantite}</option>)}</select></Champ>
      <Champ label={t('qualite.numeros')}><textarea rows={8} maxLength={20000} value={f.numeros} onChange={(e) => setF({ ...f, numeros: e.target.value })} /></Champ>
      <p className="mute">{t('qualite.aide_numeros')}</p>
      <Bandeau type="err">{lignes.erreur ?? a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

function Referentiel({ clientId, onClose, onSaved }: { clientId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const ex = useAsync(async () => ok(await supabase.from('listes_qualite_client').select('*').eq('client_id', clientId).maybeSingle()) as
    { intitule: string; reference: string | null; sections: { code: string; obligatoire: boolean; libelle?: string }[] } | null, [clientId]);
  const [f, setF] = useState<{ intitule: string; reference: string; sections: { code: string; obligatoire: boolean; libelle: string; actif: boolean }[] } | null>(null);
  const v0 = f ?? (ex.chargement ? null : {
    intitule: ex.data?.intitule ?? '', reference: ex.data?.reference ?? '',
    sections: [...(ex.data?.sections ?? []).map((s) => ({ code: s.code, obligatoire: s.obligatoire, libelle: s.libelle ?? '', actif: true })),
      ...CODES.filter((c) => !(ex.data?.sections ?? []).some((s) => s.code === c)).map((c) => ({ code: c, obligatoire: false, libelle: '', actif: !ex.data }))],
  });
  if (!v0) return null;
  const maj = (k: number, p: Partial<(typeof v0.sections)[number]>) => setF({ ...v0, sections: v0.sections.map((s, i) => (i === k ? { ...s, ...p } : s)) });
  const deplacer = (k: number, d: number) => { const s = [...v0.sections]; const j = k + d; if (j < 0 || j >= s.length) return; [s[k], s[j]] = [s[j], s[k]]; setF({ ...v0, sections: s }); };
  const enregistrer = async () => {
    const v = z.object({ client_id: z.string().uuid(), intitule: z.string().trim().min(3).max(200), reference: z.string().trim().max(80).nullable(),
      sections: z.array(z.object({ code: z.enum(CODES), obligatoire: z.boolean(), libelle: z.string().trim().max(120).optional() }).strict()).min(1).max(20) }).strict()
      .safeParse({ client_id: clientId, intitule: v0.intitule, reference: v0.reference.trim() || null,
        sections: v0.sections.filter((s) => s.actif).map((s) => ({ code: s.code, obligatoire: s.obligatoire, ...(s.libelle.trim() ? { libelle: s.libelle.trim() } : {}) })) });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => {
      if (ex.data) ok(await supabase.from('listes_qualite_client').update({ intitule: v.data.intitule, reference: v.data.reference, sections: v.data.sections }).eq('client_id', clientId));
      else ok(await supabase.from('listes_qualite_client').insert(v.data));
    })) onSaved();
  };
  return (
    <Tiroir titre={t('qualite.referentiel_client')} onClose={onClose}>
      <Champ label={t('qualite.intitule')}><input value={v0.intitule} maxLength={200} onChange={(e) => setF({ ...v0, intitule: e.target.value })} /></Champ>
      <Champ label={t('qualite.reference')}><input value={v0.reference} maxLength={80} onChange={(e) => setF({ ...v0, reference: e.target.value })} /></Champ>
      {v0.sections.map((s, k) => (
        <div key={s.code} className="actions" style={{ flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={s.actif} onChange={(e) => maj(k, { actif: e.target.checked })} />{t(`qualite.sections.${s.code}`)}</label>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={s.obligatoire} disabled={!s.actif} onChange={(e) => maj(k, { obligatoire: e.target.checked })} />{t('qualite.obligatoire')}</label>
          <input placeholder={t('qualite.libelle_client')} aria-label={t('qualite.libelle_client')} maxLength={120} value={s.libelle} disabled={!s.actif} onChange={(e) => maj(k, { libelle: e.target.value })} />
          <Bouton petit onClick={() => deplacer(k, -1)}>↑</Bouton><Bouton petit onClick={() => deplacer(k, 1)}>↓</Bouton>
        </div>
      ))}
      <p className="mute">{t('qualite.aide_referentiel')}</p>
      <Bandeau type="err">{ex.erreur ?? a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}
