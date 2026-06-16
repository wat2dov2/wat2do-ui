import { useRef, useEffect } from "react";
import { tracker } from "@/shared/services/trackingService";

// Map of elements to their tracking callbacks.
const callbacks = new WeakMap<Element, () => void>();

let sharedObserver: IntersectionObserver | null = null;

function getSharedObserver() {
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const callback = callbacks.get(entry.target);
            if (callback) {
              callback();
              // Once tracked, we unobserve and delete the callback.
              callbacks.delete(entry.target);
              sharedObserver?.unobserve(entry.target);
            }
          }
        });
      },
      { threshold: 0.5 }
    );
  }
  return sharedObserver;
}

/**
 * Tracks when an element becomes visible in the viewport (view impression).
 * Fires once per mount, then unobserves.
 */
export function useViewTracking(eventId: number) {
  const cardRef = useRef<HTMLElement>(null);
  const trackedRef = useRef(false);

  useEffect(() => {
    const el = cardRef.current;
    if (!el || trackedRef.current) return;

    const observer = getSharedObserver();

    const trackFn = () => {
      if (!trackedRef.current) {
        trackedRef.current = true;
        tracker.track(eventId, "view");
      }
    };

    callbacks.set(el, trackFn);
    observer.observe(el);

    return () => {
      callbacks.delete(el);
      observer.unobserve(el);
    };
  }, [eventId]);

  return cardRef;
}

