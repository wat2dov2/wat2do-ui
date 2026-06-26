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
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          handleEnterSubmit(event);
          onKeyDown?.(event);
        }}
        className={cn(
          "flex h-full w-full min-w-0 items-center rounded-none bg-transparent px-2 py-2 text-base text-secondary-foreground outline-none placeholder:text-muted-foreground",
          value ? "pr-20" : "pr-12",
        )}
      />
      {value && (
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            onClear();
          }}
          className="absolute right-10 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
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
        className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={submitLabel}
      >
        <Search className="size-4" />
      </button>
    </div>
  );
}
