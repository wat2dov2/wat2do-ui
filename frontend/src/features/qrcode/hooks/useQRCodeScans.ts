import { useState, useCallback, useEffect } from "react";
import { getScansFromBackend } from "@/features/qrcode/api/qrcode.api";
import { normalizeBackendScan } from "@/shared/api/scans.api";
import type { QRCode, QRCodeScan } from "@/shared/types";

interface UseQRCodeScansOptions {
  qrCode: QRCode;
  isOpen: boolean;
}

/**
 * Hook for managing QR code scans. Loads scans from backend when modal is open.
 */
export function useQRCodeScans({ qrCode, isOpen }: UseQRCodeScansOptions) {
  const [scans, setScans] = useState<QRCodeScan[]>([]);
  const [timeRange, setTimeRange] = useState<string>("30");

  const loadScans = useCallback(() => {
    getScansFromBackend(qrCode.id)
      .then((raw) => setScans(raw.map(normalizeBackendScan)))
      .catch((err) => {
        console.error("Failed to load QR scans:", err);
        setScans([]);
      });
  }, [qrCode.id]);

  useEffect(() => {
    if (isOpen && qrCode.id) loadScans();
  }, [isOpen, qrCode.id, loadScans]);

  return {
    scans,
    timeRange,
    setTimeRange,
    loadScans,
  };
}
