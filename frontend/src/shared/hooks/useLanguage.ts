import { useTranslation } from 'react-i18next';
import { loadLanguage } from '@/shared/lib/loadLanguage';
import { getLanguageByCode, getDefaultLanguage } from '@/shared/constants/languages';

export function useLanguage() {
  const { i18n } = useTranslation();
  
  const currentLanguageCode = i18n.language;
  const currentLanguage = getLanguageByCode(currentLanguageCode) || getDefaultLanguage();
  
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
