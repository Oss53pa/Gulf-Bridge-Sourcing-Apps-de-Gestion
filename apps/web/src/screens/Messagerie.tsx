// Échanges · messagerie (interne, client, fournisseur). Visibilité, création et limitation de débit
// tenues par la base (migration 60) ; le texte des messages est affiché comme du texte (jamais du HTML).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { dateHeure } from '../lib/format';
import { Bandeau, Bouton, Champ, Chargement, Entete, Tiroir, Vide } from '../components/ui';

interface Fil { id: string; audience: 'interne' | 'client' | 'fournisseur'; sujet: string; categorie: string; reference: string | null; dernier_message_le: string; dernier_auteur: string | null; dernier_extrait: string | null }
interface Message { id: string; auteur: string; moi: boolean; interne: boolean; corps: string; cree_le: string }
export interface CibleFil { id: string; libelle: string }
const CATS = ['technique', 'qualite', 'expedition', 'factures', 'autre'] as const;

/** Liste des fils + conversation. `nouveau` : audience et cibles (dossiers ou commandes) proposées pour un nouveau fil. */
export function MessagerieVue({ nouveau, avecEntete = true }: { nouveau?: { audiences: ('interne' | 'client' | 'fournisseur')[]; dossiers?: CibleFil[]; commandes?: CibleFil[] }; avecEntete?: boolean }) {
  const { t } = useTranslation();
  const { langue, fuseau } = useAuth();
  const fils = useAsync(async () => ok(await supabase.rpc('mes_fils', { p_limite: 200 })) as Fil[], []);
  const [sel, setSel] = useState<string | null>(null);
  const [creer, setCreer] = useState(false);
  const x = (fils.data ?? []).find((f) => f.id === sel) ?? fils.data?.[0] ?? null;
  const msgs = useAsync(async () => (x ? ok(await supabase.rpc('messages_du_fil', { p_fil: x.id })) as Message[] : []), [x?.id, x?.dernier_message_le]);
  const a = useAction();
  const [texte, setTexte] = useState('');
  const envoyer = async () => {
    if (!x) return;
    const v = z.object({ p_fil: z.string().uuid(), p_corps: z.string().trim().min(1).max(4000) }).strict().safeParse({ p_fil: x.id, p_corps: texte });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('envoyer_message', v.data)))) { setTexte(''); void fils.recharger(); void msgs.recharger(); }
  };
  return (
    <div className="msg">
      {avecEntete && <Entete surtitre={`${t('modules.echanges')} · MSG`} titre={t('msg.titre')}
        actions={nouveau && <Bouton variante="primaire" onClick={() => setCreer(true)}>{t('msg.nouveau')}</Bouton>} />}
      {!avecEntete && nouveau && <div className="liv-pv"><h1 className="ecl-titre">{t('msg.titre')}</h1><Bouton onClick={() => setCreer(true)}>{t('msg.nouveau')}</Bouton></div>}
      <Bandeau type="err">{fils.erreur ?? msgs.erreur}</Bandeau>
      {fils.chargement && !fils.data ? <Chargement /> : (fils.data ?? []).length === 0 ? <Vide>{t('msg.aucun')}</Vide> : (
        <div className="msg-grille">
          <ul className="msg-fils">{(fils.data ?? []).map((f) => (
            <li key={f.id}><button type="button" className={x?.id === f.id ? 'choisi' : ''} onClick={() => setSel(f.id)}>
              <span className="liv-pv"><b>{f.sujet}</b><span className="mute">{dateHeure(f.dernier_message_le, langue, fuseau)}</span></span>
              <span className="msg-meta">{t(`msg.categories.${f.categorie}`)}{f.reference ? ` · ${f.reference}` : ''} · {t(`msg.audiences.${f.audience}`)}</span>
              <span className="sec msg-extrait">{f.dernier_auteur ? `${f.dernier_auteur} : ` : ''}{f.dernier_extrait}</span></button></li>))}</ul>
          {x && <section className="msg-conv">
            <div className="msg-tete"><b>{x.sujet}</b><span className="mute">{t(`msg.categories.${x.categorie}`)}{x.reference ? ` · ${x.reference}` : ''}</span></div>
            <div className="msg-liste">{(msgs.data ?? []).map((m) => (
              <div key={m.id} className={'msg-bulle' + (m.moi ? ' moi' : '')}>
                <span className="msg-auteur">{m.moi ? t('msg.vous') : m.auteur} · {dateHeure(m.cree_le, langue, fuseau)}</span>
                <p>{m.corps}</p></div>))}</div>
            <div className="msg-saisie">
              <textarea rows={3} maxLength={4000} value={texte} placeholder={t('msg.ecrire')} aria-label={t('msg.ecrire')} onChange={(e) => setTexte(e.target.value)} />
              <Bandeau type="err">{a.erreur}</Bandeau>
              <Bouton variante="primaire" disabled={a.enCours || !texte.trim()} onClick={() => void envoyer()}>{t('msg.envoyer')}</Bouton>
            </div>
          </section>}
        </div>
      )}
      {creer && nouveau && <NouveauFil options={nouveau} onClose={() => setCreer(false)} onFait={(id) => { setCreer(false); setSel(id); void fils.recharger(); }} />}
    </div>
  );
}

function NouveauFil({ options, onClose, onFait }: { options: NonNullable<Parameters<typeof MessagerieVue>[0]['nouveau']>; onClose: () => void; onFait: (id: string) => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [f, setF] = useState({ audience: options.audiences[0], cible: '', sujet: '', categorie: 'autre', message: '' });
  const cibles = f.audience === 'fournisseur' ? options.commandes ?? [] : options.dossiers ?? [];
  const enregistrer = async () => {
    const v = z.object({ audience: z.enum(['interne', 'client', 'fournisseur']), dossier_id: z.string().uuid().nullable(), commande_id: z.string().uuid().nullable(),
      sujet: z.string().trim().min(3).max(200), categorie: z.enum(CATS), message: z.string().trim().min(1).max(4000) }).strict()
      .safeParse({ audience: f.audience, dossier_id: f.audience === 'fournisseur' ? null : f.cible || null, commande_id: f.audience === 'fournisseur' ? f.cible || null : null,
        sujet: f.sujet, categorie: f.categorie, message: f.message });
    if (!v.success || !f.cible) { a.setErreur(t('formulaire.invalide')); return; }
    let id = '';
    if (await a.executer(async () => { id = ok(await supabase.rpc('creer_fil', { p: v.data })) as string; }) && id) onFait(id);
  };
  return (
    <Tiroir titre={t('msg.nouveau')} onClose={onClose}>
      {options.audiences.length > 1 && <Champ label={t('msg.destinataires')}><select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value as typeof f.audience, cible: '' })}>
        {options.audiences.map((x) => <option key={x} value={x}>{t(`msg.audiences.${x}`)}</option>)}</select></Champ>}
      <Champ label={f.audience === 'fournisseur' ? t('msg.commande') : t('champs.dossier')}><select value={f.cible} onChange={(e) => setF({ ...f, cible: e.target.value })}>
        <option value="">—</option>{cibles.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></Champ>
      <div className="grille2">
        <Champ label={t('msg.sujet')}><input value={f.sujet} maxLength={200} onChange={(e) => setF({ ...f, sujet: e.target.value })} /></Champ>
        <Champ label={t('msg.categorie')}><select value={f.categorie} onChange={(e) => setF({ ...f, categorie: e.target.value })}>{CATS.map((c) => <option key={c} value={c}>{t(`msg.categories.${c}`)}</option>)}</select></Champ>
      </div>
      <Champ label={t('msg.message')}><textarea rows={4} maxLength={4000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Champ>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours} onClick={() => void enregistrer()}>{t('msg.envoyer')}</Bouton>
    </Tiroir>
  );
}

/** Écran interne : fils de tous les dossiers visibles ; nouveau fil interne, client ou fournisseur (achats). */
export function Messagerie() {
  const { profil } = useAuth();
  const achats = ['admin', 'achats_chine'].includes(profil?.role ?? '');
  const ds = useAsync(async () => ok(await supabase.from('dossiers').select('id, reference, intitule').in('statut', ['ouvert', 'suspendu']).order('reference', { ascending: false }).limit(500)) as
    { id: string; reference: string; intitule: string }[], []);
  const cs = useAsync(async () => (achats ? ok(await supabase.from('commandes').select('id, reference').neq('statut', 'annulee').order('reference', { ascending: false }).limit(500)) as
    { id: string; reference: string }[] : []), [achats]);
  return (
    <div className="screen">
      <MessagerieVue nouveau={{ audiences: achats ? ['interne', 'client', 'fournisseur'] : ['interne', 'client'],
        dossiers: (ds.data ?? []).map((d) => ({ id: d.id, libelle: `${d.reference} · ${d.intitule}` })), commandes: (cs.data ?? []).map((c) => ({ id: c.id, libelle: c.reference })) }} />
    </div>
  );
}
