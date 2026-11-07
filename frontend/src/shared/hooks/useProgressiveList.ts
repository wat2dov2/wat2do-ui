import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAIN_CONTENT_SCROLL_ROOT_SELECTOR } from "@/shared/constants/ui";

/**
 * Keep all results available for local filtering, but mount only nearby cards.
 *
 * `resetKey` names the query the reader asked for (search, filters, sort). The list
 * returns to its first batch only when that changes: data arriving in the background
 * (a refetch, stats, an event ending) keeps every card already mounted, so the page
 * never shrinks under the reader and remounted cards never replay their entrance.
 * Without a key, any change to the result ids resets, as a plain filter would want.
 */
export function useProgressiveList<T extends { id: number }>(items: T[], batchSize: number, resetKey?: string) {
  const resultKey = useMemo(
    () => resetKey ?? items.map(item => item.id).join(","),
    [items, resetKey],
  );
  const [previousResultKey, setPreviousResultKey] = useState(resultKey);
  const [visibleCount, setVisibleCount] = useState(batchSize);
  // Reset before children mount so a filter edit never renders the old expanded list.
  if (previousResultKey !== resultKey) {
    setPreviousResultKey(resultKey);
    setVisibleCount(batchSize);
  }
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const hasMore = visibleCount < items.length;
  const loadMore = useCallback(() => {
    setVisibleCount(count => Math.min(count + batchSize, items.length));
  }, [batchSize, items.length]);
  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!hasMore || !sentinel || typeof IntersectionObserver === "undefined") return;
    // Measured against the main scroll root, so the next cards mount before the
    // reader reaches the end (the window's margin cannot see past that root).
    // Observing again after each batch re-checks a sentinel still in range.
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) loadMore();
    }, { root: sentinel.closest(MAIN_CONTENT_SCROLL_ROOT_SELECTOR), rootMargin: "400px", threshold: 0.1 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, visibleCount]);
  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  return { visibleItems, visibleCount, hasMore, loadMoreRef };
}
