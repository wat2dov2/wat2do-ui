/**
 * Translation Constants
 * Centralized language definitions for the application
 */

export interface Language {
  code: string;
  label: string;
  flag: string;
}

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇨🇦' },
  { code: 'zh', label: '简体中文', flag: '🇨🇳' },
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
