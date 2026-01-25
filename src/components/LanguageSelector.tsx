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
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
];

export function LanguageSelector({ className }: LanguageSelectorProps) {
  const { i18n } = useTranslation();
  const currentLanguage = i18n.language;

  const handleLanguageChange = async (value: string) => {
    await loadLanguage(value);
    i18n.changeLanguage(value);
  };

  const currentLanguageLabel = languages.find(lang => lang.code === currentLanguage)?.label || 'English';

  return (
    <Select value={currentLanguage} onValueChange={handleLanguageChange}>
      <SelectTrigger
        className={cn(
          "h-9 w-fit min-w-[100px] rounded-xl p-2 hover:bg-muted transition-colors",
          className
        )}
        size="sm"
      >
        <div className="flex items-center gap-2">
          <SelectValue>
            <span className="text-sm">{currentLanguageLabel}</span>
          </SelectValue>
        </div>
      </SelectTrigger>
      <SelectContent>
        {languages.map((lang) => (
          <SelectItem key={lang.code} value={lang.code}>
            {lang.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
