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
        className={cn(
          "h-9 w-fit min-w-10 rounded-xl p-2 hover:bg-secondary/80 transition-colors sm:min-w-[100px]",
          className
        )}
        size="sm"
      >
          <SelectValue>
            <span className="flex items-center gap-2 text-sm">
              <span>{currentLanguage.flag}</span>
              <span className="hidden sm:inline">{currentLanguage.label}</span>
            </span>
          </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {SUPPORTED_LANGUAGES.map((lang) => (
          <SelectItem key={lang.code} value={lang.code}>
            <span className="flex items-center gap-2">
              <span>{lang.flag}</span>
              <span>{lang.label}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
