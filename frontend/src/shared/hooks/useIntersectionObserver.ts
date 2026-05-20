import { useEffect, useRef, useState } from "react";

interface UseIntersectionObserverOptions {
  threshold?: number;
  rootMargin?: string;
  enabled?: boolean;
}

export function useIntersectionObserver<T extends HTMLElement = HTMLDivElement>({
  threshold = 0,
  rootMargin = "0px",
  enabled = true,
}: UseIntersectionObserverOptions = {}) {
  const [isIntersecting, setIsIntersecting] = useState(false);
  const [hasIntersected, setHasIntersected] = useState(false);
  const elementRef = useRef<T>(null);
  // Mirror hasIntersected into a ref so the effect can read it without
  // re-subscribing when the state flips.
  const hasIntersectedRef = useRef(hasIntersected);

  useEffect(() => {
    hasIntersectedRef.current = hasIntersected;
  }, [hasIntersected]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !enabled) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const isElementIntersecting = entry.isIntersecting;
        setIsIntersecting(isElementIntersecting);
        if (isElementIntersecting && !hasIntersectedRef.current) {
          setHasIntersected(true);
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
    // hasIntersected is intentionally read via ref to avoid observer churn.
  }, [threshold, rootMargin, enabled]);

  return { ref: elementRef, isIntersecting, hasIntersected };
}
