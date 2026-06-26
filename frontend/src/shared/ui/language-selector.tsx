import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/hooks/useLanguage';
import { SUPPORTED_LANGUAGES } from '@/shared/constants/languages';

interface LanguageSelectorProps {
  className?: string;
}

/**
 * Language Selector Component
 * Simplified component using useLanguage hook to reduce complexity
 */
export function LanguageSelector({ className }: LanguageSelectorProps) {
  const { currentLanguage, currentLanguageCode, changeLanguage } = useLanguage();

  return (
    <Select value={currentLanguageCode} onValueChange={changeLanguage}>
      <SelectTrigger
        showIcon={false}
        className={cn(
          "w-fit min-w-0 hover:bg-secondary/80 transition-colors",
          className
        )}
        size="sm"
      >
          <SelectValue>
            <span data-language-label className="text-sm">{currentLanguage.label}</span>
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
