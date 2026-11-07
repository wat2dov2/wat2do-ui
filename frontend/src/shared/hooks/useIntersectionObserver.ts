import { useEffect, useRef, useState } from "react";
import { MAIN_CONTENT_SCROLL_ROOT_SELECTOR } from "@/shared/constants/ui";

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
  const [hasIntersected, setHasIntersected] = useState(false);
  const elementRef = useRef<T>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !enabled) return;

    // Pages scroll inside the app's main scroll root, which clips its content:
    // measured against the window, `rootMargin` could never reach below it.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHasIntersected(true);
        }
      },
      { root: element.closest(MAIN_CONTENT_SCROLL_ROOT_SELECTOR), threshold, rootMargin }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [threshold, rootMargin, enabled]);

  return { ref: elementRef, hasIntersected };
}
