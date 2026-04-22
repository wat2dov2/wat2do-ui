/**
 * Shared Modal State Hook
 *
 * Standardizes the `handleOpenChange` / `handleClose` callback pair that
 * every Radix-backed modal needs. On close, optionally runs a caller-supplied
 * `resetFn` before invoking `onClose`.
 */

export interface UseModalStateOptions {
  onClose?: () => void;
  resetOnClose?: boolean;
  resetFn?: () => void;
}

export interface UseModalStateReturn {
  handleOpenChange: (open: boolean) => void;
  handleClose: () => void;
}

export function useModalState(options: UseModalStateOptions = {}): UseModalStateReturn {
  const { onClose, resetOnClose = true, resetFn } = options;

  const runCloseLogic = () => {
    if (resetOnClose) resetFn?.();
    onClose?.();
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) runCloseLogic();
  };

  const handleClose = () => {
    runCloseLogic();
  };

  return { handleOpenChange, handleClose };
}
