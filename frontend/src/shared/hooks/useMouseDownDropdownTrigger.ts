import {
  cloneElement,
  isValidElement,
  useCallback,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
} from "react";

type TriggerElementProps = {
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  onMouseDown?: (event: MouseEvent<HTMLElement>) => void;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
};

interface UseMouseDownDropdownTriggerResult {
  open: boolean;
  setOpen: (open: boolean) => void;
  close: () => void;
  triggerChild: ReactElement;
}

/**
 * Controlled dropdown disclosure opened on mouse down, matching the app's
 * click-first card UX. Prevents Radix pointer-down toggling from fighting
 * custom trigger handlers on nested buttons.
 */
export function useMouseDownDropdownTrigger(
  child: ReactElement<TriggerElementProps>,
): UseMouseDownDropdownTriggerResult {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const toggle = useCallback(() => {
    setOpen((current) => !current);
  }, []);

  const triggerChild = isValidElement<TriggerElementProps>(child)
    ? cloneElement(child, {
        onPointerDown: (event: PointerEvent<HTMLElement>) => {
          event.preventDefault();
          child.props.onPointerDown?.(event);
        },
        onMouseDown: (event: MouseEvent<HTMLElement>) => {
          child.props.onMouseDown?.(event);
          if (event.button !== 0) {
            return;
          }
          toggle();
        },
        onClick: (event: MouseEvent<HTMLElement>) => {
          event.preventDefault();
          child.props.onClick?.(event);
        },
      })
    : child;

  return { open, setOpen, close, triggerChild };
}
