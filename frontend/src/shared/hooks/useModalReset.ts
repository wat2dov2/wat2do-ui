import { useEffect } from "react";

interface UseModalResetOptions<T> {
  isOpen: boolean;
  initialData?: T;
  isEditMode?: boolean;
  resetFn: (isEditMode: boolean, initialData?: T) => void;
  dependencies?: React.DependencyList; // Additional dependencies to watch
  resetOnOpen?: boolean; // Reset when opening (default: true)
  resetOnClose?: boolean; // Reset when closing (default: false)
}

/**
 * Hook for resetting modal state when opening/closing
 * Handles requestAnimationFrame pattern to avoid setState warnings
 */
export function useModalReset<T>({
  isOpen,
  initialData,
  isEditMode = false,
  resetFn,
  dependencies = [],
  resetOnOpen = true,
  resetOnClose = false,
}: UseModalResetOptions<T>) {
  useEffect(() => {
    if (!isOpen && resetOnClose) {
      // Reset when closing
      requestAnimationFrame(() => {
        resetFn(false, undefined);
      });
      return;
    }

    if (isOpen && resetOnOpen) {
      // Reset when opening (for edit mode, this will use initialData)
      requestAnimationFrame(() => {
        resetFn(isEditMode, initialData);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isEditMode, initialData, resetOnOpen, resetOnClose, ...dependencies]);
}
