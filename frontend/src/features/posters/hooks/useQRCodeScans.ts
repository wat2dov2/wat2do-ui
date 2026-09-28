import { useState } from "react";
import { useBackendScans } from "@/features/posters/hooks/useBackendScans";
import type { QRCode } from "@/features/posters/types";

interface UseQRCodeScansOptions {
  qrCode: QRCode;
  isOpen: boolean;
}

/** Load QR scans while the details modal is open. */
export function useQRCodeScans({ qrCode, isOpen }: UseQRCodeScansOptions) {
  const scans = useBackendScans({ posterId: qrCode.id, enabled: isOpen });
  const [timeRange, setTimeRange] = useState<string>("30");

  return {
    ...scans,
    timeRange,
    setTimeRange,
  };
}
