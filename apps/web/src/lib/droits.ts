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
  section: string;         // section du module (bande de navigation sous la barre supérieure)
  roles: Role[];
  lot: 0 | 1 | 2 | 3;
}

/** Un module regroupe des sections numérotées (01, 02…), chacune listant ses écrans. */
export interface Module { id: string; metier: Metier[]; sections: string[]; }

const TOUS: Role[] = ROLES_INTERNES;

// Ordre et découpage repris de la maquette (Sommaire et bande de sections).
export const MODULES: Module[] = [
  { id: 'pilotage', metier: ['direction'], sections: ['synthese', 'analyse'] },
  { id: 'supervision', metier: ['direction', 'administration'], sections: ['controle'] },
  { id: 'commercial', metier: ['commercial'], sections: ['prospection', 'affaires', 'appels_offres'] },
  { id: 'dossiers', metier: ['commercial'], sections: ['portefeuille', 'suivi', 'planning'] },
  { id: 'achats', metier: ['achats'], sections: ['fournisseurs', 'consultation', 'commandes'] },
  { id: 'qualite', metier: ['achats'], sections: ['controles', 'non_conformites'] },
  { id: 'logistique', metier: ['logistique'], sections: ['transport', 'import'] },
  { id: 'apres_vente', metier: ['commercial'], sections: ['interventions'] },
  { id: 'finance', metier: ['finance'], sections: ['facturation', 'tresorerie', 'partage'] },
  { id: 'echanges', metier: ['commercial', 'logistique'], sections: ['messagerie'] },
  { id: 'parametrage', metier: ['administration'], sections: ['referentiel'] },
];

export const ECRANS: Ecran[] = [
  { id: 'tableau', chemin: '/tableau-de-bord', module: 'pilotage', section: 'synthese', roles: TOUS, lot: 0 },
  { id: 'rentabilite', chemin: '/rentabilite', module: 'pilotage', section: 'synthese', roles: ['admin', 'comptable'], lot: 1 },
  { id: 'journal', chemin: '/journal', module: 'supervision', section: 'controle', roles: ['admin', 'comptable'], lot: 0 },
  { id: 'prospection', chemin: '/prospection', module: 'commercial', section: 'prospection', roles: ['admin', 'hub_afrique', 'agent_pays'], lot: 1 },
  { id: 'clients', chemin: '/clients', module: 'commercial', section: 'prospection', roles: ['admin', 'achats_chine', 'hub_afrique', 'agent_pays', 'comptable'], lot: 0 },
  { id: 'appels_offres', chemin: '', module: 'commercial', section: 'appels_offres', roles: ['admin', 'hub_afrique'], lot: 2 },
  { id: 'portefeuille', chemin: '/dossiers', module: 'dossiers', section: 'portefeuille', roles: ['admin', 'achats_chine', 'hub_afrique', 'agent_pays', 'comptable'], lot: 0 },
  { id: 'nouveau_dossier', chemin: '/dossiers/nouveau', module: 'dossiers', section: 'portefeuille', roles: ['admin', 'hub_afrique', 'agent_pays'], lot: 0 },
  { id: 'mes_taches', chemin: '/mes-taches', module: 'dossiers', section: 'suivi', roles: TOUS, lot: 1 },
  { id: 'pieces_manquantes', chemin: '/pieces-manquantes', module: 'dossiers', section: 'suivi', roles: ['admin', 'achats_chine', 'hub_afrique', 'agent_pays', 'comptable'], lot: 0 },
  { id: 'points_bloquants', chemin: '/points-bloquants', module: 'dossiers', section: 'suivi', roles: ['admin', 'achats_chine', 'hub_afrique', 'agent_pays', 'comptable'], lot: 0 },
  { id: 'gantt', chemin: '/gantt', module: 'dossiers', section: 'planning', roles: ['admin', 'achats_chine', 'hub_afrique', 'agent_pays', 'comptable'], lot: 2 },
  { id: 'retroplanning', chemin: '/retroplanning', module: 'dossiers', section: 'planning', roles: ['admin', 'achats_chine', 'hub_afrique', 'agent_pays', 'comptable'], lot: 1 },
  { id: 'calendrier', chemin: '/jours-ouvres', module: 'dossiers', section: 'planning', roles: TOUS, lot: 1 },
  { id: 'fournisseurs', chemin: '/fournisseurs', module: 'achats', section: 'fournisseurs', roles: ['admin', 'achats_chine', 'comptable'], lot: 0 },
  { id: 'articles', chemin: '/articles', module: 'achats', section: 'fournisseurs', roles: TOUS, lot: 0 },
  { id: 'consultations', chemin: '/mise-en-concurrence', module: 'achats', section: 'consultation', roles: ['admin', 'achats_chine'], lot: 0 },
  { id: 'commandes', chemin: '/commandes', module: 'achats', section: 'commandes', roles: ['admin', 'achats_chine', 'comptable'], lot: 0 },
  { id: 'approbation', chemin: '', module: 'achats', section: 'commandes', roles: ['admin', 'achats_chine'], lot: 1 },
  { id: 'inspections', chemin: '/inspections', module: 'qualite', section: 'controles', roles: ['admin', 'achats_chine', 'inspecteur'], lot: 0 },
  { id: 'non_conformites', chemin: '/non-conformites', module: 'qualite', section: 'non_conformites', roles: ['admin', 'achats_chine'], lot: 1 },
  { id: 'expeditions', chemin: '/expeditions', module: 'logistique', section: 'transport', roles: ['admin', 'achats_chine', 'hub_afrique', 'agent_pays'], lot: 0 },
  { id: 'conformite_import', chemin: '', module: 'logistique', section: 'import', roles: ['admin', 'achats_chine'], lot: 2 },
  { id: 'reserves', chemin: '/reserves', module: 'logistique', section: 'import', roles: ['admin', 'hub_afrique', 'achats_chine'], lot: 1 },
  { id: 'interventions', chemin: '/interventions', module: 'apres_vente', section: 'interventions', roles: ['admin', 'hub_afrique', 'achats_chine', 'inspecteur'], lot: 1 },
  { id: 'factures', chemin: '/factures', module: 'finance', section: 'facturation', roles: ['admin', 'hub_afrique', 'comptable'], lot: 0 },
  { id: 'paiements', chemin: '/paiements', module: 'finance', section: 'facturation', roles: ['admin', 'achats_chine', 'comptable'], lot: 0 },
  { id: 'rapprochement', chemin: '/rapprochement', module: 'finance', section: 'facturation', roles: ['admin', 'comptable'], lot: 1 },
  { id: 'flux', chemin: '/flux', module: 'finance', section: 'tresorerie', roles: ['admin', 'comptable', 'hub_afrique', 'agent_pays'], lot: 0 },
  { id: 'tresorerie', chemin: '', module: 'finance', section: 'tresorerie', roles: ['admin', 'comptable'], lot: 2 },
  { id: 'commissions', chemin: '/commissions', module: 'finance', section: 'partage', roles: ['admin', 'comptable', 'agent_pays'], lot: 1 },
  { id: 'notes_frais', chemin: '/notes-frais', module: 'finance', section: 'partage', roles: TOUS, lot: 1 },
  { id: 'messagerie', chemin: '', module: 'echanges', section: 'messagerie', roles: TOUS, lot: 1 },
  { id: 'parametrage', chemin: '/parametrage', module: 'parametrage', section: 'referentiel', roles: ['admin'], lot: 0 },
];

/** Écran courant d'après la route (le chemin le plus long qui préfixe la route). */
export function ecranCourant(pathname: string): Ecran | undefined {
  return ECRANS.filter((e) => e.chemin && (pathname === e.chemin || pathname.startsWith(e.chemin + '/')))
    .sort((a, b) => b.chemin.length - a.chemin.length)[0];
}

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

/** Codes d'écran (« T-codes ») : saisis dans la recherche du Sommaire, Entrée ouvre l'écran. */
export const TCODES: Record<string, string> = {
  tableau: 'TDB', rentabilite: 'RNT', retroplanning: 'RPL', journal: 'AUD', prospection: 'PRO', clients: 'CLI',
  appels_offres: 'AOF', portefeuille: 'PTF', nouveau_dossier: 'NDO', mes_taches: 'TAC', pieces_manquantes: 'PCM', points_bloquants: 'BLQ', gantt: 'GNT', calendrier: 'CAL', fournisseurs: 'FOU',
  articles: 'ART', consultations: 'MEC', commandes: 'CMD', approbation: 'APT', inspections: 'INS', non_conformites: 'NCF',
  expeditions: 'EXP', conformite_import: 'IMP', reserves: 'LIV', interventions: 'INT', factures: 'FAC', paiements: 'PAY',
  rapprochement: 'BNK', flux: 'FLX', tresorerie: 'TRC', commissions: 'COM', notes_frais: 'NDF', messagerie: 'MSG', parametrage: 'PAR',
};
