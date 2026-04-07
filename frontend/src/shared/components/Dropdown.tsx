import React from "react";
import { X } from "lucide-react";

interface DropdownProps {
  options: string[];
  selected: string[];
  onToggle: (option: string) => void;
}

export function Dropdown({ options, selected, onToggle }: DropdownProps) {
  return (
    <div
      data-dropdown
      className="absolute z-dropdown mt-2 rounded-lg shadow-xl w-full max-h-60 overflow-y-auto bg-popover border border-border"
    >
      <div className="p-2">
        {options.map((option) => {
          const isSelected = selected.includes(option);
          return (
            <button
              key={option}
              onClick={() => onToggle(option)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-accent/60 transition-colors text-left group"
            >
              <div
                className={`w-4 h-4 border-2 rounded transition-all flex items-center justify-center shrink-0 ${
                  isSelected 
                    ? "border-primary bg-primary" 
                    : "border-border bg-card"
                }`}
              >
                {isSelected && (
                  <svg
                    className="w-2.5 h-2.5 text-primary-foreground"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="3"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path d="M5 13l4 4L19 7"></path>
                  </svg>
                )}
              </div>
              <span className="font-medium text-xs transition-colors text-foreground">
                {option}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface FilterTagProps {
  label: string;
  onRemove: (e?: React.MouseEvent) => void;
}

export const FilterTag = React.memo(function FilterTag({ label, onRemove }: FilterTagProps) {
  return (
    <span
      className="text-primary-foreground font-medium text-[11px] pl-2.5 pr-1.5 py-1 rounded-full inline-flex items-center gap-1.5 hover:opacity-90 transition-colors bg-primary"
    >
      {label}
      <span
        role="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(e);
        }}
        className="hover:bg-primary-foreground/20 rounded-full p-0.5 transition-colors cursor-pointer"
        aria-label={`Remove ${label}`}
      >
        <X className="w-2.5 h-2.5" />
      </span>
    </span>
  );
});
