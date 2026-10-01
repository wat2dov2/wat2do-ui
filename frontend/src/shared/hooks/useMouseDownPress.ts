import { useCallback, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";
import { COARSE_POINTER_MEDIA } from "@/shared/hooks/useCoarsePointer";

const CLICK_ACTIVATION_MEDIA = `${COARSE_POINTER_MEDIA}, (max-width: 639px)`;

const CARD_INTERACTIVE_SELECTOR =
  "button, a, [role='menuitem'], input, textarea, select, [data-no-card-activate]";


type PressHandler = (event: ReactMouseEvent<HTMLElement>) => void;

interface MouseDownPressHandlersOptions {
  onMouseDown?: PressHandler;
  onClick?: PressHandler;
  disabled?: boolean;
  preferClick?: boolean;
  /** Delegate to the element for links, form buttons and Radix controls. */
  nativeActivation?: boolean;
}

/** Mobile widths and touch use click so scrolling never activates a control. */
function prefersClickActivation() {
  return typeof window !== "undefined" && window.matchMedia(CLICK_ACTIVATION_MEDIA).matches;
}

const serverClickActivation = () => false;
function subscribeToClickActivation(listener: () => void) {
  const media = window.matchMedia(CLICK_ACTIVATION_MEDIA);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

export function useMobileClickActivation() {
  return useSyncExternalStore(subscribeToClickActivation, prefersClickActivation, serverClickActivation);
}

/**
 * Mousedown-first on desktop; native click on mobile widths and touch/coarse pointers.
 */
export function createAdaptivePressHandlers({
  onMouseDown,
  onClick,
  disabled = false,
  preferClick = prefersClickActivation(),
  nativeActivation = false,
}: MouseDownPressHandlersOptions) {
  if (preferClick) {
    const handleClick: PressHandler = (event) => {
      if (disabled || event.button !== 0) {
        return;
      }
      onMouseDown?.(event);
      onClick?.(event);
    };

    return onClick || onMouseDown ? { onClick: handleClick } : {};
  }

  return createMouseDownPressHandlers({ onMouseDown, onClick, disabled, nativeActivation });
}

/**
 * Standard press handlers for the app's mouse-down-first UI.
 * Runs `onClick` on left mouse down and swallows the trailing click.
 */
function createMouseDownPressHandlers({
  onMouseDown,
  onClick,
  disabled = false,
  nativeActivation = false,
}: MouseDownPressHandlersOptions) {
  const handleMouseDown: PressHandler = (event) => {
    if (event.currentTarget?.closest?.('[data-activation="click"]')) return;
    if (nativeActivation && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
    if (disabled || event.button !== 0) return;
    onMouseDown?.(event);
    if (event.defaultPrevented) {
      return;
    }
    if (nativeActivation) {
      if (event.currentTarget.getAttribute("role") === "option") {
        event.currentTarget.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      } else {
        event.currentTarget.click();
      }
    } else {
      onClick?.(event);
    }
  };

  const handleClick: PressHandler = (event) => {
    if (disabled) { event.preventDefault(); return; }
    if (event.currentTarget?.closest?.('[data-activation="click"]') ||
        (nativeActivation && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey))) {
      onClick?.(event);
      return;
    }
    if (event.detail === 0 && event.button === 0 && !event.defaultPrevented) {
      onClick?.(event);
      if (!onClick && !nativeActivation) onMouseDown?.(event);
      if (nativeActivation) return;
    }
    event.preventDefault();
  };

  return {
    onMouseDown: handleMouseDown,
    onClick: handleClick,
  };
}

/** Open cards/drawers on mouse down while skipping footer actions and nested controls. */
export function useCardMouseDownActivate(
  onActivate: () => void,
  footerSelector?: string,
) {
  return useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }
      if (!(event.target instanceof Element)) {
        return;
      }
      if (footerSelector && event.target.closest(footerSelector)) {
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
