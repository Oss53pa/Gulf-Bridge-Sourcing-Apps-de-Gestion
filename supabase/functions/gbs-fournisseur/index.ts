// Fonction serveur « gbs-fournisseur » : formulaire fournisseur par lien sécurisé et plis fermés.
// - Public (jeton du lien) : lire la consultation, déposer une offre, poser une question.
//   L'offre est validée strictement, salée, chiffrée en AES-256-GCM avec GBS_PLIS_CLE ; la base
//   ne reçoit que le pli chiffré et l'empreinte du contenu.
// - Équipe achats (jeton de session) : ouvrir les plis après la date limite. La base ne livre
//   les plis qu'après la date limite et vérifie chaque contenu déchiffré contre son empreinte.
// - Limitation de débit par adresse ; erreurs génériques ; ni jeton ni contenu dans les journaux.
// Sans GBS_PLIS_CLE, le dépôt et l'ouverture sont fermés (503).
import { createClient } from 'npm:@supabase/supabase-js@2.46.1';
import { adresseClient, Limiteur } from '../_shared/suivi.ts';
import { chiffrer, cle, contenuPli, dechiffrer, empreinte, lireDemande, lireOffre } from '../_shared/plis.ts';

const ORIGINE = Deno.env.get('GBS_ORIGINE') ?? '';
const limiteur = new Limiteur(Number(Deno.env.get('GBS_FOURNISSEUR_LIMITE_MINUTE') ?? '20'), 60_000);
const TAILLE_MAX = 64 * 1024;
const CODES = ['GBS_LIEN_INVALIDE', 'GBS_TROP_DE_CONSULTATIONS', 'GBS_CONSULTATION_CLOSE', 'GBS_TROP_DE_DEPOTS', 'GBS_TROP_DE_QUESTIONS',
  'GBS_PLI_ALTERE', 'GBS_PLI_FERME', 'GBS_OFFRE_EXISTANTE', 'GBS_ACCES_REFUSE'];

const entetes = (extra: Record<string, string> = {}) => ({
  'Access-Control-Allow-Origin': ORIGINE,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  ...extra,
});
const repondre = (status: number, corps: unknown) =>
  new Response(JSON.stringify(corps), { status, headers: entetes({ 'Content-Type': 'application/json; charset=utf-8' }) });
const refus = (status: number, code: string) => repondre(status, { erreur: code });
const codeErreur = (e: { message?: string } | null) => CODES.find((c) => String(e?.message ?? '').includes(c)) ?? 'GBS_ERREUR';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: entetes() });
  if (req.method !== 'POST') return refus(405, 'GBS_METHODE');
  if (ORIGINE && req.headers.get('origin') && req.headers.get('origin') !== ORIGINE) return refus(403, 'GBS_ORIGINE');
  if (!limiteur.autorise(adresseClient(req.headers))) return refus(429, 'GBS_TROP_DE_CONSULTATIONS');
  if (Number(req.headers.get('content-length') ?? '0') > TAILLE_MAX) return refus(413, 'GBS_PARAMETRES_INVALIDES');
  let corps: unknown;
  try {
    const t = await req.text();
    if (t.length > TAILLE_MAX) return refus(413, 'GBS_PARAMETRES_INVALIDES');
    corps = JSON.parse(t);
  } catch { return refus(400, 'GBS_PARAMETRES_INVALIDES'); }

  const url = Deno.env.get('SUPABASE_URL')!;
  const k = await cle(Deno.env.get('GBS_PLIS_CLE'));

  // Ouverture des plis par l'équipe achats (session de l'utilisateur, droits appliqués en base).
  const o = corps as Record<string, unknown>;
  if (o && o.action === 'ouvrir') {
    if (!k) return refus(503, 'GBS_PLIS_INDISPONIBLES');
    const auth = req.headers.get('authorization');
    const consultation = typeof o.consultation === 'string' && /^[0-9a-f-]{36}$/.test(o.consultation) ? o.consultation : null;
    if (!auth?.startsWith('Bearer ') || !consultation || Object.keys(o).length !== 2) return refus(400, 'GBS_PARAMETRES_INVALIDES');
    const u = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false }, db: { schema: 'gbs' } });
    const { data: plis, error } = await u.rpc('plis_a_ouvrir', { p_consultation: consultation });
    if (error) return refus(error.code === '42501' ? 403 : 409, codeErreur(error));
    const contenus = [];
    for (const p of (plis ?? []) as { pli_id: string; chiffre: string; iv: string }[]) {
      const c = await dechiffrer(k, p.chiffre, p.iv);
      if (c === null) { console.error('fournisseur: pli indéchiffrable'); return refus(409, 'GBS_PLI_ALTERE'); }
      contenus.push({ pli_id: p.pli_id, contenu: c });
    }
    if (contenus.length === 0) return repondre(200, { ouverts: 0 });
    const r = await u.rpc('ouvrir_plis', { p_consultation: consultation, p_plis: contenus });
    if (r.error) return refus(409, codeErreur(r.error));
    return repondre(200, { ouverts: r.data });
  }

  const d = lireDemande(corps);
  if (!d) return refus(400, 'GBS_PARAMETRES_INVALIDES');
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false }, db: { schema: 'gbs' } });

  if (d.action === 'lire') {
    const { data, error } = await service.rpc('formulaire_fournisseur', { p_jeton: d.jeton });
    if (error) return refus(codeErreur(error) === 'GBS_TROP_DE_CONSULTATIONS' ? 429 : 404, codeErreur(error) === 'GBS_ERREUR' ? 'GBS_LIEN_INVALIDE' : codeErreur(error));
    return repondre(200, data);
  }
  if (d.action === 'question') {
    const { error } = await service.rpc('poser_question_fournisseur', { p_jeton: d.jeton, p_question: d.question });
    if (error) return refus(409, codeErreur(error));
    return repondre(200, { ok: true });
  }
  // Dépôt d'une offre sous pli fermé.
  if (!k) return refus(503, 'GBS_PLIS_INDISPONIBLES');
  const lu = lireOffre(d.offre);
  if (!lu) return refus(400, 'GBS_OFFRE_INVALIDE');
  const contenu = contenuPli(lu.offre);
  const { chiffre, iv } = await chiffrer(k, contenu);
  const { data, error } = await service.rpc('deposer_pli', { p_jeton: d.jeton, p_chiffre: chiffre, p_iv: iv,
    p_empreinte: await empreinte(contenu), p_complet: lu.complet });
  if (error) return refus(409, codeErreur(error));
  return repondre(200, data);
});
