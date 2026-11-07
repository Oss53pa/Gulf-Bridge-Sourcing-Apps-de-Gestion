import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Seules l'URL et la clé « anon » (publique par conception) sont exposées au navigateur. */
export const configurationOk = Boolean(url && anon);

export const supabase: SupabaseClient = createClient(url ?? 'http://localhost:54321', anon ?? 'cle-absente', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
