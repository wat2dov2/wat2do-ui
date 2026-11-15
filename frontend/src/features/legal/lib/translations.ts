import english from "@/features/legal/locales/en.json" with { type: "json" };
import type { SupportedLanguage } from "@/shared/constants/languages";
import i18n from "@/shared/lib/i18n";
import { loadLanguage } from "@/shared/lib/loadLanguage";

/**
 * The legal pages' copy stays out of the locale bundles every page loads
 * (`app/english-locale.ts`, `shared/lib/languageLoaders.ts`): the documents are
 * long and few visitors open them. English ships with these pages' own code, so
 * the server renders it, and another language loads when a visitor reading in
 * it opens one of the pages; until then its keys fall back to English.
 */
i18n.addResourceBundle("en", "translation", english, true, true);

/** The legal copy in English, whose shape each page renders. */
export const LEGAL_ENGLISH = english.legal;

type LazyLanguage = Exclude<SupportedLanguage, "en">;
type TranslationModule = { default: Record<string, unknown> };

const LOADERS: Record<LazyLanguage, () => Promise<TranslationModule>> = {
  fr: () => import("@/features/legal/locales/fr.json", { with: { type: "json" } }),
  es: () => import("@/features/legal/locales/es.json", { with: { type: "json" } }),
  zh: () => import("@/features/legal/locales/zh.json", { with: { type: "json" } }),
  "pa-Guru": () => import("@/features/legal/locales/pa-Guru.json", { with: { type: "json" } }),
  ar: () => import("@/features/legal/locales/ar.json", { with: { type: "json" } }),
  hi: () => import("@/features/legal/locales/hi.json", { with: { type: "json" } }),
  fil: () => import("@/features/legal/locales/fil.json", { with: { type: "json" } }),
  "yue-Hant": () => import("@/features/legal/locales/yue-Hant.json", { with: { type: "json" } }),
  it: () => import("@/features/legal/locales/it.json", { with: { type: "json" } }),
  de: () => import("@/features/legal/locales/de.json", { with: { type: "json" } }),
  ur: () => import("@/features/legal/locales/ur.json", { with: { type: "json" } }),
  pt: () => import("@/features/legal/locales/pt.json", { with: { type: "json" } }),
  ru: () => import("@/features/legal/locales/ru.json", { with: { type: "json" } }),
  ta: () => import("@/features/legal/locales/ta.json", { with: { type: "json" } }),
  vi: () => import("@/features/legal/locales/vi.json", { with: { type: "json" } }),
  fa: () => import("@/features/legal/locales/fa.json", { with: { type: "json" } }),
  gu: () => import("@/features/legal/locales/gu.json", { with: { type: "json" } }),
  pl: () => import("@/features/legal/locales/pl.json", { with: { type: "json" } }),
  ko: () => import("@/features/legal/locales/ko.json", { with: { type: "json" } }),
};

const loaded = new Set<LazyLanguage>();

/** Add the legal copy in `language` to i18n, after that language's main bundle. */
export async function loadLegalTranslations(language: SupportedLanguage): Promise<void> {
  if (language === "en" || loaded.has(language)) {
    return;
  }
  // loadLanguage skips any language that already has a bundle, so ours goes in second.
  await loadLanguage(language);
  const { default: translations } = await LOADERS[language]();
  i18n.addResourceBundle(language, "translation", translations, true, true);
  loaded.add(language);
}
