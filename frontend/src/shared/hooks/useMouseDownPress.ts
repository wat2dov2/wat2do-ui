import { useCallback, type MouseEvent as ReactMouseEvent } from "react";

const CARD_INTERACTIVE_SELECTOR =
  "button, a, [role='menuitem'], input, textarea, select, [data-no-card-activate]";

/** Fire an action on left mouse down (used for chips, links, and filter controls). */
export function useMouseDownAction(action: () => void) {
  return useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }
      action();
    },
    [action],
  );
}

/** Open cards/drawers on mouse down while skipping footer actions and nested controls. */
export function useCardMouseDownActivate(
  onActivate: () => void,
  footerSelector: string,
) {
  return useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }
      if (!(event.target instanceof Element)) {
        return;
      }
      if (event.target.closest(footerSelector)) {
        return;
      }
      if (event.target.closest(CARD_INTERACTIVE_SELECTOR)) {
        return;
      }
      onActivate();
    },
    [footerSelector, onActivate],
  );
}
