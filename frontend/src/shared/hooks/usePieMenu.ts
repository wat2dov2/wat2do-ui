import { useState, useCallback } from "react";

export interface UsePieMenuReturn {
  isOpen: boolean;
  position: { x: number; y: number };
  open: (e: React.MouseEvent | MouseEvent) => void;
  close: () => void;
  toggle: (e: React.MouseEvent | MouseEvent) => void;
  triggerProps: {
    onMouseDown: (e: React.MouseEvent) => void;
  };
}

/**
 * Hook to manage pie menu state
 *
 * @example
 * ```tsx
 * const { isOpen, position, open, close, triggerProps } = usePieMenu();
 *
 * return (
 *   <>
 *     <button {...triggerProps}>Open Menu</button>
 *     <PieMenu
 *       items={items}
 *       isOpen={isOpen}
 *       position={position}
 *       onClose={close}
 *     />
 *   </>
 * );
 * ```
 */
export function usePieMenu(): UsePieMenuReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const open = useCallback((e: React.MouseEvent | MouseEvent) => {
    // Get position before any potential event modifications
    const x = e.clientX;
    const y = e.clientY;
    setPosition({ x, y });
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggle = useCallback((e: React.MouseEvent | MouseEvent) => {
    if (isOpen) {
      close();
    } else {
      open(e);
    }
  }, [isOpen, open, close]);

  const triggerProps = {
    onMouseDown: open,
  };

  return {
    isOpen,
    position,
    open,
    close,
    toggle,
    triggerProps,
  };
}

