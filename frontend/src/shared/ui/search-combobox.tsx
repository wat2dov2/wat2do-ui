import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Check, ChevronsUpDown, Search } from "@/shared/ui/doodle-icons";
import { cn } from "@/shared/lib/utils";
import { useEnterKeySubmit } from "@/shared/hooks";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/shared/ui/popover";

export type SearchComboboxVariant = "nav" | "field";

export interface SearchComboboxProps<T> {
  /** Key of the currently selected item, compared against getKey for the check mark. */
  selectedKey: string;
  onSelect: (item: T) => void;
  /** Resolve results for a query. May be sync (client filter) or async (server search). */
  fetcher: (query: string) => T[] | Promise<T[]>;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  /** Text shown on the trigger button (selected label or placeholder). */
  displayValue: string;
  /** Style the trigger text as a placeholder. */
  isPlaceholder?: boolean;
  /** Wrap the trigger label (e.g. with a highlighter). Defaults to a plain truncating span. */
  renderTriggerLabel?: (label: string) => ReactNode;
  /** Fetch (and show results) even when the query is empty — list behaves like an input dropdown. */
  searchOnEmpty?: boolean;
  /** Debounce before fetching. Use 0 for synchronous client-side filtering. */
  debounceMs?: number;
  variant?: SearchComboboxVariant;
  align?: "start" | "center" | "end";
  id?: string;
  searchPlaceholder: string;
  emptyLabel: string;
  loadingLabel: string;
  contentClassName?: string;
  triggerClassName?: string;
}

const VARIANT_TRIGGER_STYLES: Record<SearchComboboxVariant, string> = {
  nav: "flex h-8 min-w-0 items-center gap-1 overflow-hidden rounded-xl bg-transparent px-3 text-sm text-foreground transition-colors hover:bg-secondary",
  field:
    "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-xl bg-secondary px-3 py-2 text-left text-base text-secondary-foreground shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:bg-input/50 dark:disabled:bg-input/80 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
};

const VARIANT_CONTENT_STYLES: Record<SearchComboboxVariant, string> = {
  nav: "w-[280px]",
  field: "w-[var(--search-combobox-trigger-width)] min-w-[280px]",
};

/**
 * Generic search-and-select combobox: a popover with a search input and a
 * scrollable result list. The single source of truth for school/club pickers —
 * callers supply how to fetch, key, and label items.
 */
export function SearchCombobox<T>({
  selectedKey,
  onSelect,
  fetcher,
  getKey,
  getLabel,
  displayValue,
  isPlaceholder = false,
  renderTriggerLabel,
  searchOnEmpty = false,
  debounceMs = 0,
  variant = "field",
  align = "start",
  id,
  searchPlaceholder,
  emptyLabel,
  loadingLabel,
  contentClassName,
  triggerClassName,
}: SearchComboboxProps<T>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [triggerWidth, setTriggerWidth] = useState(280);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef(false);

  const resetSearchState = useCallback(() => {
    setSearch("");
    setResults([]);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const willFetch = useCallback(
    (query: string) => query.trim().length > 0 || searchOnEmpty,
    [searchOnEmpty],
  );

  const fetchResults = useCallback(
    async (query: string) => {
      try {
        return await Promise.resolve(fetcher(query));
      } catch (err) {
        console.error("SearchCombobox fetch failed:", err);
        return [];
      }
    },
    [fetcher],
  );

  // Loading is toggled in the event handlers below (open/typing); the effect
  // only fires the fetch and writes results from async callbacks — keeping
  // setState out of the synchronous effect body.
  useEffect(() => {
    if (!open) return;

    const query = search.trim();
    if (!query && !searchOnEmpty) return;

    let cancelled = false;
    const run = () => {
      fetchResults(query)
        .then((items) => {
          if (!cancelled) setResults(items);
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    };

    if (debounceMs > 0) {
      const timeoutId = window.setTimeout(run, debounceMs);
      return () => {
        cancelled = true;
        window.clearTimeout(timeoutId);
      };
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [open, search, searchOnEmpty, debounceMs, fetchResults]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (willFetch(value)) {
      setIsLoading(true);
    } else {
      setResults([]);
      setIsLoading(false);
    }
  };

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    openRef.current = nextOpen;
    setOpen(nextOpen);
    if (!nextOpen) {
      resetSearchState();
    }
  }, [resetSearchState]);

  const handleSelect = useCallback((item: T) => {
    onSelect(item);
    handleOpenChange(false);
  }, [handleOpenChange, onSelect]);

  const handleSelectFirstResult = useCallback(async () => {
    const firstResult = results[0];
    if (firstResult) {
      handleSelect(firstResult);
      return;
    }

    const query = search.trim();
    if (!willFetch(search)) return;

    setIsLoading(true);
    const items = await fetchResults(query);
    setResults(items);
    if (items[0]) {
      handleSelect(items[0]);
    } else {
      setIsLoading(false);
    }
  }, [fetchResults, handleSelect, results, search, willFetch]);

  const handleSearchKeyDown = useEnterKeySubmit<HTMLInputElement>({
    onSubmit: handleSelectFirstResult,
  });

  const handleTriggerMouseDown = (e: MouseEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;

    e.stopPropagation();
    setTriggerWidth(e.currentTarget.getBoundingClientRect().width);

    const nextOpen = !openRef.current;
    handleOpenChange(nextOpen);

    if (nextOpen && willFetch(search)) {
      setIsLoading(true);
      setResults([]);
    }

    e.preventDefault();
  };

  const handleTriggerClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
  };

  const handleTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowDown") return;

    e.preventDefault();
    setTriggerWidth(e.currentTarget.getBoundingClientRect().width);
    if (!open) {
      handleOpenChange(true);
    }
  };

  const hasQuery = search.trim().length > 0;
  const showEmpty = !isLoading && results.length === 0 && (hasQuery || searchOnEmpty);

  const triggerClasses = cn(VARIANT_TRIGGER_STYLES[variant], triggerClassName);
  const contentStyles = cn(
    "p-0 bg-popover border-border",
    VARIANT_CONTENT_STYLES[variant],
    contentClassName,
  );
  const contentStyle = {
    "--search-combobox-trigger-width": `${triggerWidth}px`,
  } as CSSProperties;

  const labelNode = renderTriggerLabel ? (
    renderTriggerLabel(displayValue)
  ) : (
    <span
      className={cn(
        "min-w-0 flex-1 truncate",
        isPlaceholder && "text-muted-foreground",
      )}
    >
      {displayValue}
    </span>
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverAnchor asChild>
        <button
          ref={triggerRef}
          id={id}
          type="button"
          className={triggerClasses}
          aria-expanded={open}
          aria-haspopup="listbox"
          onMouseDown={handleTriggerMouseDown}
          onClick={handleTriggerClick}
          onKeyDown={handleTriggerKeyDown}
        >
          {labelNode}
          <ChevronsUpDown className="size-3.5 text-muted-foreground shrink-0" />
        </button>
      </PopoverAnchor>
      <PopoverContent
        className={contentStyles}
        align={align}
        style={contentStyle}
        onPointerDownOutside={(event) => {
          if (triggerRef.current?.contains(event.target as Node)) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (triggerRef.current?.contains(event.target as Node)) {
            event.preventDefault();
          }
        }}
      >
        <div className="flex items-center border-b border-border px-3">
          <Search className="size-4 text-muted-foreground shrink-0" />
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="flex-1 px-2 py-2.5 text-sm bg-transparent focus:outline-none text-foreground placeholder:text-muted-foreground"
          />
        </div>

        <div className="max-h-[220px] overflow-y-auto p-1 empty:hidden">
          {isLoading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {loadingLabel}
            </div>
          ) : showEmpty ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {emptyLabel}
            </div>
          ) : (
            results.map((item) => {
              const key = getKey(item);
              const selected = key === selectedKey;
              return (
                <button
                  key={key}
                  type="button"
                  onMouseDown={() => handleSelect(item)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-2 text-sm rounded-xl text-left transition-colors",
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-secondary text-foreground",
                  )}
                >
                  <Check
                    className={cn(
                      "w-4 h-4 shrink-0",
                      selected ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{getLabel(item)}</span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
