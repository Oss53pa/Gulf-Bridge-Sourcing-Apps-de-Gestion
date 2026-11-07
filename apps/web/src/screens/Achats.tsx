import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date, dateHeure, montant } from '../lib/format';
import type { Article, Commande, Compte, Dossier, Fournisseur, Inspection, LigneCommande, Paiement } from '../lib/types';
import { Bandeau, Bouton, CadreTableau, Champ, Chargement, Entete, Kpis, Statut, Tiroir, Vide } from '../components/ui';
import { ApprobationEssais } from './ApprobationEssais';
import { Depot } from '../components/Depot';
import { useNoms } from '../lib/referentiels';
import { DonneesCoutGlobal, ListeRapports } from './RapportOffres';

const INCOTERMS = ['FOB', 'FCA', 'FAS', 'EXW', 'CFR', 'CPT', 'CIF', 'CIP'] as const;

// ============================================================================ Mise en concurrence
interface Rfq { id: string; reference: string; dossier_id: string; objet: string; incoterm_demande: string; date_limite: string; fuseau: string; statut: string; quantite: number | null; specifications: string | null; }
interface Ligne { id: string; fournisseur_id: string; incoterm: string; devise: string; montant: number; fob_montant: number; fob_xof: number;
  delai_jours: number | null; garantie_mois: number | null; note_technique: number | null; retenue: boolean; rang_prix: number; anormalement_basse: boolean; cout_global_manquant: boolean; }

export function MiseEnConcurrence() {
  const [donnees, setDonnees] = useState<string | null>(null);
  const { t } = useTranslation();
  const { langue, fuseau } = useAuth();
  const dossiers = useNoms('dossiers');
  const fournisseurs = useNoms('fournisseurs');
  const [sel, setSel] = useState<string | null>(null);
  const [creer, setCreer] = useState(false);
  const [saisie, setSaisie] = useState(false);
  const l = useAsync(async () => ok(await supabase.from('consultations_fournisseurs').select('*').order('cree_le', { ascending: false }).limit(300)) as Rfq[], []);
  const r = (l.data ?? []).find((x) => x.id === sel) ?? null;
  const invites = useAsync(async () => (r ? ok(await supabase.from('consultation_invites').select('fournisseur_id').eq('consultation_id', r.id)) as { fournisseur_id: string }[] : []), [r?.id]);
  const comparatif = useAsync(async () => (r ? ok(await supabase.from('v_comparatif_offres').select('*').eq('consultation_id', r.id).order('rang_prix')) as Ligne[] : []), [r?.id]);
  const agrees = useAsync(async () => ok(await supabase.from('fournisseurs').select('id, raison_sociale_en, statut_agrement').in('statut_agrement', ['agree', 'sous_surveillance'])) as Fournisseur[], []);
  const [inv, setInv] = useState('');
  const a = useAction();
  const inviter = async () => {
    if (!r || !inv) return;
    if (await a.executer(async () => ok(await supabase.from('consultation_invites').insert({ consultation_id: r.id, fournisseur_id: inv })))) { setInv(''); void invites.recharger(); }
  };
  const retenir = async (o: Ligne) => { if (await a.executer(async () => ok(await supabase.from('offres').update({ retenue: !o.retenue }).eq('id', o.id)))) void comparatif.recharger(); };
  const ferme = r ? new Date(r.date_limite).getTime() > Date.now() : false;
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.achats')} · M5`} titre={t('rfq.titre')} actions={<Bouton variante="primaire" onClick={() => setCreer(true)}>{t('rfq.nouvelle')}</Bouton>} />
      <Bandeau type="err">{l.erreur ?? a.erreur}</Bandeau>
      <div className="liste-detail" style={{ gridTemplateColumns: 'minmax(0, 0.8fr) minmax(0, 1.2fr)' }}>
        <div className="liste"><CadreTableau>
          {(l.data ?? []).length === 0 ? <Vide>{t('rfq.aucune')}</Vide> : (
            <table className="t"><thead><tr><th>{t('champs.reference')}</th><th>{t('champs.objet')}</th><th>{t('rfq.date_limite')}</th><th>{t('champs.statut')}</th></tr></thead>
              <tbody>{(l.data ?? []).map((x) => (
                <tr key={x.id} className="cliquable" aria-selected={x.id === sel} onClick={() => setSel(x.id)}>
                  <td className="ref">{x.reference}<div className="mute">{dossiers[x.dossier_id]}</div></td><td>{x.objet}</td>
                  <td className="ref">{dateHeure(x.date_limite, langue, fuseau)}</td><td><Statut statut={x.statut} libelle={t(`statuts_rfq.${x.statut}`)} /></td></tr>))}</tbody></table>
          )}
        </CadreTableau></div>
        <aside className="detail">
          {!r ? <Vide>{t('rfq.choisir')}</Vide> : (<>
            <div className="surtitre">{r.reference} · {r.incoterm_demande}</div>
            <h2 style={{ fontSize: 22 }}>{r.objet}</h2>
            <dl className="dl">
              <dt>{t('rfq.date_limite')}</dt><dd>{dateHeure(r.date_limite, langue, fuseau)} ({t('rfq.votre_fuseau')}) · {dateHeure(r.date_limite, langue, r.fuseau)} ({r.fuseau})</dd>
              <dt>{t('champs.quantite')}</dt><dd>{r.quantite ?? '—'}</dd>
            </dl>
            <div className="section-titre">{t('rfq.invites')}</div>
            <div className="mute">{(invites.data ?? []).map((i) => fournisseurs[i.fournisseur_id]).join(' · ') || t('rfq.aucun_invite')}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="search" value={inv} onChange={(e) => setInv(e.target.value)} aria-label={t('rfq.inviter')}>
                <option value="">{t('rfq.choisir_fournisseur')}</option>
                {(agrees.data ?? []).filter((f) => !(invites.data ?? []).some((i) => i.fournisseur_id === f.id)).map((f) => <option key={f.id} value={f.id}>{f.raison_sociale_en}</option>)}
              </select>
              <Bouton petit onClick={() => void inviter()}>{t('rfq.inviter')}</Bouton>
            </div>
            <p className="mute">{t('rfq.aide_agrement')}</p>
            <div className="filet" />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="section-titre">{t('rfq.comparatif')}</span>
              <Bouton petit disabled={ferme} title={ferme ? t('rfq.pli_ferme') : ''} onClick={() => setSaisie(true)}>{t('rfq.saisir_offre')}</Bouton>
            </div>
            {ferme && <Bandeau>{t('rfq.pli_ferme')}</Bandeau>}
            {(comparatif.data ?? []).length === 0 ? <span className="mute">{t('rfq.aucune_offre')}</span> : (
              <table className="t"><thead><tr><th>#</th><th>{t('champs.fournisseur')}</th><th>{t('champs.incoterm')}</th><th className="num">{t('rfq.prix')}</th><th className="num">{t('rfq.base_fob')}</th><th className="num">{t('rfq.delai')}</th><th>{t('rfq.alertes')}</th><th /></tr></thead>
                <tbody>{(comparatif.data ?? []).map((o) => (
                  <tr key={o.id}><td>{o.rang_prix}</td><td>{fournisseurs[o.fournisseur_id]}</td><td>{o.incoterm}</td>
                    <td className="num">{montant(o.montant, o.devise, langue)}</td><td className="num">{montant(o.fob_xof, 'XOF', langue)}</td>
                    <td className="num">{o.delai_jours ?? '—'}</td>
                    <td className="sec">{[o.anormalement_basse && t('rfq.anormalement_basse'), o.cout_global_manquant && t('rfq.cout_global_manquant')].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="num"><span className="actions" style={{ justifyContent: 'flex-end' }}>
                      <Bouton petit onClick={() => setDonnees(o.id)}>{t('rapport.cout_global_court')}</Bouton>
                      <Bouton petit variante={o.retenue ? 'primaire' : undefined} onClick={() => void retenir(o)}>{o.retenue ? t('rfq.retenue') : t('rfq.retenir')}</Bouton></span></td></tr>))}</tbody></table>
            )}
            <div className="filet" />
            <ListeRapports consultationId={r.id} peutGenerer={!ferme && (comparatif.data ?? []).length > 0} />
          </>)}
        </aside>
      </div>
      {creer && <NouvelleRfq onClose={() => setCreer(false)} onOk={() => { setCreer(false); void l.recharger(); }} />}
      {donnees && <DonneesCoutGlobal offreId={donnees} onClose={() => setDonnees(null)} onSaved={() => { setDonnees(null); void comparatif.recharger(); }} />}
      {saisie && r && <SaisieOffre rfq={r} invites={(invites.data ?? []).map((i) => i.fournisseur_id)} onClose={() => setSaisie(false)} onOk={() => { setSaisie(false); void comparatif.recharger(); }} />}
    </div>
  );
}

function NouvelleRfq({ onClose, onOk }: { onClose: () => void; onOk: () => void }) {
  const { t } = useTranslation();
  const { fuseau } = useAuth();
  const ds = useAsync(async () => ok(await supabase.from('dossiers').select('id, reference, intitule').eq('statut', 'ouvert').order('reference', { ascending: false })) as Dossier[], []);
  const [f, setF] = useState({ dossier_id: '', objet: '', specifications: '', quantite: '', incoterm_demande: 'FOB', lieu: '', date_limite: '', fuseau });
  const a = useAction();
  const envoyer = async () => {
    // La date limite est saisie dans le fuseau choisi, enregistrée en UTC.
    const iso = f.date_limite ? enUtc(f.date_limite, f.fuseau) : '';
    const v = z.object({ dossier_id: z.string().uuid(), objet: z.string().trim().min(2).max(300), specifications: z.string().max(20000).nullable(),
      quantite: z.number().positive().max(1e9).nullable(), incoterm_demande: z.enum(INCOTERMS), lieu: z.string().max(120).nullable(),
      date_limite: z.string().min(10), fuseau: z.string().min(3).max(64) }).strict()
      .safeParse({ ...f, specifications: f.specifications || null, quantite: f.quantite ? Number(f.quantite) : null, lieu: f.lieu || null, date_limite: iso });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('consultations_fournisseurs').insert(v.data)))) onOk();
  };
  return (
    <Tiroir titre={t('rfq.nouvelle')} onClose={onClose}>
      <Champ label={t('champs.dossier')}><select value={f.dossier_id} onChange={(e) => setF({ ...f, dossier_id: e.target.value })}>
        <option value="">—</option>{(ds.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.reference} · {d.intitule}</option>)}</select></Champ>
      <Champ label={t('champs.objet')}><input value={f.objet} maxLength={300} onChange={(e) => setF({ ...f, objet: e.target.value })} /></Champ>
      <Champ label={t('rfq.specifications')}><textarea value={f.specifications} maxLength={20000} onChange={(e) => setF({ ...f, specifications: e.target.value })} /></Champ>
      <div className="grille2">
        <Champ label={t('champs.quantite')}><input inputMode="decimal" value={f.quantite} onChange={(e) => setF({ ...f, quantite: e.target.value })} /></Champ>
        <Champ label={t('champs.incoterm')}><select value={f.incoterm_demande} onChange={(e) => setF({ ...f, incoterm_demande: e.target.value })}>{INCOTERMS.map((i) => <option key={i}>{i}</option>)}</select></Champ>
        <Champ label={t('rfq.date_limite')}><input type="datetime-local" value={f.date_limite} onChange={(e) => setF({ ...f, date_limite: e.target.value })} /></Champ>
        <Champ label={t('rfq.fuseau')}><select value={f.fuseau} onChange={(e) => setF({ ...f, fuseau: e.target.value })}>
          {['Asia/Shanghai', 'Africa/Abidjan', 'Africa/Libreville', 'Africa/Douala'].map((z2) => <option key={z2}>{z2}</option>)}</select></Champ>
      </div>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void envoyer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

/** Convertit une date-heure locale d'un fuseau IANA en ISO UTC. */
export function enUtc(local: string, fuseau: string): string {
  const [d, h = '00:00'] = local.split('T');
  const [y, m, j] = d.split('-').map(Number);
  const [hh, mm] = h.split(':').map(Number);
  const approx = Date.UTC(y, m - 1, j, hh, mm);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: fuseau, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(approx)).reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const vu = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute));
  return new Date(approx - (vu - approx)).toISOString();
}

function SaisieOffre({ rfq, invites, onClose, onOk }: { rfq: Rfq; invites: string[]; onClose: () => void; onOk: () => void }) {
  const { t } = useTranslation();
  const fournisseurs = useNoms('fournisseurs');
  const [f, setF] = useState({ fournisseur_id: '', recu_le: '', canal: 'wechat', incoterm: rfq.incoterm_demande, lieu: '', devise: 'USD', montant: '', fret: '', assurance: '',
    frais_jusqu_a_bord: '', delai_jours: '', garantie_mois: '', note_technique: '' });
  const a = useAction();
  const n = (s: string) => (s.trim() === '' ? null : Number(s.replace(/\s/g, '').replace(',', '.')));
  const envoyer = async () => {
    const v = z.object({ consultation_id: z.string().uuid(), fournisseur_id: z.string().uuid(), recu_le: z.string().min(10), canal: z.enum(['wechat', 'email', 'formulaire', 'autre']),
      incoterm: z.enum(INCOTERMS), lieu: z.string().trim().min(2).max(120), devise: z.enum(['USD', 'CNY', 'XOF', 'XAF']), montant: z.number().min(0).max(1e12),
      fret: z.number().min(0).nullable(), assurance: z.number().min(0).nullable(), frais_jusqu_a_bord: z.number().min(0).nullable(),
      delai_jours: z.number().int().min(0).max(730).nullable(), garantie_mois: z.number().int().min(0).max(240).nullable(), note_technique: z.number().min(0).max(5).nullable() }).strict()
      .safeParse({ ...f, consultation_id: rfq.id, recu_le: f.recu_le ? new Date(f.recu_le).toISOString() : '', montant: n(f.montant), fret: n(f.fret), assurance: n(f.assurance),
        frais_jusqu_a_bord: n(f.frais_jusqu_a_bord), delai_jours: n(f.delai_jours), garantie_mois: n(f.garantie_mois), note_technique: n(f.note_technique) });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('offres').insert(v.data)))) onOk();
  };
  const besoinFret = ['CFR', 'CPT', 'CIF', 'CIP'].includes(f.incoterm);
  return (
    <Tiroir titre={t('rfq.saisir_offre')} onClose={onClose}>
      <p className="sec">{t('rfq.aide_saisie')}</p>
      <div className="grille2">
        <Champ label={t('champs.fournisseur')}><select value={f.fournisseur_id} onChange={(e) => setF({ ...f, fournisseur_id: e.target.value })}>
          <option value="">—</option>{invites.map((i) => <option key={i} value={i}>{fournisseurs[i]}</option>)}</select></Champ>
        <Champ label={t('rfq.recu_le')}><input type="datetime-local" value={f.recu_le} onChange={(e) => setF({ ...f, recu_le: e.target.value })} /></Champ>
        <Champ label={t('rfq.canal')}><select value={f.canal} onChange={(e) => setF({ ...f, canal: e.target.value })}>{['wechat', 'email', 'formulaire', 'autre'].map((c) => <option key={c} value={c}>{t(`canaux.${c}`)}</option>)}</select></Champ>
        <Champ label={t('champs.incoterm')}><select value={f.incoterm} onChange={(e) => setF({ ...f, incoterm: e.target.value })}>{INCOTERMS.map((i) => <option key={i}>{i}</option>)}</select></Champ>
        <Champ label={t('rfq.lieu_nomme')}><input value={f.lieu} maxLength={120} onChange={(e) => setF({ ...f, lieu: e.target.value })} /></Champ>
        <Champ label={t('champs.devise')}><select value={f.devise} onChange={(e) => setF({ ...f, devise: e.target.value })}>{['USD', 'CNY'].map((d) => <option key={d}>{d}</option>)}</select></Champ>
        <Champ label={t('rfq.prix')}><input inputMode="decimal" value={f.montant} onChange={(e) => setF({ ...f, montant: e.target.value })} /></Champ>
        {besoinFret && <Champ label={t('rfq.fret')}><input inputMode="decimal" value={f.fret} onChange={(e) => setF({ ...f, fret: e.target.value })} /></Champ>}
        {['CIF', 'CIP'].includes(f.incoterm) && <Champ label={t('rfq.assurance')}><input inputMode="decimal" value={f.assurance} onChange={(e) => setF({ ...f, assurance: e.target.value })} /></Champ>}
        {['EXW', 'FCA'].includes(f.incoterm) && <Champ label={t('rfq.frais_bord')}><input inputMode="decimal" value={f.frais_jusqu_a_bord} onChange={(e) => setF({ ...f, frais_jusqu_a_bord: e.target.value })} /></Champ>}
        <Champ label={t('rfq.delai')}><input inputMode="numeric" value={f.delai_jours} onChange={(e) => setF({ ...f, delai_jours: e.target.value })} /></Champ>
        <Champ label={t('rfq.garantie')}><input inputMode="numeric" value={f.garantie_mois} onChange={(e) => setF({ ...f, garantie_mois: e.target.value })} /></Champ>
        <Champ label={t('rfq.note_technique')}><input inputMode="decimal" value={f.note_technique} onChange={(e) => setF({ ...f, note_technique: e.target.value })} /></Champ>
      </div>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void envoyer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

// ============================================================================ Commandes
export function Commandes() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { langue, profil, societeActive } = useAuth();
  const fournisseurs = useNoms('fournisseurs');
  const dossiers = useNoms('dossiers');
  const [creer, setCreer] = useState(Boolean(params.get('dossier')));
  const l = useAsync(async () => ok(await supabase.from('commandes').select('*').order('cree_le', { ascending: false }).limit(500)) as Commande[], [societeActive]);
  const totaux = useMemo(() => {
    const prod = (l.data ?? []).filter((c) => c.statut === 'en_production').length;
    const brouillon = (l.data ?? []).filter((c) => c.statut === 'brouillon').length;
    return { prod, brouillon, tot: (l.data ?? []).length };
  }, [l.data]);
  const ecrit = ['admin', 'achats_chine'].includes(profil?.role ?? '');
  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.achats')} · M7`} titre={t('commandes.titre', { n: totaux.tot, p: totaux.prod })}
        actions={ecrit && <Bouton variante="primaire" onClick={() => setCreer(true)}>{t('commandes.nouvelle')}</Bouton>} />
      <Kpis items={[
        { lib: t('commandes.total'), val: totaux.tot },
        { lib: t('statuts_commande.brouillon'), val: totaux.brouillon, sous: t('commandes.attente_contrat') },
        { lib: t('statuts_commande.en_production'), val: totaux.prod, sous: t('commandes.verrou1_leve') },
        { lib: t('statuts_commande.expediee'), val: (l.data ?? []).filter((c) => c.statut === 'expediee').length, sous: t('commandes.verrou2_leve') },
      ]} />
      <Bandeau type="err">{l.erreur}</Bandeau>
      <CadreTableau>
        {l.chargement ? <Chargement /> : (l.data ?? []).length === 0 ? <Vide>{t('commandes.aucune')}</Vide> : (
          <table className="t"><thead><tr><th>{t('champs.reference')}</th><th>{t('champs.dossier')}</th><th>{t('champs.fournisseur')}</th><th>{t('champs.incoterm')}</th>
            <th className="num">{t('champs.montant')}</th><th className="num">{t('champs.fob')}</th><th>{t('champs.statut')}</th></tr></thead>
            <tbody>{(l.data ?? []).map((c) => (
              <tr key={c.id} className="cliquable" onClick={() => nav(`/commandes/${c.id}`)}>
                <td className="ref">{c.reference}{c.sur_mesure && <div className="mute">{t('commandes.sur_mesure')}</div>}</td><td className="ref">{dossiers[c.dossier_id]}</td>
                <td>{fournisseurs[c.fournisseur_id]}</td><td>{c.incoterm} {c.lieu}</td>
                <td className="num">{montant(c.montant_marchandise, c.devise, langue)}</td><td className="num">{montant(c.fob_montant, c.devise, langue)}</td>
                <td><Statut statut={c.statut} libelle={t(`statuts_commande.${c.statut}`)} /></td></tr>))}</tbody></table>
        )}
      </CadreTableau>
      {creer && <NouvelleCommande dossierInitial={params.get('dossier')} onClose={() => setCreer(false)} onOk={(id) => nav(`/commandes/${id}`)} />}
    </div>
  );
}

function NouvelleCommande({ dossierInitial, onClose, onOk }: { dossierInitial: string | null; onClose: () => void; onOk: (id: string) => void }) {
  const { t } = useTranslation();
  const ds = useAsync(async () => ok(await supabase.from('dossiers').select('id, reference, intitule, mode_financier').eq('statut', 'ouvert').neq('mode_financier', 'service_seul').order('reference', { ascending: false })) as Dossier[], []);
  const fs = useAsync(async () => ok(await supabase.from('fournisseurs').select('id, raison_sociale_en, statut_agrement, apporte_par_client').not('statut_agrement', 'in', '(suspendu,radie)')) as Fournisseur[], []);
  const [f, setF] = useState({ dossier_id: dossierInitial ?? '', fournisseur_id: '', incoterm: 'FOB', lieu: '', devise: 'USD', fret: '', assurance: '', frais_jusqu_a_bord: '', date_livraison_promise: '', transfert_risque: '' });
  const a = useAction();
  const n = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
  const envoyer = async () => {
    const v = z.object({ dossier_id: z.string().uuid(), fournisseur_id: z.string().uuid(), incoterm: z.enum(INCOTERMS), lieu: z.string().trim().min(2).max(120),
      devise: z.enum(['USD', 'CNY']), fret: z.number().min(0).nullable(), assurance: z.number().min(0).nullable(), frais_jusqu_a_bord: z.number().min(0).nullable(),
      date_livraison_promise: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), transfert_risque: z.string().max(200).nullable() }).strict()
      .safeParse({ ...f, fret: n(f.fret), assurance: n(f.assurance), frais_jusqu_a_bord: n(f.frais_jusqu_a_bord), date_livraison_promise: f.date_livraison_promise || null, transfert_risque: f.transfert_risque || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    await a.executer(async () => { const r = ok(await supabase.from('commandes').insert(v.data).select('id').single()) as { id: string }; onOk(r.id); });
  };
  return (
    <Tiroir titre={t('commandes.nouvelle')} onClose={onClose}>
      <Champ label={t('champs.dossier')}><select value={f.dossier_id} onChange={(e) => setF({ ...f, dossier_id: e.target.value })}>
        <option value="">—</option>{(ds.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.reference} · {d.intitule}</option>)}</select></Champ>
      <Champ label={t('champs.fournisseur')}><select value={f.fournisseur_id} onChange={(e) => setF({ ...f, fournisseur_id: e.target.value })}>
        <option value="">—</option>{(fs.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.raison_sociale_en} · {t(`agrement.${x.statut_agrement}`)}</option>)}</select></Champ>
      <div className="grille2">
        <Champ label={t('champs.incoterm')}><select value={f.incoterm} onChange={(e) => setF({ ...f, incoterm: e.target.value })}>{INCOTERMS.filter((i) => i !== 'EXW').map((i) => <option key={i}>{i}</option>)}</select></Champ>
        <Champ label={t('rfq.lieu_nomme')}><input value={f.lieu} maxLength={120} onChange={(e) => setF({ ...f, lieu: e.target.value })} /></Champ>
        <Champ label={t('champs.devise')}><select value={f.devise} onChange={(e) => setF({ ...f, devise: e.target.value })}><option>USD</option><option>CNY</option></select></Champ>
        <Champ label={t('commandes.livraison_promise')}><input type="date" value={f.date_livraison_promise} onChange={(e) => setF({ ...f, date_livraison_promise: e.target.value })} /></Champ>
        {['CFR', 'CPT', 'CIF', 'CIP'].includes(f.incoterm) && <Champ label={t('rfq.fret')}><input inputMode="decimal" value={f.fret} onChange={(e) => setF({ ...f, fret: e.target.value })} /></Champ>}
        {['CIF', 'CIP'].includes(f.incoterm) && <Champ label={t('rfq.assurance')}><input inputMode="decimal" value={f.assurance} onChange={(e) => setF({ ...f, assurance: e.target.value })} /></Champ>}
        {f.incoterm === 'FCA' && <Champ label={t('rfq.frais_bord')}><input inputMode="decimal" value={f.frais_jusqu_a_bord} onChange={(e) => setF({ ...f, frais_jusqu_a_bord: e.target.value })} /></Champ>}
      </div>
      <Champ label={t('commandes.transfert_risque')}><input value={f.transfert_risque} maxLength={200} onChange={(e) => setF({ ...f, transfert_risque: e.target.value })} /></Champ>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void envoyer()}>{t('commun.enregistrer')}</Bouton>
    </Tiroir>
  );
}

export function FicheCommande() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { profil, langue, fuseau } = useAuth();
  const role = profil?.role ?? '';
  const fournisseurs = useNoms('fournisseurs');
  const articlesN = useNoms('articles');
  const profils = useNoms('profils');
  const c = useAsync(async () => ok(await supabase.from('commandes').select('*').eq('id', id).maybeSingle()) as Commande | null, [id]);
  const lignes = useAsync(async () => ok(await supabase.from('lignes_commande').select('*').eq('commande_id', id).order('cree_le')) as LigneCommande[], [id]);
  const paiements = useAsync(async () => ok(await supabase.from('paiements_fournisseurs').select('*').eq('commande_id', id).order('prepare_le')) as Paiement[], [id]);
  const inspections = useAsync(async () => ok(await supabase.from('inspections').select('*').eq('commande_id', id).order('cree_le')) as Inspection[], [id]);
  const arts = useAsync(async () => ok(await supabase.from('articles').select('*').is('archive_le', null).order('reference')) as Article[], []);
  const dossier = useAsync(async () => (c.data ? ok(await supabase.from('dossiers').select('*').eq('id', c.data.dossier_id).single()) as Dossier : null), [c.data?.dossier_id]);
  const a = useAction();
  const [ligne, setLigne] = useState({ article_id: '', quantite: '', prix_unitaire: '', sur_mesure: false, reassort: false });
  const [contrat, setContrat] = useState<{ doc: string; mode: string; date: string } | null>(null);
  const [pay, setPay] = useState(false);
  const [exec, setExec] = useState<Paiement | null>(null);
  const [motif, setMotif] = useState('');
  const [annuler, setAnnuler] = useState(false);
  const cmd = c.data;
  if (c.chargement) return <div className="screen"><Chargement /></div>;
  if (!cmd) return <div className="screen"><Vide>{c.erreur ?? t('commandes.introuvable')}</Vide></div>;
  const ecrit = ['admin', 'achats_chine'].includes(role);
  const recharger = () => { void c.recharger(); void lignes.recharger(); void paiements.recharger(); void inspections.recharger(); };
  const ajouterLigne = async () => {
    const v = z.object({ article_id: z.string().uuid(), quantite: z.number().positive().max(1e9), prix_unitaire: z.number().min(0).max(1e9), sur_mesure: z.boolean(), reassort: z.boolean(), commande_id: z.string().uuid() }).strict()
      .safeParse({ ...ligne, quantite: Number(ligne.quantite.replace(',', '.')), prix_unitaire: Number(ligne.prix_unitaire.replace(',', '.')), commande_id: cmd.id });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('lignes_commande').insert(v.data)))) { setLigne({ article_id: '', quantite: '', prix_unitaire: '', sur_mesure: false, reassort: false }); recharger(); }
  };
  const statut = async (s: string, m?: string) => { if (await a.executer(async () => ok(await supabase.rpc('changer_statut_commande', { p_commande: cmd.id, p_statut: s, p_motif: m ?? null })))) { setAnnuler(false); recharger(); } };
  const validerContrat = async () => {
    if (!contrat?.doc || !/^\d{4}-\d{2}-\d{2}$/.test(contrat.date)) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('valider_contrat', { p_commande: cmd.id, p_document: contrat.doc, p_mode: contrat.mode, p_signe_le: contrat.date })))) { setContrat(null); recharger(); }
  };
  const validerPaiement = async (p: Paiement) => { if (await a.executer(async () => ok(await supabase.rpc('valider_paiement', { p_paiement: p.id })))) recharger(); };
  const refuserPaiement = async (p: Paiement) => { const m = window.prompt(t('paiements.motif_refus'))?.trim(); if (m && await a.executer(async () => ok(await supabase.rpc('refuser_paiement', { p_paiement: p.id, p_motif: m.slice(0, 1000) })))) recharger(); };
  const fob = Number(cmd.fob_montant);
  const validateur = role === 'admin' || profil?.delegue_validation;

  return (
    <div className="screen">
      <Entete surtitre={`${t('modules.achats')} · ${dossier.data?.reference ?? ''} · ${t(`modes.${dossier.data?.mode_financier ?? 'accompagne'}`)}`}
        titre={`${cmd.reference} — ${fournisseurs[cmd.fournisseur_id] ?? ''}`}
        actions={<>
          <Statut statut={cmd.statut} libelle={t(`statuts_commande.${cmd.statut}`)} />
          {ecrit && cmd.statut === 'contrat_signe' && <Bouton variante="primaire" onClick={() => void statut('en_production')}>{t('commandes.lancer_production')}</Bouton>}
          {ecrit && cmd.statut === 'en_production' && <Bouton onClick={() => void statut('production_terminee')}>{t('commandes.production_terminee')}</Bouton>}
          {role === 'admin' && !['annulee', 'livree', 'expediee'].includes(cmd.statut) && <Bouton variante="danger" onClick={() => setAnnuler(true)}>{t('commandes.annuler')}</Bouton>}
        </>} />
      <Kpis items={[
        { lib: t('champs.montant'), val: montant(cmd.montant_marchandise, cmd.devise, langue), sous: `${cmd.incoterm} ${cmd.lieu}` },
        { lib: t('champs.fob'), val: montant(fob, cmd.devise, langue), sous: t('commandes.base_commission') },
        { lib: t('commandes.contrat'), texte: true, val: cmd.contrat_valide_le ? t('commandes.signe') : t('commandes.non_signe'), sous: cmd.contrat_signe_le ? `${date(cmd.contrat_signe_le, langue)} · ${t(`modes_contrat.${cmd.contrat_mode}`)}` : t('commandes.verrou1') },
        { lib: t('commandes.risque'), texte: true, val: cmd.transfert_risque ?? cmd.incoterm, sous: t('commandes.inspection_avant') },
      ]} />
      <Bandeau type="err">{a.erreur}</Bandeau>
      <div className="cadre" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section>
          <div className="section-titre">{t('commandes.lignes')}</div>
          <table className="t"><thead><tr><th>{t('champs.article')}</th><th className="num">{t('champs.quantite')}</th><th className="num">{t('commandes.pu')}</th><th className="num">{t('champs.montant')}</th><th>{t('commandes.options')}</th><th /></tr></thead>
            <tbody>{(lignes.data ?? []).map((l) => (
              <tr key={l.id}><td>{articlesN[l.article_id]}</td><td className="num">{l.quantite}</td><td className="num">{montant(l.prix_unitaire, cmd.devise, langue)}</td><td className="num">{montant(l.montant, cmd.devise, langue)}</td>
                <td className="sec">{[l.sur_mesure && t('commandes.sur_mesure'), l.reassort && t('commandes.reassort')].filter(Boolean).join(' · ') || '—'}</td>
                <td className="num">{ecrit && !cmd.contrat_valide_le && <Bouton petit variante="danger" onClick={() => void a.executer(async () => { ok(await supabase.from('lignes_commande').delete().eq('id', l.id)); recharger(); })}>{t('commun.retirer')}</Bouton>}</td></tr>))}
            </tbody></table>
          {ecrit && !cmd.contrat_valide_le && (
            <div className="grille3" style={{ alignItems: 'end', marginTop: 8, gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr auto' }}>
              <Champ label={t('champs.article')}><select value={ligne.article_id} onChange={(e) => setLigne({ ...ligne, article_id: e.target.value })}>
                <option value="">—</option>{(arts.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.reference} · {x.designation}</option>)}</select></Champ>
              <Champ label={t('champs.quantite')}><input inputMode="decimal" value={ligne.quantite} onChange={(e) => setLigne({ ...ligne, quantite: e.target.value })} /></Champ>
              <Champ label={t('commandes.pu')}><input inputMode="decimal" value={ligne.prix_unitaire} onChange={(e) => setLigne({ ...ligne, prix_unitaire: e.target.value })} /></Champ>
              <label className="champ" style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 18, height: 18 }} checked={ligne.sur_mesure} onChange={(e) => setLigne({ ...ligne, sur_mesure: e.target.checked })} /><span>{t('commandes.sur_mesure')}</span></label>
              <label className="champ" style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 18, height: 18 }} checked={ligne.reassort} onChange={(e) => setLigne({ ...ligne, reassort: e.target.checked })} /><span>{t('commandes.reassort')}</span></label>
              <Bouton onClick={() => void ajouterLigne()}>{t('commun.ajouter')}</Bouton>
            </div>
          )}
        </section>
        <section style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {role === 'admin' && !cmd.contrat_valide_le && <Bouton variante="primaire" onClick={() => setContrat({ doc: '', mode: 'electronique', date: '' })}>{t('commandes.valider_contrat')}</Bouton>}
          {cmd.approbation_valide_le && <Statut statut="validee" libelle={t('commandes.approbation_ok')} />}
          {cmd.sur_mesure && !cmd.approbation_valide_le && <Statut statut="att" libelle={t('approbation.requise')} />}
        </section>
        {ecrit && <ApprobationEssais commandeId={cmd.id} dossierId={cmd.dossier_id} statutCommande={cmd.statut} onChange={recharger} />}
        {cmd.date_livraison_promise && <PenaliteCommande commande={cmd} peutDater={ecrit} onChange={recharger} />}
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="section-titre">{t('commandes.paiements')}</span>
            {ecrit && <Bouton petit onClick={() => setPay(true)}>{t('paiements.preparer')}</Bouton>}
          </div>
          <p className="mute">{dossier.data?.mode_financier === 'accompagne' ? t('paiements.aide_mode1') : t('paiements.aide_mode2')}</p>
          {(paiements.data ?? []).length === 0 ? <span className="mute">{t('paiements.aucun')}</span> : (
            <table className="t"><thead><tr><th>{t('champs.reference')}</th><th>{t('paiements.nature')}</th><th>{t('paiements.canal')}</th><th className="num">{t('champs.montant')}</th><th>{t('paiements.prepare')}</th><th>{t('paiements.valide')}</th><th>{t('champs.statut')}</th><th /></tr></thead>
              <tbody>{(paiements.data ?? []).map((p) => (
                <tr key={p.id}><td className="ref">{p.reference}</td><td>{t(`natures.${p.nature}`)}<div className="mute">{t(`flux_paiement.${p.flux}`)}</div></td><td className="sec">{t(`canaux_paiement.${p.canal}`)}</td>
                  <td className="num">{montant(p.montant, p.devise, langue)}</td><td className="sec">{profils[p.prepare_par]}<div className="mute">{dateHeure(p.prepare_le, langue, fuseau)}</div></td>
                  <td className="sec">{p.valide_par ? profils[p.valide_par] : '—'}</td><td><Statut statut={p.statut} libelle={t(`statuts_paiement.${p.statut}`)} /></td>
                  <td className="num"><span className="actions" style={{ justifyContent: 'flex-end' }}>
                    {p.statut === 'prepare' && validateur && p.prepare_par !== profil?.id && <Bouton petit variante="primaire" onClick={() => void validerPaiement(p)}>{t('commun.valider')}</Bouton>}
                    {p.statut === 'prepare' && p.prepare_par === profil?.id && <span className="mute">{t('paiements.attente_second')}</span>}
                    {['prepare', 'valide'].includes(p.statut) && validateur && <Bouton petit variante="danger" onClick={() => void refuserPaiement(p)}>{t('fiche.refuser')}</Bouton>}
                    {p.statut === 'valide' && ecrit && <Bouton petit onClick={() => setExec(p)}>{p.flux === 'gbs' ? t('paiements.executer') : t('paiements.confirmer_client')}</Bouton>}
                  </span></td></tr>))}</tbody></table>
          )}
        </section>
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="section-titre">{t('commandes.inspections')}</span>
            {ecrit && <Link className="btn petit" to={`/inspections?commande=${cmd.id}`}>{t('inspections.planifier')}</Link>}
          </div>
          {(inspections.data ?? []).length === 0 ? <span className="mute">{t('inspections.aucune')}</span> : (
            <table className="t"><tbody>{(inspections.data ?? []).map((i) => (
              <tr key={i.id}><td className="ref"><Link to={`/inspections/${i.id}`}>{i.reference}</Link></td><td>{t(`types_inspection.${i.type}`)}</td><td className="ref">{date(i.date_realisee ?? i.date_prevue, langue)}</td>
                <td><Statut statut={i.statut} libelle={t(`statuts_inspection.${i.statut}`)} /></td></tr>))}</tbody></table>
          )}
        </section>
      </div>
      {contrat && (
        <Tiroir titre={t('commandes.valider_contrat')} onClose={() => setContrat(null)}>
          <p className="sec">{t('commandes.aide_contrat')}</p>
          <Champ label={t('commandes.mode_signature')}><select value={contrat.mode} onChange={(e) => setContrat({ ...contrat, mode: e.target.value })}>
            <option value="electronique">{t('modes_contrat.electronique')}</option><option value="cachet">{t('modes_contrat.cachet')}</option></select></Champ>
          <Champ label={t('devis.date_signature')}><input type="date" value={contrat.date} onChange={(e) => setContrat({ ...contrat, date: e.target.value })} /></Champ>
          <Champ label={t('devis.document_signe')}><Depot dossierId={cmd.dossier_id} valeur={contrat.doc || null} onChange={(doc) => setContrat({ ...contrat, doc })} /></Champ>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <Bouton variante="primaire" disabled={a.enCours} onClick={() => void validerContrat()}>{t('commun.valider')}</Bouton>
        </Tiroir>
      )}
      {annuler && (
        <Tiroir titre={t('commandes.annuler')} onClose={() => setAnnuler(false)}>
          <p className="sec">{t('commandes.aide_annulation')}</p>
          <Champ label={t('champs.motif')}><textarea value={motif} maxLength={1000} onChange={(e) => setMotif(e.target.value)} /></Champ>
          <Bandeau type="err">{a.erreur}</Bandeau>
          <Bouton variante="danger" disabled={motif.trim().length < 5} onClick={() => void statut('annulee', motif.trim())}>{t('commandes.confirmer_annulation')}</Bouton>
        </Tiroir>
      )}
      {pay && dossier.data && <PreparerPaiement commande={cmd} dossier={dossier.data} onClose={() => setPay(false)} onOk={() => { setPay(false); recharger(); }} />}
      {exec && <ExecuterPaiement paiement={exec} dossierId={cmd.dossier_id} onClose={() => setExec(null)} onOk={() => { setExec(null); recharger(); }} />}
    </div>
  );
}

interface Penalite { applicable: boolean; devise: string; date_promise: string; date_reference: string; provisoire: boolean; jours_retard: number;
  taux_jour: number; plafond: number | null; montant_brut: number; montant: number; plafonnee: boolean }

/** Pénalité de retard calculée selon le contrat ; les achats datent la livraison effective. */
function PenaliteCommande({ commande, peutDater, onChange }: { commande: Commande; peutDater: boolean; onChange: () => void }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const p = useAsync(async () => ok(await supabase.rpc('penalite_commande', { p_commande: commande.id })) as Penalite, [commande.id, commande.livraison_reelle_le]);
  const a = useAction();
  const [dateLiv, setDateLiv] = useState('');
  const dater = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateLiv)) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('commandes').update({ livraison_reelle_le: dateLiv }).eq('id', commande.id)))) onChange();
  };
  const x = p.data;
  return (
    <section>
      <span className="section-titre">{t('penalites.titre')}</span>
      <Bandeau type="err">{p.erreur ?? a.erreur}</Bandeau>
      {x && !x.applicable ? <p className="mute">{t('penalites.sans_clause')}</p> : x && (
        <dl className="dl">
          <dt>{t('penalites.date_promise')}</dt><dd>{date(x.date_promise, langue)}</dd>
          <dt>{t('penalites.date_livraison')}</dt><dd>{commande.livraison_reelle_le ? date(commande.livraison_reelle_le, langue) : t('penalites.non_datee')}</dd>
          <dt>{t('penalites.retard')}</dt><dd>{t('penalites.jours', { n: x.jours_retard })}</dd>
          <dt>{t('penalites.montant')}</dt><dd>{montant(x.montant, x.devise, langue)}
            {x.plafonnee ? ` · ${t('penalites.plafonnee')}` : ''}{x.provisoire ? ` · ${t('penalites.provisoire')}` : ''}</dd>
        </dl>
      )}
      {peutDater && !commande.livraison_reelle_le && (
        <div className="actions" style={{ alignItems: 'flex-end' }}>
          <Champ label={t('penalites.dater_livraison')}><input type="date" value={dateLiv} onChange={(e) => setDateLiv(e.target.value)} /></Champ>
          <Bouton disabled={a.enCours} onClick={() => void dater()}>{t('commun.enregistrer')}</Bouton>
        </div>
      )}
      <p className="mute">{t('penalites.aide')}</p>
    </section>
  );
}

function PreparerPaiement({ commande, dossier, onClose, onOk }: { commande: Commande; dossier: Dossier; onClose: () => void; onOk: () => void }) {
  const { t } = useTranslation();
  const { langue } = useAuth();
  const comptes = useAsync(async () => ok(await supabase.from('comptes_paiement').select('*').eq('fournisseur_id', commande.fournisseur_id).eq('verifie', true).is('archive_le', null)) as Compte[], []);
  const flux = dossier.mode_financier === 'accompagne' ? 'instruction_client' : 'gbs';
  const [f, setF] = useState({ nature: 'acompte', compte_id: '', montant: '', retenue: '', motif: '' });
  const a = useAction();
  const compte = (comptes.data ?? []).find((c) => c.id === f.compte_id);
  const penalite = useAsync(async () => (f.nature === 'solde' ? ok(await supabase.rpc('penalite_commande', { p_commande: commande.id })) as Penalite : null), [f.nature, commande.id]);
  const envoyer = async () => {
    if (!compte) { a.setErreur(t('formulaire.invalide')); return; }
    const canal = compte.type === 'banque' ? (flux === 'instruction_client' ? 'virement' : 'virement') : compte.type;
    const v = z.object({ commande_id: z.string().uuid(), nature: z.enum(['acompte', 'solde', 'echantillon', 'frais']), flux: z.enum(['gbs', 'instruction_client']),
      canal: z.enum(['virement', 'wechat_pay', 'alipay', 'lettre_credit']), compte_id: z.string().uuid(), montant: z.number().positive().max(1e10), devise: z.enum(['USD', 'CNY']),
      penalite_retenue: z.number().min(0).max(1e10), penalite_motif: z.string().trim().max(1000).nullable() }).strict()
      .safeParse({ commande_id: commande.id, nature: f.nature, flux, canal, compte_id: compte.id, montant: Number(f.montant.replace(',', '.')), devise: compte.devise,
        penalite_retenue: f.nature === 'solde' && f.retenue ? Number(f.retenue.replace(',', '.')) : 0, penalite_motif: f.motif.trim() || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('paiements_fournisseurs').insert(v.data)))) onOk();
  };
  return (
    <Tiroir titre={flux === 'gbs' ? t('paiements.preparer') : t('paiements.instruction')} onClose={onClose}>
      <p className="sec">{flux === 'gbs' ? t('paiements.aide_mode2') : t('paiements.aide_mode1')}</p>
      <Champ label={t('paiements.nature')}><select value={f.nature} onChange={(e) => setF({ ...f, nature: e.target.value })}>
        {['acompte', 'solde', 'echantillon', 'frais'].map((n) => <option key={n} value={n}>{t(`natures.${n}`)}</option>)}</select></Champ>
      <Champ label={t('paiements.compte_verifie')}><select value={f.compte_id} onChange={(e) => setF({ ...f, compte_id: e.target.value })}>
        <option value="">—</option>{(comptes.data ?? []).map((c) => <option key={c.id} value={c.id}>{t(`types_compte.${c.type}`)} · {c.devise} · {c.numero.replace(/.(?=.{4})/g, '•')}</option>)}</select></Champ>
      {(comptes.data ?? []).length === 0 && <Bandeau>{t('paiements.aucun_compte')}</Bandeau>}
      <Champ label={`${t('champs.montant')} ${compte ? `(${compte.devise})` : ''}`}><input inputMode="decimal" value={f.montant} onChange={(e) => setF({ ...f, montant: e.target.value })} /></Champ>
      {f.nature === 'solde' && penalite.data?.applicable && Number(penalite.data.montant) > 0 && (<>
        <Bandeau>{t('penalites.proposee', { montant: montant(penalite.data.montant, penalite.data.devise, langue), jours: penalite.data.jours_retard })}
          {penalite.data.provisoire ? ` ${t('penalites.provisoire')}` : ''}</Bandeau>
        <Champ label={`${t('penalites.retenue')} ${compte ? `(${compte.devise})` : ''}`}><input inputMode="decimal" value={f.retenue} onChange={(e) => setF({ ...f, retenue: e.target.value })} /></Champ>
        <Champ label={t('penalites.motif_renonciation')}><textarea value={f.motif} maxLength={1000} onChange={(e) => setF({ ...f, motif: e.target.value })} /></Champ>
      </>)}
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void envoyer()}>{t('paiements.preparer')}</Bouton>
    </Tiroir>
  );
}

function ExecuterPaiement({ paiement, dossierId, onClose, onOk }: { paiement: Paiement; dossierId: string; onClose: () => void; onOk: () => void }) {
  const { t } = useTranslation();
  const [ref, setRef] = useState('');
  const [doc, setDoc] = useState('');
  const a = useAction();
  const envoyer = async () => {
    if (!/^[A-Za-z0-9 ./_-]{3,80}$/.test(ref) || !doc) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('executer_paiement', { p_paiement: paiement.id, p_reference: ref, p_justificatif: doc })))) onOk();
  };
  return (
    <Tiroir titre={paiement.flux === 'gbs' ? t('paiements.executer') : t('paiements.confirmer_client')} onClose={onClose}>
      <Champ label={t('paiements.reference_transaction')}><input value={ref} maxLength={80} onChange={(e) => setRef(e.target.value)} /></Champ>
      <Champ label={t('paiements.justificatif')}><Depot dossierId={dossierId} valeur={doc || null} onChange={setDoc} /></Champ>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void envoyer()}>{t('commun.valider')}</Bouton>
    </Tiroir>
  );
}
