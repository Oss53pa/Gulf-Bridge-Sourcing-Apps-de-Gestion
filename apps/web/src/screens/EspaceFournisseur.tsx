// Portail fournisseur avec compte (maquette « Espace fournisseur »), première tranche en lecture :
// accueil, cotations, commandes, paiements, agrément. Contenu calculé par la base : jamais le client,
// le dossier, les prix de vente ni les autres fournisseurs.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { ok, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, dateHeure, montant } from '../lib/format';
import { Bandeau, Bouton, Champ, Chargement, Statut, Tiroir, Vide } from '../components/ui';
import { z } from 'zod';
import { useAction } from '../lib/data';
import { MessagerieVue } from './Messagerie';
import { PageFournisseur } from './PlisFournisseurs';
import { DeclarerAvancement, DeclarerColisage, Jauge } from './Avancement';

interface Paiement { nature: string; montant: number; devise: string; etat: 'recu' | 'a_venir' | 'annule'; date: string | null }
interface Commande { id: string; reference: string; statut: string; avancement: number | null; photos: number; incoterm: string; lieu: string | null; devise: string; fob_montant: number | null;
  lignes: { designation: string; quantite: number; prix_unitaire: number; montant: number }[]; paiements: Paiement[] }
interface Espace {
  utilisateur: { nom: string; sous_role: string };
  fournisseur: { reference: string | null; raison_sociale_en: string; raison_sociale_zh: string | null; statut_agrement: string; note: number | null;
    engagement_non_commission_le: string | null; due_diligence_jusqu_au: string | null };
  consultations: { id: string; reference: string; objet: string; quantite: number | null; incoterm: string; lieu: string | null; date_limite: string; fuseau: string; statut: string; pli_depose_le: string | null }[];
  commandes: Commande[];
  comptes: { type: string; banque: string | null; fin_numero: string; verifie: boolean; verifie_le: string | null }[];
}
type Vue = 'accueil' | 'cotations' | 'commandes' | 'paiements' | 'messagerie' | 'agrement';
const VUES: Vue[] = ['accueil', 'cotations', 'commandes', 'paiements', 'messagerie', 'agrement'];

export function EspaceFournisseur() {
  const { t } = useTranslation();
  const { langue, fuseau, deconnexion } = useAuth();
  const e = useAsync(async () => ok(await supabase.rpc('espace_fournisseur')) as Espace, []);
  const [vue, setVue] = useState<Vue>('accueil');
  const [rfq, setRfq] = useState<string | null>(null);
  const [prod, setProd] = useState<Commande | null>(null);
  const [colis, setColis] = useState<Commande | null>(null);
  const cols = useAsync(async () => ok(await supabase.rpc('mes_colisages')) as { commande_id: string; statut: string }[], [vue, colis?.id]);
  const nonLus = useAsync(async () => ok(await supabase.rpc('messages_non_lus')) as number, [vue]);
  const x = e.data;
  const maintenant = new Date().toISOString();
  const aCoter = (x?.consultations ?? []).filter((c) => c.statut === 'ouverte' && c.date_limite > maintenant && !c.pli_depose_le);
  const enCours = (x?.commandes ?? []).filter((c) => !['livree', 'annulee'].includes(c.statut));
  const paiements = (x?.commandes ?? []).flatMap((c) => c.paiements.map((p) => ({ ...p, commande: c.reference })));
  const totalRecu = (d: string) => paiements.filter((p) => p.etat === 'recu' && p.devise === d).reduce((n, p) => n + Number(p.montant), 0);
  const devises = [...new Set(paiements.map((p) => p.devise))];
  const nom = x ? (langue === 'zh' && x.fournisseur.raison_sociale_zh ? x.fournisseur.raison_sociale_zh : x.fournisseur.raison_sociale_en) : '…';
  return (
    <div className="app ecl">
      <header className="topbar ecl-tete">
        <span className="ecl-marque"><b>{nom}</b>{x?.fournisseur.reference && <span className="mute"> · {x.fournisseur.reference}</span>}</span>
        <Bouton petit onClick={() => void deconnexion()}>{t('coque.deconnexion')}</Bouton>
      </header>
      <nav className="ecl-nav" aria-label={t('portail.navigation')}>
        {VUES.map((v) => <button key={v} type="button" aria-current={vue === v ? 'page' : undefined} onClick={() => { setVue(v); setRfq(null); }}>
          {t(`portail_f.vues.${v}`)}{v === 'cotations' && aCoter.length > 0 && <span className="badge">{aCoter.length}</span>}{v === 'messagerie' && (nonLus.data ?? 0) > 0 && <span className="badge">{nonLus.data}</span>}</button>)}
      </nav>
      <main className="screen ecl-main">
        <Bandeau type="err">{e.erreur}</Bandeau>
        {e.chargement && !x ? <Chargement /> : x && <>
          {vue === 'accueil' && <>
            <h1 className="ecl-titre">{t('portail.bonjour', { nom: x.utilisateur.nom })}{t('portail_f.resume', { c: aCoter.length, o: enCours.length })}</h1>
            <div className="ref-chiffres ecl-chiffres f4">
              <div><span>{t('portail_f.note')}</span><b>{x.fournisseur.note ?? '—'}</b><small className="mute">{t('portail_f.sur_100')}</small></div>
              <div><span>{t('portail_f.agrement')}</span><b className="ecl-petit">{t(`agrement.${x.fournisseur.statut_agrement}`, { defaultValue: x.fournisseur.statut_agrement })}</b></div>
              <div><span>{t('portail_f.dd_valide')}</span><b className="ecl-petit">{x.fournisseur.due_diligence_jusqu_au ? date(x.fournisseur.due_diligence_jusqu_au, langue) : '—'}</b></div>
              <div><span>{t('portail_f.commandes_cours')}</span><b>{enCours.length}</b></div>
            </div>
            <section className="ecl-bloc">
              <div className="surtitre">{t('portail.actions')}</div>
              {aCoter.length === 0 && <span className="mute">{t('portail.aucune_action')}</span>}
              {aCoter.map((c) => <div key={c.reference} className="grl-regle"><span><b>{t('portail_f.coter', { o: c.objet })}</b>
                <span className="mute">{t('portail_f.limite', { d: dateHeure(c.date_limite, langue, c.fuseau || fuseau) })}</span></span>
                <Bouton petit onClick={() => { setVue('cotations'); setRfq(c.id); }}>{t('portail_f.ouvrir')}</Bouton></div>)}
            </section>
            <Bandeau>{t('portail_f.ethique')}</Bandeau>
          </>}
          {vue === 'cotations' && rfq && <PageFournisseur consultation={rfq} onRetour={() => { setRfq(null); void e.recharger(); }} />}
          {vue === 'cotations' && !rfq && <>
            <div className="surtitre">{t('portail_f.scelle')}</div>
            <h1 className="ecl-titre">{t('portail_f.vues.cotations')}</h1>
            <p className="sec">{t('portail_f.aide_cotations')}</p>
            {x.consultations.length === 0 ? <Vide>{t('portail_f.aucune_consultation')}</Vide> : (
              <table className="t"><thead><tr><th>{t('portail_f.consultation')}</th><th>{t('portail_f.conditions')}</th><th>{t('portail_f.date_limite')}</th><th>{t('champs.statut')}</th><th></th></tr></thead>
                <tbody>{x.consultations.map((c) => {
                  const fermee = c.statut !== 'ouverte' || c.date_limite <= maintenant;
                  return (<tr key={c.reference}><td className="ref">{c.reference}<div>{c.objet}</div></td>
                    <td className="sec">{[c.quantite ? `${Number(c.quantite)}` : null, `${c.incoterm}${c.lieu ? ` ${c.lieu}` : ''}`].filter(Boolean).join(' · ')}</td>
                    <td className="ref">{dateHeure(c.date_limite, langue, c.fuseau || fuseau)}</td>
                    <td><Statut statut={c.pli_depose_le ? 'ok' : fermee ? 'neutre' : 'att'} libelle={c.pli_depose_le ? t('portail_f.pli_depose', { d: date(c.pli_depose_le, langue) }) : fermee ? t('portail_f.close') : t('portail_f.a_coter')} /></td>
                    <td className="num"><Bouton petit variante={!fermee && !c.pli_depose_le ? 'primaire' : undefined} onClick={() => setRfq(c.id)}>{fermee ? t('portail_f.consulter') : c.pli_depose_le ? t('portail_f.modifier') : t('portail_f.repondre')}</Bouton></td></tr>);
                })}</tbody></table>)}
          </>}
          {vue === 'commandes' && <>
            <h1 className="ecl-titre">{t('portail_f.vues.commandes')}</h1>
            {x.commandes.length === 0 ? <Vide>{t('portail_f.aucune_commande')}</Vide> : x.commandes.map((c) => (
              <section key={c.reference} className="ecl-bloc">
                <div className="liv-pv"><b className="ref">{c.reference}</b><Statut statut={['livree', 'expediee'].includes(c.statut) ? 'ok' : 'info'} libelle={t(`statuts_commande.${c.statut}`, { defaultValue: c.statut })} /></div>
                <span className="sec">{c.incoterm}{c.lieu ? ` ${c.lieu}` : ''}{c.fob_montant !== null ? ` · ${montant(Number(c.fob_montant), c.devise, langue)}` : ''}</span>
                {['contrat_signe', 'en_production', 'production_terminee'].includes(c.statut) && <div className="liv-pv">
                  <Jauge pct={c.avancement ?? 0} /><span className="actions"><span className="mute">{t('avancement.n_photos', { n: c.photos })}</span>
                  <Bouton petit onClick={() => setProd(c)}>{t('avancement.declarer')}</Bouton></span></div>}
                {['en_production', 'production_terminee'].includes(c.statut) && (() => {
                  const dernier = (cols.data ?? []).find((x) => x.commande_id === c.id);
                  return <div className="liv-pv"><span className="sec">{t('colisage.titre_court')}</span><span className="actions">
                    {dernier && <Statut statut={dernier.statut === 'validee' ? 'ok' : dernier.statut === 'refusee' ? 'err' : 'att'} libelle={t(`colisage.statuts.${dernier.statut}`)} />}
                    {dernier?.statut !== 'validee' && <Bouton petit onClick={() => setColis(c)}>{t('colisage.declarer')}</Bouton>}</span></div>;
                })()}
                <table className="t"><tbody>{c.lignes.map((l, i) => <tr key={i}><td>{l.designation}</td><td className="num">{Number(l.quantite)}</td>
                  <td className="num">{montant(Number(l.prix_unitaire), c.devise, langue)}</td><td className="num">{montant(Number(l.montant), c.devise, langue)}</td></tr>)}</tbody></table>
              </section>))}
          </>}
          {vue === 'paiements' && <>
            <div className="surtitre">{t('portail_f.paiement_direct')}</div>
            <h1 className="ecl-titre">{t('portail_f.vues.paiements')}</h1>
            <p className="sec">{t('portail_f.aide_paiements')}</p>
            {devises.length > 0 && <div className="ref-chiffres ecl-chiffres">{devises.map((d) => <div key={d}><span>{t('portail_f.recu')} · {d}</span><b>{montant(totalRecu(d), d, langue)}</b></div>)}</div>}
            {paiements.length === 0 ? <Vide>{t('portail_f.aucun_paiement')}</Vide> : (
              <table className="t"><tbody>{paiements.map((p, i) => <tr key={i}><td className="ref">{p.commande}<div>{t(`portail_f.natures.${p.nature}`, { defaultValue: p.nature })}</div></td>
                <td className="num">{montant(Number(p.montant), p.devise, langue)}</td>
                <td><Statut statut={p.etat === 'recu' ? 'ok' : p.etat === 'annule' ? 'neutre' : 'att'} libelle={p.etat === 'recu' && p.date ? t('portail_f.recu_le', { d: date(p.date, langue) }) : t(`portail_f.etats.${p.etat}`)} /></td></tr>)}</tbody></table>)}
            <section className="ecl-bloc">
              <div className="surtitre">{t('portail_f.comptes')}</div>
              {x.comptes.map((c, i) => <div key={i} className="grl-regle"><span><b>{c.banque ?? t(`portail_f.types_compte.${c.type}`, { defaultValue: c.type })}</b><span className="mute">•••• {c.fin_numero}</span></span>
                <Statut statut={c.verifie ? 'ok' : 'att'} libelle={c.verifie ? t('portail_f.verifie', { d: c.verifie_le ? date(c.verifie_le, langue) : '' }) : t('portail_f.non_verifie')} /></div>)}
              <span className="mute">{t('portail_f.aide_compte')}</span>
              <DemandesCompte finance={x.utilisateur.sous_role === 'finance'} />
            </section>
          </>}
          {colis && <DeclarerColisage commandeId={colis.id} reference={colis.reference} onClose={() => setColis(null)} onFait={() => setColis(null)} />}
          {prod && <DeclarerAvancement commandeId={prod.id} reference={prod.reference} actuel={prod.avancement ?? 0} onClose={() => setProd(null)} onFait={() => { setProd(null); void e.recharger(); }} />}
          {vue === 'messagerie' && <MessagerieVue avecEntete={false} nouveau={{ audiences: ['fournisseur'], commandes: x.commandes.map((c) => ({ id: c.id, libelle: c.reference })) }} />}
          {vue === 'agrement' && <>
            <h1 className="ecl-titre">{t('portail_f.vues.agrement')}</h1>
            <div className="grl-regle"><span>{t('portail_f.agrement')}</span><Statut statut={x.fournisseur.statut_agrement === 'agree' ? 'ok' : 'att'} libelle={t(`agrement.${x.fournisseur.statut_agrement}`, { defaultValue: x.fournisseur.statut_agrement })} /></div>
            <div className="grl-regle"><span>{t('portail_f.dd_valide')}</span><b>{x.fournisseur.due_diligence_jusqu_au ? date(x.fournisseur.due_diligence_jusqu_au, langue) : '—'}</b></div>
            <div className="grl-regle"><span>{t('portail_f.engagement')}</span><Statut statut={x.fournisseur.engagement_non_commission_le ? 'ok' : 'err'} libelle={x.fournisseur.engagement_non_commission_le ? t('portail_f.signe_le', { d: date(x.fournisseur.engagement_non_commission_le, langue) }) : t('portail_f.non_signe')} /></div>
            <p className="mute">{t('portail_f.aide_agrement')}</p>
          </>}
        </>}
      </main>
    </div>
  );
}

interface MaDemande { type: string; banque: string | null; devise: string; fin_numero: string; statut: 'nouvelle' | 'acceptee' | 'refusee'; cree_le: string; traitee_le: string | null }

/** Demande de changement de compte (sous-rôle finance) : jamais de compte créé ici ; l'équipe vérifie
 *  les nouvelles coordonnées, dont un rappel, avant tout paiement. */
function DemandesCompte({ finance }: { finance: boolean }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const l = useAsync(async () => ok(await supabase.rpc('mes_demandes_compte')) as MaDemande[], []);
  const [ouvert, setOuvert] = useState(false);
  const a = useAction();
  const [f, setF] = useState({ type: 'banque', titulaire: '', devise: 'USD', banque: '', numero: '', swift: '', motif: '' });
  const envoyer = async () => {
    const v = z.object({ type: z.enum(['banque', 'wechat_pay', 'alipay']), titulaire: z.string().trim().min(2).max(200), devise: z.enum(['USD', 'CNY']),
      banque: z.string().trim().max(200).nullable(), numero: z.string().trim().regex(/^[A-Za-z0-9 -]{4,64}$/),
      swift: z.string().regex(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/).nullable(), titulaire_est_entreprise: z.literal(true), motif: z.string().trim().min(5).max(1000) }).strict()
      .refine((x) => x.type !== 'banque' || !!x.banque)
      .safeParse({ ...f, banque: f.type === 'banque' ? f.banque.trim() || null : null, swift: f.type === 'banque' ? f.swift.trim().toUpperCase() || null : null,
        titulaire_est_entreprise: true });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('demander_compte_fournisseur', { p: v.data })))) { setOuvert(false); void l.recharger(); }
  };
  const enAttente = (l.data ?? []).some((d) => d.statut === 'nouvelle');
  return (<>
    {(l.data ?? []).map((d, i) => <div key={i} className="grl-regle"><span><b>{d.banque ?? t(`portail_f.types_compte.${d.type}`, { defaultValue: d.type })}</b><span className="mute">•••• {d.fin_numero} · {date(d.cree_le, langue)}</span></span>
      <Statut statut={d.statut === 'acceptee' ? 'ok' : d.statut === 'refusee' ? 'err' : 'att'} libelle={t(`portail_f.demandes_compte.${d.statut}`)} /></div>)}
    {finance && !enAttente && <div><Bouton petit onClick={() => setOuvert(true)}>{t('portail_f.changer_compte')}</Bouton></div>}
    {ouvert && <Tiroir titre={t('portail_f.changer_compte')} onClose={() => setOuvert(false)}>
      <Bandeau>{t('portail_f.aide_changer_compte')}</Bandeau>
      <div className="grille2">
        <Champ label={t('champs.type')}><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, devise: e.target.value === 'banque' ? f.devise : 'CNY' })}>
          {['banque', 'wechat_pay', 'alipay'].map((x) => <option key={x} value={x}>{t(`portail_f.types_compte.${x}`, { defaultValue: x })}</option>)}</select></Champ>
        <Champ label={t('champs.devise')}><select value={f.devise} onChange={(e) => setF({ ...f, devise: e.target.value })}><option>USD</option><option>CNY</option></select></Champ>
      </div>
      <Champ label={t('fournisseurs.titulaire')}><input value={f.titulaire} maxLength={200} onChange={(e) => setF({ ...f, titulaire: e.target.value })} /></Champ>
      {f.type === 'banque' && <Champ label={t('fournisseurs.banque')}><input value={f.banque} maxLength={200} onChange={(e) => setF({ ...f, banque: e.target.value })} /></Champ>}
      <div className="grille2">
        <Champ label={t('fournisseurs.numero')}><input value={f.numero} maxLength={64} autoComplete="off" onChange={(e) => setF({ ...f, numero: e.target.value })} /></Champ>
        {f.type === 'banque' && <Champ label="SWIFT"><input value={f.swift} maxLength={11} onChange={(e) => setF({ ...f, swift: e.target.value })} /></Champ>}
      </div>
      <Champ label={t('portail_f.motif_changement')}><textarea rows={3} maxLength={1000} value={f.motif} onChange={(e) => setF({ ...f, motif: e.target.value })} /></Champ>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void envoyer()}>{t('portail_f.envoyer_demande')}</Bouton>
    </Tiroir>}
  </>);
}
