/**
 * Admin Search Bar Component
 * Reusable search input with clear button
 */

import { Search, X } from "@/shared/ui/doodle-icons";
import { Input } from "@/shared/ui/input";

interface AdminSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

export function AdminSearchBar({
  value,
  onChange,
  placeholder,
}: AdminSearchBarProps) {
  return (
    <div className="relative flex-1">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none z-10" />
      <Input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9 pr-9"
      />
      {value && (
        <button
          onMouseDown={() => onChange("")}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground z-10"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
