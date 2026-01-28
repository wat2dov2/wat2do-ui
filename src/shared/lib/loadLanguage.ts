import i18n from '@/shared/lib/i18n';

export async function loadLanguage(lang: string) {
  // Check if language is already loaded
  if (i18n.hasResourceBundle(lang, 'translation')) {
    return;
  }

  try {
    // Dynamically import the language file
    const resources = await import(`@/locales/${lang}.json`);
    // Add the loaded resources to i18n
    i18n.addResourceBundle(lang, 'translation', resources.default);
  } catch (error) {
    // Fallback to English if loading fails
    if (lang !== 'en') {
      await loadLanguage('en');
      i18n.changeLanguage('en');
    }
  }
}
