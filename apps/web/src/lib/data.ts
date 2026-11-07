import { useCallback, useEffect, useRef, useState } from 'react';
import { messageErreur } from './erreurs';

/** Chargement asynchrone avec gestion d'erreur et rechargement. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const appel = useRef(0);
  const charger = useCallback(async () => {
    const n = ++appel.current;
    setChargement(true);
    try {
      const r = await fn();
      if (n === appel.current) { setData(r); setErreur(null); }
    } catch (e) {
      if (n === appel.current) setErreur(messageErreur(e));
    } finally {
      if (n === appel.current) setChargement(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void charger(); }, [charger]);
  return { data, erreur, chargement, recharger: charger, setData };
}

/** Lève l'erreur Supabase éventuelle, sinon renvoie les données. */
export function ok<T>(r: { data: T | null; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data as T;
}

/** Action utilisateur : exécute, mémorise l'erreur traduite, renvoie true si réussi. */
export function useAction() {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const executer = useCallback(async (fn: () => Promise<unknown>) => {
    setEnCours(true); setErreur(null);
    try { await fn(); return true; } catch (e) { setErreur(messageErreur(e)); return false; } finally { setEnCours(false); }
  }, []);
  return { enCours, erreur, executer, setErreur };
}
