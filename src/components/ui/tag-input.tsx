import React from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldLabel,
  FieldError,
} from "@/components/ui/field";
import { cn } from "@/lib/utils";

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
  warning: "bg-warning/20 text-warning hover:bg-warning/30",
  primary: "bg-primary/20 text-primary hover:bg-primary/30",
  secondary: "bg-secondary/20 text-secondary hover:bg-secondary/30",
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
                "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full",
                tagColorClasses[tagColor]
              )}
            >
              {item}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => onRemove(index)}
                className="hover:bg-transparent rounded-full p-0.5 h-auto w-auto"
              >
                <X className="w-3 h-3" />
              </Button>
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
