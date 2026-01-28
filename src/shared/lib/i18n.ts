import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { loadLanguage, saveLanguage, type SupportedLanguage } from '@/features/settings/api/settings.api';
import { LANGUAGE_CODES } from '@/shared/constants/languages';

// Get language from settings API or default to English
export const getStoredLanguage = (): string => {
  return loadLanguage();
};

// Preload English asynchronously (non-blocking)
// This allows the app to start immediately while English loads in background
(async () => {
  try {
    const resources = await import('@/locales/en.json');
    i18n.addResourceBundle('en', 'translation', resources.default);
  } catch (error) {
    console.error('Failed to load English translations:', error);
  }
})();

// Initialize i18n
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
    // This ensures missing keys show the key instead of empty string
    // But we'll ensure languages are loaded before switching
  });

// Listen for language changes and update via settings API
// Single listener setup - i18n handles deduplication internally
i18n.on('languageChanged', (lng: string) => {
  if (LANGUAGE_CODES.includes(lng)) {
    saveLanguage(lng as SupportedLanguage);
  }
});

export default i18n;
