import { useState, useEffect } from "react";

/**
 * Generic fetch hook that deduplicates the loading/error/data pattern
 * used by backend query hooks.
 */
export function useBackendQuery<T>(
  fetchFn: () => Promise<T>,
  initialValue: T,
  refreshKey?: number,
): { data: T; loading: boolean; error: Error | null } {
  const [data, setData] = useState<T>(initialValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchFn()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        console.error("useBackendQuery fetch failed:", err);
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setData(initialValue);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return { data, loading, error };
}
