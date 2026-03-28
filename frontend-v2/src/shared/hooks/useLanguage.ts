/**
 * Language Management Hook
 * Provides language state and change handler
 * Optimized to reduce unnecessary re-renders and memoization
 */

import { useTranslation } from 'react-i18next';
import { loadLanguage } from '@/shared/lib/loadLanguage';
import { getLanguageByCode, getDefaultLanguage } from '@/shared/constants/languages';

/**
 * Hook for managing language selection
 * Simplified to avoid unnecessary memoization - i18n already handles reactivity
 */
export function useLanguage() {
  const { i18n } = useTranslation();
  
  // Direct access - i18n.language is reactive, no need for memoization
  const currentLanguageCode = i18n.language;
  
  // Simple lookup - fast enough without memoization for small array
  const currentLanguage = getLanguageByCode(currentLanguageCode) || getDefaultLanguage();
  
  // Direct function - no need for useCallback, called infrequently
  const changeLanguage = async (languageCode: string) => {
    await loadLanguage(languageCode);
    i18n.changeLanguage(languageCode);
  };
  
  return {
    currentLanguage,
    currentLanguageCode,
    changeLanguage,
  };
}
