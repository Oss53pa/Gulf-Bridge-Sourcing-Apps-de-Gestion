import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import qrcode from 'qrcode-generator';
import i18n from '../i18n';
import { supabase } from '../lib/supabase';
import { ok, useAsync } from '../lib/data';
import { date, montant, pourcent, type Langue } from '../lib/format';
import type { Client, Constat, Dossier, DueDiligence, Facture, Fournisseur, Inspection, LigneFacture, NonConformite, Societe } from '../lib/types';
import { Bouton, Chargement, Vide } from '../components/ui';

function Qr({ texte }: { texte: string }) {
  // QR généré localement (aucun service externe) ; rendu en SVG à partir des modules.
  const svg = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(texte.slice(0, 1000));
    q.make();
    return q.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
  }, [texte]);
  return <div style={{ width: 96, height: 96 }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

function BarreImpression() {
  return (
    <div className="no-print" style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: 12 }}>
      <Bouton variante="primaire" onClick={() => window.print()}>{i18n.t('commun.imprimer')}</Bouton>
      <Bouton onClick={() => window.history.back()}>{i18n.t('coque.retour')}</Bouton>
    </div>
  );
}

/** Facture A4 dans la langue du destinataire. Les honoraires de GBS sont toujours séparés de la facture du fabricant. */
export function ImprimerFacture() {
  const { id = '' } = useParams();
  const f = useAsync(async () => ok(await supabase.from('factures').select('*').eq('id', id).single()) as Facture, [id]);
  const lignes = useAsync(async () => ok(await supabase.from('lignes_facture').select('*').eq('facture_id', id).order('ordre')) as LigneFacture[], [id]);
  const soc = useAsync(async () => (f.data ? ok(await supabase.from('societes').select('*').in('id', [f.data.societe_id, f.data.societe_dest_id].filter(Boolean) as string[])) as Societe[] : []), [f.data?.id]);
  const cli = useAsync(async () => (f.data?.client_id ? ok(await supabase.from('clients').select('*').eq('id', f.data.client_id).single()) as Client : null), [f.data?.client_id]);
  const dos = useAsync(async () => (f.data?.dossier_id ? ok(await supabase.from('dossiers').select('reference, reference_domiciliation').eq('id', f.data.dossier_id).single()) as Dossier : null), [f.data?.dossier_id]);
  if (f.chargement || soc.chargement) return <Chargement />;
  if (!f.data) return <Vide>{f.erreur}</Vide>;
  const x = f.data;
  const lg = (x.langue as Langue) ?? 'fr';
  const t = i18n.getFixedT(lg);
  const emettrice = (soc.data ?? []).find((s) => s.id === x.societe_id);
  const dest = (soc.data ?? []).find((s) => s.id === x.societe_dest_id);
  const m = (v: number) => montant(v, x.devise, lg);
  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <BarreImpression />
      <article className="doc" lang={lg === 'zh' ? 'zh-CN' : lg}>
        <header style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
          <div>
            <img src="/gbs-logo.png" alt="" width={44} height={44} />
            <div style={{ fontWeight: 600, fontSize: 14, marginTop: 6 }}>{emettrice?.raison_sociale}</div>
            <div className="mute">{t('doc.bureau_achat')}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h1>{x.type === 'avoir' ? t('doc.avoir') : t('doc.facture')}</h1>
            <div style={{ fontSize: 14 }}>{x.numero}</div>
            <div className="mute">{t('doc.date')} {date(x.date_emission, lg)} · {t('doc.echeance')} {date(x.echeance, lg)}</div>
          </div>
        </header>
        <section style={{ display: 'flex', justifyContent: 'space-between', margin: '24px 0', gap: 24 }}>
          <div><div className="surtitre">{t('doc.client')}</div><div style={{ fontSize: 14 }}>{cli.data?.raison_sociale ?? dest?.raison_sociale}</div><div className="mute">{cli.data?.pays ?? dest?.pays}</div></div>
          <div style={{ textAlign: 'right' }}><div className="surtitre">{t('doc.objet')}</div><div>{x.objet}</div>
            {dos.data && <div className="mute">{t('doc.dossier')} {dos.data.reference}{dos.data.reference_domiciliation ? ` · ${t('doc.domiciliation')} ${dos.data.reference_domiciliation}` : ''}</div>}</div>
        </section>
        <table>
          <thead><tr><th>{t('doc.designation')}</th><th className="num">{t('doc.quantite')}</th><th className="num">{t('doc.pu')}</th><th className="num">{t('doc.montant_ht')}</th></tr></thead>
          <tbody>{(lignes.data ?? []).map((l) => <tr key={l.id}><td>{l.libelle}</td><td className="num">{l.quantite}</td><td className="num">{m(l.prix_unitaire)}</td><td className="num">{m(l.montant)}</td></tr>)}</tbody>
        </table>
        <section style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18, gap: 24 }}>
          <div style={{ maxWidth: '55%' }}>
            {x.recapitulatif && <p className="mute">{t('doc.recap_projet', {
              total: montant(x.recapitulatif.forfait_total_xof, 'XOF', lg), deja: montant(x.recapitulatif.versements_factures_xof, 'XOF', lg),
              reste: montant(x.recapitulatif.reste_du_xof, 'XOF', lg) })}</p>}
            {x.type === 'commission' && <p className="mute">{t('doc.honoraires_separes')}</p>}
            {x.retenue_taux > 0 && <p className="mute">{t(x.prix_apres_retenue ? 'doc.prix_apres_retenue' : 'doc.prix_avant_retenue')}</p>}
            {x.fne_numero && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
                {x.fne_qr && <Qr texte={x.fne_qr} />}
                <div className="mute">{t('doc.fne', { n: x.fne_numero })}</div>
              </div>
            )}
          </div>
          <table style={{ width: '40%' }}><tbody>
            <tr><td>{t('doc.total_ht')}</td><td className="num">{m(x.montant_ht)}</td></tr>
            <tr><td>{t('doc.tva')} {pourcent(x.tva_taux, lg)}</td><td className="num">{m(x.tva)}</td></tr>
            <tr><td style={{ fontWeight: 600 }}>{t('doc.total_ttc')}</td><td className="num" style={{ fontWeight: 600 }}>{m(x.ttc)}</td></tr>
            {x.retenue_taux > 0 && <tr><td>{t('doc.retenue')} {pourcent(x.retenue_taux, lg)}</td><td className="num">− {m(x.retenue)}</td></tr>}
            <tr><td style={{ fontWeight: 600 }}>{t('doc.net_a_payer')}</td><td className="num" style={{ fontWeight: 600 }}>{m(x.net_a_payer)}</td></tr>
          </tbody></table>
        </section>
        <footer className="mute" style={{ marginTop: 40, borderTop: '1px solid var(--border)', paddingTop: 8 }}>{t('doc.pied', { s: emettrice?.raison_sociale ?? '' })}</footer>
      </article>
    </div>
  );
}

/** Rapport d'inspection A4 (lot 0 : français et anglais). */
export function ImprimerInspection() {
  const { id = '' } = useParams();
  const i = useAsync(async () => ok(await supabase.from('inspections').select('*').eq('id', id).single()) as Inspection, [id]);
  const cs = useAsync(async () => ok(await supabase.from('constats').select('*').eq('inspection_id', id).order('ordre')) as Constat[], [id]);
  const ncs = useAsync(async () => ok(await supabase.from('non_conformites').select('*').eq('inspection_id', id)) as NonConformite[], [id]);
  const lg = (new URLSearchParams(window.location.search).get('langue') as Langue) ?? (i18n.language as Langue);
  if (i.chargement) return <Chargement />;
  if (!i.data) return <Vide>{i.erreur}</Vide>;
  const x = i.data;
  const t = i18n.getFixedT(lg);
  const plan = x.plan;
  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'center', gap: 8, paddingTop: 12 }}>
        {(['fr', 'en', 'zh'] as Langue[]).map((l) => <a key={l} className="btn petit" href={`?langue=${l}`}>{l === 'zh' ? '中文' : l.toUpperCase()}</a>)}
      </div>
      <BarreImpression />
      <article className="doc" lang={lg === 'zh' ? 'zh-CN' : lg}>
        <header style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div><img src="/gbs-logo.png" alt="" width={44} height={44} /><div className="mute">Gulf Bridge Sourcing · {t('doc.bureau_achat')}</div></div>
          <div style={{ textAlign: 'right' }}><h1>{t('doc.rapport_inspection')}</h1><div>{x.reference}</div><div className="mute">{t(`types_inspection.${x.type}`)} · {date(x.date_realisee, lg)}</div></div>
        </header>
        <section style={{ margin: '20px 0' }}>
          <table><tbody>
            <tr><td>{t('doc.produit')}</td><td>{x.produit ?? '—'}</td><td>{t('doc.lieu')}</td><td>{x.lieu ?? '—'}</td></tr>
            <tr><td>{t('doc.taille_lot')}</td><td>{x.taille_lot}</td><td>{t('doc.niveau')}</td><td>{x.niveau} · ISO 2859-1</td></tr>
          </tbody></table>
        </section>
        {plan && <table><thead><tr><th>{t('doc.classe')}</th><th>NQA</th><th>{t('doc.lettre')}</th><th className="num">n</th><th className="num">Ac / Re</th><th className="num">{t('doc.trouves')}</th></tr></thead>
          <tbody>{(['critique', 'majeur', 'mineur'] as const).map((k) => (
            <tr key={k}><td>{t(`gravites.${k}`)}</td><td>{k === 'critique' ? x.nqa_critique : k === 'majeur' ? x.nqa_majeur : x.nqa_mineur}</td><td>{plan[k].lettre}</td><td className="num">{plan[k].n}</td>
              <td className="num">{plan[k].ac} / {plan[k].re}</td><td className="num">{k === 'critique' ? x.defauts_critiques : k === 'majeur' ? x.defauts_majeurs : x.defauts_mineurs}</td></tr>))}</tbody></table>}
        <h2 style={{ fontSize: 18, margin: '20px 0 8px' }}>{t('doc.points_controle')}</h2>
        <table><thead><tr><th>#</th><th>{t('inspections.point')}</th><th>{t('inspections.exigence')}</th><th>{t('inspections.mesure')}</th><th>{t('inspections.resultat')}</th></tr></thead>
          <tbody>{(cs.data ?? []).map((c) => <tr key={c.id}><td>{c.ordre}</td><td>{c.point}</td><td>{c.exigence ?? ''}</td><td>{c.mesure ?? ''}</td><td>{t(`resultats.${c.resultat}`)}{c.gravite ? ` · ${t(`gravites.${c.gravite}`)}` : ''}</td></tr>)}</tbody></table>
        {(ncs.data ?? []).length > 0 && <>
          <h2 style={{ fontSize: 18, margin: '20px 0 8px' }}>{t('inspections.non_conformites')}</h2>
          <table><tbody>{(ncs.data ?? []).map((n) => <tr key={n.id}><td>{n.reference}</td><td>{t(`gravites.${n.gravite}`)}</td><td>{n.description}</td><td>{t(`statuts_nc.${n.statut}`)}</td></tr>)}</tbody></table>
        </>}
        <section style={{ marginTop: 24, padding: 12, border: '1px solid var(--ink)' }}>
          <div className="surtitre">{t('doc.decision')}</div>
          <div style={{ fontSize: 16 }}>{x.decision ? t(`decisions.${x.decision}`) : t('doc.en_attente')} · {t('doc.proposee')} {x.decision_proposee ? t(`decisions.${x.decision_proposee}`) : '—'}</div>
          {x.conclusion && <p>{x.conclusion}</p>}
        </section>
        {lg === 'zh' && <p className="mute">{t('doc.zh_lot1')}</p>}
      </article>
    </div>
  );
}

/** Rapport de due diligence A4 (lot 0 : français et anglais ; chinois au lot 1). */
export function ImprimerDueDiligence() {
  const { id = '' } = useParams();
  const dd = useAsync(async () => ok(await supabase.from('due_diligences').select('*').eq('id', id).single()) as DueDiligence, [id]);
  const f = useAsync(async () => (dd.data ? ok(await supabase.from('fournisseurs').select('*').eq('id', dd.data.fournisseur_id).single()) as Fournisseur : null), [dd.data?.fournisseur_id]);
  const lg = (new URLSearchParams(window.location.search).get('langue') as Langue) ?? (i18n.language as Langue);
  if (dd.chargement) return <Chargement />;
  if (!dd.data) return <Vide>{dd.erreur}</Vide>;
  const x = dd.data;
  const t = i18n.getFixedT(lg);
  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'center', gap: 8, paddingTop: 12 }}>
        {(['fr', 'en', 'zh'] as Langue[]).map((l) => <a key={l} className="btn petit" href={`?langue=${l}`}>{l === 'zh' ? '中文' : l.toUpperCase()}</a>)}
      </div>
      <BarreImpression />
      <article className="doc" lang={lg === 'zh' ? 'zh-CN' : lg}>
        <header style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div><img src="/gbs-logo.png" alt="" width={44} height={44} /><div className="mute">Gulf Bridge Sourcing · {t('doc.bureau_achat')}</div></div>
          <div style={{ textAlign: 'right' }}><h1>{t('doc.rapport_dd')}</h1><div>{x.reference ?? ''}</div>
            <div className="mute">{t(`niveaux_dd.${x.niveau}`)} · {date(x.realisee_le, lg)}</div></div>
        </header>
        <section style={{ margin: '20px 0' }}>
          <div style={{ fontSize: 16 }}>{f.data?.raison_sociale_en}</div>
          <div className="mute">{f.data?.raison_sociale_zh ?? ''} {f.data?.uscc ? `· ${f.data.uscc}` : ''} {f.data?.ville ? `· ${f.data.ville}` : ''}</div>
        </section>
        <table><thead><tr><th>{t('fournisseurs.critere')}</th><th className="num">{t('fournisseurs.poids')}</th><th className="num">{t('fournisseurs.note_5')}</th><th>{t('champs.commentaire')}</th></tr></thead>
          <tbody>{x.grille.map((g) => <tr key={g.critere}><td>{g.critere}</td><td className="num">{g.poids}</td><td className="num">{g.note}</td><td>{g.commentaire ?? ''}</td></tr>)}</tbody></table>
        <section style={{ marginTop: 24, padding: 12, border: '1px solid var(--ink)' }}>
          <div className="surtitre">{t('fournisseurs.note_ponderee')}</div>
          <div style={{ fontSize: 20 }}>{x.note ?? '—'} / 100 · {t(`statuts_dd.${x.statut}`)}</div>
          <div className="mute">{x.valide_jusqu_au ? t('fournisseurs.valide_jusqu', { d: date(x.valide_jusqu_au, lg) }) : ''}</div>
          {x.conclusion && <p>{x.conclusion}</p>}
        </section>
        <p className="mute">{t('doc.dd_engagement', { d: f.data?.engagement_non_commission_le ? date(f.data.engagement_non_commission_le, lg) : '—' })}</p>
        {lg === 'zh' && <p className="mute">{t('doc.zh_lot1')}</p>}
      </article>
    </div>
  );
}
