import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, montant, nombre, pourcent } from '../lib/format';
import type { Client, Dossier, Facture, LigneFacture, Paiement } from '../lib/types';
import { Bandeau, Bouton, CadreTableau, Champ, Chargement, Entete, Kpis, Onglets, Statut, Tiroir, Vide } from '../components/ui';
import { useNoms } from '../lib/referentiels';
import { Qr } from './Imprimes';

type Filtre = 'toutes' | 'a_encaisser' | 'retard' | 'fne' | 'reglees';
const TYPES = ['forfait_consultation', 'forfait_projet', 'commission', 'accord_cadre', 'installation', 'due_diligence', 'controle_qualite',
  'inspection', 'logistique', 'visite_usines', 'negoce'] as const;

export function Factures() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { langue, societeActive, societes, profil } = useAuth();
  const clients = useNoms('clients');
  const [filtre, setFiltre] = useState<Filtre>('toutes');
  const [creer, setCreer] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const mens = useAction();
  const l = useAsync(async () => {
    let r = supabase.from('factures').select('*').order('cree_le', { ascending: false }).limit(1000);
    if (societeActive) r = r.eq('societe_id', societeActive);
    return ok(await r) as Facture[];
  }, [societeActive]);
  const auj = new Date().toISOString().slice(0, 10);
  const liste = useMemo(() => (l.data ?? []).filter((f) => {
    if (filtre === 'a_encaisser') return ['emise', 'partiellement_payee'].includes(f.statut);
    if (filtre === 'retard') return ['emise', 'partiellement_payee'].includes(f.statut) && (f.echeance ?? '9') < auj;
    if (filtre === 'fne') return f.statut === 'en_attente_fne';
    if (filtre === 'reglees') return f.statut === 'payee';
    return true;
  }), [l.data, filtre, auj]);
  const parDevise = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of l.data ?? []) if (['emise', 'partiellement_payee'].includes(f.statut)) m[f.devise] = (m[f.devise] ?? 0) + Number(f.net_a_payer) - Number(f.encaisse);
    return m;
  }, [l.data]);
  const fne = (l.data ?? []).filter((f) => f.statut === 'en_attente_fne').length;
  const retard = (l.data ?? []).filter((f) => ['emise', 'partiellement_payee'].includes(f.statut) && (f.echeance ?? '9') < auj).length;
  const peut = ['admin', 'hub_afrique'].includes(profil?.role ?? '');
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.finance')} · M11`} titre={t('factures.titre', { n: (l.data ?? []).length, r: retard, f: fne })}
        actions={<>
          {profil?.role === 'admin' && <Bouton onClick={() => void mens.executer(async () => {
            const n = ok(await supabase.rpc('facturer_mensualites_cadre', { p_mois: new Date().toISOString().slice(0, 10) })) as number;
            setInfo(t('factures.mensualites_faites', { n })); void l.recharger();
          })}>{t('factures.facturer_mensualites')}</Bouton>}
          {peut && <Bouton variante="primaire" onClick={() => setCreer(true)}>{t('factures.nouvelle')}</Bouton>}
        </>} />
      <Bandeau type="err">{mens.erreur}</Bandeau>
      <Bandeau>{info}</Bandeau>
      {fne > 0 && <Bandeau>{t('factures.bandeau_fne', { n: fne })}</Bandeau>}
      <Kpis items={[
        { lib: `${t('factures.a_encaisser')} · XOF`, val: montant(parDevise.XOF ?? 0, 'XOF', langue).replace(' XOF', '').replace('XOF ', ''), sous: 'GBS CI' },
        { lib: `${t('factures.a_encaisser')} · USD`, val: montant(parDevise.USD ?? 0, 'USD', langue).replace(' USD', '').replace('USD ', ''), sous: 'GBS Chine' },
        { lib: t('factures.en_retard'), val: retard, sous: t('factures.relance') },
        { lib: t('factures.fne_attente'), val: fne, sous: t('factures.fne_sous') },
      ]} />
      <Onglets actif={filtre} onChange={setFiltre} items={(['toutes', 'a_encaisser', 'retard', 'fne', 'reglees'] as Filtre[]).map((id) => ({ id, lib: t(`factures.filtres.${id}`) }))} />
      <Bandeau type="err">{l.erreur}</Bandeau>
      <CadreTableau>
        {l.chargement ? <Chargement /> : liste.length === 0 ? <Vide>{t('factures.aucune')}</Vide> : (
          <table className="t"><thead><tr><th>{t('factures.numero')}</th><th>{t('factures.emettrice')}</th><th>{t('champs.client')} · {t('champs.objet')}</th><th>{t('champs.devise')}</th>
            <th className="num">TTC</th><th className="num">{t('factures.reste_du')}</th><th>{t('factures.certification')}</th><th>{t('champs.echeance')}</th><th>{t('factures.paiement')}</th></tr></thead>
            <tbody>{liste.map((f) => (
              <tr key={f.id} className="cliquable" onClick={() => nav(`/factures/${f.id}`)}>
                <td className="ref">{f.numero ?? t('factures.brouillon')}</td><td className="sec">{societes.find((s) => s.id === f.societe_id)?.raison_sociale}</td>
                <td>{f.client_id ? clients[f.client_id] : societes.find((s) => s.id === f.societe_dest_id)?.raison_sociale}<div className="mute">{f.objet}</div></td>
                <td>{f.devise}</td><td className="num">{montant(f.ttc, f.devise, langue)}</td>
                <td className="num">{['emise', 'partiellement_payee'].includes(f.statut) ? montant(Number(f.net_a_payer) - Number(f.encaisse), f.devise, langue) : '—'}</td>
                <td>{f.fne_requise ? (f.fne_numero ? <span className="chip ok">✓ {t('factures.certifiee')}</span> : <span className="chip att">⧗ {t('factures.attente_dgi')}</span>)
                  : <span className="chip">{f.devise === 'CNY' ? 'Fapiao' : t('factures.export')}</span>}</td>
                <td className="ref">{date(f.echeance, langue)}</td>
                <td><Statut statut={['emise', 'partiellement_payee'].includes(f.statut) && (f.echeance ?? '9') < auj ? 'refusee' : f.statut}
                  libelle={['emise', 'partiellement_payee'].includes(f.statut) && (f.echeance ?? '9') < auj ? t('factures.en_retard') : t(`statuts_facture.${f.statut}`)} /></td>
              </tr>))}</tbody></table>
        )}
      </CadreTableau>
      {creer && <NouvelleFacture onClose={() => setCreer(false)} onOk={(id) => nav(`/factures/${id}`)} />}
    </div>
  );
}

function NouvelleFacture({ onClose, onOk }: { onClose: () => void; onOk: (id: string) => void }) {
  const { t } = useTranslation();
  const { societes, profil } = useAuth();
  const cs = useAsync(async () => ok(await supabase.from('clients').select('*').is('archive_le', null).order('raison_sociale')) as Client[], []);
  const [f, setF] = useState({ societe_id: profil?.role === 'hub_afrique' ? (societes.find((s) => s.code === 'GBS_CI')?.id ?? '') : '', client_id: '', dossier_id: '', type: 'forfait_consultation', objet: '', devise: 'XOF', langue: 'fr', marge_ht: '' });
  const ds = useAsync(async () => (f.client_id ? ok(await supabase.from('dossiers').select('id, reference, intitule').eq('client_id', f.client_id)) as Dossier[] : []), [f.client_id]);
  const a = useAction();
  const envoyer = async () => {
    const v = z.object({ societe_id: z.string().uuid(), client_id: z.string().uuid(), dossier_id: z.string().uuid().nullable(), type: z.enum(TYPES), objet: z.string().trim().min(2).max(300),
      devise: z.enum(['XOF', 'XAF', 'USD', 'CNY']), langue: z.enum(['fr', 'en', 'zh']), marge_ht: z.number().min(0).nullable() }).strict()
      .safeParse({ ...f, dossier_id: f.dossier_id || null, marge_ht: f.marge_ht ? Number(f.marge_ht.replace(',', '.')) : null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    await a.executer(async () => { const r = ok(await supabase.from('factures').insert(v.data).select('id').single()) as { id: string }; onOk(r.id); });
  };
  return (
    <Tiroir titre={t('factures.nouvelle')} onClose={onClose}>
      <p className="sec">{t('factures.aide_societe')}</p>
      <div className="grille2">
        <Champ label={t('factures.emettrice')}><select value={f.societe_id} onChange={(e) => { const s = societes.find((x) => x.id === e.target.value); setF({ ...f, societe_id: e.target.value, devise: s?.code === 'GBS_CI' ? 'XOF' : 'USD' }); }}>
          <option value="">—</option>{societes.map((s) => <option key={s.id} value={s.id}>{s.raison_sociale}</option>)}</select></Champ>
        <Champ label={t('champs.type')}><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{TYPES.map((x) => <option key={x} value={x}>{t(`types_facture.${x}`)}</option>)}</select></Champ>
        <Champ label={t('champs.client')}><select value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value, dossier_id: '' })}>
          <option value="">—</option>{(cs.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.raison_sociale} · {c.pays}</option>)}</select></Champ>
        <Champ label={t('champs.dossier')}><select value={f.dossier_id} onChange={(e) => setF({ ...f, dossier_id: e.target.value })}>
          <option value="">—</option>{(ds.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.reference}</option>)}</select></Champ>
        <Champ label={t('champs.devise')}><select value={f.devise} onChange={(e) => setF({ ...f, devise: e.target.value })}>{['XOF', 'XAF', 'USD', 'CNY'].map((d) => <option key={d}>{d}</option>)}</select></Champ>
        <Champ label={t('champs.langue')}><select value={f.langue} onChange={(e) => setF({ ...f, langue: e.target.value })}><option value="fr">FR</option><option value="en">EN</option><option value="zh">中文</option></select></Champ>
      </div>
      <Champ label={t('champs.objet')}><input value={f.objet} maxLength={300} onChange={(e) => setF({ ...f, objet: e.target.value })} /></Champ>
      {f.type === 'negoce' && <Champ label={t('factures.marge')}><input inputMode="decimal" value={f.marge_ht} onChange={(e) => setF({ ...f, marge_ht: e.target.value })} /></Champ>}
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void envoyer()}>{t('factures.creer_brouillon')}</Bouton>
    </Tiroir>
  );
}

export function FicheFacture() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { langue, societes, profil } = useAuth();
  const clients = useNoms('clients');
  const dossiers = useNoms('dossiers');
  const f = useAsync(async () => ok(await supabase.from('factures').select('*').eq('id', id).maybeSingle()) as Facture | null, [id]);
  const lignes = useAsync(async () => ok(await supabase.from('lignes_facture').select('*').eq('facture_id', id).order('ordre').order('cree_le')) as LigneFacture[], [id]);
  const encs = useAsync(async () => ok(await supabase.from('encaissements').select('*').eq('facture_id', id).order('recu_le')) as { id: string; montant: number; devise: string; recu_le: string; mode: string; reference: string | null }[], [id]);
  const annonces = useAsync(async () => ok(await supabase.from('annonces_virements').select('id, reference, date_virement, statut, cree_le').eq('facture_id', id).order('cree_le', { ascending: false })) as
    { id: string; reference: string; date_virement: string | null; statut: string; cree_le: string }[], [id]);
  const a = useAction();
  const [ligne, setLigne] = useState({ libelle: '', service: '', quantite: '1', prix_unitaire: '' });
  const [fne, setFne] = useState<{ num: string; qr: string } | null>(null);
  const [enc, setEnc] = useState<{ montant: string; recu_le: string; mode: string; reference: string } | null>(null);
  const x = f.data;
  if (f.chargement) return <div className="screen"><Chargement /></div>;
  if (!x) return <div className="screen"><Vide>{f.erreur ?? t('factures.introuvable')}</Vide></div>;
  const peut = profil?.role === 'admin' || (profil?.role === 'hub_afrique' && societes.find((s) => s.id === x.societe_id)?.code === 'GBS_CI');
  const recharger = () => { void f.recharger(); void lignes.recharger(); void encs.recharger(); };
  const ajouter = async () => {
    const v = z.object({ libelle: z.string().trim().min(1).max(300), service: z.enum(['S1', 'S2', 'S2bis', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10']).nullable(),
      quantite: z.number().positive().max(1e6), prix_unitaire: z.number().min(-1e12).max(1e12) }).strict()
      .safeParse({ ...ligne, service: ligne.service || null, quantite: Number(ligne.quantite.replace(',', '.')), prix_unitaire: Number(ligne.prix_unitaire.replace(/\s/g, '').replace(',', '.')) });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('lignes_facture').insert({ ...v.data, facture_id: x.id, ordre: (lignes.data ?? []).length + 1 })))) { setLigne({ libelle: '', service: '', quantite: '1', prix_unitaire: '' }); recharger(); }
  };
  const emettre = async () => { if (await a.executer(async () => ok(await supabase.rpc('emettre_facture', { p_facture: x.id })))) recharger(); };
  const certifier = async () => {
    if (!fne || !/^[A-Za-z0-9-]{4,60}$/.test(fne.num) || fne.qr.length < 10 || fne.qr.length > 2000) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('certifier_fne', { p_facture: x.id, p_numero: fne.num, p_qr: fne.qr })))) { setFne(null); recharger(); }
  };
  const encaisser = async () => {
    if (!enc) return;
    const v = z.object({ montant: z.number().positive().max(1e13), recu_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), mode: z.enum(['virement', 'lettre_credit', 'cheque', 'especes', 'mobile']), reference: z.string().max(80).nullable() }).strict()
      .safeParse({ ...enc, montant: Number(enc.montant.replace(/\s/g, '').replace(',', '.')), reference: enc.reference || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('encaissements').insert({ ...v.data, facture_id: x.id, devise: x.devise })))) { setEnc(null); recharger(); }
  };
  const recap = x.recapitulatif;
  const emettrice = societes.find((s) => s.id === x.societe_id);
  const destinataire = x.client_id ? clients[x.client_id] : societes.find((s) => s.id === x.societe_dest_id)?.raison_sociale;
  const reste = Math.max(0, Number(x.net_a_payer) - Number(x.encaisse));
  const enRetard = ['emise', 'partiellement_payee'].includes(x.statut) && Boolean(x.echeance) && x.echeance! < new Date().toISOString().slice(0, 10);
  const certif = x.fne_requise ? (x.fne_numero ? ['ok', t('factures.certifiee_dgi')] : x.statut === 'en_attente_fne' ? ['att', t('factures.attente_dgi')] : ['neutre', t('factures.non_certifiee')])
    : ['neutre', t('factures.facture_export')];
  const paiement = x.statut === 'payee' ? ['ok', t('factures.reglee')] : enRetard ? ['err', t('factures.en_retard')]
    : ['emise', 'partiellement_payee'].includes(x.statut) ? ['info', t('factures.a_echoir')] : ['neutre', t(`statuts_facture.${x.statut}`)];
  const m = (v: number) => montant(v, x.devise, langue);
  return (
    <div className="screen" style={{ overflow: 'auto' }}>
      {x.statut === 'en_attente_fne' && <Bandeau>{t('factures.bandeau_attente')}</Bandeau>}
      <Bandeau type="err">{a.erreur}</Bandeau>
      <div className="fac-grille">
        <article className="fac-doc">
          <header className="fac-tete">
            <div><b>{emettrice?.raison_sociale}</b><div className="mute">{t('doc.bureau_achat')}</div></div>
            <div style={{ textAlign: 'right' }}>
              <div className="surtitre">{x.type === 'avoir' ? t('doc.avoir') : t('doc.facture')}</div>
              <b className="fac-numero">{x.numero ?? t('factures.brouillon')}</b>
              <div className="mute">{x.date_emission ? t('factures.emise_le', { d: date(x.date_emission, langue) }) : t('factures.non_emise')}
                {x.echeance ? ` · ${t('factures.echeance_le', { d: date(x.echeance, langue) })}` : ''}</div>
            </div>
          </header>
          <div className="fac-parties">
            <div><span>{t('factures.facture_a')}</span><b>{destinataire ?? '—'}</b></div>
            <div><span>{t('factures.dossier_objet')}</span><b>{x.dossier_id ? `${dossiers[x.dossier_id]} · ` : ''}{x.objet}</b></div>
          </div>
          <table className="t fac-lignes"><thead><tr><th>{t('champs.designation')}</th><th className="num">{t('champs.quantite')}</th><th className="num">{t('commandes.pu')}</th><th className="num">{t('champs.montant')}</th><th /></tr></thead>
            <tbody>{(lignes.data ?? []).length === 0 ? <tr><td colSpan={5} className="mute">{t('factures.aucune_ligne')}</td></tr> : (lignes.data ?? []).map((l) => (
              <tr key={l.id}><td>{l.libelle}{l.service && <div className="mute">{l.service} · {t(`services.${l.service}`)}</div>}</td><td className="num">{l.quantite}</td>
                <td className="num">{m(l.prix_unitaire)}</td><td className="num">{m(l.montant)}</td>
                <td className="num">{peut && x.statut === 'brouillon' && <Bouton petit variante="danger" onClick={() => void a.executer(async () => { ok(await supabase.from('lignes_facture').delete().eq('id', l.id)); recharger(); })}>{t('commun.retirer')}</Bouton>}</td></tr>))}</tbody></table>
          {peut && x.statut === 'brouillon' && (
            <div className="grille3" style={{ alignItems: 'end', gridTemplateColumns: '3fr 1fr 1fr 1fr auto' }}>
              <Champ label={t('champs.designation')}><input value={ligne.libelle} maxLength={300} onChange={(e) => setLigne({ ...ligne, libelle: e.target.value })} /></Champ>
              <Champ label={t('factures.service')}><select value={ligne.service} onChange={(e) => setLigne({ ...ligne, service: e.target.value })}>
                <option value="">—</option>{['S1', 'S2', 'S2bis', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10'].map((s) => <option key={s} value={s}>{s} · {t(`services.${s}`)}</option>)}</select></Champ>
              <Champ label={t('champs.quantite')}><input inputMode="decimal" value={ligne.quantite} onChange={(e) => setLigne({ ...ligne, quantite: e.target.value })} /></Champ>
              <Champ label={`${t('commandes.pu')} (${x.devise})`}><input inputMode="decimal" value={ligne.prix_unitaire} onChange={(e) => setLigne({ ...ligne, prix_unitaire: e.target.value })} /></Champ>
              <Bouton onClick={() => void ajouter()}>{t('commun.ajouter')}</Bouton>
            </div>
          )}
          <div className="fac-pied">
            <div className="fac-qr">{x.fne_qr ? <Qr texte={x.fne_qr} /> : <span className="mute">{x.fne_requise ? t('factures.qr_attendu') : t('factures.sans_fne')}</span>}
              {x.fne_numero && <div className="mute">{t('factures.fne_numero', { n: x.fne_numero })}</div>}</div>
            <table className="fac-totaux"><tbody>
              <tr><td>{t('doc.total_ht')}</td><td className="num">{m(x.montant_ht)}</td></tr>
              <tr><td>{t('doc.tva')} {pourcent(x.tva_taux, langue)}</td><td className="num">{m(x.tva)}</td></tr>
              <tr className="fort"><td>{t('doc.total_ttc')} · {x.devise}</td><td className="num">{m(x.ttc)}</td></tr>
              {x.retenue_taux > 0 && <tr><td>{t('doc.retenue')} {pourcent(x.retenue_taux, langue)}</td><td className="num">− {m(x.retenue)}</td></tr>}
              {x.retenue_taux > 0 && <tr className="fort"><td>{t('doc.net_a_payer')}</td><td className="num">{m(x.net_a_payer)}</td></tr>}
            </tbody></table>
          </div>
        </article>
        <aside className="fac-cote">
          <div className="actions"><Statut statut={certif[0]} libelle={certif[1]} /><Statut statut={paiement[0]} libelle={paiement[1]} /></div>
          <div className="fac-chiffres">
            <div><span>{t('factures.encaisse_court')}</span><b>{m(x.encaisse)}</b></div>
            <div><span>{t('factures.reste_du')}</span><b className={enRetard ? 'txt-err' : ''}>{m(reste)}</b></div>
          </div>
          {peut && x.statut === 'brouillon' && <Bouton variante="primaire" data-sans-glose style={{ width: '100%', justifyContent: 'center' }} disabled={a.enCours} onClick={() => void emettre()}>{t('factures.emettre')}</Bouton>}
          {peut && x.statut === 'en_attente_fne' && <Bouton variante="primaire" data-sans-glose style={{ width: '100%', justifyContent: 'center' }} onClick={() => setFne({ num: '', qr: '' })}>{t('factures.certifier')}</Bouton>}
          {peut && ['emise', 'partiellement_payee'].includes(x.statut) && <Bouton variante="primaire" data-sans-glose style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => setEnc({ montant: String(reste), recu_le: new Date().toISOString().slice(0, 10), mode: 'virement', reference: '' })}>{t('factures.rapprocher')}</Bouton>}
          {x.statut !== 'brouillon' && <Link className="btn" style={{ justifyContent: 'center' }} to={`/imprimer/facture/${x.id}`}>{t('commun.imprimer')}</Link>}
          {(annonces.data ?? []).length > 0 && <section className="fiche-bloc">
            <div className="surtitre">{t('virements.annonces')}</div>
            {(annonces.data ?? []).map((v) => (
              <div key={v.id} className="annonce-vir">
                <div className="ligne-montant"><span className="ref">{v.reference}<span className="mute"> · {date(v.date_virement ?? v.cree_le, langue)}</span></span>
                  <Statut statut={v.statut === 'rapprochee' ? 'ok' : v.statut === 'sans_suite' ? 'neutre' : 'att'} libelle={t(`virements.statuts.${v.statut}`)} /></div>
                <span className="actions">
                  {peut && v.statut === 'annoncee' && <>
                    <Bouton petit disabled={a.enCours} onClick={() => void a.executer(async () => ok(await supabase.rpc('traiter_annonce_virement', { p_annonce: v.id, p_statut: 'rapprochee' }))).then((o) => { if (o) void annonces.recharger(); })}>{t('virements.rapprochee')}</Bouton>
                    <Bouton petit disabled={a.enCours} onClick={() => void a.executer(async () => ok(await supabase.rpc('traiter_annonce_virement', { p_annonce: v.id, p_statut: 'sans_suite' }))).then((o) => { if (o) void annonces.recharger(); })}>{t('virements.sans_suite')}</Bouton></>}</span>
              </div>))}
            <span className="mute">{t('virements.aide_interne')}</span>
          </section>}
          <section className="fiche-bloc">
            <div className="surtitre">{t('factures.encaissements')}</div>
            {(encs.data ?? []).length === 0 ? <span className="mute">{t('factures.aucun_encaissement')}</span> : (encs.data ?? []).map((e) => (
              <div key={e.id} className="ligne-montant"><span>{date(e.recu_le, langue)} · {t(`modes_enc.${e.mode}`)}{e.reference ? <span className="mute"> · {e.reference}</span> : ''}</span><b>{montant(e.montant, e.devise, langue)}</b></div>))}
          </section>
          {recap && (
            <section className="fiche-bloc">
              <div className="surtitre">{t('factures.recap_projet')}</div>
              <div className="ligne-montant"><span>{t('factures.forfait_total')}</span><b>{montant(recap.forfait_total_xof, 'XOF', langue)}</b></div>
              <div className="ligne-montant"><span>{t('factures.deja_facture')}</span><b>{montant(recap.versements_factures_xof, 'XOF', langue)}</b></div>
              <div className="ligne-montant"><span>{t('factures.deja_encaisse')}</span><b>{montant(recap.versements_encaisses_xof, 'XOF', langue)}</b></div>
              <div className="ligne-montant"><span>{t('factures.reste_du_projet')}</span><b>{montant(recap.reste_du_xof, 'XOF', langue)}</b></div>
            </section>
          )}
          <p className="mute" style={{ margin: 0 }}>{t('factures.aide_partage')}</p>
        </aside>
      </div>
      {fne && (
        <Tiroir titre={t('factures.certifier')} onClose={() => setFne(null)}>
          <p className="sec">{t('factures.aide_fne')}</p>
          <Champ label={t('factures.numero_fne')}><input value={fne.num} maxLength={60} onChange={(e) => setFne({ ...fne, num: e.target.value.trim() })} /></Champ>
          <Champ label={t('factures.qr_fne')}><textarea value={fne.qr} maxLength={2000} onChange={(e) => setFne({ ...fne, qr: e.target.value.trim() })} /></Champ>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <Bouton variante="primaire" disabled={a.enCours} onClick={() => void certifier()}>{t('commun.valider')}</Bouton>
        </Tiroir>
      )}
      {enc && (
        <Tiroir titre={t('factures.encaisser')} onClose={() => setEnc(null)}>
          <p className="sec">{t('factures.aide_devise', { d: x.devise })}</p>
          <div className="grille2">
            <Champ label={`${t('champs.montant')} (${x.devise})`}><input inputMode="decimal" value={enc.montant} onChange={(e) => setEnc({ ...enc, montant: e.target.value })} /></Champ>
            <Champ label={t('factures.recu_le')}><input type="date" value={enc.recu_le} onChange={(e) => setEnc({ ...enc, recu_le: e.target.value })} /></Champ>
            <Champ label={t('factures.mode')}><select value={enc.mode} onChange={(e) => setEnc({ ...enc, mode: e.target.value })}>{['virement', 'lettre_credit', 'cheque', 'especes', 'mobile'].map((m) => <option key={m} value={m}>{t(`modes_enc.${m}`)}</option>)}</select></Champ>
            <Champ label={t('champs.reference')}><input value={enc.reference} maxLength={80} onChange={(e) => setEnc({ ...enc, reference: e.target.value })} /></Champ>
          </div>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <Bouton variante="primaire" disabled={a.enCours} onClick={() => void encaisser()}>{t('commun.enregistrer')}</Bouton>
        </Tiroir>
      )}
    </div>
  );
}

type PaiementFile = Paiement & {
  commandes: { reference: string; fournisseur_id: string; contrat_valide_le: string | null } | null;
  comptes_paiement: { verifie: boolean } | null;
};
const FILTRES_PAY = { a_traiter: ['prepare', 'valide'], emis: ['execute', 'confirme_client'], tous: [] as string[] };

/** File de paiements fournisseurs (maquette PAY). Les conditions affichées sont indicatives : la base les impose à la validation. */
export function Paiements() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { langue, profil } = useAuth();
  const profils = useNoms('profils');
  const fournisseurs = useNoms('fournisseurs');
  const a = useAction();
  const [filtre, setFiltre] = useState<keyof typeof FILTRES_PAY>('a_traiter');
  const l = useAsync(async () => ok(await supabase.from('paiements_fournisseurs')
    .select('*, commandes(reference, fournisseur_id, contrat_valide_le), comptes_paiement(verifie)').order('prepare_le', { ascending: false }).limit(500)) as unknown as PaiementFile[], []);
  const ids = [...new Set((l.data ?? []).map((p) => p.commande_id))];
  const ins = useAsync(async () => (ids.length ? ok(await supabase.from('inspections').select('commande_id, type, statut, decision').in('commande_id', ids)) as
    { commande_id: string; type: string; statut: string; decision: string | null }[] : []), [ids.join(',')]);
  const pl = useAsync(async () => ok(await supabase.from('parametres').select('valeur, date_effet').eq('cle', 'paiement.plafond_wallet_cny')
    .lte('date_effet', new Date().toISOString().slice(0, 10)).order('date_effet', { ascending: false }).limit(1)) as { valeur: unknown }[], []);
  const plafond = pl.data?.[0] ? Number(pl.data[0].valeur) : null;
  const tous = l.data ?? [];
  const liste = tous.filter((p) => filtre === 'tous' || FILTRES_PAY[filtre].includes(p.statut));
  const inspectionOk = (c: string) => (ins.data ?? []).some((x) => x.commande_id === c && ['avant_expedition', 'contre_inspection'].includes(x.type) && x.statut === 'validee' && x.decision === 'liberation');
  const conditions = (p: PaiementFile): [string, boolean | null][] => [
    ['compte', p.comptes_paiement ? p.comptes_paiement.verifie : null],
    ...(p.nature === 'acompte' ? [['contrat', Boolean(p.commandes?.contrat_valide_le)] as [string, boolean]] : []),
    ...(p.nature === 'solde' ? [['inspection', inspectionOk(p.commande_id)] as [string, boolean]] : []),
    ...(['wechat_pay', 'alipay'].includes(p.canal) && plafond !== null ? [['plafond', Number(p.montant) <= plafond] as [string, boolean]] : []),
  ];
  const bloque = (p: PaiementFile) => ['prepare', 'valide'].includes(p.statut) && conditions(p).some(([, v]) => v === false);
  const aValider = tous.filter((p) => p.statut === 'prepare' && !bloque(p)).length;
  const bloques = tous.filter(bloque).length;
  const validateur = profil?.role === 'admin' || profil?.delegue_validation;
  const valider = async (p: PaiementFile) => { if (await a.executer(async () => ok(await supabase.rpc('valider_paiement', { p_paiement: p.id })))) void l.recharger(); };
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.finance')} · ${t('paiements.surtitre')} · PAY`}
        titre={l.data ? t('paiements.titre_file', { n: aValider, b: bloques }) : t('ecrans.paiements')} />
      <p className="mute" style={{ flex: 'none', margin: 0 }}>{t('paiements.aide_quatre_yeux', { nom: profil?.nom ?? '' })}</p>
      <Onglets actif={filtre} onChange={setFiltre} items={[{ id: 'a_traiter', lib: t('paiements.a_traiter') }, { id: 'emis', lib: t('paiements.emis') }, { id: 'tous', lib: t('paiements.tous') }]} />
      <Bandeau type="err">{l.erreur ?? ins.erreur ?? a.erreur}</Bandeau>
      <div className="cadre">
        {l.chargement && !l.data ? <Chargement /> : liste.length === 0 ? <Vide>{t('paiements.aucun')}</Vide> : (
          <table className="t"><thead><tr><th>{t('champs.reference')}</th><th>{t('paiements.beneficiaire')}</th><th>{t('paiements.objet_mode')}</th><th>{t('paiements.moyen')}</th>
            <th className="num">{t('champs.montant')}</th><th>{t('paiements.conditions')}</th><th>{t('champs.statut')}</th><th /></tr></thead>
            <tbody>{liste.map((p) => {
              const b = bloque(p);
              return (
                <tr key={p.id} className="cliquable" onClick={() => nav(`/commandes/${p.commande_id}`)}>
                  <td className="ref">{p.reference}<div className="mute">{p.commandes?.reference}</div></td>
                  <td>{p.commandes ? fournisseurs[p.commandes.fournisseur_id] : '—'}</td>
                  <td>{t(`natures.${p.nature}`)}<div className="mute">{t(`flux_paiement.${p.flux}`)} · {t('paiements.prepare_par', { nom: profils[p.prepare_par] ?? '—' })}</div></td>
                  <td className="sec">{t(`canaux_paiement.${p.canal}`)}</td>
                  <td className="num">{montant(p.montant, p.devise, langue)}</td>
                  <td><div className="pay-conds">{conditions(p).map(([k, v]) => (
                    <span key={k} className={v === null ? 'mute' : v ? 'txt-ok' : 'txt-err'}>{v === null ? '·' : v ? '✓' : '×'} {t(`paiements.cond.${k}`, { m: plafond === null ? '' : nombre(plafond, langue) })}</span>))}</div></td>
                  <td><Statut statut={b ? 'err' : p.statut} libelle={b ? t('paiements.bloque') : t(`statuts_paiement.${p.statut}`)} /></td>
                  <td className="num" onClick={(e) => e.stopPropagation()}>
                    {p.statut === 'prepare' && !b && validateur && p.prepare_par !== profil?.id &&
                      <Bouton petit variante="primaire" disabled={a.enCours} onClick={() => void valider(p)}>{t('commun.valider')}</Bouton>}
                    {p.statut === 'prepare' && p.prepare_par === profil?.id && <span className="mute">{t('paiements.attente_second')}</span>}
                  </td>
                </tr>);
            })}</tbody></table>
        )}
        <p className="mute" style={{ margin: '10px 0 0' }}>{t('paiements.aide_conditions')}</p>
      </div>
    </div>
  );
}

interface LigneReleve { mois: string; du_par: string; du_a: string; agent_id: string | null; dossier_id: string | null; dossier_reference: string | null; facture_numero: string | null; recu_le: string; base_xof: number; taux: number; montant_xof: number; regle: string; regle_date_effet: string; }

/** Partage de la valeur et commissions (maquette COM) : relevé du mois, une ligne par encaissement, règles datées appliquées. */
export function Flux() {
  const { t } = useTranslation();
  const { langue, profil } = useAuth();
  const profils = useNoms('profils');
  const [mois, setMois] = useState(new Date().toISOString().slice(0, 7));
  const debut = `${mois}-01`;
  const l = useAsync(async () => ok(await supabase.from('v_releve_flux').select('*').eq('mois', debut).order('recu_le')) as LigneReleve[], [debut]);
  const val = useAsync(async () => ok(await supabase.from('releves_valides').select('*').eq('mois', debut).maybeSingle()) as { valide_le: string } | null, [debut]);
  const a = useAction();
  const lignes = l.data ?? [];
  // Un encaissement = une facture encaissée à une date ; ses lignes de partage y sont regroupées.
  const enc = Object.values(lignes.reduce<Record<string, { cle: string; dossier: string | null; facture: string | null; recu_le: string; base: number; ciCn: number; cnCi: number;
    agents: { id: string | null; taux: number; montant: number }[] }>>((acc, x) => {
    const cle = `${x.facture_numero ?? ''}|${x.recu_le}`;
    const e = acc[cle] ?? (acc[cle] = { cle, dossier: x.dossier_reference, facture: x.facture_numero, recu_le: x.recu_le, base: Number(x.base_xof), ciCn: 0, cnCi: 0, agents: [] });
    e.base = Math.max(e.base, Number(x.base_xof));
    if (x.du_par === 'GBS_CI' && x.du_a === 'GBS_CN') e.ciCn += Number(x.montant_xof);
    else if (x.du_par === 'GBS_CN' && x.du_a === 'GBS_CI') e.cnCi += Number(x.montant_xof);
    else if (x.du_a === 'agent') e.agents.push({ id: x.agent_id, taux: Number(x.taux), montant: Number(x.montant_xof) });
    return acc;
  }, {}));
  const somme = (f: (e: (typeof enc)[number]) => number) => enc.reduce((s, e) => s + f(e), 0);
  const agentsTotal = somme((e) => e.agents.reduce((s, x) => s + x.montant, 0));
  const nAgents = new Set(lignes.filter((x) => x.du_a === 'agent').map((x) => x.agent_id)).size;
  const regles = Object.values(lignes.reduce<Record<string, { regle: string; taux: number; effet: string }>>((acc, x) => {
    acc[`${x.regle}|${x.taux}|${x.regle_date_effet}`] = { regle: x.regle, taux: Number(x.taux), effet: x.regle_date_effet };
    return acc;
  }, {})).sort((x, y) => x.regle.localeCompare(y.regle));
  const libMois = new Date(`${debut}T12:00:00Z`).toLocaleDateString(langue === 'zh' ? 'zh-CN' : langue === 'en' ? 'en-GB' : 'fr-FR', { month: 'long', year: 'numeric' });
  const m = (v: number) => (v ? nombre(v, langue) : '—');
  const admin = profil?.role === 'admin';
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.finance')} · ${t('flux.surtitre')} · ${libMois} · COM`}
        titre={l.data ? t('flux.titre_releve', { mois: libMois.split(' ')[0], n: enc.length, c: nombre(agentsTotal, langue) }) + (val.data ? ` ; ${t('flux.releve_valide')}` : ` ; ${t('flux.releve_a_valider')}`) : t('flux.titre')}
        actions={<>
          <input type="month" className="search" style={{ width: 170 }} value={mois} onChange={(e) => setMois(e.target.value)} aria-label={t('flux.mois')} />
          {admin && val.data && <Bouton onClick={() => void a.executer(async () => ok(await supabase.rpc('generer_factures_intragroupe', { p_mois: debut })))}>{t('flux.generer')}</Bouton>}
          {admin && !val.data && <Bouton variante="primaire" onClick={() => void a.executer(async () => { ok(await supabase.rpc('valider_releve', { p_mois: debut })); void val.recharger(); })}>{t('flux.valider')}</Bouton>}
        </>} />
      <Kpis items={[
        { lib: t('flux.k_encaissements'), val: m(somme((e) => e.base)), sous: 'XOF' },
        { lib: t('flux.ci_vers_cn'), val: m(somme((e) => e.ciCn)), sous: t('flux.ci_vers_cn_sous') },
        { lib: t('flux.cn_vers_ci'), val: m(somme((e) => e.cnCi)), sous: t('flux.cn_vers_ci_sous') },
        { lib: t('flux.agents'), val: m(agentsTotal), sous: t('flux.n_agents', { n: nAgents }) },
      ]} />
      <Bandeau type="err">{l.erreur ?? a.erreur}</Bandeau>
      <div className="fiche-grille">
        <div className="cadre fiche-principal">
          {l.chargement && !l.data ? <Chargement /> : enc.length === 0 ? <Vide>{t('flux.aucun')}</Vide> : (
            <table className="t"><thead><tr><th>{t('champs.dossier')}</th><th>{t('flux.encaissement')}</th><th className="num">{t('champs.montant')}</th>
              <th className="num">{t('flux.part_cn')}</th><th className="num">{t('flux.gestion')}</th><th>{t('flux.agent')}</th><th className="num">{t('flux.commission')}</th><th>{t('champs.statut')}</th></tr></thead>
              <tbody>{enc.map((e) => (
                <tr key={e.cle}><td className="ref">{e.dossier ?? '—'}</td>
                  <td>{e.facture ?? '—'}<div className="mute">{t('flux.encaisse_le_d', { d: date(e.recu_le, langue) })}</div></td>
                  <td className="num">{m(e.base)}</td><td className="num">{m(e.ciCn)}</td><td className="num">{m(e.cnCi)}</td>
                  <td>{e.agents.length === 0 ? <span className="mute">—</span> : e.agents.map((g, i) => <div key={i}>{g.id ? profils[g.id] : t('flux.agent')} · {pourcent(g.taux, langue, 0)}</div>)}</td>
                  <td className="num">{m(e.agents.reduce((s, x) => s + x.montant, 0))}</td>
                  <td><Statut statut={val.data ? 'ok' : 'att'} libelle={val.data ? t('flux.valide') : t('flux.a_valider')} /></td></tr>))}</tbody></table>
          )}
        </div>
        <aside className="fiche-cote">
          <section className="fiche-bloc">
            <div className="surtitre">{t('flux.regles_datees')}</div>
            {regles.length === 0 ? <span className="mute">{t('flux.aucune_regle')}</span> : regles.map((r) => (
              <div key={`${r.regle}${r.taux}${r.effet}`} className="ligne-montant"><span>{t(`regles.${r.regle.replace(/\./g, '_')}`, { defaultValue: r.regle })}<br />
                <span className="mute">{t('flux.depuis', { d: date(r.effet, langue) })}</span></span><b>{pourcent(r.taux, langue, 0)}</b></div>))}
            <p className="mute" style={{ margin: 0 }}>{t('flux.aide_regles')}</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
