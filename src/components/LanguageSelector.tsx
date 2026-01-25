import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { loadLanguage } from '@/lib/loadLanguage';

interface LanguageSelectorProps {
  className?: string;
}

const languages = [
  { code: 'en', label: 'English', flag: '🇨🇦' },
  { code: 'zh', label: '中文', flag: '🇨🇳' },
];

export function LanguageSelector({ className }: LanguageSelectorProps) {
  const { i18n } = useTranslation();
  const currentLanguageCode = i18n.language;

  const handleLanguageChange = async (value: string) => {
    await loadLanguage(value);
    i18n.changeLanguage(value);
  };

  const currentLanguage = languages.find(lang => lang.code === currentLanguageCode) || languages[0];

  return (
    <Select value={currentLanguageCode} onValueChange={handleLanguageChange}>
      <SelectTrigger
        className={cn(
          "h-9 w-fit min-w-[100px] rounded-xl p-2 hover:bg-muted transition-colors",
          className
        )}
        size="sm"
      >
        <div className="flex items-center gap-2">
          <SelectValue>
            <span className="flex items-center gap-2 text-sm">
              <span>{currentLanguage.flag}</span>
              <span>{currentLanguage.label}</span>
            </span>
          </SelectValue>
        </div>
      </SelectTrigger>
      <SelectContent>
        {languages.map((lang) => (
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
