import i18n from '@/shared/lib/i18n';

// Cache of loading promises to prevent duplicate loads
const loadingPromises = new Map<string, Promise<void>>();

type SupportedLanguage = 'en' | 'zh';
type TranslationModule = { default: Record<string, unknown> };
type TranslationLoader = () => Promise<TranslationModule>;

// Keep each feature's locale loaders together so adding a feature or language
// updates one list while preserving static imports for bundler code splitting.
const featureTranslationLoaders: Array<Record<SupportedLanguage, TranslationLoader>> = [
  {
    en: () => import('@/shared/locales/en.json'),
    zh: () => import('@/shared/locales/zh.json'),
  },
  {
    en: () => import('@/features/auth/locales/en.json'),
    zh: () => import('@/features/auth/locales/zh.json'),
  },
  {
    en: () => import('@/features/events/locales/en.json'),
    zh: () => import('@/features/events/locales/zh.json'),
  },
  {
    en: () => import('@/features/organizations/locales/en.json'),
    zh: () => import('@/features/organizations/locales/zh.json'),
  },
  {
    en: () => import('@/features/organization-panel/locales/en.json'),
    zh: () => import('@/features/organization-panel/locales/zh.json'),
  },
  {
    en: () => import('@/features/admin/locales/en.json'),
    zh: () => import('@/features/admin/locales/zh.json'),
  },
  {
    en: () => import('@/features/credits/locales/en.json'),
    zh: () => import('@/features/credits/locales/zh.json'),
  },
  {
    en: () => import('@/features/qrcode/locales/en.json'),
    zh: () => import('@/features/qrcode/locales/zh.json'),
  },
  {
    en: () => import('@/features/settings/locales/en.json'),
    zh: () => import('@/features/settings/locales/zh.json'),
  },
  {
    en: () => import('@/features/onboarding-demo/locales/en.json'),
    zh: () => import('@/features/onboarding-demo/locales/zh.json'),
  },
];

async function loadTranslations(lang: SupportedLanguage): Promise<TranslationModule> {
  const modules = await Promise.all(
    featureTranslationLoaders.map((loaders) => loaders[lang]()),
  );
  return {
    default: Object.assign({}, ...modules.map((module) => module.default)),
  };
}

const localeLoaders: Record<string, TranslationLoader> = {
  en: () => loadTranslations('en'),
  zh: () => loadTranslations('zh'),
};

export async function loadLanguage(lang: string): Promise<void> {
  if (i18n.hasResourceBundle(lang, 'translation')) {
    return;
  }

  const existingPromise = loadingPromises.get(lang);
  if (existingPromise) {
    return existingPromise;
  }

  const loadPromise = (async () => {
    try {
      const loader = localeLoaders[lang];
      if (!loader) {
        throw new Error(`No loader registered for locale "${lang}"`);
      }
      const resources = await loader();
      i18n.addResourceBundle(lang, 'translation', resources.default);
    } catch (error) {
      console.error(`Failed to load language "${lang}":`, error);
      if (lang !== 'en') {
        await loadLanguage('en');
        i18n.changeLanguage('en');
      }
    } finally {
      loadingPromises.delete(lang);
    }
  })();

  loadingPromises.set(lang, loadPromise);
  return loadPromise;
}
