import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, montant, pourcent } from '../lib/format';
import type { Client, Dossier, Facture, LigneFacture, Paiement } from '../lib/types';
import { Bandeau, Bouton, CadreTableau, Champ, Chargement, Entete, Kpis, Onglets, Statut, Tiroir, Vide } from '../components/ui';
import { useNoms } from '../lib/referentiels';

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
  return (
    <div className="screen">
      <Entete surtitre={`${societes.find((s) => s.id === x.societe_id)?.raison_sociale ?? ''} · ${t(`types_facture.${x.type}`)}${x.tranche ? ` ${x.tranche}/2` : ''}`}
        titre={`${x.numero ?? t('factures.brouillon')} — ${x.client_id ? clients[x.client_id] : societes.find((s) => s.id === x.societe_dest_id)?.raison_sociale}`}
        actions={<>
          <Statut statut={x.statut} libelle={t(`statuts_facture.${x.statut}`)} />
          {x.statut !== 'brouillon' && <Link className="btn" to={`/imprimer/facture/${x.id}`}>{t('commun.imprimer')}</Link>}
          {peut && x.statut === 'brouillon' && <Bouton variante="primaire" disabled={a.enCours} onClick={() => void emettre()}>{t('factures.emettre')}</Bouton>}
          {peut && x.statut === 'en_attente_fne' && <Bouton variante="primaire" onClick={() => setFne({ num: '', qr: '' })}>{t('factures.certifier')}</Bouton>}
          {peut && ['emise', 'partiellement_payee'].includes(x.statut) && <Bouton variante="primaire" onClick={() => setEnc({ montant: String(Number(x.net_a_payer) - Number(x.encaisse)), recu_le: new Date().toISOString().slice(0, 10), mode: 'virement', reference: '' })}>{t('factures.encaisser')}</Bouton>}
        </>} />
      <Kpis items={[
        { lib: t('factures.ht'), val: montant(x.montant_ht, x.devise, langue), sous: x.dossier_id ? dossiers[x.dossier_id] : '—' },
        { lib: `TVA ${pourcent(x.tva_taux, langue)}`, val: montant(x.tva, x.devise, langue), sous: `TTC ${montant(x.ttc, x.devise, langue)}` },
        { lib: `${t('factures.retenue')} ${pourcent(x.retenue_taux, langue)}`, val: montant(x.retenue, x.devise, langue), sous: x.retenue_taux > 0 ? t('factures.attestation') : t('factures.sans_retenue') },
        { lib: t('factures.net_a_payer'), val: montant(x.net_a_payer, x.devise, langue), sous: t('factures.encaisse', { m: montant(x.encaisse, x.devise, langue) }) },
      ]} />
      {x.statut === 'en_attente_fne' && <Bandeau>{t('factures.bandeau_attente')}</Bandeau>}
      <Bandeau type="err">{a.erreur}</Bandeau>
      <div className="cadre" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {recap && (
          <section><div className="section-titre">{t('factures.recap_projet')}</div>
            <dl className="dl">
              <dt>{t('factures.forfait_total')}</dt><dd>{montant(recap.forfait_total_xof, 'XOF', langue)}</dd>
              <dt>{t('factures.deja_facture')}</dt><dd>{montant(recap.versements_factures_xof, 'XOF', langue)}</dd>
              <dt>{t('factures.deja_encaisse')}</dt><dd>{montant(recap.versements_encaisses_xof, 'XOF', langue)}</dd>
              <dt>{t('factures.ce_versement')}</dt><dd>{montant(recap.ce_versement_xof, 'XOF', langue)}</dd>
              <dt>{t('factures.reste_du_projet')}</dt><dd>{montant(recap.reste_du_xof, 'XOF', langue)}</dd>
            </dl></section>
        )}
        <section>
          <div className="section-titre">{t('factures.lignes')}</div>
          <table className="t"><thead><tr><th>{t('champs.designation')}</th><th>{t('factures.service')}</th><th className="num">{t('champs.quantite')}</th><th className="num">{t('commandes.pu')}</th><th className="num">{t('champs.montant')}</th><th /></tr></thead>
            <tbody>{(lignes.data ?? []).map((l) => (
              <tr key={l.id}><td>{l.libelle}</td><td className="sec">{l.service ?? '—'}</td><td className="num">{l.quantite}</td><td className="num">{montant(l.prix_unitaire, x.devise, langue)}</td><td className="num">{montant(l.montant, x.devise, langue)}</td>
                <td className="num">{peut && x.statut === 'brouillon' && <Bouton petit variante="danger" onClick={() => void a.executer(async () => { ok(await supabase.from('lignes_facture').delete().eq('id', l.id)); recharger(); })}>{t('commun.retirer')}</Bouton>}</td></tr>))}</tbody></table>
          {peut && x.statut === 'brouillon' && (
            <div className="grille3" style={{ alignItems: 'end', marginTop: 8, gridTemplateColumns: '3fr 1fr 1fr 1fr auto' }}>
              <Champ label={t('champs.designation')}><input value={ligne.libelle} maxLength={300} onChange={(e) => setLigne({ ...ligne, libelle: e.target.value })} /></Champ>
              <Champ label={t('factures.service')}><select value={ligne.service} onChange={(e) => setLigne({ ...ligne, service: e.target.value })}>
                <option value="">—</option>{['S1', 'S2', 'S2bis', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10'].map((s) => <option key={s} value={s}>{s} · {t(`services.${s}`)}</option>)}</select></Champ>
              <Champ label={t('champs.quantite')}><input inputMode="decimal" value={ligne.quantite} onChange={(e) => setLigne({ ...ligne, quantite: e.target.value })} /></Champ>
              <Champ label={`${t('commandes.pu')} (${x.devise})`}><input inputMode="decimal" value={ligne.prix_unitaire} onChange={(e) => setLigne({ ...ligne, prix_unitaire: e.target.value })} /></Champ>
              <Bouton onClick={() => void ajouter()}>{t('commun.ajouter')}</Bouton>
            </div>
          )}
        </section>
        {x.fne_numero && <p className="sec">{t('factures.fne_numero', { n: x.fne_numero })}</p>}
        <section>
          <div className="section-titre">{t('factures.encaissements')}</div>
          {(encs.data ?? []).length === 0 ? <span className="mute">{t('factures.aucun_encaissement')}</span> : (
            <table className="t"><tbody>{(encs.data ?? []).map((e) => (
              <tr key={e.id}><td className="ref">{date(e.recu_le, langue)}</td><td>{montant(e.montant, e.devise, langue)}</td><td className="sec">{t(`modes_enc.${e.mode}`)}</td><td className="sec">{e.reference ?? ''}</td></tr>))}</tbody></table>
          )}
        </section>
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

export function Paiements() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { langue, profil } = useAuth();
  const profils = useNoms('profils');
  const fournisseurs = useNoms('fournisseurs');
  const [filtre, setFiltre] = useState<'a_valider' | 'tous'>('a_valider');
  const l = useAsync(async () => {
    let r = supabase.from('paiements_fournisseurs').select('*, commandes(reference, fournisseur_id)').order('prepare_le', { ascending: false }).limit(500);
    if (filtre === 'a_valider') r = r.in('statut', ['prepare', 'valide']);
    return ok(await r) as (Paiement & { commandes: { reference: string; fournisseur_id: string } | null })[];
  }, [filtre]);
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.finance')} · M12`} titre={t('paiements.titre')} />
      <p className="mute" style={{ flex: 'none' }}>{t('paiements.aide_quatre_yeux', { nom: profil?.nom ?? '' })}</p>
      <Onglets actif={filtre} onChange={setFiltre} items={[{ id: 'a_valider', lib: t('paiements.a_traiter') }, { id: 'tous', lib: t('paiements.tous') }]} />
      <Bandeau type="err">{l.erreur}</Bandeau>
      <CadreTableau>
        {(l.data ?? []).length === 0 ? <Vide>{t('paiements.aucun')}</Vide> : (
          <table className="t"><thead><tr><th>{t('champs.reference')}</th><th>{t('champs.commande')}</th><th>{t('champs.fournisseur')}</th><th>{t('paiements.nature')}</th><th className="num">{t('champs.montant')}</th><th>{t('paiements.prepare')}</th><th>{t('paiements.valide')}</th><th>{t('champs.statut')}</th></tr></thead>
            <tbody>{(l.data ?? []).map((p) => (
              <tr key={p.id} className="cliquable" onClick={() => nav(`/commandes/${p.commande_id}`)}>
                <td className="ref">{p.reference}</td><td className="ref">{p.commandes?.reference}</td><td>{p.commandes ? fournisseurs[p.commandes.fournisseur_id] : ''}</td>
                <td>{t(`natures.${p.nature}`)}<div className="mute">{t(`flux_paiement.${p.flux}`)} · {t(`canaux_paiement.${p.canal}`)}</div></td>
                <td className="num">{montant(p.montant, p.devise, langue)}</td><td className="sec">{profils[p.prepare_par]}</td><td className="sec">{p.valide_par ? profils[p.valide_par] : '—'}</td>
                <td><Statut statut={p.statut} libelle={t(`statuts_paiement.${p.statut}`)} /></td></tr>))}</tbody></table>
        )}
      </CadreTableau>
    </div>
  );
}

interface LigneReleve { mois: string; du_par: string; du_a: string; agent_id: string | null; dossier_id: string | null; dossier_reference: string | null; facture_numero: string | null; recu_le: string; base_xof: number; taux: number; montant_xof: number; regle: string; regle_date_effet: string; }

export function Flux() {
  const { t } = useTranslation();
  const { langue, profil } = useAuth();
  const profils = useNoms('profils');
  const [mois, setMois] = useState(new Date().toISOString().slice(0, 7));
  const debut = `${mois}-01`;
  const l = useAsync(async () => ok(await supabase.from('v_releve_flux').select('*').eq('mois', debut).order('recu_le')) as LigneReleve[], [debut]);
  const val = useAsync(async () => ok(await supabase.from('releves_valides').select('*').eq('mois', debut).maybeSingle()) as { valide_le: string } | null, [debut]);
  const a = useAction();
  const tot = (p: (x: LigneReleve) => boolean) => (l.data ?? []).filter(p).reduce((s, x) => s + Number(x.montant_xof), 0);
  const ciCn = tot((x) => x.du_par === 'GBS_CI' && x.du_a === 'GBS_CN');
  const cnCi = tot((x) => x.du_par === 'GBS_CN' && x.du_a === 'GBS_CI');
  const ag = tot((x) => x.du_a === 'agent');
  const admin = profil?.role === 'admin';
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.pilotage')} · M21 · M36`} titre={t('flux.titre')}
        actions={<>
          <input type="month" className="search" style={{ width: 170 }} value={mois} onChange={(e) => setMois(e.target.value)} aria-label={t('flux.mois')} />
          {admin && !val.data && <Bouton variante="primaire" onClick={() => void a.executer(async () => { ok(await supabase.rpc('valider_releve', { p_mois: debut })); void val.recharger(); })}>{t('flux.valider')}</Bouton>}
          {admin && val.data && <Bouton onClick={() => void a.executer(async () => ok(await supabase.rpc('generer_factures_intragroupe', { p_mois: debut })))}>{t('flux.generer')}</Bouton>}
        </>} />
      <Kpis items={[
        { lib: t('flux.ci_vers_cn'), val: montant(ciCn, 'XOF', langue), sous: t('flux.ci_vers_cn_sous') },
        { lib: t('flux.cn_vers_ci'), val: montant(cnCi, 'XOF', langue), sous: t('flux.cn_vers_ci_sous') },
        { lib: t('flux.agents'), val: montant(ag, 'XOF', langue), sous: t('flux.agents_sous') },
        { lib: t('flux.statut'), texte: true, val: val.data ? t('flux.valide') : t('flux.a_valider'), sous: val.data ? date(val.data.valide_le, langue) : t('flux.avant_factures') },
      ]} />
      <Bandeau type="err">{l.erreur ?? a.erreur}</Bandeau>
      <CadreTableau titre={t('flux.releve')}>
        {(l.data ?? []).length === 0 ? <Vide>{t('flux.aucun')}</Vide> : (
          <table className="t"><thead><tr><th>{t('champs.dossier')}</th><th>{t('flux.facture')}</th><th>{t('flux.encaisse_le')}</th><th>{t('flux.sens')}</th><th className="num">{t('flux.base')}</th><th className="num">{t('flux.taux')}</th><th className="num">{t('champs.montant')}</th><th>{t('flux.regle')}</th></tr></thead>
            <tbody>{(l.data ?? []).map((x, i) => (
              <tr key={i}><td className="ref">{x.dossier_reference ?? '—'}</td><td className="ref">{x.facture_numero}</td><td className="ref">{date(x.recu_le, langue)}</td>
                <td className="sec">{x.du_par} → {x.du_a === 'agent' ? (x.agent_id ? profils[x.agent_id] : t('flux.agent')) : x.du_a}</td>
                <td className="num">{montant(x.base_xof, 'XOF', langue)}</td><td className="num">{pourcent(x.taux, langue, 0)}</td><td className="num">{montant(x.montant_xof, 'XOF', langue)}</td>
                <td className="mute">{t(`regles.${x.regle}`, { defaultValue: x.regle })} · {date(x.regle_date_effet, langue)}</td></tr>))}</tbody></table>
        )}
      </CadreTableau>
    </div>
  );
}
