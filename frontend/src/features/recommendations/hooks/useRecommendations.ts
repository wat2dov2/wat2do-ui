import { useState, useEffect, useCallback, useRef } from "react";
import { DEFAULT_RECOMMENDATION_LIMIT } from "@/shared/constants/pagination";
import { getUserId } from "@/features/auth";
import { fetchRecommendations } from "../api/recommendationApi";
import type { RecommendationItem } from "../types";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CachedResult {
  data: RecommendationItem[];
  timestamp: number;
}

// Cache keyed by user ID so different users (or logged-out -> logged-in
// transitions) never see stale recommendations from another session.
// "anonymous" key is used for logged-out popular recommendations.
const cacheByUser = new Map<string, CachedResult>();
const inFlightByUser = new Map<string, Promise<RecommendationItem[]>>();

function getCacheKey(): string {
  return getUserId() ?? "anonymous";
}

export function useRecommendations(limit = DEFAULT_RECOMMENDATION_LIMIT) {
  const cacheKey = getCacheKey();
  const cached = cacheByUser.get(cacheKey);

  const [recommendations, setRecommendations] = useState<RecommendationItem[]>(
    () => cached?.data ?? [],
  );
  const [isLoading, setIsLoading] = useState(!cached);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(
    (force = false) => {
      const key = getCacheKey();
      const entry = cacheByUser.get(key);

      if (!force && entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
        setRecommendations(entry.data);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      let request = inFlightByUser.get(key);
      if (!request) {
        request = fetchRecommendations(limit);
        inFlightByUser.set(key, request);
        request.finally(() => {
          if (inFlightByUser.get(key) === request) {
            inFlightByUser.delete(key);
          }
        });
      }

      request
        .then((data) => {
          if (!mountedRef.current) return;
          cacheByUser.set(key, { data, timestamp: Date.now() });
          setRecommendations(data);
          setError(null);
        })
        .catch((err) => {
          console.error("Failed to fetch recommendations:", err);
          if (!mountedRef.current) return;
          setError(err instanceof Error ? err : new Error(String(err)));
        })
        .finally(() => {
          if (mountedRef.current) setIsLoading(false);
        });
    },
    [limit],
  );

  // Re-fetch when user identity changes (login/logout)
  useEffect(() => {
    mountedRef.current = true;
    const task = window.setTimeout(() => load(), 600);
    return () => {
      window.clearTimeout(task);
      mountedRef.current = false;
    };
  }, [load, cacheKey]);

  const refresh = useCallback(() => load(true), [load]);

  return { recommendations, isLoading, error, refresh };
}
