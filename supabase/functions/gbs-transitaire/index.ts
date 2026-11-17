// Fonction serveur « gbs-transitaire » : formulaire du transitaire par lien sécurisé (M9).
// Point d'entrée public : le jeton du lien est la seule preuve, vérifié en base.
// - Lecture de son expédition (liste blanche), saisie des étapes, mise à jour du transport.
// - Dépôt des documents de transport : type vérifié sur les octets, taille bornée, nom régénéré,
//   empreinte SHA-256 ; le lien est vérifié avant toute écriture dans le stockage.
// - Limitation de débit par adresse ; erreurs génériques ; ni jeton ni contenu dans les journaux.
import { createClient } from 'npm:@supabase/supabase-js@2.46.1';
import { adresseClient, Limiteur } from '../_shared/suivi.ts';
import { lireDemandeTransitaire, lireDepotDocument, TAILLE_DOCUMENT_MAX } from '../_shared/transitaire.ts';
import { detecter, hex, longueurCorps } from '../_shared/fichiers.ts';

const ORIGINE = Deno.env.get('GBS_ORIGINE') ?? '';
const limiteur = new Limiteur(Number(Deno.env.get('GBS_TRANSITAIRE_LIMITE_MINUTE') ?? '20'), 60_000);
const TAILLE_MAX = 16 * 1024;
const CODES = ['GBS_LIEN_INVALIDE', 'GBS_TROP_DE_CONSULTATIONS', 'GBS_TROP_DE_DEPOTS', 'GBS_PARAMETRES_INVALIDES'];

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
const statut = (code: string) => (code === 'GBS_TROP_DE_CONSULTATIONS' ? 429 : code === 'GBS_LIEN_INVALIDE' ? 404 : code === 'GBS_PARAMETRES_INVALIDES' ? 400 : 409);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: entetes() });
  if (req.method !== 'POST') return refus(405, 'GBS_METHODE');
  if (ORIGINE && req.headers.get('origin') && req.headers.get('origin') !== ORIGINE) return refus(403, 'GBS_ORIGINE');
  if (!limiteur.autorise(adresseClient(req.headers))) return refus(429, 'GBS_TROP_DE_CONSULTATIONS');
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false }, db: { schema: 'gbs' },
  });

  // Dépôt d'un document de transport (formulaire multipart).
  if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    const lgd = longueurCorps(req.headers.get('content-length'), TAILLE_DOCUMENT_MAX + 64 * 1024);
    if (lgd !== 'ok') return refus(lgd === 'absente' ? 411 : 413, 'GBS_FICHIER_TAILLE');
    let form: FormData;
    try { form = await req.formData(); } catch { return refus(400, 'GBS_PARAMETRES_INVALIDES'); }
    const fichier = form.get('fichier');
    if (form.get('action') !== 'document' || !(fichier instanceof File) || form.getAll('fichier').length !== 1) return refus(400, 'GBS_PARAMETRES_INVALIDES');
    const d = lireDepotDocument({ jeton: form.get('jeton'), type: form.get('type'), libelle: form.get('libelle'), taille: fichier.size, cles: [...form.keys()] });
    if (!d) return refus(fichier.size > TAILLE_DOCUMENT_MAX ? 413 : 400, fichier.size > TAILLE_DOCUMENT_MAX ? 'GBS_FICHIER_TAILLE' : 'GBS_PARAMETRES_INVALIDES');
    const octets = new Uint8Array(await fichier.arrayBuffer());
    const type = detecter(octets.subarray(0, 12));
    if (!type) return refus(415, 'GBS_FICHIER_TYPE');
    const dossier = await service.rpc('dossier_lien_transitaire', { p_jeton: d.jeton });
    if (dossier.error || typeof dossier.data !== 'string') return refus(statut(codeErreur(dossier.error)), codeErreur(dossier.error) === 'GBS_TROP_DE_CONSULTATIONS' ? 'GBS_TROP_DE_CONSULTATIONS' : 'GBS_LIEN_INVALIDE');
    const chemin = `${dossier.data}/${crypto.randomUUID()}.${type.ext}`;
    const up = await service.storage.from('gbs-documents').upload(chemin, octets, { contentType: type.mime, upsert: false });
    if (up.error) { console.error('transitaire: echec de stockage'); return refus(500, 'GBS_DEPOT_ECHEC'); }
    const { data, error } = await service.rpc('enregistrer_document_transitaire', { p_jeton: d.jeton, p_type: d.type, p_libelle: d.libelle,
      p_chemin: chemin, p_empreinte: hex(await crypto.subtle.digest('SHA-256', octets)), p_taille: octets.length });
    if (error) {
      await service.storage.from('gbs-documents').remove([chemin]);
      return refus(statut(codeErreur(error)), codeErreur(error));
    }
    return repondre(201, data);
  }

  const lg = longueurCorps(req.headers.get('content-length'), TAILLE_MAX);
  if (lg !== 'ok') return refus(lg === 'absente' ? 411 : 413, 'GBS_PARAMETRES_INVALIDES');
  let corps: unknown;
  try {
    const t = await req.text();
    if (t.length > TAILLE_MAX) return refus(413, 'GBS_PARAMETRES_INVALIDES');
    corps = JSON.parse(t);
  } catch { return refus(400, 'GBS_PARAMETRES_INVALIDES'); }
  const d = lireDemandeTransitaire(corps);
  if (!d) return refus(400, 'GBS_PARAMETRES_INVALIDES');

  const r = d.action === 'lire'
    ? await service.rpc('formulaire_transitaire', { p_jeton: d.jeton })
    : d.action === 'etape'
      ? await service.rpc('ajouter_etape_transitaire', { p_jeton: d.jeton, p_etape: d.etape, p_lieu: d.lieu, p_survenue_le: d.survenue_le, p_commentaire: d.commentaire })
      : await service.rpc('maj_expedition_transitaire', { p_jeton: d.jeton, p_champs: d.champs });
  if (r.error) return refus(statut(codeErreur(r.error)), codeErreur(r.error) === 'GBS_ERREUR' ? 'GBS_LIEN_INVALIDE' : codeErreur(r.error));
  return repondre(200, r.data);
});
