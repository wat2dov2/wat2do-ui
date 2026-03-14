import { useState, useEffect } from "react";
import {
  getScansFromBackend,
  normalizeBackendScan,
} from "@/features/qrcode/api/qrcode.api";
import type { QRCodeScan } from "@/shared/types";

/**
 * Fetches scans from the backend so that scans from any device (e.g. phone)
 * appear in the dashboard. Returns normalized QRCodeScan[] and loading state.
 */
export function useBackendScans(refreshKey?: number): {
  scans: QRCodeScan[];
  loading: boolean;
  error: Error | null;
} {
  const [scans, setScans] = useState<QRCodeScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getScansFromBackend()
      .then((raw) => {
        if (!cancelled) setScans(raw.map(normalizeBackendScan));
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setScans([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { scans, loading, error };
}
