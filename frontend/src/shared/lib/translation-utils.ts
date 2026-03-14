/**
 * Translation Utilities
 * Provides non-hook translation functions to reduce hook usage
 * Use these for simple translations that don't need reactivity
 */

import i18n from '@/shared/lib/i18n';

/**
 * Direct translation function - no hook needed
 * Use for one-off translations or in non-React contexts
 */
export function translate(key: string, options?: Record<string, any>): string {
  return i18n.t(key, options) as string;
}

/**
 * Get current language code without hook
 */
export function getCurrentLanguage(): string {
  return i18n.language;
}

/**
 * Check if a translation key exists
 */
export function hasTranslation(key: string): boolean {
  return i18n.exists(key);
}
