import { useId, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { createAdaptivePressHandlers, useMobileClickActivation } from "@/shared/hooks/useMouseDownPress";
import { Input } from "@/shared/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/shared/ui/popover";

export type InputSuggestionKey = string | number;

export interface InputSuggestion {
  key: InputSuggestionKey;
  content: ReactNode;
}

export interface InputSuggestions {
  /** Matches for what is typed, best first; the list hides while it is empty. */
  items: readonly InputSuggestion[];
  onSelect: (key: InputSuggestionKey) => void;
  /** Names the list for screen readers. */
  label: string;
}

type SuggestionInputProps = Omit<ComponentProps<typeof Input>, "role" | "autoComplete"> & {
  suggestions: InputSuggestions;
};

/**
 * A text input with a dropdown of suggestions under it (an ARIA combobox):
 * typing opens it, arrows move through it, Enter or a click picks one and
 * Escape closes it. Anything else typed stays as typed.
 */
export function SuggestionInput({ suggestions, onChange, onKeyDown, ...props }: SuggestionInputProps) {
  const [listOpen, setListOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const mobileClickActivation = useMobileClickActivation();
  const listId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const { items, onSelect, label } = suggestions;
  const open = listOpen && items.length > 0;
  const active = Math.min(activeIndex, items.length - 1);

  const select = (key: InputSuggestionKey) => {
    setListOpen(false);
    onSelect(key);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setListOpen(true);
        setActiveIndex(0);
        return;
      }
      setActiveIndex(Math.max(0, Math.min(items.length - 1, active + (event.key === "ArrowDown" ? 1 : -1))));
    } else if (event.key === "Enter" && open) {
      // Picks the highlighted suggestion instead of submitting the form.
      event.preventDefault();
      select(items[active].key);
    }
  };

  return (
    <Popover open={open} onOpenChange={setListOpen}>
      <PopoverAnchor asChild>
        <div ref={anchorRef}>
          <Input
            {...props}
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={open ? `${listId}-${active}` : undefined}
            onChange={(event) => {
              setListOpen(true);
              setActiveIndex(0);
              onChange?.(event);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-64 bg-surface-elevated p-1"
        // Focus stays in the input, so typing goes on while the list is open.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node)) event.preventDefault();
        }}
      >
        <div id={listId} role="listbox" aria-label={label} className="max-h-[280px] overflow-y-auto">
          {items.map((item, index) => (
            <div
              key={item.key}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              data-active={index === active}
              {...createAdaptivePressHandlers({
                preferClick: mobileClickActivation,
                onMouseDown: (event) => {
                  // Keeps focus in the input.
                  event.preventDefault();
                  select(item.key);
                },
              })}
              onPointerMove={() => setActiveIndex(index)}
              className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 text-left text-sm text-foreground data-[active=true]:bg-surface-hover"
            >
              {item.content}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
