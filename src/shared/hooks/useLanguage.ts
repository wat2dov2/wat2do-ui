/**
 * Language Management Hook
 * Provides language state and change handler
 * Reduces props by encapsulating language logic
 */

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { loadLanguage } from '@/shared/lib/loadLanguage';
import { getLanguageByCode, getDefaultLanguage, type Language } from '@/shared/constants/languages';

/**
 * Hook for managing language selection
 * Encapsulates language state and change logic
 */
export function useLanguage() {
  const { i18n } = useTranslation();
  
  const currentLanguageCode = i18n.language;
  
  const currentLanguage = useMemo(() => {
    return getLanguageByCode(currentLanguageCode) || getDefaultLanguage();
  }, [currentLanguageCode]);
  
  const changeLanguage = useCallback(async (languageCode: string) => {
    await loadLanguage(languageCode);
    i18n.changeLanguage(languageCode);
  }, [i18n]);
  
  return {
    currentLanguage,
    currentLanguageCode,
    changeLanguage,
  };
}
