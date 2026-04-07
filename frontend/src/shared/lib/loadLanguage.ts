import i18n from '@/shared/lib/i18n';

// Cache of loading promises to prevent duplicate loads
const loadingPromises = new Map<string, Promise<void>>();

export async function loadLanguage(lang: string): Promise<void> {
  // Check if language is already loaded
  if (i18n.hasResourceBundle(lang, 'translation')) {
    return;
  }

  // Return existing promise if already loading
  const existingPromise = loadingPromises.get(lang);
  if (existingPromise) {
    return existingPromise;
  }

  // Create and cache loading promise
  const loadPromise = (async () => {
    try {
      // Dynamically import the language file
      const resources = await import(`@/locales/${lang}.json`);
      // Add the loaded resources to i18n
      i18n.addResourceBundle(lang, 'translation', resources.default);
    } catch (error) {
      console.error(`Failed to load language "${lang}":`, error);
      if (lang !== 'en') {
        await loadLanguage('en');
        i18n.changeLanguage('en');
      }
    } finally {
      // Remove from cache after loading completes
      loadingPromises.delete(lang);
    }
  })();

  loadingPromises.set(lang, loadPromise);
  return loadPromise;
}
