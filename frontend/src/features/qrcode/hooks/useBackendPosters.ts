import { useState, useEffect } from "react";
import { listPostersFromBackend } from "@/features/qrcode/api/qrcode.api";
import type { QRCode } from "@/shared/types";

/**
 * Fetches posters from the backend (GET /qr/). Use for dashboard and admin.
 */
export function useBackendPosters(refreshKey?: number): {
  posters: QRCode[];
  loading: boolean;
  error: Error | null;
} {
  const [posters, setPosters] = useState<QRCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    listPostersFromBackend()
      .then((list) => {
        if (!cancelled) setPosters(list);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setPosters([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { posters, loading, error };
}
