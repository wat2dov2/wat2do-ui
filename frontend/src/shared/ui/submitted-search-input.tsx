import { Search, X } from "@/shared/ui/doodle-icons";
import { useEnterKeySubmit } from "@/shared/hooks";
import { cn } from "@/shared/lib/utils";
import type { KeyboardEvent } from "react";

interface SubmittedSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  placeholder: string;
  submitLabel: string;
  clearLabel: string;
  className?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

export function SubmittedSearchInput({
  value,
  onChange,
  onSubmit,
  onClear,
  placeholder,
  submitLabel,
  clearLabel,
  className,
  onKeyDown,
}: SubmittedSearchInputProps) {
  const handleEnterSubmit = useEnterKeySubmit<HTMLInputElement>({
    onSubmit,
  });

  return (
    <div
      className={cn(
        "relative h-11 min-w-0 flex-1 overflow-hidden rounded-xl bg-secondary shadow-xs transition-[color,box-shadow] focus-within:ring-[3px] focus-within:ring-ring/50",
        className,
      )}
      data-elevation="control"
    >
      <input
        type="text"
        data-search-input=""
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          handleEnterSubmit(event);
          onKeyDown?.(event);
        }}
        className={cn(
          "block h-full w-full min-w-0 rounded-none bg-transparent px-3 py-2 text-base leading-7 text-secondary-foreground outline-none placeholder:text-muted-foreground",
          value ? "pr-[5.5rem]" : "pr-14",
        )}
      />
      {value && (
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            onClear();
          }}
          className="absolute right-11 top-0 flex h-full w-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
          aria-label={clearLabel}
        >
          <X className="size-4" />
        </button>
      )}
      <button
        type="button"
        onMouseDown={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className="absolute right-0 top-0 flex h-full w-11 items-center justify-center rounded-l-none rounded-r-xl border-l border-border/60 bg-secondary text-muted-foreground transition-colors hover:bg-muted-hover hover:text-foreground"
        aria-label={submitLabel}
      >
        <Search className="size-4" />
      </button>
    </div>
  );
}
