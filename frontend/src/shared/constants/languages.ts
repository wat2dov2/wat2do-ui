interface Language {
  code: string;
  label: string;
  direction: "ltr" | "rtl";
}

// Ranked by 2021 Census knowledge of languages, the latest released Canadian data.
export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", direction: "ltr" },
  { code: "fr", label: "Français", direction: "ltr" },
  { code: "es", label: "Español", direction: "ltr" },
  { code: "zh", label: "简体中文", direction: "ltr" },
  { code: "pa-Guru", label: "ਪੰਜਾਬੀ", direction: "ltr" },
  { code: "ar", label: "العربية", direction: "rtl" },
  { code: "hi", label: "हिन्दी", direction: "ltr" },
  { code: "fil", label: "Filipino", direction: "ltr" },
  { code: "yue-Hant", label: "粵語", direction: "ltr" },
  { code: "it", label: "Italiano", direction: "ltr" },
  { code: "de", label: "Deutsch", direction: "ltr" },
  { code: "ur", label: "اردو", direction: "rtl" },
  { code: "pt", label: "Português", direction: "ltr" },
  { code: "ru", label: "Русский", direction: "ltr" },
  { code: "ta", label: "தமிழ்", direction: "ltr" },
  { code: "vi", label: "Tiếng Việt", direction: "ltr" },
  { code: "fa", label: "فارسی", direction: "rtl" },
  { code: "gu", label: "ગુજરાતી", direction: "ltr" },
  { code: "pl", label: "Polski", direction: "ltr" },
  { code: "ko", label: "한국어", direction: "ltr" },
] as const satisfies readonly Language[];

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export function isSupportedLanguage(code: string): code is SupportedLanguage {
  return SUPPORTED_LANGUAGES.some((language) => language.code === code);
}

export function getLanguageByCode(code: string): Language | undefined {
  return SUPPORTED_LANGUAGES.find(lang => lang.code === code);
}

export function getDefaultLanguage(): Language {
  return SUPPORTED_LANGUAGES[0];
}
