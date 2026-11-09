import { Navigate, Route, Routes } from 'react-router-dom';
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { useAuth } from './lib/auth';
import { configurationOk } from './lib/supabase';
import { accueil, ecranAutorise, ROLES_INTERNES } from './lib/droits';
import { Coque } from './components/Coque';
import { AccesReserve, Chargement } from './components/ui';
import { ConfigurationManquante, Connexion, SansRole } from './screens/Connexion';

/** Écran chargé à la demande : le code de chaque module n'est téléchargé qu'à sa première ouverture. */
function paresseux<M, K extends keyof M>(charger: () => Promise<M>, nom: K) {
  return lazy(async () => ({ default: (await charger())[nom] as unknown as ComponentType }));
}
const Commissions = paresseux(() => import('./screens/Commissions'), 'Commissions');
const Rapprochement = paresseux(() => import('./screens/Rapprochement'), 'Rapprochement');
const PageFournisseur = paresseux(() => import('./screens/PlisFournisseurs'), 'PageFournisseur');
const PageDueDiligence = paresseux(() => import('./screens/PiecesDueDiligence'), 'PageDueDiligence');
const PageTransitaire = paresseux(() => import('./screens/Transitaires'), 'PageTransitaire');
const Entonnoir = paresseux(() => import('./screens/Prospection'), 'Entonnoir');
const FicheProspect = paresseux(() => import('./screens/Prospection'), 'FicheProspect');
const Prospection = paresseux(() => import('./screens/Prospection'), 'Prospection');
const NonConformites = paresseux(() => import('./screens/NonConformites'), 'NonConformites');
const Livraisons = paresseux(() => import('./screens/Receptions'), 'Livraisons');
const ReservesOuvertes = paresseux(() => import('./screens/Receptions'), 'ReservesOuvertes');
const Interventions = paresseux(() => import('./screens/Interventions'), 'Interventions');
const ImprimerCertificatLc = paresseux(() => import('./screens/LettresCredit'), 'ImprimerCertificatLc');
const PiecesManquantes = paresseux(() => import('./screens/SuiviDossiers'), 'PiecesManquantes');
const PointsBloquants = paresseux(() => import('./screens/SuiviDossiers'), 'PointsBloquants');
const GanttPortefeuille = paresseux(() => import('./screens/Planning'), 'GanttPortefeuille');
const JoursOuvres = paresseux(() => import('./screens/Planning'), 'JoursOuvres');
const Retroplanning = paresseux(() => import('./screens/Planning'), 'Retroplanning');
const ClotureArchivage = paresseux(() => import('./screens/Rapports'), 'ClotureArchivage');
const Productivite = paresseux(() => import('./screens/Rapports'), 'Productivite');
const TableauDeBord = paresseux(() => import('./screens/TableauDeBord'), 'TableauDeBord');
const NouveauDossier = paresseux(() => import('./screens/Dossiers'), 'NouveauDossier');
const Portefeuille = paresseux(() => import('./screens/Dossiers'), 'Portefeuille');
const Consultations = paresseux(() => import('./screens/Consultations'), 'Consultations');
const FicheConsultation = paresseux(() => import('./screens/Consultations'), 'FicheConsultation');
const NouvelleConsultation = paresseux(() => import('./screens/Consultations'), 'NouvelleConsultation');
const AppelsOffres = paresseux(() => import('./screens/AppelsOffres'), 'AppelsOffres');
const FicheAppelOffres = paresseux(() => import('./screens/AppelsOffres'), 'FicheAppelOffres');
const ApprobationsTechniques = paresseux(() => import('./screens/ApprobationEssais'), 'ApprobationsTechniques');
const FichesReference = paresseux(() => import('./screens/FichesReference'), 'FichesReference');
const FicheDossier = paresseux(() => import('./screens/FicheDossier'), 'FicheDossier');
const MesTaches = paresseux(() => import('./screens/Delais'), 'MesTaches');
const PageSuivi = paresseux(() => import('./screens/Suivi'), 'PageSuivi');
const NotesFrais = paresseux(() => import('./screens/Couts'), 'NotesFrais');
const Rentabilite = paresseux(() => import('./screens/Couts'), 'Rentabilite');
const Alertes = paresseux(() => import('./screens/Alertes'), 'Alertes');
const Recherche = paresseux(() => import('./screens/Recherche'), 'Recherche');
const GarantieSav = paresseux(() => import('./screens/ApresVente'), 'GarantieSav');
const StockPieces = paresseux(() => import('./screens/ApresVente'), 'StockPieces');
const ConformiteImport = paresseux(() => import('./screens/ConformiteImport'), 'ConformiteImport');
const Documents = paresseux(() => import('./screens/Documents'), 'Documents');
const Garanties = paresseux(() => import('./screens/Garanties'), 'Garanties');
const Tresorerie = paresseux(() => import('./screens/Tresorerie'), 'Tresorerie');
const Negoce = paresseux(() => import('./screens/Negoce'), 'Negoce');
const Ethique = paresseux(() => import('./screens/Ethique'), 'Ethique');
const ImprimerRapportOffres = paresseux(() => import('./screens/RapportOffres'), 'ImprimerRapportOffres');
const Articles = paresseux(() => import('./screens/Tiers'), 'Articles');
const Clients = paresseux(() => import('./screens/Tiers'), 'Clients');
const FicheClient = paresseux(() => import('./screens/Tiers'), 'FicheClient');
const FicheFournisseur = paresseux(() => import('./screens/Tiers'), 'FicheFournisseur');
const Fournisseurs = paresseux(() => import('./screens/Tiers'), 'Fournisseurs');
const Commandes = paresseux(() => import('./screens/Achats'), 'Commandes');
const FicheCommande = paresseux(() => import('./screens/Achats'), 'FicheCommande');
const HistoriquePrix = paresseux(() => import('./screens/Achats'), 'HistoriquePrix');
const MiseEnConcurrence = paresseux(() => import('./screens/Achats'), 'MiseEnConcurrence');
const Expeditions = paresseux(() => import('./screens/Operations'), 'Expeditions');
const FicheExpedition = paresseux(() => import('./screens/Operations'), 'FicheExpedition');
const Inspections = paresseux(() => import('./screens/Operations'), 'Inspections');
const RapportInspection = paresseux(() => import('./screens/Operations'), 'RapportInspection');
const Factures = paresseux(() => import('./screens/Finance'), 'Factures');
const FicheFacture = paresseux(() => import('./screens/Finance'), 'FicheFacture');
const Flux = paresseux(() => import('./screens/Finance'), 'Flux');
const Paiements = paresseux(() => import('./screens/Finance'), 'Paiements');
const Journal = paresseux(() => import('./screens/Administration'), 'Journal');
const Parametrage = paresseux(() => import('./screens/Administration'), 'Parametrage');
const ImprimerDueDiligence = paresseux(() => import('./screens/Imprimes'), 'ImprimerDueDiligence');
const ImprimerFacture = paresseux(() => import('./screens/Imprimes'), 'ImprimerFacture');
const ImprimerInspection = paresseux(() => import('./screens/Imprimes'), 'ImprimerInspection');
const attente = <div className="screen"><Chargement /></div>;

function Garde({ ecran, children }: { ecran: string; children: ReactNode }) {
  const { profil } = useAuth();
  return ecranAutorise(ecran, profil?.role) ? <>{children}</> : <AccesReserve />;
}

export function App() {
  const { pret, session, aal, profil } = useAuth();
  if (!configurationOk) return <ConfigurationManquante />;
  // Page de suivi du client : publique, sans compte ; le jeton du lien est vérifié côté serveur.
  if (window.location.pathname === '/suivi') return <Suspense fallback={attente}><PageSuivi /></Suspense>;
  // Formulaire fournisseur : public, sans compte ; jeton du lien vérifié en base.
  if (window.location.pathname === '/fournisseur') return <Suspense fallback={attente}><PageFournisseur /></Suspense>;
  if (window.location.pathname === '/due-diligence') return <Suspense fallback={attente}><PageDueDiligence /></Suspense>;
  if (window.location.pathname === '/transitaire') return <Suspense fallback={attente}><PageTransitaire /></Suspense>;
  if (!pret) return <div className="screen"><Chargement /></div>;
  // Double facteur obligatoire pour tous les comptes internes.
  if (!session || aal !== 'aal2') return <Connexion />;
  if (!profil?.role || !ROLES_INTERNES.includes(profil.role) || !profil.actif) return <SansRole />;
  const g = (ecran: string, el: ReactNode) => <Garde ecran={ecran}>{el}</Garde>;
  return (
    <Suspense fallback={attente}>
    <Routes>
      <Route path="/imprimer/facture/:id" element={g('factures', <ImprimerFacture />)} />
      <Route path="/imprimer/inspection/:id" element={g('inspections', <ImprimerInspection />)} />
      <Route path="/imprimer/due-diligence/:id" element={g('fournisseurs', <ImprimerDueDiligence />)} />
      <Route path="/imprimer/certificat-lc/:id" element={g('portefeuille', <ImprimerCertificatLc />)} />
      <Route path="/imprimer/rapport-offres/:id" element={g('portefeuille', <ImprimerRapportOffres />)} />
      <Route path="*" element={
        <Coque>
          <Suspense fallback={attente}>
          <Routes>
            <Route path="/" element={<Navigate to={accueil(profil.role)} replace />} />
            <Route path="/tableau-de-bord" element={g('tableau', <TableauDeBord />)} />
            <Route path="/flux" element={g('flux', <Flux />)} />
            <Route path="/dossiers" element={g('portefeuille', <Portefeuille />)} />
            <Route path="/dossiers/nouveau" element={g('nouveau_dossier', <NouveauDossier />)} />
            <Route path="/dossiers/:id" element={g('portefeuille', <FicheDossier />)} />
            <Route path="/mes-taches" element={g('mes_taches', <MesTaches />)} />
            <Route path="/pieces-manquantes" element={g('pieces_manquantes', <PiecesManquantes />)} />
            <Route path="/points-bloquants" element={g('points_bloquants', <PointsBloquants />)} />
            <Route path="/gantt" element={g('gantt', <GanttPortefeuille />)} />
            <Route path="/retroplanning" element={g('retroplanning', <Retroplanning />)} />
            <Route path="/jours-ouvres" element={g('calendrier', <JoursOuvres />)} />
            <Route path="/productivite" element={g('productivite', <Productivite />)} />
            <Route path="/cloture" element={g('cloture', <ClotureArchivage />)} />
            <Route path="/notes-frais" element={g('notes_frais', <NotesFrais />)} />
            <Route path="/rentabilite" element={g('rentabilite', <Rentabilite />)} />
            <Route path="/negoce" element={g('negoce', <Negoce />)} />
            <Route path="/prospection" element={g('prospection', <Prospection />)} />
            <Route path="/prospection/entonnoir" element={g('prospection', <Entonnoir />)} />
            <Route path="/prospection/:id" element={g('prospection', <FicheProspect />)} />
            <Route path="/clients" element={g('clients', <Clients />)} />
            <Route path="/clients/:id" element={g('clients', <FicheClient />)} />
            <Route path="/consultations" element={g('consultations_clients', <Consultations />)} />
            <Route path="/consultations/nouvelle" element={g('nouvelle_consultation', <NouvelleConsultation />)} />
            <Route path="/consultations/:id" element={g('consultations_clients', <FicheConsultation />)} />
            <Route path="/appels-offres" element={g('appels_offres', <AppelsOffres />)} />
            <Route path="/appels-offres/:id" element={g('appels_offres', <FicheAppelOffres />)} />
            <Route path="/fiches-reference" element={g('fiches_reference', <FichesReference />)} />
            <Route path="/fournisseurs" element={g('fournisseurs', <Fournisseurs />)} />
            <Route path="/fournisseurs/:id" element={g('fournisseurs', <FicheFournisseur />)} />
            <Route path="/articles" element={g('articles', <Articles />)} />
            <Route path="/mise-en-concurrence" element={g('consultations', <MiseEnConcurrence />)} />
            <Route path="/historique-prix" element={g('historique_prix', <HistoriquePrix />)} />
            <Route path="/approbation-technique" element={g('approbation', <ApprobationsTechniques />)} />
            <Route path="/commandes" element={g('commandes', <Commandes />)} />
            <Route path="/commandes/:id" element={g('commandes', <FicheCommande />)} />
            <Route path="/inspections" element={g('inspections', <Inspections />)} />
            <Route path="/non-conformites" element={g('non_conformites', <NonConformites />)} />
            <Route path="/ethique" element={g('ethique', <Ethique />)} />
            <Route path="/inspections/:id" element={g('inspections', <RapportInspection />)} />
            <Route path="/expeditions" element={g('expeditions', <Expeditions />)} />
            <Route path="/interventions" element={g('interventions', <Interventions />)} />
            <Route path="/stock" element={g('stock', <StockPieces />)} />
            <Route path="/sav" element={g('sav', <GarantieSav />)} />
            <Route path="/livraisons" element={g('livraisons', <Livraisons />)} />
            <Route path="/conformite-import" element={g('conformite_import', <ConformiteImport />)} />
            <Route path="/reserves" element={g('reserves', <ReservesOuvertes />)} />
            <Route path="/expeditions/:id" element={g('expeditions', <FicheExpedition />)} />
            <Route path="/factures" element={g('factures', <Factures />)} />
            <Route path="/factures/:id" element={g('factures', <FicheFacture />)} />
            <Route path="/commissions" element={g('commissions', <Commissions />)} />
            <Route path="/rapprochement" element={g('rapprochement', <Rapprochement />)} />
            <Route path="/paiements" element={g('paiements', <Paiements />)} />
            <Route path="/garanties" element={g('garanties', <Garanties />)} />
            <Route path="/tresorerie" element={g('tresorerie', <Tresorerie />)} />
            <Route path="/journal" element={g('journal', <Journal />)} />
            <Route path="/documents" element={g('documents', <Documents />)} />
            <Route path="/alertes" element={g('alertes', <Alertes />)} />
            <Route path="/recherche" element={g('recherche', <Recherche />)} />
            <Route path="/parametrage" element={g('parametrage', <Parametrage />)} />
            <Route path="*" element={<AccesReserve />} />
          </Routes>
          </Suspense>
        </Coque>
      } />
    </Routes>
    </Suspense>
  );
}
