// M9, lot 1 : logique pure de la fonction serveur gbs-transitaire.
import { describe, expect, it } from 'vitest';
import { lireDemandeTransitaire, lireDepotDocument, TAILLE_DOCUMENT_MAX } from '../functions/_shared/transitaire';

const J = 'B'.repeat(43);
const T = Date.parse('2026-11-08T12:00:00Z');

describe('fonction gbs-transitaire : entrées', () => {
  it('actions et champs prévus seulement', () => {
    expect(lireDemandeTransitaire({ action: 'lire', jeton: J })).toEqual({ action: 'lire', jeton: J });
    expect(lireDemandeTransitaire({ action: 'lire', jeton: J, expedition: 'x' })).toBeNull();
    expect(lireDemandeTransitaire({ action: 'supprimer', jeton: J })).toBeNull();
    expect(lireDemandeTransitaire({ action: 'lire', jeton: 'court' })).toBeNull();
  });

  it('étape : type connu, date ni future ni trop ancienne, textes bornés', () => {
    const e = { action: 'etape', jeton: J, etape: 'depart_port', lieu: ' Nansha ', survenue_le: '2026-11-08T10:00:00Z', commentaire: '' };
    expect(lireDemandeTransitaire(e, T)).toEqual({ action: 'etape', jeton: J, etape: 'depart_port', lieu: 'Nansha', survenue_le: '2026-11-08T10:00:00.000Z', commentaire: null });
    expect(lireDemandeTransitaire({ ...e, etape: 'teleportation' }, T)).toBeNull();
    expect(lireDemandeTransitaire({ ...e, survenue_le: '2026-11-10T10:00:00Z' }, T)).toBeNull();
    expect(lireDemandeTransitaire({ ...e, survenue_le: '2025-01-01T10:00:00Z' }, T)).toBeNull();
    expect(lireDemandeTransitaire({ ...e, commentaire: 'x'.repeat(1001) }, T)).toBeNull();
    expect(lireDemandeTransitaire({ ...e, visible_client: true }, T)).toBeNull();
  });

  it('mise à jour : champs de transport seulement, conteneurs au format ISO 6346', () => {
    const r = lireDemandeTransitaire({ action: 'maj', jeton: J, champs: { navire: 'MSC ADRIANA', conteneurs: ['mscu 1234567'], eta: '2026-12-20' } });
    expect(r).toEqual({ action: 'maj', jeton: J, champs: { navire: 'MSC ADRIANA', conteneurs: ['MSCU1234567'], eta: '2026-12-20' } });
    expect(lireDemandeTransitaire({ action: 'maj', jeton: J, champs: { statut: 'livree' } })).toBeNull();
    expect(lireDemandeTransitaire({ action: 'maj', jeton: J, champs: { conteneurs: ['ABC123'] } })).toBeNull();
    expect(lireDemandeTransitaire({ action: 'maj', jeton: J, champs: { eta: '20/12/2026' } })).toBeNull();
    expect(lireDemandeTransitaire({ action: 'maj', jeton: J, champs: {} })).toBeNull();
  });

  it('document : type connu, taille bornée, aucun champ en plus', () => {
    const b = { jeton: J, type: 'connaissement', libelle: 'B/L', taille: 100, cles: ['action', 'jeton', 'type', 'libelle', 'fichier'] };
    expect(lireDepotDocument(b)).toEqual({ jeton: J, type: 'connaissement', libelle: 'B/L' });
    expect(lireDepotDocument({ ...b, type: 'facture' })).toBeNull();
    expect(lireDepotDocument({ ...b, taille: TAILLE_DOCUMENT_MAX + 1 })).toBeNull();
    expect(lireDepotDocument({ ...b, cles: [...b.cles, 'chemin'] })).toBeNull();
  });
});
