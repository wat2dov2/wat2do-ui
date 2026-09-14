import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Check, Search } from "@/shared/ui/doodle-icons";
import { OUTLINE_CONTROL_STYLES } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import { useEnterKeySubmit } from "@/shared/hooks";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/shared/ui/popover";

export type SearchComboboxVariant = "nav" | "field";
type SearchComboboxKey = string | number;

export interface SearchComboboxProps<T> {
  /** Key of the currently selected item, compared against getKey for the check mark. */
  selectedKey: SearchComboboxKey;
  onSelect: (item: T) => void;
  /** Complete in-memory option list. */
  items: readonly T[];
  getKey: (item: T) => SearchComboboxKey;
  getLabel: (item: T) => string;
  /** Additional client-side search terms beyond the item label and key. */
  getSearchTerms?: (item: T) => readonly string[];
  /** Text shown on the trigger button (selected label or placeholder). */
  displayValue: string;
  /** Optional catch-all choice pinned before filtered results when it matches the query. */
  allOption?: T;
  /** Style the trigger text as a placeholder. */
  isPlaceholder?: boolean;
  /** Wrap the trigger label (e.g. with a highlighter). Defaults to a plain truncating span. */
  renderTriggerLabel?: (label: string) => ReactNode;
  variant?: SearchComboboxVariant;
  align?: "start" | "center" | "end";
  id?: string;
  searchPlaceholder: string;
  emptyLabel: string;
  contentClassName?: string;
  triggerClassName?: string;
}

const VARIANT_TRIGGER_STYLES: Record<SearchComboboxVariant, string> = {
  nav: "flex h-8 min-w-0 items-center gap-1 overflow-hidden rounded-xl bg-transparent px-3 text-sm text-foreground transition-colors hover:bg-surface-hover",
  field: cn(
    OUTLINE_CONTROL_STYLES,
    "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-base transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:bg-muted disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
  ),
};

const VARIANT_CONTENT_STYLES: Record<SearchComboboxVariant, string> = {
  nav: "w-[280px]",
  field: "w-[var(--search-combobox-trigger-width)] min-w-[280px]",
};

/**
 * Generic client-side search-and-select combobox: a popover with a search
 * input and a scrollable result list. The single source of truth for static
 * school and club pickers.
 */
export function SearchCombobox<T>({
  selectedKey,
  onSelect,
  items,
  getKey,
  getLabel,
  getSearchTerms,
  displayValue,
  allOption,
  isPlaceholder = false,
  renderTriggerLabel,
  variant = "field",
  align = "start",
  id,
  searchPlaceholder,
  emptyLabel,
  contentClassName,
  triggerClassName,
}: SearchComboboxProps<T>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const resultsRef = useRef<HTMLDivElement>(null);
  const [triggerWidth, setTriggerWidth] = useState(280);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const displayedResults = useMemo(() => {
    const normalizedQuery = search.trim().toLocaleLowerCase();
    const matchesQuery = (item: T) => {
      if (!normalizedQuery) return true;

      const terms = getSearchTerms?.(item) ?? [
        getLabel(item),
        String(getKey(item)),
      ];
      return terms.some((term) =>
        term.toLocaleLowerCase().includes(normalizedQuery),
      );
    };
    const matchingItems = items.filter(matchesQuery);

    if (allOption === undefined || !matchesQuery(allOption)) {
      return matchingItems;
    }

    const allKey = getKey(allOption);
    return [
      allOption,
      ...matchingItems.filter((item) => getKey(item) !== allKey),
    ];
  }, [allOption, getKey, getLabel, getSearchTerms, items, search]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen && triggerRef.current) setTriggerWidth(triggerRef.current.getBoundingClientRect().width);
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearch("");
      setActiveIndex(0);
    }
  }, []);

  const handleSelect = useCallback((item: T) => {
    onSelect(item);
    handleOpenChange(false);
  }, [handleOpenChange, onSelect]);

  const handleSelectActiveResult = useCallback(() => {
    const firstResult = displayedResults[Math.min(activeIndex, displayedResults.length - 1)];
    if (firstResult !== undefined) {
      handleSelect(firstResult);
    }
  }, [activeIndex, displayedResults, handleSelect]);

  const handleSearchEnter = useEnterKeySubmit<HTMLInputElement>({
    onSubmit: handleSelectActiveResult,
  });

  useEffect(() => {
    resultsRef.current?.querySelector(`[data-active="true"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, Math.min(displayedResults.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
    } else {
      handleSearchEnter(event);
    }
  };

  const handleTriggerMouseDown = (e: MouseEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;

    e.stopPropagation();
    setTriggerWidth(e.currentTarget.getBoundingClientRect().width);

    handleOpenChange(true);

    e.preventDefault();
  };

  const handleTriggerClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
  };

  const handleTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) return;

    e.preventDefault();
    setTriggerWidth(e.currentTarget.getBoundingClientRect().width);
    if (!open) {
      handleOpenChange(true);
    }
  };

  const showEmpty = displayedResults.length === 0;

  const triggerClasses = cn(VARIANT_TRIGGER_STYLES[variant], triggerClassName);
  const contentStyles = cn(
    "p-0 bg-surface-elevated border-border",
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
          data-elevation={variant === "field" ? "control" : undefined}
          className={triggerClasses}
          aria-expanded={open}
          aria-haspopup="listbox"
          onMouseDown={handleTriggerMouseDown}
          onClick={handleTriggerClick}
          onKeyDown={handleTriggerKeyDown}
        >
          {labelNode}
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
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={displayedResults.length ? `${listId}-${Math.min(activeIndex, displayedResults.length - 1)}` : undefined}
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setActiveIndex(0); }}
            onKeyDown={handleSearchKeyDown}
            className="flex-1 px-2 py-2.5 text-sm bg-transparent focus:outline-none text-foreground placeholder:text-muted-foreground"
          />
        </div>

        <div ref={resultsRef} id={listId} role="listbox" aria-label={searchPlaceholder} className="max-h-[220px] overflow-y-auto p-1 empty:hidden">
          {showEmpty ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {emptyLabel}
            </div>
          ) : (
            displayedResults.map((item, index) => {
              const key = getKey(item);
              const selected = key === selectedKey;
              return (
                <button
                  key={key}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={selected}
                  data-active={index === activeIndex}
                  tabIndex={-1}
                  type="button"
                  onClick={() => handleSelect(item)}
                  onPointerMove={() => setActiveIndex(index)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-2 text-sm rounded-xl text-left transition-colors",
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-surface-hover data-[active=true]:bg-surface-hover",
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
