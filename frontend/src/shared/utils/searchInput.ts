import { SEARCH_INPUT_SELECTOR } from "@/shared/constants/ui";

/**
 * Focus the page's search input.
 *
 * The command palette's "Search events" item and the global "/" hotkey both
 * hand focus to the same input, so the lookup lives here rather than being
 * repeated at each call site.
 */
export function focusSearchInput(): boolean {
  const input = document.querySelector<HTMLInputElement>(SEARCH_INPUT_SELECTOR);
  if (!input) return false;

  input.focus();
  // Land the caret at the end so typing appends to an existing query.
  input.setSelectionRange(input.value.length, input.value.length);
  return true;
}
