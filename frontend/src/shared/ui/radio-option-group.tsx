import { Circle } from "lucide-react";

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
    <div className={`space-y-2 ${className}`}>
      {options.map((option) => (
        <label
          key={option.value}
          className="flex items-center gap-2 p-3 border border-border rounded-xl cursor-pointer hover:bg-secondary"
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
