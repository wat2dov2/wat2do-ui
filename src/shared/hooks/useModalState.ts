/**
 * Shared Modal State Hook
 * Reduces useState duplication across modals by providing common state management patterns
 */

import { useCallback, useRef, useEffect } from "react";

export interface UseModalStateOptions {
  onClose?: () => void;
  resetOnClose?: boolean;
  resetFn?: () => void;
}

export interface UseModalStateReturn {
  handleOpenChange: (open: boolean) => void;
  handleClose: () => void;
  reset: () => void;
}

/**
 * Hook for managing common modal state patterns
 * Handles open/close state and reset logic
 */
export function useModalState<T = void>(
  options: UseModalStateOptions = {}
): UseModalStateReturn {
  const { onClose, resetOnClose = true, resetFn } = options;
  const resetCallbackRef = useRef<(() => void) | null>(null);

  // Register reset function if provided
  useEffect(() => {
    if (resetFn) {
      resetCallbackRef.current = resetFn;
    }
  }, [resetFn]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        if (resetOnClose && resetCallbackRef.current) {
          resetCallbackRef.current();
        }
        onClose?.();
      }
    },
    [onClose, resetOnClose]
  );

  const handleClose = useCallback(() => {
    if (resetOnClose && resetCallbackRef.current) {
      resetCallbackRef.current();
    }
    onClose?.();
  }, [onClose, resetOnClose]);

  const reset = useCallback(() => {
    resetCallbackRef.current?.();
  }, []);

  return {
    handleOpenChange,
    handleClose,
    reset,
  };
}
