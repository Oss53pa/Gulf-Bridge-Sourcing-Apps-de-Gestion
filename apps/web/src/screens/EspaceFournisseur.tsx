// Portail fournisseur avec compte (maquette « Espace fournisseur »), première tranche en lecture :
// accueil, cotations, commandes, paiements, agrément. Contenu calculé par la base : jamais le client,
// le dossier, les prix de vente ni les autres fournisseurs.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { ok, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, dateHeure, montant } from '../lib/format';
import { Bandeau, Bouton, Chargement, Statut, Vide } from '../components/ui';
import { MessagerieVue } from './Messagerie';

interface Paiement { nature: string; montant: number; devise: string; etat: 'recu' | 'a_venir' | 'annule'; date: string | null }
interface Commande { id: string; reference: string; statut: string; incoterm: string; lieu: string | null; devise: string; fob_montant: number | null;
  lignes: { designation: string; quantite: number; prix_unitaire: number; montant: number }[]; paiements: Paiement[] }
interface Espace {
  utilisateur: { nom: string; sous_role: string };
  fournisseur: { reference: string | null; raison_sociale_en: string; raison_sociale_zh: string | null; statut_agrement: string; note: number | null;
    engagement_non_commission_le: string | null; due_diligence_jusqu_au: string | null };
  consultations: { reference: string; objet: string; quantite: number | null; incoterm: string; lieu: string | null; date_limite: string; fuseau: string; statut: string; pli_depose_le: string | null }[];
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
        {VUES.map((v) => <button key={v} type="button" aria-current={vue === v ? 'page' : undefined} onClick={() => setVue(v)}>
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
                <Bouton petit onClick={() => setVue('cotations')}>{t('portail_f.ouvrir')}</Bouton></div>)}
            </section>
            <Bandeau>{t('portail_f.ethique')}</Bandeau>
          </>}
          {vue === 'cotations' && <>
            <div className="surtitre">{t('portail_f.scelle')}</div>
            <h1 className="ecl-titre">{t('portail_f.vues.cotations')}</h1>
            <p className="sec">{t('portail_f.aide_cotations')}</p>
            {x.consultations.length === 0 ? <Vide>{t('portail_f.aucune_consultation')}</Vide> : (
              <table className="t"><thead><tr><th>{t('portail_f.consultation')}</th><th>{t('portail_f.conditions')}</th><th>{t('portail_f.date_limite')}</th><th>{t('champs.statut')}</th></tr></thead>
                <tbody>{x.consultations.map((c) => {
                  const fermee = c.statut !== 'ouverte' || c.date_limite <= maintenant;
                  return (<tr key={c.reference}><td className="ref">{c.reference}<div>{c.objet}</div></td>
                    <td className="sec">{[c.quantite ? `${Number(c.quantite)}` : null, `${c.incoterm}${c.lieu ? ` ${c.lieu}` : ''}`].filter(Boolean).join(' · ')}</td>
                    <td className="ref">{dateHeure(c.date_limite, langue, c.fuseau || fuseau)}</td>
                    <td><Statut statut={c.pli_depose_le ? 'ok' : fermee ? 'neutre' : 'att'} libelle={c.pli_depose_le ? t('portail_f.pli_depose', { d: date(c.pli_depose_le, langue) }) : fermee ? t('portail_f.close') : t('portail_f.a_coter')} /></td></tr>);
                })}</tbody></table>)}
          </>}
          {vue === 'commandes' && <>
            <h1 className="ecl-titre">{t('portail_f.vues.commandes')}</h1>
            {x.commandes.length === 0 ? <Vide>{t('portail_f.aucune_commande')}</Vide> : x.commandes.map((c) => (
              <section key={c.reference} className="ecl-bloc">
                <div className="liv-pv"><b className="ref">{c.reference}</b><Statut statut={['livree', 'expediee'].includes(c.statut) ? 'ok' : 'info'} libelle={t(`statuts_commande.${c.statut}`, { defaultValue: c.statut })} /></div>
                <span className="sec">{c.incoterm}{c.lieu ? ` ${c.lieu}` : ''}{c.fob_montant !== null ? ` · ${montant(Number(c.fob_montant), c.devise, langue)}` : ''}</span>
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
            </section>
          </>}
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
