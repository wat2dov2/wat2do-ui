import { useReducer, useCallback } from "react";
import type { QRCode } from "@/shared/types";
import { qrCodeEditReducer } from "@/features/qrcode/hooks/useQRCodeEditForm.reducer";

interface UseQRCodeEditFormOptions {
  qrCode: QRCode;
  isOpen: boolean;
}

/**
 * Hook for managing QR code edit form state
 */
export function useQRCodeEditForm({ qrCode, isOpen }: UseQRCodeEditFormOptions) {
  const initialState = {
    isEditing: false,
    editedName: qrCode.name,
    editedDescription: qrCode.description || "",
  };

  const [state, dispatch] = useReducer(qrCodeEditReducer, initialState);

  // Reset function - can be called when modal opens
  const reset = useCallback(() => {
    dispatch({
      type: "RESET",
      payload: {
        name: qrCode.name,
        description: qrCode.description || "",
      },
    });
  }, [qrCode.name, qrCode.description]);

  return {
    ...state,
    dispatch,
    reset,
  };
}
