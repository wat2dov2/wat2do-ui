import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select';
import { useLanguage } from '@/shared/hooks/useLanguage';
import { SUPPORTED_LANGUAGES } from '@/shared/constants/languages';

/** Language picker: a stock small Select listing the supported languages. */
export function LanguageSelector() {
  const { currentLanguage, currentLanguageCode, changeLanguage } = useLanguage();

  return (
    <Select value={currentLanguageCode} onValueChange={changeLanguage}>
      <SelectTrigger size="sm">
        <SelectValue>
          <span className="sm:hidden">{currentLanguage.shortLabel}</span>
          <span className="hidden sm:inline">{currentLanguage.label}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {SUPPORTED_LANGUAGES.map((lang) => (
          <SelectItem key={lang.code} value={lang.code}>
            {lang.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
