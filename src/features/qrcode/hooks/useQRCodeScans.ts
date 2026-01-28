import { useState, useCallback, useEffect } from "react";
import { getScansForQRCode } from "@/features/qrcode/api/qrcode.api";
import type { QRCode } from "@/shared/types";

interface UseQRCodeScansOptions {
  qrCode: QRCode;
  isOpen: boolean;
}

/**
 * Hook for managing QR code scans
 */
export function useQRCodeScans({ qrCode, isOpen }: UseQRCodeScansOptions) {
  const [scans, setScans] = useState<QRCodeScan[]>([]);
  const [timeRange, setTimeRange] = useState<string>("30");

  const loadScans = useCallback(() => {
    const loadedScans = getScansForQRCode(qrCode.id);
    setScans(loadedScans);
  }, [qrCode.id]);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        loadScans();
      });
    }
  }, [isOpen, loadScans]);

  return {
    scans,
    timeRange,
    setTimeRange,
    loadScans,
  };
}
