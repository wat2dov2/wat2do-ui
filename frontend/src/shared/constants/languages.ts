interface Language {
  code: string;
  label: string;
  shortLabel: string;
  direction: "ltr" | "rtl";
}

// Ranked by 2021 Census knowledge of languages, the latest released Canadian data.
export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", shortLabel: "EN", direction: "ltr" },
  { code: "fr", label: "Français", shortLabel: "FR", direction: "ltr" },
  { code: "es", label: "Español", shortLabel: "ES", direction: "ltr" },
  { code: "zh", label: "简体中文", shortLabel: "简", direction: "ltr" },
  { code: "pa-Guru", label: "ਪੰਜਾਬੀ", shortLabel: "PA", direction: "ltr" },
  { code: "ar", label: "العربية", shortLabel: "AR", direction: "rtl" },
  { code: "hi", label: "हिन्दी", shortLabel: "HI", direction: "ltr" },
  { code: "fil", label: "Filipino", shortLabel: "FIL", direction: "ltr" },
  { code: "yue-Hant", label: "粵語", shortLabel: "粵", direction: "ltr" },
  { code: "it", label: "Italiano", shortLabel: "IT", direction: "ltr" },
  { code: "de", label: "Deutsch", shortLabel: "DE", direction: "ltr" },
  { code: "ur", label: "اردو", shortLabel: "UR", direction: "rtl" },
  { code: "pt", label: "Português", shortLabel: "PT", direction: "ltr" },
  { code: "ru", label: "Русский", shortLabel: "RU", direction: "ltr" },
  { code: "ta", label: "தமிழ்", shortLabel: "TA", direction: "ltr" },
  { code: "vi", label: "Tiếng Việt", shortLabel: "VI", direction: "ltr" },
  { code: "fa", label: "فارسی", shortLabel: "FA", direction: "rtl" },
  { code: "gu", label: "ગુજરાતી", shortLabel: "GU", direction: "ltr" },
  { code: "pl", label: "Polski", shortLabel: "PL", direction: "ltr" },
  { code: "ko", label: "한국어", shortLabel: "KO", direction: "ltr" },
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
