import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import fr from './fr.json';
import en from './en.json';
import zh from './zh.json';

let langue = 'fr';
try { langue = localStorage.getItem('gbs-langue') ?? 'fr'; } catch { /* stockage indisponible */ }

// Le français fait foi ; anglais et chinois simplifié sont des traductions (le chinois est à faire valider).
void i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en }, zh: { translation: zh } },
  lng: ['fr', 'en', 'zh'].includes(langue) ? langue : 'fr',
  fallbackLng: 'fr',
  interpolation: { escapeValue: false }, // React échappe déjà le texte rendu
  returnNull: false,
});

export default i18n;
