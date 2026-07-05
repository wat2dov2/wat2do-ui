import { useCallback, useRef, type MouseEvent as ReactMouseEvent } from "react";

const CARD_INTERACTIVE_SELECTOR =
  "button, a, [role='menuitem'], input, textarea, select, [data-no-card-activate]";

type PressHandler = (event: ReactMouseEvent<HTMLElement>) => void;

interface MouseDownPressHandlersOptions {
  onMouseDown?: PressHandler;
  onClick?: PressHandler;
  disabled?: boolean;
}

/**
 * Standard press handlers for the app's mouse-down-first UI.
 * Runs `onClick` on left mouse down and swallows the trailing click.
 */
export function createMouseDownPressHandlers({
  onMouseDown,
  onClick,
  disabled = false,
}: MouseDownPressHandlersOptions) {
  const handleMouseDown: PressHandler = (event) => {
    onMouseDown?.(event);
    if (event.defaultPrevented || event.button !== 0 || disabled) {
      return;
    }
    onClick?.(event);
  };

  const handleClick: PressHandler = (event) => {
    if (onClick) {
      event.preventDefault();
    }
  };

  return {
    onMouseDown: handleMouseDown,
    ...(onClick ? { onClick: handleClick } : {}),
  };
}

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

/** Dedup mouse select from the trailing Radix `onSelect` event. */
export function useMouseSelectDedup() {
  const lastMouseSelectAt = useRef(0);

  const markMouseSelect = useCallback(() => {
    lastMouseSelectAt.current = Date.now();
  }, []);

  const shouldSkipSelect = useCallback(() => {
    return Date.now() - lastMouseSelectAt.current < 500;
  }, []);

  return { markMouseSelect, shouldSkipSelect };
}
