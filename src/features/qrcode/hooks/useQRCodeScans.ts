import { useReducer, useCallback } from "react";
import { getScansForQRCode } from "@/features/qrcode/api/qrcode.api";
import type { QRCode } from "@/shared/types";
import {
  qrCodeScansReducer,
  initialState,
} from "@/features/qrcode/hooks/useQRCodeScans.reducer";

interface UseQRCodeScansOptions {
  qrCode: QRCode;
  isOpen: boolean;
}

/**
 * Hook for managing QR code scans
 * Refactored to use useReducer instead of useState
 * Scans loaded synchronously when isOpen is true (derived from props)
 */
export function useQRCodeScans({ qrCode, isOpen }: UseQRCodeScansOptions) {
  // Load scans synchronously when modal is open (derived state, no useEffect)
  const initialScans = isOpen ? getScansForQRCode(qrCode.id) : [];
  
  const [state, dispatch] = useReducer(qrCodeScansReducer, {
    ...initialState,
    scans: initialScans,
  });

  const loadScans = useCallback(() => {
    const loadedScans = getScansForQRCode(qrCode.id);
    dispatch({ type: "SET_SCANS", payload: loadedScans });
  }, [qrCode.id]);

  return {
    scans: state.scans,
    timeRange: state.timeRange,
    setTimeRange: (range: string) =>
      dispatch({ type: "SET_TIME_RANGE", payload: range }),
    loadScans,
  };
}
