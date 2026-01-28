/**
 * Translation Constants
 * Centralized language definitions for the application
 */

export interface Language {
  code: string;
  label: string;
  flag: string;
}

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: 'en', label: 'English', flag: '🇨🇦' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
  { code: 'bn', label: 'বাংলা', flag: '🇧🇩' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'ha', label: 'Hausa', flag: '🇳🇬' },
  { code: 'hi', label: 'हिन्दी', flag: '🇮🇳' },
  { code: 'id', label: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
  { code: 'mr', label: 'मराठी', flag: '🇮🇳' },
  { code: 'pt', label: 'Português', flag: '🇵🇹' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'te', label: 'తెలుగు', flag: '🇮🇳' },
  { code: 'tr', label: 'Türkçe', flag: '🇹🇷' },
  { code: 'ur', label: 'اردو', flag: '🇵🇰' },
  { code: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'zh', label: '中文', flag: '🇨🇳' },
] as const;

export const LANGUAGE_CODES = SUPPORTED_LANGUAGES.map(lang => lang.code) as readonly string[];

export function getLanguageByCode(code: string): Language | undefined {
  return SUPPORTED_LANGUAGES.find(lang => lang.code === code);
}

export function getDefaultLanguage(): Language {
  return SUPPORTED_LANGUAGES[0];
}
