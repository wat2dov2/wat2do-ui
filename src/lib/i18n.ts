import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Get language from localStorage or default to English
export const getStoredLanguage = (): string => {
  const stored = localStorage.getItem('i18n-language');
  if (stored && ['en', 'zh'].includes(stored)) {
    return stored;
  }
  return 'en';
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

// Listen for language changes and update localStorage
i18n.on('languageChanged', (lng) => {
  localStorage.setItem('i18n-language', lng);
});

export default i18n;
