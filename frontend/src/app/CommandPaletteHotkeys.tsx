/**
 * CommandPaletteHotkeys
 *
 * Registers the app's global keyboard shortcuts:
 *   Cmd/Ctrl+K  toggle the command palette
 *   /           focus the search input
 *   Escape      clear the search query
 *
 * Kept as a tiny sibling component (rather than inside a context provider) so
 * toggling the palette does not re-render any unrelated subtree. This is the
 * only global `keydown` listener - add shortcuts here rather than registering
 * another document-level handler elsewhere.
 */

import { useEffect } from "react";
import { useUIStore } from "@/shared/store/ui.store";
import { useSearchStore } from "@/features/search/store/search.store";
import { storeStatesToFilterState } from "@/features/search/api/filterService";
import { focusSearchInput } from "@/shared/utils/searchInput";

/**
 * Whether the keystroke landed in a field the user is typing into. Printable
 * shortcuts must stay inert there, or "/" becomes unusable in any text field.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

/**
 * Whether a modal surface is currently open. Radix and vaul both mark their
 * open dialogs, drawers, and menus with `data-state="open"`.
 */
function hasOpenOverlay(): boolean {
  return Boolean(
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="menu"][data-state="open"]',
    ),
  );
}

export function CommandPaletteHotkeys() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        const { showCommandPalette, setShowCommandPalette } = useUIStore.getState();
        setShowCommandPalette(!showCommandPalette);
        return;
      }

      // Escape clears the query from anywhere on the page, including the
      // search field itself, so it doubles as "get me out of this search".
      // An open overlay owns Escape first - clearing the feed behind a drawer
      // the user is only dismissing would be invisible and destructive.
      if (e.key === "Escape") {
        if (useUIStore.getState().showCommandPalette || hasOpenOverlay()) return;

        const state = useSearchStore.getState();
        if (!state.searchQuery) return;
        state.setFilterState({
          ...storeStatesToFilterState(state),
          searchQuery: "",
        });
        return;
      }

      // Bare "/" only - modified presses belong to the browser.
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isTypingTarget(e.target)) return;
        // Only swallow the keystroke once a search input actually took focus.
        if (focusSearchInput()) {
          e.preventDefault();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return null;
}
