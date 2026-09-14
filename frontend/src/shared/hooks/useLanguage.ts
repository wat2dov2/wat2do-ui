import { useTranslation } from 'react-i18next';
import { loadLanguage } from '@/shared/lib/loadLanguage';
import { saveLanguage } from '@/shared/services/preferencesStorage';
import {
  getLanguageByCode,
  getDefaultLanguage,
  type SupportedLanguage,
} from '@/shared/constants/languages';

export function useLanguage() {
  const { i18n } = useTranslation();
  
  const currentLanguageCode = i18n.language;
  const currentLanguage = getLanguageByCode(currentLanguageCode) || getDefaultLanguage();
  
  const changeLanguage = async (languageCode: SupportedLanguage) => {
    await loadLanguage(languageCode);
    await i18n.changeLanguage(languageCode);
    saveLanguage(languageCode);
  };
  
  return {
    currentLanguage,
    currentLanguageCode,
    changeLanguage,
  };
}
