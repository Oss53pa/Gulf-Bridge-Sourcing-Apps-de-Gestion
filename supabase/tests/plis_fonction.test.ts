// M17 et M5, lot 1 : logique pure de la fonction serveur gbs-fournisseur (plis fermés).
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { chiffrer, cle, contenuPli, dechiffrer, empreinte, lireDemande, lireOffre } from '../functions/_shared/plis';

const J = 'A'.repeat(43);
const offre = { incoterm: 'FOB', lieu: 'Shenzhen', devise: 'USD', montant: 10000.5, delai_jours: 45, garantie_mois: 24,
  cout_global: { puissance_kw: 5, heures_an: 2000, duree_vie_ans: 12, entretien_heures_an: 10, pieces_cout_an: 300,
    pieces_disponibles_ans: 10, sav_afrique: 'Partenaire à Abidjan', delai_pieces_jours: 30 } };

describe('fonction gbs-fournisseur : offre et plis', () => {
  it('offre stricte : champs inconnus, devise, montant, bornes et coût global contrôlés', () => {
    expect(lireOffre(offre)?.complet).toBe(true);
    expect(lireOffre({ ...offre, cout_global: { puissance_kw: 5 } })?.complet).toBe(false);
    expect(lireOffre({ ...offre, prix_client: 1 })).toBeNull();
    expect(lireOffre({ ...offre, devise: 'EUR' })).toBeNull();
    expect(lireOffre({ ...offre, montant: 0 })).toBeNull();
    expect(lireOffre({ ...offre, montant: 1.005 })).toBeNull();
    expect(lireOffre({ ...offre, montant: '10000' })).toBeNull();
    expect(lireOffre({ ...offre, delai_jours: 45.5 })).toBeNull();
    expect(lireOffre({ ...offre, cout_global: { ...offre.cout_global, inconnu: 1 } })).toBeNull();
    expect(lireOffre({ ...offre, cout_global: { ...offre.cout_global, heures_an: 9000 } })).toBeNull();
    expect(lireOffre({ ...offre, commentaire: 'x'.repeat(2001) })).toBeNull();
    expect(lireOffre({ ...offre, lieu: 'Shen\u0000zhen' })?.offre.lieu).toBe('Shen zhen');
  });

  it('demande publique : action, jeton et champs attendus seulement', () => {
    expect(lireDemande({ action: 'lire', jeton: J })).toEqual({ action: 'lire', jeton: J });
    expect(lireDemande({ action: 'lire', jeton: J, x: 1 })).toBeNull();
    expect(lireDemande({ action: 'ouvrir', jeton: J })).toBeNull();
    expect(lireDemande({ action: 'lire', jeton: 'court' })).toBeNull();
    expect(lireDemande({ action: 'question', jeton: J, question: 'Ok ?' })).toBeNull();
    expect(lireDemande({ action: 'question', jeton: J, question: 'Marque du compresseur imposée ?' })?.action).toBe('question');
  });

  it('chiffrement AES-256-GCM : aller-retour, clé ou pli altéré refusés ; empreinte salée', async () => {
    expect(await cle(undefined)).toBeNull();
    expect(await cle('trop-court')).toBeNull();
    const k = (await cle(randomBytes(32).toString('base64')))!;
    const autre = (await cle(randomBytes(32).toString('base64')))!;
    const c1 = contenuPli(lireOffre(offre)!.offre);
    const c2 = contenuPli(lireOffre(offre)!.offre);
    expect(c1).not.toBe(c2);   // sel différent : même offre, empreintes différentes
    expect(await empreinte(c1)).toBe(createHash('sha256').update(c1, 'utf8').digest('hex'));
    const p = await chiffrer(k, c1);
    expect(p.iv).toMatch(/^[A-Za-z0-9+/]{16}$/);
    expect(p.chiffre).not.toContain('10000');
    expect(await dechiffrer(k, p.chiffre, p.iv)).toBe(c1);
    expect(await dechiffrer(autre, p.chiffre, p.iv)).toBeNull();
    const altere = Buffer.from(p.chiffre, 'base64'); altere[0] ^= 1;
    expect(await dechiffrer(k, altere.toString('base64'), p.iv)).toBeNull();
    expect(JSON.parse(c1)).toMatchObject({ incoterm: 'FOB', montant: 10000.5 });
  });
});
