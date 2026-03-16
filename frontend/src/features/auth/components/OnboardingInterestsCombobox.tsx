/**
 * Input + dropdown multi-select for onboarding (event types).
 * User can type to filter and click options to toggle selection; selected shown as tags.
 */

import { useState, useRef, useEffect } from "react";
import { ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/shared/ui/popover";
import { EVENT_CATEGORIES } from "@/shared/constants/eventCategories";

interface OnboardingInterestsComboboxProps {
  selected: string[];
  onToggle: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function OnboardingInterestsCombobox({
  selected,
  onToggle,
  placeholder = "Search or select...",
  className,
}: OnboardingInterestsComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = EVENT_CATEGORIES.filter((cat) =>
    cat.toLowerCase().includes(search.toLowerCase().trim())
  );

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  return (
    <div className={cn("flex flex-col gap-2 w-full max-w-md mx-auto", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div
            className="flex w-full items-center gap-2 rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs cursor-text focus-within:ring-2 focus-within:ring-ring focus-within:outline-none"
            role="combobox"
            aria-expanded={open}
          >
            <input
              ref={inputRef}
              type="text"
              placeholder={placeholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => requestAnimationFrame(() => setOpen(true))}
              className="flex-1 min-w-0 bg-transparent focus:outline-none placeholder:text-muted-foreground"
            />
            <ChevronsUpDown className="w-4 h-4 shrink-0 text-muted-foreground pointer-events-none" />
          </div>
        </PopoverAnchor>
        <PopoverContent
          className="w-(--radix-popover-trigger-width) p-1 max-h-[220px] overflow-y-auto"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onFocusOutside={(e) => {
            if (inputRef.current && e.target instanceof Node && inputRef.current.contains(e.target)) {
              e.preventDefault();
            }
          }}
          onInteractOutside={(e) => {
            if (inputRef.current && e.target instanceof Node && inputRef.current.contains(e.target)) {
              e.preventDefault();
            }
          }}
        >
          {filtered.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              No matches
            </div>
          ) : (
            filtered.map((option) => {
              const isSelected = selected.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    onToggle(option);
                  }}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-2 text-sm rounded-lg text-left transition-colors",
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-gray-200 dark:hover:bg-gray-200 text-foreground"
                  )}
                >
                  <span className="flex-1 truncate">{option}</span>
                  {isSelected && (
                    <span className="text-xs font-medium text-primary-foreground">✓</span>
                  )}
                </button>
              );
            })
          )}
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-xl font-medium bg-primary/80 text-white"
            >
              {item}
              <button
                type="button"
                onClick={() => onToggle(item)}
                className="rounded-full p-0.5 h-4 w-4 flex items-center justify-center hover:bg-white/20 transition-colors"
                aria-label={`Remove ${item}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
