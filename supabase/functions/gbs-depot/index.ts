// Fonction serveur « gbs-depot » : seul point d'écriture dans le bucket privé « gbs-documents ».
// Vérifie l'utilisateur (session AAL2 via les droits en base), le dossier, la taille
// et le type réel du fichier sur ses octets, régénère le nom, calcule l'empreinte SHA-256.
// Variables : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (fournies par
// Supabase), GBS_ORIGINE (origine autorisée de l'application, ex. https://app.gulfbridge.ci).
// Compte client (cible « piece_client ») : droit vérifié en base avec la session (double facteur,
// pièce attendue de lui), puis la pièce est enregistrée par le rôle de service ; fichier retiré en cas d'échec.
import { createClient } from 'npm:@supabase/supabase-js@2.46.1';
import { detecter, hex, TAILLE_MAX, UUID } from '../_shared/fichiers.ts';

const ORIGINE = Deno.env.get('GBS_ORIGINE') ?? '';
const ROLES = ['admin', 'achats_chine', 'hub_afrique', 'agent_pays'];
// Justificatifs de notes de frais : toute l'équipe interne, dans son propre dossier frais/<utilisateur>/.
const ROLES_FRAIS = ['admin', 'achats_chine', 'hub_afrique', 'agent_pays', 'inspecteur', 'comptable'];
const LIMITE_PAR_MINUTE = Number(Deno.env.get('GBS_DEPOT_LIMITE_MINUTE') ?? '30');
const compteurs = new Map<string, { debut: number; n: number }>();

const entetes = (extra: Record<string, string> = {}) => ({
  'Access-Control-Allow-Origin': ORIGINE,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
  ...extra,
});
// Erreurs génériques côté client : aucun détail technique.
const refus = (status: number, code: string) =>
  new Response(JSON.stringify({ erreur: code }), { status, headers: entetes({ 'Content-Type': 'application/json' }) });

function limite(uid: string): boolean {
  const t = Date.now();
  const c = compteurs.get(uid);
  if (!c || t - c.debut > 60_000) { compteurs.set(uid, { debut: t, n: 1 }); return true; }
  c.n += 1;
  return c.n <= LIMITE_PAR_MINUTE;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: entetes() });
  if (req.method !== 'POST') return refus(405, 'GBS_METHODE');
  if (ORIGINE && req.headers.get('origin') && req.headers.get('origin') !== ORIGINE) return refus(403, 'GBS_ORIGINE');
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return refus(401, 'GBS_ACCES_REFUSE');
  const longueur = Number(req.headers.get('content-length') ?? '0');
  if (longueur > TAILLE_MAX + 64 * 1024) return refus(413, 'GBS_FICHIER_TAILLE');

  const url = Deno.env.get('SUPABASE_URL')!;
  const utilisateur = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false }, db: { schema: 'gbs' },
  });
  const { data: u } = await utilisateur.auth.getUser();
  if (!u?.user) return refus(401, 'GBS_ACCES_REFUSE');
  if (!limite(u.user.id)) return refus(429, 'GBS_TROP_DE_DEPOTS');

  let form: FormData;
  try { form = await req.formData(); } catch { return refus(400, 'GBS_PARAMETRES_INVALIDES'); }
  // Pièce transmise par un compte client depuis son espace.
  if (form.get('cible') === 'piece_client') {
    const pieceId = String(form.get('piece_id') ?? '');
    const f = form.get('fichier');
    if (!UUID.test(pieceId) || !(f instanceof File) || form.getAll('fichier').length !== 1
        || [...form.keys()].some((k) => !['cible', 'piece_id', 'fichier'].includes(k))) return refus(400, 'GBS_PARAMETRES_INVALIDES');
    if (f.size === 0 || f.size > TAILLE_MAX) return refus(413, 'GBS_FICHIER_TAILLE');
    const acces = await utilisateur.rpc('verifier_depot_piece_client', { p_piece: pieceId });
    if (acces.error || typeof acces.data !== 'string' || !UUID.test(acces.data)) return refus(403, 'GBS_ACCES_REFUSE');
    const octets = new Uint8Array(await f.arrayBuffer());
    const type = detecter(octets.subarray(0, 12));
    if (!type) return refus(415, 'GBS_FICHIER_TYPE');
    const chemin = `${acces.data}/${crypto.randomUUID()}.${type.ext}`;
    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false }, db: { schema: 'gbs' } });
    const up = await service.storage.from('gbs-documents').upload(chemin, octets, { contentType: type.mime, upsert: false });
    if (up.error) { console.error('depot: echec de stockage'); return refus(500, 'GBS_DEPOT_ECHEC'); }
    const empreinte = hex(await crypto.subtle.digest('SHA-256', octets));
    const r = await service.rpc('enregistrer_piece_client', { p_user: u.user.id, p_piece: pieceId, p_chemin: chemin, p_empreinte: empreinte });
    if (r.error) {
      await service.storage.from('gbs-documents').remove([chemin]);
      return refus(r.error.code === '42501' ? 403 : 409, 'GBS_DEPOT_ECHEC');
    }
    return new Response(JSON.stringify({ empreinte }), { status: 201, headers: entetes({ 'Content-Type': 'application/json' }) });
  }

  const frais = form.get('cible') === 'frais';
  const dossierId = String(form.get('dossier_id') ?? '');
  const fichier = form.get('fichier');
  if ((!frais && !UUID.test(dossierId)) || !(fichier instanceof File)) return refus(400, 'GBS_PARAMETRES_INVALIDES');
  if (fichier.size === 0 || fichier.size > TAILLE_MAX) return refus(413, 'GBS_FICHIER_TAILLE');

  // Droits : la base applique la RLS (rôle, société, double facteur) avec le jeton de l'utilisateur.
  const [{ data: profil }, { data: dossier }] = await Promise.all([
    utilisateur.from('profils').select('role, actif').eq('id', u.user.id).maybeSingle(),
    // Pour un justificatif, la lecture du calendrier (réservée en base aux membres internes
    // ayant validé le double facteur) tient lieu de contrôle de dossier.
    frais ? utilisateur.from('calendrier').select('pays').limit(1).maybeSingle()
          : utilisateur.from('dossiers').select('id').eq('id', dossierId).maybeSingle(),
  ]);
  if (!profil?.actif || !(frais ? ROLES_FRAIS : ROLES).includes(profil.role) || !dossier) {
    return refus(403, 'GBS_ACCES_REFUSE');
  }

  const octets = new Uint8Array(await fichier.arrayBuffer());
  const type = detecter(octets.subarray(0, 12));
  if (!type) return refus(415, 'GBS_FICHIER_TYPE');

  const chemin = frais ? `frais/${u.user.id}/${crypto.randomUUID()}.${type.ext}` : `${dossierId}/${crypto.randomUUID()}.${type.ext}`;
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { error } = await service.storage.from('gbs-documents').upload(chemin, octets, { contentType: type.mime, upsert: false });
  if (error) { console.error('depot: echec de stockage'); return refus(500, 'GBS_DEPOT_ECHEC'); }
  const empreinte = hex(await crypto.subtle.digest('SHA-256', octets));
  return new Response(JSON.stringify({ chemin, empreinte }), { status: 201, headers: entetes({ 'Content-Type': 'application/json' }) });
});
