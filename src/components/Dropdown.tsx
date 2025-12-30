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
      className="absolute z-50 mt-2 rounded-lg shadow-xl w-full max-h-60 overflow-y-auto"
      style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb" }}
    >
      <div className="p-2">
        {options.map((option) => {
          const isSelected = selected.includes(option);
          return (
            <button
              key={option}
              onClick={() => onToggle(option)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors text-left group"
            >
              <div
                className="w-4 h-4 border-2 rounded transition-all flex items-center justify-center flex-shrink-0"
                style={{
                  borderColor: isSelected ? "#3B82F6" : "#D1D5DB",
                  backgroundColor: isSelected ? "#3B82F6" : "#fff",
                }}
              >
                {isSelected && (
                  <svg
                    className="w-2.5 h-2.5 text-white"
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
              <span className="font-medium text-xs transition-colors" style={{ color: "#4B5563" }}>
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
      className="text-white font-medium text-[11px] pl-2.5 pr-1.5 py-1 rounded-full inline-flex items-center gap-1.5 hover:opacity-90 transition-colors"
      style={{ backgroundColor: "#3B82F6" }}
    >
      {label}
      <span
        role="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(e);
        }}
        className="hover:bg-white/20 rounded-full p-0.5 transition-colors cursor-pointer"
        aria-label={`Remove ${label}`}
      >
        <X className="w-2.5 h-2.5" />
      </span>
    </span>
  );
});
