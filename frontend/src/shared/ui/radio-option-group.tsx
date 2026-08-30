import { Circle } from "@/shared/ui/doodle-icons";
import { OUTLINE_CONTROL_STYLES } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

interface RadioOption {
  value: string;
  label: string;
  description?: string;
}

interface RadioOptionGroupProps {
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
  name: string;
  className?: string;
}

export function RadioOptionGroup({
  options,
  value,
  onChange,
  name,
  className = "",
}: RadioOptionGroupProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            OUTLINE_CONTROL_STYLES,
            "flex cursor-pointer items-center gap-2 rounded-xl p-3",
          )}
        >
          <div className="relative">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            <Circle
              className={`w-4 h-4 ${
                value === option.value
                  ? "text-primary fill-primary"
                  : "text-muted-foreground"
              }`}
            />
          </div>
          <div className="flex-1">
            <div className="font-medium text-sm">{option.label}</div>
            {option.description && (
              <div className="text-xs text-muted-foreground">{option.description}</div>
            )}
          </div>
        </label>
      ))}
    </div>
  );
}
