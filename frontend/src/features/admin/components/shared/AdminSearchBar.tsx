import { Search, X } from "@/shared/ui/doodle-icons";
import { SubmittedSearchInput } from "@/shared/ui/submitted-search-input";
import { useEnterKeySubmit } from "@/shared/hooks";
import { cn } from "@/shared/lib/utils";

interface AdminSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  onSubmit?: () => void;
  onClear?: () => void;
  submitLabel?: string;
  clearLabel?: string;
}

export function AdminSearchBar({
  value,
  onChange,
  placeholder,
  onSubmit,
  onClear,
  submitLabel,
  clearLabel,
}: AdminSearchBarProps) {
  const handleEnterSubmit = useEnterKeySubmit<HTMLInputElement>({
    onSubmit: () => onChange(value.trim()),
  });

  if (onSubmit && onClear && submitLabel && clearLabel) {
    return (
      <SubmittedSearchInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        onClear={onClear}
        placeholder={placeholder}
        submitLabel={submitLabel}
        clearLabel={clearLabel}
      />
    );
  }

  return (
    <div
      className={cn(
        "relative h-11 min-w-0 flex-1 overflow-hidden rounded-xl bg-secondary shadow-xs transition-[color,box-shadow] focus-within:ring-[3px] focus-within:ring-ring/50",
      )}
      data-elevation="control"
    >
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleEnterSubmit}
        className={cn(
          "block h-full w-full min-w-0 rounded-none bg-transparent px-3 py-2 text-base leading-7 text-secondary-foreground outline-none placeholder:text-muted-foreground",
          value ? "pr-10" : "pr-3",
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-0 top-0 flex h-full w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
          aria-label={clearLabel ?? "Clear search"}
        >
          <X className="size-4" />
        </button>
      )}
      {!value && (
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
      )}
    </div>
  );
}
