import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import i18n from '../i18n';
import type { Profil, Societe } from './types';
import type { Langue } from './format';

interface Ctx {
  session: Session | null;
  aal: 'aal1' | 'aal2' | null;
  profil: Profil | null;
  societes: Societe[];
  societeActive: string | null;          // null = vue consolidée
  setSocieteActive: (id: string | null) => void;
  langue: Langue;
  setLangue: (l: Langue) => void;
  fuseau: string;
  pret: boolean;
  rafraichir: () => Promise<void>;
  deconnexion: () => Promise<void>;
}

const AuthCtx = createContext<Ctx | null>(null);

const lireLangue = (): Langue => {
  try {
    const v = localStorage.getItem('gbs-langue');
    if (v === 'fr' || v === 'en' || v === 'zh') return v;
  } catch { /* stockage indisponible */ }
  return 'fr';
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [aal, setAal] = useState<'aal1' | 'aal2' | null>(null);
  const [profil, setProfil] = useState<Profil | null>(null);
  const [societes, setSocietes] = useState<Societe[]>([]);
  const [societeActive, setSocieteActive] = useState<string | null>(null);
  const [langue, setLangueState] = useState<Langue>(lireLangue());
  const [pret, setPret] = useState(false);

  const setLangue = useCallback((l: Langue) => {
    setLangueState(l);
    void i18n.changeLanguage(l);
    document.documentElement.lang = l === 'zh' ? 'zh-CN' : l;
    try { localStorage.setItem('gbs-langue', l); } catch { /* ignoré */ }
  }, []);

  const rafraichir = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    if (!data.session) { setAal(null); setProfil(null); setSocietes([]); setPret(true); return; }
    const niveau = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const courant = (niveau.data?.currentLevel ?? 'aal1') as 'aal1' | 'aal2';
    setAal(courant);
    const p = await supabase.from('profils').select('*').eq('id', data.session.user.id).maybeSingle();
    const prof = (p.data as Profil | null) ?? null;
    setProfil(prof);
    if (prof?.langue) setLangue(prof.langue);
    if (courant === 'aal2') {
      const s = await supabase.from('societes').select('id, code, raison_sociale, pays, devise, date_creation, fne').order('code');
      setSocietes((s.data as Societe[]) ?? []);
    }
    setPret(true);
  }, [setLangue]);

  useEffect(() => {
    void rafraichir();
    const { data } = supabase.auth.onAuthStateChange((evt) => {
      if (evt === 'SIGNED_OUT' || evt === 'MFA_CHALLENGE_VERIFIED' || evt === 'TOKEN_REFRESHED' || evt === 'SIGNED_IN') {
        void rafraichir();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [rafraichir]);

  const deconnexion = useCallback(async () => {
    await supabase.auth.signOut();
    setSocieteActive(null);
  }, []);

  const valeur = useMemo<Ctx>(() => ({
    session, aal, profil, societes, societeActive, setSocieteActive, langue, setLangue,
    fuseau: profil?.fuseau ?? 'Africa/Abidjan', pret, rafraichir, deconnexion,
  }), [session, aal, profil, societes, societeActive, langue, setLangue, pret, rafraichir, deconnexion]);

  return <AuthCtx.Provider value={valeur}>{children}</AuthCtx.Provider>;
}

export function useAuth(): Ctx {
  const c = useContext(AuthCtx);
  if (!c) throw new Error('AuthProvider manquant');
  return c;
}
