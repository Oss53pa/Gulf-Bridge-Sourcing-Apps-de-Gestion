// Fonction serveur « gbs-suivi » : page de suivi du client par lien sécurisé.
// Point d'entrée public (sans compte) : le jeton du lien est la seule preuve.
// - limitation de débit par adresse (GBS_SUIVI_LIMITE_MINUTE, 30 par défaut) ;
// - corps strict { jeton }, taille bornée, origine contrôlée (GBS_ORIGINE) ;
// - lecture par gbs.suivi_client(), réservée au rôle de service, qui contrôle le
//   jeton (empreinte), l'expiration, la révocation et le plafond par lien ;
// - documents remis par URL signée de 5 minutes, chemin revérifié ;
// - erreurs génériques ; aucun jeton ni donnée personnelle dans les journaux.
import { longueurCorps } from '../_shared/fichiers.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.46.1';
import { adresseClient, CHEMIN_DOCUMENT, Limiteur, lireJeton } from '../_shared/suivi.ts';

const ORIGINE = Deno.env.get('GBS_ORIGINE') ?? '';
const limiteur = new Limiteur(Number(Deno.env.get('GBS_SUIVI_LIMITE_MINUTE') ?? '30'), 60_000);
const DUREE_URL = 300;

const entetes = (extra: Record<string, string> = {}) => ({
  'Access-Control-Allow-Origin': ORIGINE,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  ...extra,
});
const repondre = (status: number, corps: unknown) =>
  new Response(JSON.stringify(corps), { status, headers: entetes({ 'Content-Type': 'application/json; charset=utf-8' }) });
const refus = (status: number, code: string) => repondre(status, { erreur: code });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: entetes() });
  if (req.method !== 'POST') return refus(405, 'GBS_METHODE');
  if (ORIGINE && req.headers.get('origin') && req.headers.get('origin') !== ORIGINE) return refus(403, 'GBS_ORIGINE');
  if (!limiteur.autorise(adresseClient(req.headers))) return refus(429, 'GBS_TROP_DE_CONSULTATIONS');
  const lg = longueurCorps(req.headers.get('content-length'), 1024);
  if (lg !== 'ok') return refus(lg === 'absente' ? 411 : 413, 'GBS_PARAMETRES_INVALIDES');

  let jeton: string | null = null;
  try {
    const texte = await req.text();
    if (texte.length <= 1024) jeton = lireJeton(JSON.parse(texte));
  } catch { /* corps illisible */ }
  if (!jeton) return refus(404, 'GBS_LIEN_INVALIDE');

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false }, db: { schema: 'gbs' },
  });
  const { data, error } = await service.rpc('suivi_client', { p_jeton: jeton });
  if (error) {
    if (String(error.message).includes('GBS_TROP_DE_CONSULTATIONS')) return refus(429, 'GBS_TROP_DE_CONSULTATIONS');
    if (!String(error.message).includes('GBS_LIEN_INVALIDE')) console.error('suivi: echec de lecture');
    return refus(404, 'GBS_LIEN_INVALIDE');
  }

  const documents = [];
  for (const d of (data?.documents ?? []) as { libelle: string; phase: string; chemin: string; date: string }[]) {
    if (!CHEMIN_DOCUMENT.test(d.chemin)) continue;
    const s = await service.storage.from('gbs-documents').createSignedUrl(d.chemin, DUREE_URL);
    if (s.data?.signedUrl) documents.push({ libelle: d.libelle, phase: d.phase, date: d.date, url: s.data.signedUrl });
  }
  return repondre(200, { ...data, documents });
});
