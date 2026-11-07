// Catalogue des modules et écrans, droits d'affichage par profil.
// L'interface masque ce qui est interdit ; la base de données refuse de toute façon (RLS).
export type Role = 'admin' | 'achats_chine' | 'hub_afrique' | 'agent_pays' | 'inspecteur' | 'comptable'
  | 'client' | 'fournisseur' | 'transitaire';

export const ROLES_INTERNES: Role[] = ['admin', 'achats_chine', 'hub_afrique', 'agent_pays', 'inspecteur', 'comptable'];

export type Metier = 'direction' | 'commercial' | 'achats' | 'logistique' | 'finance' | 'administration';

export interface Ecran {
  id: string;
  chemin: string;          // route ('' pour un écran prévu dans un lot ultérieur)
  module: string;
  roles: Role[];
  lot: 0 | 1 | 2 | 3;
}

export interface Module { id: string; metier: Metier[]; }

const TOUS: Role[] = ROLES_INTERNES;

export const MODULES: Module[] = [
  { id: 'pilotage', metier: ['direction', 'finance'] },
  { id: 'dossiers', metier: ['direction', 'commercial', 'achats', 'logistique'] },
  { id: 'commercial', metier: ['commercial'] },
  { id: 'achats', metier: ['achats'] },
  { id: 'qualite', metier: ['achats'] },
  { id: 'logistique', metier: ['logistique'] },
  { id: 'finance', metier: ['finance'] },
  { id: 'supervision', metier: ['direction', 'administration'] },
  { id: 'parametrage', metier: ['administration'] },
];

export const ECRANS: Ecran[] = [
  { id: 'tableau', chemin: '/tableau-de-bord', module: 'pilotage', roles: TOUS, lot: 0 },
  { id: 'flux', chemin: '/flux', module: 'pilotage', roles: ['admin', 'comptable', 'hub_afrique', 'agent_pays'], lot: 0 },
  { id: 'messagerie', chemin: '', module: 'pilotage', roles: TOUS, lot: 1 },
  { id: 'retroplanning', chemin: '', module: 'pilotage', roles: TOUS, lot: 1 },
  { id: 'portefeuille', chemin: '/dossiers', module: 'dossiers', roles: ['admin', 'achats_chine', 'hub_afrique', 'agent_pays', 'comptable'], lot: 0 },
  { id: 'nouveau_dossier', chemin: '/dossiers/nouveau', module: 'dossiers', roles: ['admin', 'hub_afrique', 'agent_pays'], lot: 0 },
  { id: 'mes_taches', chemin: '/mes-taches', module: 'dossiers', roles: TOUS, lot: 1 },
  { id: 'gantt', chemin: '', module: 'dossiers', roles: TOUS, lot: 2 },
  { id: 'clients', chemin: '/clients', module: 'commercial', roles: ['admin', 'achats_chine', 'hub_afrique', 'agent_pays', 'comptable'], lot: 0 },
  { id: 'prospection', chemin: '', module: 'commercial', roles: ['admin', 'hub_afrique', 'agent_pays'], lot: 1 },
  { id: 'appels_offres', chemin: '', module: 'commercial', roles: ['admin', 'hub_afrique'], lot: 2 },
  { id: 'fournisseurs', chemin: '/fournisseurs', module: 'achats', roles: ['admin', 'achats_chine', 'comptable'], lot: 0 },
  { id: 'consultations', chemin: '/mise-en-concurrence', module: 'achats', roles: ['admin', 'achats_chine'], lot: 0 },
  { id: 'commandes', chemin: '/commandes', module: 'achats', roles: ['admin', 'achats_chine', 'comptable'], lot: 0 },
  { id: 'articles', chemin: '/articles', module: 'achats', roles: TOUS, lot: 0 },
  { id: 'approbation', chemin: '', module: 'achats', roles: ['admin', 'achats_chine'], lot: 1 },
  { id: 'inspections', chemin: '/inspections', module: 'qualite', roles: ['admin', 'achats_chine', 'inspecteur'], lot: 0 },
  { id: 'notes_frais', chemin: '', module: 'qualite', roles: TOUS, lot: 1 },
  { id: 'expeditions', chemin: '/expeditions', module: 'logistique', roles: ['admin', 'achats_chine', 'hub_afrique', 'agent_pays'], lot: 0 },
  { id: 'conformite_import', chemin: '', module: 'logistique', roles: ['admin', 'achats_chine'], lot: 2 },
  { id: 'factures', chemin: '/factures', module: 'finance', roles: ['admin', 'hub_afrique', 'comptable'], lot: 0 },
  { id: 'paiements', chemin: '/paiements', module: 'finance', roles: ['admin', 'achats_chine', 'comptable'], lot: 0 },
  { id: 'tresorerie', chemin: '', module: 'finance', roles: ['admin', 'comptable'], lot: 2 },
  { id: 'journal', chemin: '/journal', module: 'supervision', roles: ['admin', 'comptable'], lot: 0 },
  { id: 'rentabilite', chemin: '', module: 'supervision', roles: ['admin'], lot: 1 },
  { id: 'parametrage', chemin: '/parametrage', module: 'parametrage', roles: ['admin'], lot: 0 },
];

export function ecranAutorise(id: string, role: Role | null | undefined): boolean {
  const e = ECRANS.find((x) => x.id === id);
  return Boolean(e && role && e.roles.includes(role));
}

/** Chaque profil arrive sur un écran d'accueil différent. */
export function accueil(role: Role | null | undefined): string {
  switch (role) {
    case 'achats_chine': return '/commandes';
    case 'hub_afrique': return '/dossiers';
    case 'agent_pays': return '/clients';
    case 'inspecteur': return '/inspections';
    case 'comptable': return '/factures';
    default: return '/tableau-de-bord';
  }
}

/** Normalisation des accents pour la recherche du Sommaire. */
export const normaliser = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
