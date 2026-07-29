import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { useLanguage } from "@/shared/hooks/useLanguage";
import {
  getDefaultLanguage,
  getLanguageByCode,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from "@/shared/constants/languages";

/** Language picker: a stock small Select listing the supported languages. */
interface LanguageSelectorProps {
  value?: SupportedLanguage;
  disabled?: boolean;
  onValueChange?: (language: SupportedLanguage) => void;
}

export function LanguageSelector({
  value,
  disabled = false,
  onValueChange,
}: LanguageSelectorProps = {}) {
  const language = useLanguage();
  const currentLanguageCode = value ?? language.currentLanguageCode;
  const currentLanguage =
    getLanguageByCode(currentLanguageCode) ?? getDefaultLanguage();

  const handleValueChange = (nextLanguage: string) => {
    if (onValueChange) {
      onValueChange(nextLanguage as SupportedLanguage);
      return;
    }
    void language.changeLanguage(nextLanguage);
  };

  return (
    <Select
      value={currentLanguageCode}
      disabled={disabled}
      onValueChange={handleValueChange}
    >
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
