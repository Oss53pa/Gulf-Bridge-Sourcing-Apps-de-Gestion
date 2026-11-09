import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Bandeau, Bouton, Champ, MotDePasse } from '../components/ui';
import type { Langue } from '../lib/format';

const schemaIdentifiants = z.object({
  email: z.string().trim().email().max(254),
  motDePasse: z.string().min(8).max(128),
});

/** Connexion en deux étapes : mot de passe, puis code à usage unique (TOTP). Le double facteur est obligatoire. */
export function Connexion() {
  const { t } = useTranslation();
  const { session, aal, rafraichir, deconnexion, langue, setLangue } = useAuth();
  const [email, setEmail] = useState('');
  const [mdp, setMdp] = useState('');
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [facteur, setFacteur] = useState<{ id: string; qr?: string; secret?: string } | null>(null);
  const etape = session && aal === 'aal1' ? 2 : 1;

  // Étape 2 : facteur TOTP existant, sinon inscription (QR code à scanner).
  useEffect(() => {
    if (etape !== 2) return;
    let actif = true;
    (async () => {
      const f = await supabase.auth.mfa.listFactors();
      const verifie = f.data?.totp?.find((x) => x.status === 'verified');
      if (!actif) return;
      if (verifie) { setFacteur({ id: verifie.id }); return; }
      // Nettoie les inscriptions inachevées puis en crée une nouvelle.
      for (const x of f.data?.all ?? []) if (x.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: x.id });
      const e = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'GBS' });
      if (!actif) return;
      if (e.error || !e.data) { setErreur(t('connexion.erreur_mfa')); return; }
      setFacteur({ id: e.data.id, qr: e.data.totp.qr_code, secret: e.data.totp.secret });
    })();
    return () => { actif = false; };
  }, [etape, t]);

  const etape1 = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErreur(null);
    const v = schemaIdentifiants.safeParse({ email, motDePasse: mdp });
    if (!v.success) { setErreur(t('connexion.identifiants_invalides')); return; }
    setEnCours(true);
    const r = await supabase.auth.signInWithPassword({ email: v.data.email, password: v.data.motDePasse });
    setEnCours(false);
    // Message volontairement générique : on ne révèle pas si le compte existe.
    if (r.error) { setErreur(t('connexion.refus')); return; }
    await rafraichir();
  };

  const etape2 = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErreur(null);
    if (!facteur || !/^\d{6}$/.test(code)) { setErreur(t('connexion.code_invalide')); return; }
    setEnCours(true);
    const r = await supabase.auth.mfa.challengeAndVerify({ factorId: facteur.id, code });
    setEnCours(false);
    if (r.error) { setErreur(t('connexion.code_refuse')); return; }
    await rafraichir();
  };

  return (
    <div className="connexion">
      <div className="gauche">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="logo">GB</span>
          <span style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: '#fff', fontSize: 17, fontWeight: 600 }}>Gulf Bridge Sourcing</span>
            <span style={{ fontSize: 13, color: 'var(--nuit-icon)' }}>{t('connexion.sous_titre')}</span>
          </span>
        </div>
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8, maxWidth: '44ch' }}>
          <span className="surtitre" style={{ color: 'var(--nuit-icon)' }}>{t('connexion.securite')}</span>
          <span style={{ lineHeight: 1.5 }}>{t('connexion.texte_securite')}</span>
        </div>
      </div>
      <div className="droite">
        {etape === 1 ? (
          <form onSubmit={etape1} noValidate>
            <h1 style={{ fontSize: 30 }}>{t('connexion.titre')}</h1>
            <span className="sec">{t('connexion.etape', { n: 1 })}</span>
            <Champ label={t('connexion.email')}>
              <input type="email" autoComplete="username" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} required />
            </Champ>
            <Champ label={t('connexion.mot_de_passe')}>
              <MotDePasse autoComplete="current-password" value={mdp} maxLength={128} onChange={(e) => setMdp(e.target.value)} required />
            </Champ>
            {erreur && <Bandeau type="err">{erreur}</Bandeau>}
            <Bouton type="submit" variante="primaire" disabled={enCours}>{t('connexion.continuer')}</Bouton>
            <div className="seg" role="group" aria-label={t('coque.langue')} style={{ alignSelf: 'flex-start' }}>
              {(['fr', 'en', 'zh'] as Langue[]).map((l) => (
                <button type="button" key={l} aria-pressed={langue === l} onClick={() => setLangue(l)}>{l === 'zh' ? '中文' : l.toUpperCase()}</button>
              ))}
            </div>
          </form>
        ) : (
          <form onSubmit={etape2} noValidate>
            <h1 style={{ fontSize: 30 }}>{t('connexion.titre_mfa')}</h1>
            <span className="sec">{t('connexion.etape', { n: 2 })}</span>
            {facteur?.qr && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span>{t('connexion.inscription_mfa')}</span>
                <img src={facteur.qr} alt={t('connexion.qr')} width={180} height={180} style={{ background: '#fff', padding: 8, borderRadius: 8 }} />
                <span className="mute">{t('connexion.secret')} <code>{facteur.secret}</code></span>
              </div>
            )}
            <Champ label={t('connexion.code')}>
              <input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
            </Champ>
            {erreur && <Bandeau type="err">{erreur}</Bandeau>}
            <Bouton type="submit" variante="primaire" disabled={enCours || !facteur}>{t('connexion.valider')}</Bouton>
            <Bouton onClick={() => void deconnexion()}>{t('connexion.annuler')}</Bouton>
          </form>
        )}
      </div>
    </div>
  );
}

export function ConfigurationManquante() {
  const { t } = useTranslation();
  return (
    <div className="screen"><div className="reserve">
      <h1 style={{ fontSize: 28 }}>{t('config.titre')}</h1>
      <p className="sec">{t('config.texte')}</p>
    </div></div>
  );
}

export function SansRole() {
  const { t } = useTranslation();
  const { deconnexion } = useAuth();
  return (
    <div className="screen"><div className="reserve">
      <h1 style={{ fontSize: 28 }}>{t('sans_role.titre')}</h1>
      <p className="sec">{t('sans_role.texte')}</p>
      <Bouton onClick={() => void deconnexion()}>{t('coque.deconnexion')}</Bouton>
    </div></div>
  );
}
