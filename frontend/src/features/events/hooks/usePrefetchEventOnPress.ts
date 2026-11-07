"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { fetchEventById } from "@/features/events/api/events.api";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import { controlBox } from "@/shared/config/controlBox";
import { queryKeys } from "@/shared/lib/queryKeys";
import { preloadDrawer } from "@/shared/ui/drawer";

/** A touch that is still down after this long is a press, not the start of a scroll. */
const TOUCH_PRESS_DELAY_MS = 50;
/** A finger that moves this far is scrolling, so nothing is fetched. */
const TOUCH_MOVE_TOLERANCE_PX = 8;

/**
 * Start loading an event when its card is pressed rather than when the press ends.
 *
 * A tap or click opens the card on release, 100 to 300 ms after the finger or
 * button went down; fetching the details (and the drawer, and the event page's
 * route) from the press hides most of the wait for the server. A mouse press
 * prefetches at once; a touch waits a moment so a scroll that starts on a card
 * fetches nothing.
 */
export function usePrefetchEventOnPress(eventId: number) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const touch = useRef<{ timer: number; x: number; y: number } | null>(null);

  const prefetch = useCallback(() => {
    void queryClient.prefetchQuery({
      queryKey: queryKeys.events.detail(eventId),
      queryFn: () => fetchEventById(eventId),
      staleTime: controlBox.clientCache.liveEventDataStaleMs,
    });
    void preloadDrawer();
    router.prefetch(eventPagePath(eventId));
  }, [eventId, queryClient, router]);

  const cancelTouch = useCallback(() => {
    if (touch.current) window.clearTimeout(touch.current.timer);
    touch.current = null;
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch") {
        prefetch();
        return;
      }
      cancelTouch();
      touch.current = {
        timer: window.setTimeout(() => {
          touch.current = null;
          prefetch();
        }, TOUCH_PRESS_DELAY_MS),
        x: event.clientX,
        y: event.clientY,
      };
    },
    [cancelTouch, prefetch],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const start = touch.current;
      if (!start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TOUCH_MOVE_TOLERANCE_PX) cancelTouch();
    },
    [cancelTouch],
  );

  const onPointerUp = useCallback(() => {
    // A tap shorter than the delay is still a tap: fetch now, ahead of the click.
    if (touch.current) {
      cancelTouch();
      prefetch();
    }
  }, [cancelTouch, prefetch]);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: cancelTouch };
}
