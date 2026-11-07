// Les règles métier refusées par la base renvoient un code GBS_* : on affiche un
// message traduit. Toute autre erreur reste générique côté client (aucun détail technique).
import i18n from '../i18n';

export function messageErreur(e: unknown): string {
  const brut = typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : '';
  const code = brut.match(/GBS_[A-Z0-9_]+/)?.[0];
  if (code) {
    const cle = `erreurs.${code}`;
    if (i18n.exists(cle)) {
      // Détail métier éventuel après « : » (liste de pièces, référence de commande…), sans données techniques.
      const detail = brut.split(':').slice(1).join(':').trim();
      const msg = i18n.t(cle);
      return detail && code === 'GBS_PIECES_MANQUANTES' ? `${msg} ${detail}` : msg;
    }
    return i18n.t('erreurs.regle', { code });
  }
  if (/permission denied|row-level security|42501/i.test(brut)) return i18n.t('erreurs.droits');
  if (/Failed to fetch|NetworkError|network/i.test(brut)) return i18n.t('erreurs.reseau');
  return i18n.t('erreurs.generique');
}
