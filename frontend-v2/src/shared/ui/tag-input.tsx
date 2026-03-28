import React from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Field,
  FieldLabel,
  FieldError,
} from "@/shared/ui/field";
import { cn } from "@/shared/lib/utils";

interface TagInputProps {
  label: string;
  labelIcon?: React.ReactNode;
  value: string[]; // Array of tags
  inputValue: string; // Current input value
  onInputChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  placeholder?: string;
  error?: string;
  touched?: boolean;
  tagColor?: "warning" | "primary" | "secondary"; // Default: "warning"
  className?: string;
  allowDuplicates?: boolean; // Default: false
  required?: boolean; // Show required indicator
}

const tagColorClasses = {
  warning: "bg-primary/80 text-white",
  primary: "bg-primary/80 text-white",
  secondary: "bg-primary/80 text-white",
};

/**
 * Reusable tag input component
 * Supports adding tags via input field and removing them via buttons
 */
export function TagInput({
  label,
  labelIcon,
  value,
  inputValue,
  onInputChange,
  onAdd,
  onRemove,
  placeholder,
  error,
  touched,
  tagColor = "warning",
  className,
  allowDuplicates = false,
  required = false,
}: TagInputProps) {
  const hasError = touched && error;
  const id = `tag-input-${label.toLowerCase().replace(/\s+/g, "-")}`;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onAdd();
    }
  };

  return (
    <Field className={className}>
      <FieldLabel
        htmlFor={id}
        className="text-sm font-medium text-foreground flex items-center gap-1.5"
      >
        {labelIcon}
        {label}
        {required && <span className="text-error">*</span>}
      </FieldLabel>
      <div className="flex gap-2">
        <Input
          id={id}
          type="text"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            "flex-1 text-xs",
            hasError && "border-error bg-error/10"
          )}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onAdd}
          className="shrink-0"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {value.map((item, index) => (
            <span
              key={`${item}-${index}`}
              className={cn(
                "inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-xl font-medium",
                tagColorClasses[tagColor]
              )}
            >
              {item}
              <button
                type="button"
                onClick={() => onRemove(index)}
                className="bg-foreground/30 text-white rounded-full p-0.5 h-4 w-4 flex items-center justify-center hover:bg-foreground/40 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {hasError && (
        <FieldError className="text-xs">{error}</FieldError>
      )}
    </Field>
  );
}
