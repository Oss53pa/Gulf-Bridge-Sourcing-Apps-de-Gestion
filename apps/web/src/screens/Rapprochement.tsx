// Lot 1, M11 : import des relevés bancaires et rapprochement avec les encaissements et paiements.
// Le fichier est lu dans le navigateur ; la base revalide chaque ligne, l'équilibre et les doublons,
// puis rapproche automatiquement sur la référence de transaction. Le pointage reste à la finance.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, montant } from '../lib/format';
import { useNoms } from '../lib/referentiels';
import { formatReleve, lireCamt053, lireMt940, lireTableur, ReleveIllisible, type Releve } from '../lib/releves';
import { Bandeau, Bouton, CadreTableau, Champ, Entete, Kpis, Onglets, Statut, Tiroir, Vide } from '../components/ui';

interface Compte { id: string; societe_id: string; libelle: string; banque: string; numero: string; devise: string; actif: boolean }
interface Ligne { id: string; releve_id: string; date_operation: string; montant: number; devise: string; libelle: string; reference: string | null;
  contrepartie: string | null; statut: 'a_rapprocher' | 'rapprochee' | 'classee'; encaissement_id: string | null; paiement_id: string | null;
  classement: string | null; motif: string | null; automatique: boolean }
interface Proposition { type: 'encaissement' | 'paiement'; id: string; reference: string | null; date_op: string; montant: number; devise: string; ecart: number; libelle: string }
interface NonConfirme { encaissement_id: string; facture: string; societe: string; recu_le: string; montant: number; devise: string; mode: string; reference: string | null; jours: number }
type Onglet = 'operations' | 'import' | 'non_confirmes' | 'comptes';
const TAILLE_MAX = 5 * 1024 * 1024;

async function sha256(octets: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', octets))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function Rapprochement() {
  const { t } = useTranslation();
  const { profil } = useAuth();
  const [onglet, setOnglet] = useState<Onglet>('operations');
  const comptes = useAsync(async () => ok(await supabase.from('comptes_bancaires').select('*').order('libelle')) as Compte[], []);
  const [compteId, setCompteId] = useState('');
  const actif = compteId || comptes.data?.[0]?.id || '';
  const items: { id: Onglet; lib: string }[] = [{ id: 'operations', lib: t('banque.operations') }, { id: 'import', lib: t('banque.importer') },
    { id: 'non_confirmes', lib: t('banque.non_confirmes') }];
  if (profil?.role === 'admin') items.push({ id: 'comptes', lib: t('banque.comptes') });
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.finance')} · M11`} titre={t('banque.titre')}
        actions={(comptes.data ?? []).length > 0 && (
          <select aria-label={t('banque.compte')} value={actif} onChange={(e) => setCompteId(e.target.value)}>
            {(comptes.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.libelle} · {c.devise} · {c.numero.slice(-6)}</option>)}</select>)} />
      <Bandeau type="err">{comptes.erreur}</Bandeau>
      <Onglets items={items} actif={onglet} onChange={setOnglet} />
      {onglet === 'operations' && (actif ? <Operations compteId={actif} /> : <Vide>{t('banque.aucun_compte')}</Vide>)}
      {onglet === 'import' && (actif ? <Import compte={(comptes.data ?? []).find((c) => c.id === actif)!} onFait={() => setOnglet('operations')} />
        : <Vide>{t('banque.aucun_compte')}</Vide>)}
      {onglet === 'non_confirmes' && <NonConfirmes />}
      {onglet === 'comptes' && <Comptes liste={comptes.data ?? []} onChange={() => void comptes.recharger()} />}
    </div>
  );
}

function Operations({ compteId }: { compteId: string }) {
  const { t } = useTranslation();
  const { langue, profil } = useAuth();
  const [filtre, setFiltre] = useState<'a_rapprocher' | 'toutes'>('a_rapprocher');
  const l = useAsync(async () => {
    let q = supabase.from('lignes_releve').select('*').eq('compte_id', compteId).order('date_operation', { ascending: false }).limit(1000);
    if (filtre === 'a_rapprocher') q = q.eq('statut', 'a_rapprocher');
    return ok(await q) as Ligne[];
  }, [compteId, filtre]);
  const [sel, setSel] = useState<Ligne | null>(null);
  const a = useAction();
  const annuler = async (x: Ligne) => {
    const motif = window.prompt(t('banque.motif_annulation')) ?? '';
    if (await a.executer(async () => ok(await supabase.rpc('annuler_rapprochement', { p_ligne: x.id, p_motif: motif })))) void l.recharger();
  };
  const liste = l.data ?? [];
  return (
    <>
      <Bandeau type="err">{l.erreur ?? a.erreur}</Bandeau>
      <div className="actions">
        <select aria-label={t('banque.filtre')} value={filtre} onChange={(e) => setFiltre(e.target.value as typeof filtre)}>
          <option value="a_rapprocher">{t('banque.statuts.a_rapprocher')}</option><option value="toutes">{t('banque.toutes')}</option></select>
      </div>
      <CadreTableau>
        {liste.length === 0 ? <Vide>{t('banque.rien_a_rapprocher')}</Vide> : (
          <table className="t"><thead><tr><th>{t('champs.date')}</th><th>{t('banque.libelle')}</th><th className="num">{t('champs.montant')}</th><th>{t('banque.statut')}</th><th /></tr></thead>
            <tbody>{liste.map((x) => (
              <tr key={x.id}><td className="ref">{date(x.date_operation, langue)}</td>
                <td>{x.libelle}<div className="mute">{[x.reference, x.contrepartie].filter(Boolean).join(' · ')}</div></td>
                <td className="num" style={{ color: x.montant < 0 ? 'var(--err)' : undefined }}>{montant(x.montant, x.devise, langue)}</td>
                <td><Statut statut={x.statut === 'a_rapprocher' ? 'att' : 'ok'} libelle={t(`banque.statuts.${x.statut}`) + (x.automatique ? ` · ${t('banque.auto')}` : '')} />
                  {x.classement && <div className="mute">{t(`banque.classements.${x.classement}`)} — {x.motif}</div>}</td>
                <td className="num">{x.statut === 'a_rapprocher'
                  ? <Bouton petit onClick={() => setSel(x)}>{t('banque.rapprocher')}</Bouton>
                  : profil?.role === 'admin' && <Bouton petit disabled={a.enCours} onClick={() => void annuler(x)}>{t('banque.annuler')}</Bouton>}</td></tr>))}</tbody></table>
        )}
      </CadreTableau>
      <p className="mute">{t('banque.aide_operations')}</p>
      {sel && <Pointage ligne={sel} onClose={() => setSel(null)} onFait={() => { setSel(null); void l.recharger(); }} />}
    </>
  );
}

function Pointage({ ligne, onClose, onFait }: { ligne: Ligne; onClose: () => void; onFait: () => void }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const dossiers = useNoms('dossiers');
  const p = useAsync(async () => ok(await supabase.rpc('propositions_rapprochement', { p_ligne: ligne.id })) as Proposition[], [ligne.id]);
  const a = useAction();
  const [cl, setCl] = useState({ classement: ligne.montant < 0 ? 'frais_bancaires' : 'autre', motif: '', dossier: '' });
  const pointer = async (x: Proposition) => {
    const args = x.type === 'encaissement' ? { p_ligne: ligne.id, p_encaissement: x.id } : { p_ligne: ligne.id, p_paiement: x.id };
    if (await a.executer(async () => ok(await supabase.rpc('pointer_ligne_releve', args)))) onFait();
  };
  const classer = async () => {
    const v = z.object({ p_ligne: z.string().uuid(), p_classement: z.enum(['frais_bancaires', 'virement_interne', 'autre']), p_motif: z.string().trim().min(5).max(1000),
      p_dossier: z.string().uuid().nullable() }).strict()
      .safeParse({ p_ligne: ligne.id, p_classement: cl.classement, p_motif: cl.motif, p_dossier: cl.classement === 'frais_bancaires' && cl.dossier ? cl.dossier : null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('classer_ligne_releve', v.data)))) onFait();
  };
  return (
    <Tiroir titre={`${date(ligne.date_operation, langue)} · ${montant(ligne.montant, ligne.devise, langue)}`} onClose={onClose}>
      <div className="sec">{ligne.libelle}</div>
      <Bandeau type="err">{p.erreur ?? a.erreur}</Bandeau>
      <div className="section-titre">{t('banque.propositions')}</div>
      {(p.data ?? []).length === 0 ? <Vide>{t('banque.aucune_proposition')}</Vide> : (
        <table className="t"><tbody>{(p.data ?? []).map((x) => (
          <tr key={x.id}><td>{t(`banque.types.${x.type}`)} · {x.libelle}<div className="mute">{x.reference ?? ''} · {date(x.date_op, langue)}</div></td>
            <td className="num">{montant(x.montant, x.devise, langue)}{Number(x.ecart) !== 0 && <div className="mute">{t('banque.ecart_frais', { m: montant(x.ecart, x.devise, langue) })}</div>}</td>
            <td className="num"><Bouton petit variante="primaire" disabled={a.enCours} onClick={() => void pointer(x)}>{t('banque.pointer')}</Bouton></td></tr>))}</tbody></table>
      )}
      <div className="section-titre">{t('banque.classer')}</div>
      <Champ label={t('banque.classement')}>
        <select value={cl.classement} onChange={(e) => setCl({ ...cl, classement: e.target.value })}>
          {(ligne.montant < 0 ? ['frais_bancaires', 'virement_interne', 'autre'] : ['virement_interne', 'autre']).map((c) => <option key={c} value={c}>{t(`banque.classements.${c}`)}</option>)}</select></Champ>
      {cl.classement === 'frais_bancaires' && (
        <Champ label={t('banque.dossier_frais')}>
          <select value={cl.dossier} onChange={(e) => setCl({ ...cl, dossier: e.target.value })}>
            <option value="">{t('banque.frais_generaux')}</option>
            {Object.entries(dossiers).map(([id, nom]) => <option key={id} value={id}>{nom}</option>)}</select></Champ>)}
      <Champ label={t('banque.motif')}><input maxLength={1000} value={cl.motif} onChange={(e) => setCl({ ...cl, motif: e.target.value })} /></Champ>
      <Bouton disabled={a.enCours} onClick={() => void classer()}>{t('banque.classer')}</Bouton>
    </Tiroir>
  );
}

function Import({ compte, onFait }: { compte: Compte; onFait: () => void }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const a = useAction();
  const [fichier, setFichier] = useState<{ contenu: string; empreinte: string } | null>(null);
  const [soldes, setSoldes] = useState({ ouverture: '', cloture: '' });
  const [lu, setLu] = useState<Releve | null>(null);
  const [resultat, setResultat] = useState<{ importees: number; doublons: number; rapprochees: number } | null>(null);
  const lire = (contenu: string, s = soldes) => {
    setLu(null); a.setErreur(null);
    try {
      const f = formatReleve(contenu);
      const r = f === 'camt053' ? lireCamt053(contenu) : f === 'mt940' ? lireMt940(contenu)
        : lireTableur(contenu, Number(s.ouverture.replace(/\s/g, '').replace(',', '.')), Number(s.cloture.replace(/\s/g, '').replace(',', '.')));
      if (r.devise && r.devise !== compte.devise) { a.setErreur(t('banque.autre_devise', { d: r.devise })); return; }
      if (r.compte && !r.compte.endsWith(compte.numero.slice(-8))) { a.setErreur(t('banque.autre_compte')); return; }
      setLu(r);
    } catch (e) {
      a.setErreur(e instanceof ReleveIllisible ? t('banque.illisible', { motif: e.message }) : t('banque.illisible', { motif: '—' }));
    }
  };
  const choisir = async (f: File | undefined) => {
    setResultat(null); setLu(null);
    if (!f) return;
    if (f.size > TAILLE_MAX) { a.setErreur(t('banque.trop_gros')); return; }
    const octets = await f.arrayBuffer();
    const contenu = new TextDecoder('utf-8').decode(octets);
    setFichier({ contenu, empreinte: await sha256(octets) });
    lire(contenu);
  };
  const envoyer = async () => {
    if (!lu || !fichier) return;
    let r: { importees: number; doublons: number; rapprochees: number }[] = [];
    const fait = await a.executer(async () => {
      r = ok(await supabase.rpc('importer_releve', { p_compte: compte.id, p_format: lu.format, p_empreinte: fichier.empreinte,
        p_date_debut: lu.debut, p_date_fin: lu.fin, p_solde_ouverture: lu.ouverture, p_solde_cloture: lu.cloture, p_lignes: lu.lignes })) as typeof r;
    });
    if (fait) { setResultat(r[0] ?? null); setLu(null); setFichier(null); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p className="mute">{t('banque.aide_import')}</p>
      <input type="file" accept=".xml,.sta,.mt940,.txt,.csv" aria-label={t('banque.fichier')} onChange={(e) => void choisir(e.target.files?.[0])} />
      {fichier && formatReleve(fichier.contenu) === 'tableur' && (
        <div className="actions">
          <Champ label={t('banque.solde_ouverture')}><input inputMode="decimal" value={soldes.ouverture} onChange={(e) => setSoldes({ ...soldes, ouverture: e.target.value })} /></Champ>
          <Champ label={t('banque.solde_cloture')}><input inputMode="decimal" value={soldes.cloture} onChange={(e) => setSoldes({ ...soldes, cloture: e.target.value })} /></Champ>
          <Bouton petit onClick={() => lire(fichier.contenu)}>{t('banque.relire')}</Bouton>
        </div>)}
      <Bandeau type="err">{a.erreur}</Bandeau>
      {resultat && <Bandeau type="ok">{t('banque.resultat', resultat)}</Bandeau>}
      {resultat && <Bouton petit onClick={onFait}>{t('banque.voir_operations')}</Bouton>}
      {lu && <>
        <Kpis items={[
          { lib: t('banque.periode'), val: `${date(lu.debut, langue)} → ${date(lu.fin, langue)}`, sous: t(`banque.formats.${lu.format}`) },
          { lib: t('banque.solde_ouverture'), val: montant(lu.ouverture, compte.devise, langue), sous: '' },
          { lib: t('banque.solde_cloture'), val: montant(lu.cloture, compte.devise, langue), sous: t('banque.nb_operations', { n: lu.lignes.length }) },
        ]} />
        <CadreTableau><table className="t"><tbody>{lu.lignes.slice(0, 200).map((x, i) => (
          <tr key={i}><td className="ref">{date(x.date_operation, langue)}</td><td>{x.libelle}<div className="mute">{x.reference ?? ''}</div></td>
            <td className="num">{montant(x.montant, compte.devise, langue)}</td></tr>))}</tbody></table></CadreTableau>
        <Bouton variante="primaire" disabled={a.enCours} onClick={() => void envoyer()}>{t('banque.confirmer_import')}</Bouton>
      </>}
    </div>
  );
}

function NonConfirmes() {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const l = useAsync(async () => ok(await supabase.rpc('encaissements_non_confirmes', { p_jours: null })) as NonConfirme[], []);
  return (
    <>
      <Bandeau type="err">{l.erreur}</Bandeau>
      <CadreTableau>
        {(l.data ?? []).length === 0 ? <Vide>{t('banque.tout_confirme')}</Vide> : (
          <table className="t"><thead><tr><th>{t('banque.facture')}</th><th>{t('banque.recu_le')}</th><th className="num">{t('champs.montant')}</th><th>{t('banque.reference')}</th></tr></thead>
            <tbody>{(l.data ?? []).map((x) => (
              <tr key={x.encaissement_id}><td className="ref">{x.facture}<div className="mute">{x.societe}</div></td>
                <td>{date(x.recu_le, langue)}<div className="mute">{t('banque.depuis_jours', { n: x.jours })}</div></td>
                <td className="num">{montant(x.montant, x.devise, langue)}</td><td className="mute">{x.reference ?? '—'}</td></tr>))}</tbody></table>
        )}
      </CadreTableau>
      <p className="mute">{t('banque.aide_non_confirmes')}</p>
    </>
  );
}

function Comptes({ liste, onChange }: { liste: Compte[]; onChange: () => void }) {
  const { t } = useTranslation();
  const societes = useNoms('societes');
  const a = useAction();
  const [f, setF] = useState({ societe_id: '', libelle: '', banque: '', numero: '', devise: 'XOF' });
  const ajouter = async () => {
    const v = z.object({ societe_id: z.string().uuid(), libelle: z.string().trim().min(2).max(120), banque: z.string().trim().min(2).max(200),
      numero: z.string().regex(/^[A-Z0-9]{8,34}$/), devise: z.enum(['XOF', 'XAF', 'USD', 'CNY', 'EUR']) }).strict()
      .safeParse({ ...f, numero: f.numero.replace(/\s/g, '').toUpperCase() });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('comptes_bancaires').insert(v.data)))) { setF({ ...f, libelle: '', banque: '', numero: '' }); onChange(); }
  };
  const basculer = async (c: Compte) => { if (await a.executer(async () => ok(await supabase.from('comptes_bancaires').update({ actif: !c.actif }).eq('id', c.id)))) onChange(); };
  return (
    <>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <CadreTableau>
        {liste.length === 0 ? <Vide>{t('banque.aucun_compte')}</Vide> : (
          <table className="t"><tbody>{liste.map((c) => (
            <tr key={c.id}><td>{c.libelle}<div className="mute">{c.banque}</div></td><td className="sec">{societes[c.societe_id] ?? ''}</td><td className="ref">{c.numero}</td>
              <td>{c.devise}</td><td className="num"><Bouton petit onClick={() => void basculer(c)}>{c.actif ? t('banque.desactiver') : t('banque.activer')}</Bouton></td></tr>))}</tbody></table>
        )}
      </CadreTableau>
      <div className="actions" style={{ flexWrap: 'wrap' }}>
        <select aria-label={t('commissions.societe')} value={f.societe_id} onChange={(e) => setF({ ...f, societe_id: e.target.value })}>
          <option value="">—</option>{Object.entries(societes).map(([id, nom]) => <option key={id} value={id}>{nom}</option>)}</select>
        <input placeholder={t('banque.libelle_compte')} aria-label={t('banque.libelle_compte')} maxLength={120} value={f.libelle} onChange={(e) => setF({ ...f, libelle: e.target.value })} />
        <input placeholder={t('banque.banque')} aria-label={t('banque.banque')} maxLength={200} value={f.banque} onChange={(e) => setF({ ...f, banque: e.target.value })} />
        <input placeholder={t('banque.numero')} aria-label={t('banque.numero')} maxLength={42} value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} />
        <select aria-label={t('champs.devise')} value={f.devise} onChange={(e) => setF({ ...f, devise: e.target.value })}>{['XOF', 'XAF', 'USD', 'CNY', 'EUR'].map((d) => <option key={d}>{d}</option>)}</select>
        <Bouton petit disabled={a.enCours} onClick={() => void ajouter()}>{t('commun.ajouter')}</Bouton>
      </div>
      <p className="mute">{t('banque.aide_comptes')}</p>
    </>
  );
}
