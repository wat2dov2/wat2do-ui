import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui/popover";
import { Highlighter } from "@/shared/ui/highlighter";
import { DEFAULT_SCHOOL } from "@/shared/constants/schools";
import { translateSchool } from "@/shared/utils/schoolTranslation";
import { searchSchools } from "@/shared/api/schools.api";

type SchoolComboboxVariant = "nav" | "field";

interface SchoolComboboxProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  variant?: SchoolComboboxVariant;
  align?: "start" | "center" | "end";
  contentClassName?: string;
  triggerClassName?: string;
}

const VARIANT_TRIGGER_STYLES: Record<SchoolComboboxVariant, string> = {
  nav: "flex text-white items-center gap-1 px-3 h-8 bg-transparent hover:bg-secondary rounded-xl transition-colors",
  field:
    "flex h-9 w-full items-center justify-between gap-2 rounded-xl border border-border bg-secondary px-3 py-1 text-left text-base md:text-sm text-foreground hover:bg-muted/60 shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
};

const VARIANT_CONTENT_STYLES: Record<SchoolComboboxVariant, string> = {
  nav: "w-[280px]",
  field: "w-[--radix-popover-trigger-width] min-w-[280px]",
};

export function SchoolCombobox({
  value,
  onChange,
  id,
  placeholder,
  variant = "nav",
  align = "start",
  contentClassName,
  triggerClassName: triggerClassNameProp,
}: SchoolComboboxProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const displayValue = useMemo(() => {
    if (value) return translateSchool(value);
    if (placeholder) return placeholder;
    return translateSchool(DEFAULT_SCHOOL);
  }, [placeholder, value]);

  const showPlaceholder = !value && Boolean(placeholder);

  useEffect(() => {
    if (!open) return;

    const query = search.trim();
    if (!query) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setResults([]);
    setIsLoading(true);
    const timeoutId = window.setTimeout(() => {
      searchSchools(query)
        .then((schools) => {
          if (!cancelled) {
            setResults(schools);
          }
        })
        .catch((err) => {
          console.error("Failed to search schools:", err);
          if (!cancelled) {
            setResults([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsLoading(false);
          }
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [open, search]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearch("");
      setResults([]);
      setIsLoading(false);
    }
  };

  const handleSelect = (school: string) => {
    onChange(school);
    setOpen(false);
    setSearch("");
    setResults([]);
    setIsLoading(false);
  };

  const hasQuery = search.trim().length > 0;
  const triggerClassName = cn(VARIANT_TRIGGER_STYLES[variant], triggerClassNameProp);
  const contentStyles = cn(
    "p-0 bg-popover border-border",
    VARIANT_CONTENT_STYLES[variant],
    contentClassName,
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          className={triggerClassName}
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          {variant === "nav" ? (
            <Highlighter action="highlight" color="var(--primary)">
              <span className="block min-w-0 truncate">{displayValue}</span>
            </Highlighter>
          ) : (
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                showPlaceholder && "text-muted-foreground",
              )}
            >
              {displayValue}
            </span>
          )}
          <ChevronsUpDown className="size-3.5 text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className={contentStyles} align={align}>
        <div className="flex items-center border-b border-border px-3">
          <Search className="size-4 text-muted-foreground shrink-0" />
          <input
            type="text"
            placeholder={t("schools.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-2 py-2.5 text-sm bg-transparent focus:outline-none text-foreground placeholder:text-muted-foreground"
          />
        </div>

        <div className="max-h-[220px] overflow-y-auto p-1">
          {isLoading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : hasQuery && results.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {t("schools.noSchoolFound")}
            </div>
          ) : (
            results.map((school) => (
              <button
                key={school}
                type="button"
                onClick={() => handleSelect(school)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-2 text-sm rounded-xl text-left transition-colors",
                  value === school
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-secondary text-foreground",
                )}
              >
                <Check
                  className={cn(
                    "w-4 h-4 shrink-0",
                    value === school ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="truncate">{translateSchool(school)}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
