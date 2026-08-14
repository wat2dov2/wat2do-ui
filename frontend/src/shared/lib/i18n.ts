import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import {
  loadLanguage,
  saveLanguage,
} from "@/shared/services/preferencesStorage";
import {
  getLanguageByCode,
  isSupportedLanguage,
  type SupportedLanguage,
} from "@/shared/constants/languages";

// Device language preference, or English when unset.
export const getStoredLanguage = (): SupportedLanguage => {
  return loadLanguage();
};

i18n
  .use(initReactI18next)
  .init({
    fallbackLng: "en",
    lng: getStoredLanguage(),
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    resources: {}, // Start with empty resources, load languages dynamically
    returnEmptyString: false, // Return key if translation is missing
    returnNull: false, // Return key if translation is missing
  });

i18n.on("languageChanged", (lng: string) => {
  if (isSupportedLanguage(lng)) {
    saveLanguage(lng);
    if (typeof document !== "undefined") {
      const language = getLanguageByCode(lng);
      document.documentElement.lang = lng;
      document.documentElement.dir = language?.direction ?? "ltr";
    }
  }
});

export default i18n;
