// Logique pure de la page de suivi client, partagée par la fonction serveur
// gbs-suivi et testée sous Node : validation du jeton, adresse du client,
// limitation de débit à mémoire bornée.

/** Jeton : 32 octets aléatoires en base64 « url » sans remplissage. */
export const JETON = /^[A-Za-z0-9_-]{43}$/;

/** Chemin d'un document du dossier : <uuid du dossier>/<uuid>.<extension>. */
export const CHEMIN_DOCUMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f-]{36}\.(pdf|png|jpg|webp)$/;

/** Corps attendu : exactement { "jeton": "<43 caractères>" } ; tout autre champ est refusé. */
export function lireJeton(corps: unknown): string | null {
  if (typeof corps !== 'object' || corps === null || Array.isArray(corps)) return null;
  const cles = Object.keys(corps);
  if (cles.length !== 1 || cles[0] !== 'jeton') return null;
  const j = (corps as { jeton: unknown }).jeton;
  return typeof j === 'string' && JETON.test(j) ? j : null;
}

/** Adresse du client derrière le proxy de Supabase (première adresse de la chaîne). */
export function adresseClient(h: Headers): string {
  const brut = h.get('cf-connecting-ip') ?? h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0] ?? '';
  const ip = brut.trim();
  return /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : 'inconnue';
}

/** Fenêtre fixe par clé, mémoire bornée : les clés expirées sont purgées, puis les plus anciennes. */
export class Limiteur {
  private readonly compteurs = new Map<string, { debut: number; n: number }>();
  constructor(private readonly max: number, private readonly fenetreMs: number, private readonly taille = 10_000) {}

  autorise(cle: string, maintenant = Date.now()): boolean {
    const c = this.compteurs.get(cle);
    if (!c || maintenant - c.debut >= this.fenetreMs) {
      if (this.compteurs.size >= this.taille) this.purger(maintenant);
      this.compteurs.set(cle, { debut: maintenant, n: 1 });
      return this.max >= 1;
    }
    c.n += 1;
    return c.n <= this.max;
  }

  private purger(maintenant: number) {
    for (const [k, v] of this.compteurs) if (maintenant - v.debut >= this.fenetreMs) this.compteurs.delete(k);
    while (this.compteurs.size >= this.taille) {
      const premiere = this.compteurs.keys().next().value;
      if (premiere === undefined) break;
      this.compteurs.delete(premiere);
    }
  }

  get nombre() { return this.compteurs.size; }
}
