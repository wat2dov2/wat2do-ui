import { Search, X } from "@/shared/ui/doodle-icons";
import { useEnterKeySubmit } from "@/shared/hooks";
import { cn } from "@/shared/lib/utils";

interface SubmittedSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  placeholder: string;
  submitLabel: string;
  clearLabel: string;
  className?: string;
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
}: SubmittedSearchInputProps) {
  const handleEnterSubmit = useEnterKeySubmit<HTMLInputElement>({
    onSubmit,
  });

  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <input
        type="text"
        data-elevation="control"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleEnterSubmit}
        className="flex h-8 w-full min-w-0 items-center rounded-xl bg-secondary pl-3 pr-20 py-2 text-base text-secondary-foreground shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
      />
      {value && (
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            onClear();
          }}
          className="absolute right-9 top-1/2 -translate-y-1/2 rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
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
        className="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={submitLabel}
      >
        <Search className="size-4" />
      </button>
    </div>
  );
}
