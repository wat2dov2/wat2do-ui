import { useReducer, useCallback, useEffect } from "react";
import { getScansFromBackend, normalizeBackendScan } from "@/features/qrcode/api/qrcode.api";
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
 * Hook for managing QR code scans. Loads scans from backend when modal is open.
 */
export function useQRCodeScans({ qrCode, isOpen }: UseQRCodeScansOptions) {
  const [state, dispatch] = useReducer(qrCodeScansReducer, initialState);

  const loadScans = useCallback(() => {
    getScansFromBackend(qrCode.id)
      .then((raw) => dispatch({ type: "SET_SCANS", payload: raw.map(normalizeBackendScan) }))
      .catch(() => dispatch({ type: "SET_SCANS", payload: [] }));
  }, [qrCode.id]);

  useEffect(() => {
    if (isOpen && qrCode.id) loadScans();
  }, [isOpen, qrCode.id, loadScans]);

  return {
    scans: state.scans,
    timeRange: state.timeRange,
    setTimeRange: (range: string) =>
      dispatch({ type: "SET_TIME_RANGE", payload: range }),
    loadScans,
  };
}
