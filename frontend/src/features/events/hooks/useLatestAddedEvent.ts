import { useState, useEffect } from "react";
import { fetchLatestAddedEvent, type LatestAddedEvent } from "@/features/events/api/events.api";

/**
 * Fetches the most recently added event from the server for "X added 22 minutes ago" text.
 */
export function useLatestAddedEvent() {
  const [latest, setLatest] = useState<LatestAddedEvent | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetchLatestAddedEvent()
      .then((data) => {
        if (!cancelled && data) setLatest(data);
      })
      .catch((err) => console.error("Failed to fetch latest added event:", err))
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { latest, isLoading };
}
