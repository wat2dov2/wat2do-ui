import { Button } from "@/shared/ui/button";
import { useTranslatedOptions } from "@/shared/hooks/useTranslatedOptions";

interface MultiSelectProps {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  className?: string;
  translationKeyPrefix?: string;
  getLabel?: (value: string) => string;
}

export function MultiSelect({
  options,
  selected,
  onToggle,
  className = "",
  translationKeyPrefix,
  getLabel,
}: MultiSelectProps) {
  const translatedOptions = useTranslatedOptions(options, translationKeyPrefix);
  const labeledOptions = getLabel
    ? options.map((value) => ({ value, label: getLabel(value) }))
    : translatedOptions;

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2 justify-center">
        {labeledOptions.map(({ value, label }) => {
          const isSelected = selected.includes(value);
          return (
            <Button
              key={value}
              type="button"
              onClick={() => onToggle(value)}
              variant={isSelected ? "selected" : "secondary"}
              aria-pressed={isSelected}
            >
              {label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
