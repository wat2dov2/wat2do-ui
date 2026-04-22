import { useRef, useEffect } from "react";
import { tracker } from "@/shared/services/trackingService";

/**
 * Tracks when an element becomes visible in the viewport (view impression).
 * Fires once per mount, then disconnects the observer.
 */
export function useViewTracking(eventId: number) {
  const cardRef = useRef<HTMLElement>(null);
  const trackedRef = useRef(false);

  useEffect(() => {
    const el = cardRef.current;
    if (!el || trackedRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !trackedRef.current) {
          trackedRef.current = true;
          tracker.track(eventId, "view");
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [eventId]);

  return cardRef;
}
