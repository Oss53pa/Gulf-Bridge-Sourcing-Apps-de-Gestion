// Fiche fournisseur · bénéficiaires effectifs et contrôle des sanctions (M16, revue annuelle).
// La base exige un bénéficiaire et un contrôle récent sans correspondance confirmée pour valider une
// due diligence ; un changement d'actionnariat périme le contrôle ; une correspondance confirmée suspend l'agrément.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ok, useAction, useAsync } from '../lib/data';
import { useAuth } from '../lib/auth';
import { date } from '../lib/format';
import { Bandeau, Bouton, Champ, Chargement, Statut, Tiroir } from '../components/ui';

interface Beneficiaire { id: string; nom: string; nom_zh: string | null; nationalite: string | null; pourcentage: number; fonction: string | null }
type Resultat = 'aucune_correspondance' | 'correspondance_ecartee' | 'correspondance_confirmee';
interface Controle { id: string; realise_le: string; listes: string[]; source: string; resultat: Resultat; justification: string | null; statut: 'valide' | 'perime'; beneficiaires: { nom: string }[] }
const LISTES = ['onu', 'ue', 'ofac', 'royaume_uni', 'france', 'chine'] as const;
const auj = () => new Date().toISOString().slice(0, 10);

export function SanctionsFournisseur({ fournisseurId, onChange }: { fournisseurId: string; onChange: () => void }) {
  const { t } = useTranslation();
  const { profil, langue } = useAuth();
  const ecrit = ['admin', 'achats_chine'].includes(profil?.role ?? '');
  const ben = useAsync(async () => ok(await supabase.from('beneficiaires_fournisseurs').select('id, nom, nom_zh, nationalite, pourcentage, fonction')
    .eq('fournisseur_id', fournisseurId).is('sortie_le', null).order('pourcentage', { ascending: false })) as Beneficiaire[], [fournisseurId]);
  const ctl = useAsync(async () => ok(await supabase.from('controles_sanctions').select('id, realise_le, listes, source, resultat, justification, statut, beneficiaires')
    .eq('fournisseur_id', fournisseurId).order('cree_le', { ascending: false }).limit(10)) as Controle[], [fournisseurId]);
  const a = useAction();
  const [nouveauBen, setNouveauBen] = useState(false);
  const [nouveauCtl, setNouveauCtl] = useState(false);
  const recharger = () => { void ben.recharger(); void ctl.recharger(); onChange(); };
  const sortir = async (b: Beneficiaire) => {
    if (await a.executer(async () => ok(await supabase.from('beneficiaires_fournisseurs').update({ sortie_le: auj() }).eq('id', z.string().uuid().parse(b.id))))) recharger();
  };
  const dernier = (ctl.data ?? [])[0] ?? null;
  const total = (ben.data ?? []).reduce((s, b) => s + Number(b.pourcentage), 0);
  if ((ben.chargement && !ben.data) || (ctl.chargement && !ctl.data)) return <Chargement />;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Bandeau type="err">{ben.erreur ?? ctl.erreur ?? a.erreur}</Bandeau>
      <div className="section-titre">{t('sanctions.beneficiaires')}</div>
      {(ben.data ?? []).length === 0 ? <span className="mute">{t('sanctions.aucun_beneficiaire')}</span> : (
        <table className="t"><tbody>{(ben.data ?? []).map((b) => (
          <tr key={b.id}><td>{b.nom}{b.nom_zh && <span className="mute"> · {b.nom_zh}</span>}{b.fonction && <span className="mute"> · {b.fonction}</span>}</td>
            <td>{b.nationalite ?? '—'}</td><td className="num">{b.pourcentage} %</td>
            <td className="num">{ecrit && <Bouton petit disabled={a.enCours} onClick={() => void sortir(b)}>{t('sanctions.sortie')}</Bouton>}</td></tr>))}</tbody></table>)}
      {(ben.data ?? []).length > 0 && <span className="mute">{t('sanctions.total', { n: total })}</span>}
      {ecrit && <div><Bouton petit onClick={() => setNouveauBen(true)}>{t('sanctions.ajouter_beneficiaire')}</Bouton></div>}
      <p className="mute">{t('sanctions.aide_beneficiaires')}</p>

      <div className="section-titre">{t('sanctions.controle')}</div>
      {!dernier ? <span className="mute">{t('sanctions.aucun_controle')}</span> : (
        <div>
          <Statut statut={dernier.statut === 'perime' ? 'neutre' : dernier.resultat === 'correspondance_confirmee' ? 'err' : dernier.resultat === 'correspondance_ecartee' ? 'att' : 'ok'}
            libelle={dernier.statut === 'perime' ? t('sanctions.perime') : t(`sanctions.resultats.${dernier.resultat}`)} />
          <span className="mute"> · {date(dernier.realise_le, langue)} · {dernier.listes.map((l) => t(`sanctions.listes.${l}`)).join(', ')} · {dernier.source}</span>
          {dernier.justification && <div className="mute">{dernier.justification}</div>}
          <div className="mute">{t('sanctions.controles_pour', { noms: dernier.beneficiaires.map((b) => b.nom).join(', ') })}</div>
        </div>)}
      {ecrit && <div><Bouton petit variante="primaire" disabled={(ben.data ?? []).length === 0} onClick={() => setNouveauCtl(true)}>{t('sanctions.nouveau_controle')}</Bouton></div>}
      <p className="mute">{t('sanctions.aide_controle')}</p>
      {nouveauBen && <NouveauBeneficiaire fournisseurId={fournisseurId} onClose={() => setNouveauBen(false)} onSaved={() => { setNouveauBen(false); recharger(); }} />}
      {nouveauCtl && <NouveauControle fournisseurId={fournisseurId} onClose={() => setNouveauCtl(false)} onSaved={() => { setNouveauCtl(false); recharger(); }} />}
    </section>
  );
}

function NouveauBeneficiaire({ fournisseurId, onClose, onSaved }: { fournisseurId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [f, setF] = useState({ nom: '', nom_zh: '', nationalite: '', pourcentage: '', fonction: '' });
  const valider = async () => {
    const v = z.object({ fournisseur_id: z.string().uuid(), nom: z.string().trim().min(2).max(200), nom_zh: z.string().trim().max(100).nullable(),
      nationalite: z.string().regex(/^[A-Z]{2}$/).nullable(), pourcentage: z.number().gt(0).max(100), fonction: z.string().trim().max(120).nullable() }).strict()
      .safeParse({ fournisseur_id: fournisseurId, nom: f.nom, nom_zh: f.nom_zh.trim() || null, nationalite: f.nationalite.trim().toUpperCase() || null,
        pourcentage: Number(f.pourcentage.replace(',', '.')), fonction: f.fonction.trim() || null });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.from('beneficiaires_fournisseurs').insert(v.data)))) onSaved();
  };
  return (
    <Tiroir titre={t('sanctions.ajouter_beneficiaire')} onClose={onClose}>
      <Champ label={t('sanctions.nom')}><input value={f.nom} maxLength={200} onChange={(e) => setF({ ...f, nom: e.target.value })} /></Champ>
      <Champ label={t('sanctions.nom_zh')}><input value={f.nom_zh} maxLength={100} onChange={(e) => setF({ ...f, nom_zh: e.target.value })} /></Champ>
      <Champ label={t('sanctions.nationalite')}><input value={f.nationalite} maxLength={2} placeholder="CN" onChange={(e) => setF({ ...f, nationalite: e.target.value })} /></Champ>
      <Champ label={t('sanctions.part')}><input value={f.pourcentage} inputMode="decimal" maxLength={6} onChange={(e) => setF({ ...f, pourcentage: e.target.value })} /></Champ>
      <Champ label={t('sanctions.fonction')}><input value={f.fonction} maxLength={120} onChange={(e) => setF({ ...f, fonction: e.target.value })} /></Champ>
      <Bandeau>{t('sanctions.aide_perime')}</Bandeau>
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante="primaire" disabled={a.enCours || f.nom.trim().length < 2 || !f.pourcentage} onClick={() => void valider()}>{t('sanctions.enregistrer')}</Bouton>
    </Tiroir>
  );
}

function NouveauControle({ fournisseurId, onClose, onSaved }: { fournisseurId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const a = useAction();
  const [f, setF] = useState<{ realise_le: string; listes: string[]; source: string; resultat: Resultat; justification: string }>(
    { realise_le: auj(), listes: ['onu', 'ue', 'ofac'], source: '', resultat: 'aucune_correspondance', justification: '' });
  const justifier = f.resultat !== 'aucune_correspondance';
  const valider = async () => {
    const v = z.object({ p_fournisseur: z.string().uuid(), p: z.object({ realise_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), listes: z.array(z.enum(LISTES)).min(1).max(6),
      source: z.string().trim().min(2).max(200), resultat: z.enum(['aucune_correspondance', 'correspondance_ecartee', 'correspondance_confirmee']),
      justification: z.string().trim().max(2000).nullable() }).strict() }).strict()
      .refine((x) => x.p.resultat === 'aucune_correspondance' || (x.p.justification ?? '').length >= 10)
      .safeParse({ p_fournisseur: fournisseurId, p: { ...f, justification: f.justification.trim() || null } });
    if (!v.success) { a.setErreur(t('formulaire.invalide')); return; }
    if (await a.executer(async () => ok(await supabase.rpc('enregistrer_controle_sanctions', v.data)))) onSaved();
  };
  return (
    <Tiroir titre={t('sanctions.nouveau_controle')} onClose={onClose}>
      <Champ label={t('sanctions.realise_le')}><input type="date" value={f.realise_le} max={auj()} onChange={(e) => setF({ ...f, realise_le: e.target.value })} /></Champ>
      <Champ label={t('sanctions.listes_consultees')}>
        <div className="segment portee-taches" role="group">
          {LISTES.map((l) => <button key={l} type="button" aria-pressed={f.listes.includes(l)}
            onClick={() => setF({ ...f, listes: f.listes.includes(l) ? f.listes.filter((x) => x !== l) : [...f.listes, l] })}>{t(`sanctions.listes.${l}`)}</button>)}
        </div>
      </Champ>
      <Champ label={t('sanctions.source')}><input value={f.source} maxLength={200} placeholder={t('sanctions.source_exemple')} onChange={(e) => setF({ ...f, source: e.target.value })} /></Champ>
      <Champ label={t('sanctions.resultat')}>
        <select value={f.resultat} onChange={(e) => setF({ ...f, resultat: e.target.value as Resultat })}>
          {(['aucune_correspondance', 'correspondance_ecartee', 'correspondance_confirmee'] as const).map((r) => <option key={r} value={r}>{t(`sanctions.resultats.${r}`)}</option>)}
        </select>
      </Champ>
      {justifier && <Champ label={t('sanctions.justification')}><textarea value={f.justification} maxLength={2000} onChange={(e) => setF({ ...f, justification: e.target.value })} /></Champ>}
      {f.resultat === 'correspondance_confirmee' && <Bandeau type="err">{t('sanctions.alerte_confirmee')}</Bandeau>}
      <Bandeau type="err">{a.erreur}</Bandeau>
      <Bouton variante={f.resultat === 'correspondance_confirmee' ? 'danger' : 'primaire'} disabled={a.enCours || f.listes.length === 0 || f.source.trim().length < 2
        || (justifier && f.justification.trim().length < 10)} onClick={() => void valider()}>{t('sanctions.enregistrer')}</Bouton>
    </Tiroir>
  );
}
