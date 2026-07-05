import { useCallback, useRef, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";

const CARD_INTERACTIVE_SELECTOR =
  "button, a, [role='menuitem'], input, textarea, select, [data-no-card-activate]";

const MOBILE_GRID_CLICK_MEDIA = "(hover: none), (pointer: coarse), (max-width: 639px)";

type PressHandler = (event: ReactMouseEvent<HTMLElement>) => void;

interface MouseDownPressHandlersOptions {
  onMouseDown?: PressHandler;
  onClick?: PressHandler;
  disabled?: boolean;
  preferClick?: boolean;
}

/**
 * Touch/coarse pointers and sub-sm viewports use click instead of mousedown.
 */
export function prefersClickActivation() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: none), (pointer: coarse)").matches;
}

export function prefersMobileGridClickActivation() {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MOBILE_GRID_CLICK_MEDIA).matches;
}

export function useMobileGridClickActivation() {
  return useSyncExternalStore(
    (onStoreChange) => {
      const media = window.matchMedia(MOBILE_GRID_CLICK_MEDIA);
      media.addEventListener("change", onStoreChange);
      return () => media.removeEventListener("change", onStoreChange);
    },
    prefersMobileGridClickActivation,
    () => false,
  );
}

/**
 * Mousedown-first on desktop; native click on touch/coarse pointers or mobile width.
 */
export function createAdaptivePressHandlers({
  onMouseDown,
  onClick,
  disabled = false,
  preferClick = prefersClickActivation(),
}: MouseDownPressHandlersOptions) {
  if (preferClick) {
    const handleClick: PressHandler = (event) => {
      onMouseDown?.(event);
      if (event.defaultPrevented || event.button !== 0 || disabled) {
        return;
      }
      onClick?.(event);
    };

    return onClick || onMouseDown ? { onClick: handleClick } : {};
  }

  return createMouseDownPressHandlers({ onMouseDown, onClick, disabled });
}

/**
 * Stop propagation on mousedown (desktop) or click (touch/mobile width).
 */
export function createAdaptiveStopPropagationHandlers(
  preferClick = prefersClickActivation(),
) {
  const stop: PressHandler = (event) => {
    event.stopPropagation();
  };

  if (preferClick) {
    return { onClick: stop };
  }

  return { onMouseDown: stop };
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
