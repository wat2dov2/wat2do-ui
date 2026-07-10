import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { loadLanguage, saveLanguage, type SupportedLanguage } from '@/shared/services/preferencesStorage';
import { LANGUAGE_CODES } from '@/shared/constants/languages';

// Device language preference, or English when unset.
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
    returnEmptyString: false, // Return key if translation is missing
    returnNull: false, // Return key if translation is missing
  });

i18n.on('languageChanged', (lng: string) => {
  if (LANGUAGE_CODES.includes(lng)) {
    saveLanguage(lng as SupportedLanguage);
  }
});

export default i18n;
