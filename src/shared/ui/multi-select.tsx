import { Button } from "@/shared/ui/button";
import { useTranslatedOptions } from "@/shared/hooks/useTranslatedOptions";

interface MultiSelectProps {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  className?: string;
  translationKeyPrefix?: string;
}

export function MultiSelect({
  options,
  selected,
  onToggle,
  className = "",
  translationKeyPrefix,
}: MultiSelectProps) {
  const translatedOptions = useTranslatedOptions(options, translationKeyPrefix);

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2 justify-center">
        {translatedOptions.map(({ value, label }) => {
          const isSelected = selected.includes(value);
          return (
            <Button
              key={value}
              onClick={() => onToggle(value)}
              variant={isSelected ? "default" : "ghost"}
              className="rounded-full"
            >
              {label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
