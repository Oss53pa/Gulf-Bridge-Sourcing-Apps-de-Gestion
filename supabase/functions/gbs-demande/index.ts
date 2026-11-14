// Fonction serveur « gbs-demande » : demandes du site web créées en prospects (M1, lot 1).
// Appel serveur à serveur uniquement : le site signe chaque envoi (HMAC-SHA256, secret
// GBS_SITE_SECRET, horodatage à ±5 minutes) ; aucun accès depuis un navigateur (pas de CORS).
// - corps strict et borné, fichiers PDF ou images vérifiés sur leurs octets, nom régénéré ;
// - limitation de débit en mémoire par appelant, puis plafonds en base par visiteur (empreinte
//   HMAC de son adresse, jamais l'adresse en clair) et par jour ;
// - erreurs génériques ; ni corps, ni adresse, ni donnée personnelle dans les journaux.
import { longueurCorps } from '../_shared/fichiers.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.46.1';
import { adresseClient, Limiteur } from '../_shared/suivi.ts';
import { avisNouvelleDemande, CORPS_MAX, destinataires, empreinteIp, lireDemande, signatureValide } from '../_shared/demande.ts';

const SECRET = Deno.env.get('GBS_SITE_SECRET') ?? '';
// Avis sans donnée personnelle à l'équipe (Resend) : désactivé si aucun destinataire n'est configuré.
const AVIS_A = destinataires(Deno.env.get('GBS_AVIS_DEMANDE_A'));
const AVIS_DE = Deno.env.get('GBS_AVIS_DEMANDE_DE') ?? 'Gulf Bridge Sourcing <notifications@atlas-studio.org>';
const APP_URL = (Deno.env.get('GBS_APP_URL') ?? 'https://gbs.gulfbridgesourcing.com').replace(/\/$/, '');
const RESEND = Deno.env.get('RESEND_API_KEY') ?? '';

async function aviser(service: ReturnType<typeof createClient>, prospect: string) {
  if (AVIS_A.length === 0 || !RESEND) return;
  try {
    const { data } = await service.from('prospects').select('reference, pays, specialite').eq('id', prospect).single();
    if (!data) return;
    const a = avisNouvelleDemande({ ...(data as { reference: string; pays: string; specialite: string }), lien: `${APP_URL}/prospection/${prospect}` });
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: AVIS_DE, to: AVIS_A, subject: a.sujet, html: a.html, text: a.texte }),
    });
    if (!r.ok) console.error(`demande: avis non envoyé (${r.status})`);
  } catch {
    console.error('demande: avis non envoyé');
  }
}
const limiteur = new Limiteur(Number(Deno.env.get('GBS_DEMANDE_LIMITE_MINUTE') ?? '60'), 60_000);
const entetes = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const repondre = (status: number, corps: unknown) => new Response(JSON.stringify(corps), { status, headers: entetes });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return repondre(405, { erreur: 'GBS_METHODE' });
  if (SECRET.length < 32) return repondre(503, { erreur: 'GBS_INDISPONIBLE' });
  const appelant = adresseClient(req.headers);
  if (!limiteur.autorise(appelant)) return repondre(429, { erreur: 'GBS_TROP_DE_DEMANDES' });
  const lg = longueurCorps(req.headers.get('content-length'), CORPS_MAX);
  if (lg !== 'ok') return repondre(lg === 'absente' ? 411 : 413, { erreur: 'GBS_DEMANDE_INVALIDE' });

  const texte = await req.text();
  if (texte.length > CORPS_MAX) return repondre(413, { erreur: 'GBS_DEMANDE_INVALIDE' });
  if (!(await signatureValide(SECRET, req.headers.get('x-gbs-horodatage'), texte, req.headers.get('x-gbs-signature')))) {
    return repondre(401, { erreur: 'GBS_SIGNATURE' });
  }
  let d = null;
  try { d = lireDemande(JSON.parse(texte)); } catch { /* corps illisible */ }
  if (!d) return repondre(400, { erreur: 'GBS_DEMANDE_INVALIDE' });

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false }, db: { schema: 'gbs' },
  });
  const { data, error } = await service.rpc('recevoir_demande_site', { p: d.champs, p_empreinte_ip: await empreinteIp(SECRET, d.ip ?? appelant) });
  if (error) {
    const m = String(error.message);
    if (m.includes('GBS_TROP_DE_DEMANDES')) return repondre(429, { erreur: 'GBS_TROP_DE_DEMANDES' });
    if (m.includes('GBS_DEMANDE_INVALIDE')) return repondre(400, { erreur: 'GBS_DEMANDE_INVALIDE' });
    console.error('demande: echec d\'enregistrement');
    return repondre(500, { erreur: 'GBS_ERREUR' });
  }
  const { prospect_id, doublon } = data as { prospect_id: string; doublon: boolean };
  if (!doublon && d.fichiers.length > 0) {
    const chemins: string[] = [];
    for (const f of d.fichiers) {
      const chemin = `prospects/${prospect_id}/${crypto.randomUUID()}.${f.ext}`;
      const r = await service.storage.from('gbs-documents').upload(chemin, f.octets, { contentType: f.mime, upsert: false });
      if (!r.error) chemins.push(chemin);
    }
    if (chemins.length > 0) {
      const j = await service.rpc('joindre_fichiers_demande', { p_prospect: prospect_id, p_chemins: chemins });
      if (j.error) console.error('demande: echec de rattachement des fichiers');
    }
  }
  // La demande est enregistrée : l'échec de l'avis est journalisé, jamais renvoyé au site.
  if (!doublon) await aviser(service, prospect_id);
  return repondre(201, { recu: true });
});
