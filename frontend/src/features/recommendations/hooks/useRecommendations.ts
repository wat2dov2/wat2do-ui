import { useState, useEffect, useCallback, useRef } from "react";
import { DEFAULT_RECOMMENDATION_LIMIT } from "@/features/recommendations/constants";
import { getUserId } from "@/features/auth";
import { fetchRecommendations } from "../api/recommendationApi";
import type { RecommendationItem } from "../types";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CachedResult {
  data: RecommendationItem[];
  timestamp: number;
}

// Cache keyed by user ID and limit so different sessions or page sizes never
// reuse the wrong recommendation slice.
// "anonymous" key is used for logged-out popular recommendations.
const cacheByRequest = new Map<string, CachedResult>();
const inFlightByRequest = new Map<string, Promise<RecommendationItem[]>>();

function getCacheKey(limit: number): string {
  return `${getUserId() ?? "anonymous"}:${limit}`;
}

export function useRecommendations(limit = DEFAULT_RECOMMENDATION_LIMIT) {
  const cacheKey = getCacheKey(limit);
  const cached = cacheByRequest.get(cacheKey);

  const [recommendations, setRecommendations] = useState<RecommendationItem[]>(
    () => cached?.data ?? [],
  );
  const [isLoading, setIsLoading] = useState(!cached);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);
  const activeRequestKeyRef = useRef(cacheKey);

  const load = useCallback(
    (force = false) => {
      const key = getCacheKey(limit);
      activeRequestKeyRef.current = key;
      const entry = cacheByRequest.get(key);

      if (!force && entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
        setRecommendations(entry.data);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      let request = inFlightByRequest.get(key);
      if (!request) {
        request = fetchRecommendations(limit);
        inFlightByRequest.set(key, request);
        const cleanupRequest = () => {
          if (inFlightByRequest.get(key) === request) {
            inFlightByRequest.delete(key);
          }
        };
        request.then(cleanupRequest, cleanupRequest);
      }

      request
        .then((data) => {
          if (!mountedRef.current || activeRequestKeyRef.current !== key) return;
          cacheByRequest.set(key, { data, timestamp: Date.now() });
          setRecommendations(data);
          setError(null);
        })
        .catch((err) => {
          console.error("Failed to fetch recommendations:", err);
          if (!mountedRef.current || activeRequestKeyRef.current !== key) return;
          setError(err instanceof Error ? err : new Error(String(err)));
        })
        .finally(() => {
          if (mountedRef.current && activeRequestKeyRef.current === key) setIsLoading(false);
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
