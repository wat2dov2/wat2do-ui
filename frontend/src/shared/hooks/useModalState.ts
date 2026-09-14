/** Reset optional form state before notifying the modal owner. */
interface UseModalStateOptions {
  onClose?: () => void;
  resetFn?: () => void;
}

export function useModalState({ onClose, resetFn }: UseModalStateOptions = {}) {
  const handleClose = () => {
    resetFn?.();
    onClose?.();
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) handleClose();
  };

  return { handleOpenChange, handleClose };
}
