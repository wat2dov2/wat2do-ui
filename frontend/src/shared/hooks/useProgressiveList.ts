import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Keep all results available for local filtering, but mount only nearby cards. */
export function useProgressiveList<T extends { id: number }>(items: T[], batchSize: number) {
  const resultKey = useMemo(() => items.map(item => item.id).join(","), [items]);
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
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) loadMore();
    }, { rootMargin: "400px", threshold: 0.1 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);
  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  return { visibleItems, visibleCount, hasMore, loadMoreRef };
}
