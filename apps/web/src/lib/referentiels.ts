import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Petits référentiels mis en cache le temps de la session (noms affichés dans les listes).
const cache = new Map<string, Promise<Record<string, string>>>();

function charger(cle: string, fn: () => Promise<Record<string, string>>) {
  if (!cache.has(cle)) cache.set(cle, fn().catch(() => { cache.delete(cle); return {}; }));
  return cache.get(cle)!;
}

export function invaliderReferentiels() { cache.clear(); }

async function noms(table: string, champ: string): Promise<Record<string, string>> {
  const r = await supabase.from(table).select(`id, ${champ}`).limit(2000);
  const out: Record<string, string> = {};
  for (const x of (r.data ?? []) as unknown as Record<string, string>[]) out[x.id] = x[champ];
  return out;
}

export function useNoms(table: 'clients' | 'fournisseurs' | 'profils' | 'articles' | 'dossiers' | 'societes') {
  const champ = { clients: 'raison_sociale', fournisseurs: 'raison_sociale_en', profils: 'nom', articles: 'designation',
    dossiers: 'reference', societes: 'raison_sociale' }[table];
  const [m, setM] = useState<Record<string, string>>({});
  useEffect(() => { let a = true; void charger(table, () => noms(table, champ)).then((x) => a && setM(x)); return () => { a = false; }; }, [table, champ]);
  return m;
}
