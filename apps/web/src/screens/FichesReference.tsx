// Commercial · Fiches de référence clients (M34, lot 2 ; maquette REF).
// Générées depuis un dossier clos ; délais tenus calculés par la base ; publication dans la plaquette
// seulement anonymisée, ou nominative avec l'accord écrit du client (règle vérifiée en base).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { nombre } from '../lib/format';
import { Bandeau, Bouton, Champ, Chargement, Entete, Statut, Tiroir, Vide } from '../components/ui';

interface Fiche {
  id: string; dossier_id: string; reference: string; besoin: string | null; solution: string | null; delais_tenus: boolean | null;
  ecart_cout_global: number | null; anonymisee: boolean; accord: string; accord_preuve: string | null; publiee_le: string | null;
  dossiers: { reference: string; intitule: string; segment: string | null; clients: { raison_sociale: string; pays: string } | null } | null;
}
const TON_ACCORD: Record<string, string> = { accorde: 'ok', demande: 'att', refuse: 'err', non_demande: 'neutre' };

export function FichesReference() {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const a = useAction();
  const l = useAsync(async () => ok(await supabase.from('fiches_reference')
    .select('*, dossiers(reference, intitule, segment, clients(raison_sociale, pays))').order('cree_le', { ascending: false }).limit(500)) as Fiche[], []);
  const [sel, setSel] = useState<string | null>(null);
  const [generer, setGenerer] = useState(false);
  const [edition, setEdition] = useState(false);
  const tous = l.data ?? [];
  const x = tous.find((f) => f.id === sel) ?? tous[0] ?? null;
  const [f, setF] = useState({ besoin: '', solution: '', ecart: '', preuve: '', accord: 'non_demande' });
  useEffect(() => {
    if (x) setF({ besoin: x.besoin ?? '', solution: x.solution ?? '', ecart: x.ecart_cout_global === null ? '' : String(x.ecart_cout_global), preuve: x.accord_preuve ?? '', accord: x.accord });
  }, [x?.id, x?.besoin, x?.solution, x?.ecart_cout_global, x?.accord, x?.accord_preuve]); // eslint-disable-line react-hooks/exhaustive-deps
  const publiables = tous.filter((y) => y.besoin && y.solution && (y.anonymisee || y.accord === 'accorde')).length;
  const enAttente = tous.filter((y) => y.accord === 'demande').length;
  const titre = [t('ref.titre_publiables', { n: publiables }), enAttente ? t('ref.titre_attente', { n: enAttente }) : null].filter(Boolean).join(' ; ');
  const nomClient = (y: Fiche) => (y.anonymisee ? t('ref.client_anonyme', { segment: y.dossiers?.segment ?? t('ref.secteur'), pays: y.dossiers?.clients?.pays ?? '' })
    : y.dossiers?.clients?.raison_sociale ?? '—');
  const appel = async (fn: string, args: Record<string, unknown>) => { if (await a.executer(async () => ok(await supabase.rpc(fn, args)))) { void l.recharger(); return true; } return false; };
  const enregistrer = async () => {
    if (!x) return;
    const v = z.object({ besoin: z.string().trim().max(2000), solution: z.string().trim().max(2000), ecart_cout_global: z.number().min(-100).max(100).nullable() }).strict()
      .safeParse({ besoin: f.besoin, solution: f.solution, ecart_cout_global: f.ecart.trim() === '' ? null : Number(f.ecart.replace(',', '.')) });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    await appel('modifier_fiche_reference', { p_fiche: x.id, p: v.data });
  };
  const accord = async () => {
    if (!x) return;
    const v = z.object({ p_fiche: z.string().uuid(), p_accord: z.enum(['non_demande', 'demande', 'accorde', 'refuse']), p_preuve: z.string().trim().max(300).nullable() }).strict()
      .safeParse({ p_fiche: x.id, p_accord: f.accord, p_preuve: f.preuve.trim() || null });
    if (!v.success || (f.accord === 'accorde' && f.preuve.trim().length < 3)) { a.setErreur(t('ref.preuve_requise')); return; }
    await appel('accord_fiche_reference', v.data);
  };
  const fige = Boolean(x?.publiee_le);
  const pct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${nombre(Math.abs(v), langue, 0)} %`);
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.commercial')} · ${t('ref.surtitre')} · REF`} titre={l.data ? titre : t('ecrans.fiches_reference')}
        actions={<Bouton variante="primaire" onClick={() => setGenerer(true)}>{t('ref.generer')}</Bouton>} />
      <Bandeau type="err">{l.erreur ?? a.erreur}</Bandeau>
      <div className="ref-grille">
        <div className="cadre">
          {l.chargement && !l.data ? <Chargement /> : tous.length === 0 ? <Vide>{t('ref.aucune')}</Vide> : (
            <table className="t"><thead><tr><th>{t('ref.fiche')}</th><th>{t('ref.client')}</th><th className="num">{t('ref.cout')}</th><th>{t('ref.accord')}</th></tr></thead>
              <tbody>{tous.map((y) => (
                <tr key={y.id} className={'cliquable' + (x?.id === y.id ? ' choisi' : '')} onClick={() => { setSel(y.id); setEdition(false); }}>
                  <td className="ref">{y.reference}{y.publiee_le && <div className="txt-ok" style={{ fontSize: 12 }}>{t('ref.publiee')}</div>}</td>
                  <td>{y.dossiers?.clients?.raison_sociale ?? '—'}</td>
                  <td className={'num' + ((y.ecart_cout_global ?? 0) < 0 ? ' txt-ok' : '')}>{pct(y.ecart_cout_global)}</td>
                  <td><Statut statut={TON_ACCORD[y.accord]} libelle={t(`ref.accords.${y.accord}`)} /></td></tr>))}</tbody></table>
          )}
        </div>
        {x && (
          <div className="ref-detail">
            <div className="ref-carte">
              <div className="ref-tete">
                <div><div className="surtitre ref-surtitre">{t('ref.reference', { ref: x.reference })}</div>
                  <div className="cons-action">{x.dossiers?.clients?.raison_sociale ?? '—'}</div>
                  {x.anonymisee && <div className="mute">{t('ref.publiee_sous', { nom: nomClient(x) })}</div>}</div>
                {!fige && <Bouton petit onClick={() => setEdition(!edition)}>{t(edition ? 'ref.fermer' : 'ref.modifier')}</Bouton>}
              </div>
              {edition && !fige ? <>
                <Champ label={t('ref.besoin')}><textarea rows={3} maxLength={2000} value={f.besoin} onChange={(e) => setF({ ...f, besoin: e.target.value })} /></Champ>
                <Champ label={t('ref.solution')}><textarea rows={3} maxLength={2000} value={f.solution} onChange={(e) => setF({ ...f, solution: e.target.value })} /></Champ>
                <Champ label={t('ref.ecart')}><input inputMode="decimal" value={f.ecart} placeholder="-18" onChange={(e) => setF({ ...f, ecart: e.target.value })} /></Champ>
                <Bouton disabled={a.enCours} onClick={() => void enregistrer()}>{t('ref.enregistrer')}</Bouton>
                <Champ label={t('ref.accord')}><select value={f.accord} onChange={(e) => setF({ ...f, accord: e.target.value })}>
                  {['non_demande', 'demande', 'accorde', 'refuse'].map((v) => <option key={v} value={v}>{t(`ref.accords.${v}`)}</option>)}</select></Champ>
                {f.accord === 'accorde' && <Champ label={t('ref.preuve')}><input maxLength={300} value={f.preuve} placeholder={t('ref.preuve_exemple')} onChange={(e) => setF({ ...f, preuve: e.target.value })} /></Champ>}
                {f.accord !== x.accord && <Bouton disabled={a.enCours} onClick={() => void accord()}>{t('ref.enregistrer_accord')}</Bouton>}
              </> : <>
                <div className="ref-champ"><span>{t('ref.besoin')}</span><p>{x.besoin ?? '—'}</p></div>
                <div className="ref-champ"><span>{t('ref.solution')}</span><p>{x.solution ?? '—'}</p></div>
                <div className="ref-chiffres">
                  <div><span>{t('ref.delais')}</span><b>{x.delais_tenus === null ? t('ref.delais_non_mesurables') : x.delais_tenus ? t('ref.tenus') : t('ref.non_tenus')}</b></div>
                  <div><span>{t('ref.ecart_court')}</span><b className={(x.ecart_cout_global ?? 0) < 0 ? 'txt-ok' : ''}>{pct(x.ecart_cout_global)}</b></div>
                </div>
                {x.accord_preuve && <div className="mute">{t('ref.preuve')} : {x.accord_preuve}</div>}
              </>}
            </div>
            <div className="ref-actions">
              <label className="bascule"><input type="checkbox" disabled={fige || a.enCours} checked={x.anonymisee}
                onChange={(e) => void appel('modifier_fiche_reference', { p_fiche: x.id, p: { anonymisee: e.target.checked } })} /> {t('ref.anonymiser')}</label>
              <span style={{ flex: 1 }} />
              <Statut statut={TON_ACCORD[x.accord]} libelle={t(`ref.accords.${x.accord}`)} />
              {fige ? <Statut statut="ok" libelle={t('ref.publiee')} />
                : <Bouton variante="primaire" disabled={a.enCours || !x.besoin || !x.solution || (!x.anonymisee && x.accord !== 'accorde')}
                  onClick={() => void appel('publier_fiche_reference', { p_fiche: x.id })}>{t('ref.publier')}</Bouton>}
            </div>
            <p className="mute" style={{ margin: 0 }}>{t('ref.aide')}</p>
          </div>
        )}
      </div>
      {generer && <GenererFiche onClose={() => setGenerer(false)} onFait={(id) => { setGenerer(false); setSel(id); void l.recharger(); }} existantes={tous.map((y) => y.dossier_id)} />}
    </div>
  );
}

function GenererFiche({ onClose, onFait, existantes }: { onClose: () => void; onFait: (id: string) => void; existantes: string[] }) {
  const { t } = useTranslation();
  const a = useAction();
  const d = useAsync(async () => ok(await supabase.from('dossiers').select('id, reference, intitule, clients(raison_sociale)').eq('statut', 'clos')
    .order('clos_le', { ascending: false }).limit(200)) as unknown as { id: string; reference: string; intitule: string; clients: { raison_sociale: string } | null }[], []);
  const libres = (d.data ?? []).filter((x) => !existantes.includes(x.id));
  const lancer = async (id: string) => {
    let r = '';
    if (await a.executer(async () => { r = ok(await supabase.rpc('generer_fiche_reference', { p_dossier: id })) as string; }) && r) onFait(r);
  };
  return (
    <Tiroir titre={t('ref.generer')} onClose={onClose}>
      <p className="sec">{t('ref.aide_generer')}</p>
      <Bandeau type="err">{d.erreur ?? a.erreur}</Bandeau>
      {d.chargement && !d.data ? <Chargement /> : libres.length === 0 ? <Vide>{t('ref.aucun_dossier_clos')}</Vide> : libres.map((x) => (
        <div key={x.id} className="ligne-montant"><span><b>{x.reference}</b> · {x.intitule}<br /><span className="mute">{x.clients?.raison_sociale}</span></span>
          <Bouton petit disabled={a.enCours} onClick={() => void lancer(x.id)}>{t('ref.generer_court')}</Bouton></div>))}
    </Tiroir>
  );
}
