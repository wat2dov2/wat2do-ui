import { useState, useEffect, useCallback, useRef } from "react";
import { fetchRecommendations } from "../api/recommendationApi";
import type { RecommendationItem } from "../types";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CachedResult {
  data: RecommendationItem[];
  timestamp: number;
}

let cache: CachedResult | null = null;

/** Must match backend DEFAULT_LIMIT in services/recommender/config.py */
const DEFAULT_RECOMMENDATION_LIMIT = 20;

export function useRecommendations(limit = DEFAULT_RECOMMENDATION_LIMIT) {
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>(
    () => cache?.data ?? [],
  );
  const [isLoading, setIsLoading] = useState(!cache);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(
    (force = false) => {
      if (!force && cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
        setRecommendations(cache.data);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      fetchRecommendations(limit)
        .then((data) => {
          if (!mountedRef.current) return;
          cache = { data, timestamp: Date.now() };
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

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return { recommendations, isLoading, error, refresh };
}
