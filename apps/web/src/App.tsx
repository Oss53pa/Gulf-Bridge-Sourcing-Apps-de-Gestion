import { Navigate, Route, Routes } from 'react-router-dom';
import { Commissions } from './screens/Commissions';
import { Rapprochement } from './screens/Rapprochement';
import { PageFournisseur } from './screens/PlisFournisseurs';
import { PageDueDiligence } from './screens/PiecesDueDiligence';
import { PageTransitaire } from './screens/Transitaires';
import { Prospection } from './screens/Prospection';
import { NonConformites } from './screens/NonConformites';
import { ReservesOuvertes } from './screens/Receptions';
import { Interventions } from './screens/Interventions';
import { ImprimerCertificatLc } from './screens/LettresCredit';
import type { ReactNode } from 'react';
import { useAuth } from './lib/auth';
import { configurationOk } from './lib/supabase';
import { accueil, ecranAutorise, ROLES_INTERNES } from './lib/droits';
import { PiecesManquantes, PointsBloquants } from './screens/SuiviDossiers';
import { GanttPortefeuille, JoursOuvres, Retroplanning } from './screens/Planning';
import { ClotureArchivage, Productivite } from './screens/Rapports';
import { Coque } from './components/Coque';
import { AccesReserve, Chargement } from './components/ui';
import { ConfigurationManquante, Connexion, SansRole } from './screens/Connexion';
import { TableauDeBord } from './screens/TableauDeBord';
import { NouveauDossier, Portefeuille } from './screens/Dossiers';
import { FicheDossier } from './screens/FicheDossier';
import { MesTaches } from './screens/Delais';
import { PageSuivi } from './screens/Suivi';
import { NotesFrais, Rentabilite } from './screens/Couts';
import { ImprimerRapportOffres } from './screens/RapportOffres';
import { Articles, Clients, Fournisseurs } from './screens/Tiers';
import { Commandes, FicheCommande, MiseEnConcurrence } from './screens/Achats';
import { Expeditions, FicheExpedition, Inspections, RapportInspection } from './screens/Operations';
import { Factures, FicheFacture, Flux, Paiements } from './screens/Finance';
import { Journal, Parametrage } from './screens/Administration';
import { ImprimerDueDiligence, ImprimerFacture, ImprimerInspection } from './screens/Imprimes';

function Garde({ ecran, children }: { ecran: string; children: ReactNode }) {
  const { profil } = useAuth();
  return ecranAutorise(ecran, profil?.role) ? <>{children}</> : <AccesReserve />;
}

export function App() {
  const { pret, session, aal, profil } = useAuth();
  if (!configurationOk) return <ConfigurationManquante />;
  // Page de suivi du client : publique, sans compte ; le jeton du lien est vérifié côté serveur.
  if (window.location.pathname === '/suivi') return <PageSuivi />;
  // Formulaire fournisseur : public, sans compte ; jeton du lien vérifié en base.
  if (window.location.pathname === '/fournisseur') return <PageFournisseur />;
  if (window.location.pathname === '/due-diligence') return <PageDueDiligence />;
  if (window.location.pathname === '/transitaire') return <PageTransitaire />;
  if (!pret) return <div className="screen"><Chargement /></div>;
  // Double facteur obligatoire pour tous les comptes internes.
  if (!session || aal !== 'aal2') return <Connexion />;
  if (!profil?.role || !ROLES_INTERNES.includes(profil.role) || !profil.actif) return <SansRole />;
  const g = (ecran: string, el: ReactNode) => <Garde ecran={ecran}>{el}</Garde>;
  return (
    <Routes>
      <Route path="/imprimer/facture/:id" element={g('factures', <ImprimerFacture />)} />
      <Route path="/imprimer/inspection/:id" element={g('inspections', <ImprimerInspection />)} />
      <Route path="/imprimer/due-diligence/:id" element={g('fournisseurs', <ImprimerDueDiligence />)} />
      <Route path="/imprimer/certificat-lc/:id" element={g('portefeuille', <ImprimerCertificatLc />)} />
      <Route path="/imprimer/rapport-offres/:id" element={g('portefeuille', <ImprimerRapportOffres />)} />
      <Route path="*" element={
        <Coque>
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
            <Route path="/prospection" element={g('prospection', <Prospection />)} />
            <Route path="/clients" element={g('clients', <Clients />)} />
            <Route path="/fournisseurs" element={g('fournisseurs', <Fournisseurs />)} />
            <Route path="/articles" element={g('articles', <Articles />)} />
            <Route path="/mise-en-concurrence" element={g('consultations', <MiseEnConcurrence />)} />
            <Route path="/commandes" element={g('commandes', <Commandes />)} />
            <Route path="/commandes/:id" element={g('commandes', <FicheCommande />)} />
            <Route path="/inspections" element={g('inspections', <Inspections />)} />
            <Route path="/non-conformites" element={g('non_conformites', <NonConformites />)} />
            <Route path="/inspections/:id" element={g('inspections', <RapportInspection />)} />
            <Route path="/expeditions" element={g('expeditions', <Expeditions />)} />
            <Route path="/interventions" element={g('interventions', <Interventions />)} />
            <Route path="/reserves" element={g('reserves', <ReservesOuvertes />)} />
            <Route path="/expeditions/:id" element={g('expeditions', <FicheExpedition />)} />
            <Route path="/factures" element={g('factures', <Factures />)} />
            <Route path="/factures/:id" element={g('factures', <FicheFacture />)} />
            <Route path="/commissions" element={g('commissions', <Commissions />)} />
            <Route path="/rapprochement" element={g('rapprochement', <Rapprochement />)} />
            <Route path="/paiements" element={g('paiements', <Paiements />)} />
            <Route path="/journal" element={g('journal', <Journal />)} />
            <Route path="/parametrage" element={g('parametrage', <Parametrage />)} />
            <Route path="*" element={<AccesReserve />} />
          </Routes>
        </Coque>
      } />
    </Routes>
  );
}
