import type { SupportedLanguage } from "@/shared/constants/languages";
import i18n from "@/shared/lib/i18n";

const loadingPromises = new Map<SupportedLanguage, Promise<void>>();

export async function loadLanguage(language: SupportedLanguage): Promise<void> {
  if (i18n.hasResourceBundle(language, "translation")) {
    return;
  }

  const existingPromise = loadingPromises.get(language);
  if (existingPromise) {
    return existingPromise;
  }

  const loadPromise = (async () => {
    try {
      if (language === "en") {
        throw new Error("The eager English locale bundle is unavailable");
      }
      const { loadLazyLanguage } = await import(
        "@/shared/lib/languageLoaders"
      );
      const resources = await loadLazyLanguage(language);
      i18n.addResourceBundle(language, "translation", resources);
    } catch (error) {
      console.error(`Failed to load language "${language}":`, error);
      throw error;
    } finally {
      loadingPromises.delete(language);
    }
  })();

  loadingPromises.set(language, loadPromise);
  return loadPromise;
}
