import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { loadLanguage, saveLanguage, type SupportedLanguage } from '@/features/settings/api/settings.api';
import { LANGUAGE_CODES } from '@/shared/constants/languages';

// Get language from settings API or default to English
export const getStoredLanguage = (): string => {
  return loadLanguage();
};

i18n
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    lng: getStoredLanguage(),
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    resources: {}, // Start with empty resources, load languages dynamically
  });

// Listen for language changes and update via settings API
i18n.on('languageChanged', (lng) => {
  if (LANGUAGE_CODES.includes(lng)) {
    saveLanguage(lng as SupportedLanguage);
  }
});

export default i18n;
