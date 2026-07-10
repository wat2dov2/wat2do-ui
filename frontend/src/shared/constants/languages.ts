export interface Language {
  code: string;
  label: string;
  shortLabel: string;
}

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', shortLabel: 'EN' },
  { code: 'zh', label: '中文', shortLabel: '中' },
] as const satisfies readonly Language[];

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export const LANGUAGE_CODES = SUPPORTED_LANGUAGES.map(
  (lang) => lang.code,
) as readonly string[];

export function getLanguageByCode(code: string): Language | undefined {
  return SUPPORTED_LANGUAGES.find(lang => lang.code === code);
}

export function getDefaultLanguage(): Language {
  return SUPPORTED_LANGUAGES[0];
}
