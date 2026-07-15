import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";

const DEFAULT_SCROLL_END_TOLERANCE_PX = 8;
const DRAG_THRESHOLD_PX = 4;

interface UseHorizontalScrollFadeOptions {
  endTolerancePx?: number;
  refreshKey?: unknown;
}

export function useHorizontalScrollFade<T extends HTMLElement = HTMLDivElement>({
  endTolerancePx = DEFAULT_SCROLL_END_TOLERANCE_PX,
  refreshKey,
}: UseHorizontalScrollFadeOptions = {}) {
  const scrollRef = useRef<T>(null);
  const scrollEndRef = useRef<HTMLSpanElement>(null);
  const [showScrollFade, setShowScrollFade] = useState(false);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
    dragged: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const syncScrollFade = useCallback(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const overflowDistance = scrollEl.scrollWidth - scrollEl.clientWidth;
    const distanceFromEnd = overflowDistance - scrollEl.scrollLeft;

    setShowScrollFade(
      overflowDistance > endTolerancePx && distanceFromEnd > endTolerancePx,
    );
  }, [endTolerancePx]);

  const syncScrollFadeAfterWheel = useCallback(() => {
    if (typeof window === "undefined") return;
    window.setTimeout(syncScrollFade, 0);
  }, [syncScrollFade]);

  const handlePointerDown = useCallback((event: PointerEvent<T>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: event.currentTarget.scrollLeft,
      dragged: false,
    };
  }, []);

  const handlePointerMove = useCallback(
    (event: PointerEvent<T>) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      const deltaX = event.clientX - dragState.startX;
      if (!dragState.dragged && Math.abs(deltaX) < DRAG_THRESHOLD_PX) return;

      if (!dragState.dragged) {
        dragState.dragged = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }

      event.preventDefault();
      event.currentTarget.scrollLeft = dragState.startScrollLeft - deltaX;
      syncScrollFade();
    },
    [syncScrollFade],
  );

  const finishPointerDrag = useCallback((event: PointerEvent<T>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (dragState.dragged) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    dragStateRef.current = null;
  }, []);

  const handleClickCapture = useCallback((event: MouseEvent<T>) => {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;

    const scrollEl = scrollRef.current;
    const scrollEndEl = scrollEndRef.current;
    if (!scrollEl) return;

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(syncScrollFade);
    const intersectionObserver =
      typeof IntersectionObserver === "undefined" || !scrollEndEl
        ? null
        : new IntersectionObserver(
            ([entry]) => {
              const overflowDistance = scrollEl.scrollWidth - scrollEl.clientWidth;
              setShowScrollFade(
                overflowDistance > endTolerancePx && !entry.isIntersecting,
              );
            },
            {
              root: scrollEl,
              rootMargin: `0px ${endTolerancePx}px 0px 0px`,
              threshold: 1,
            },
          );

    const initialSyncId = window.setTimeout(syncScrollFade, 0);
    scrollEl.addEventListener("scroll", syncScrollFade, { passive: true });
    scrollEl.addEventListener("scrollend", syncScrollFade);
    window.addEventListener("resize", syncScrollFade);
    resizeObserver?.observe(scrollEl);
    Array.from(scrollEl.children).forEach((child) => resizeObserver?.observe(child));
    if (scrollEndEl) {
      intersectionObserver?.observe(scrollEndEl);
    }

    return () => {
      window.clearTimeout(initialSyncId);
      scrollEl.removeEventListener("scroll", syncScrollFade);
      scrollEl.removeEventListener("scrollend", syncScrollFade);
      window.removeEventListener("resize", syncScrollFade);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
    };
  }, [endTolerancePx, refreshKey, syncScrollFade]);

  return {
    scrollRef,
    scrollEndRef,
    showScrollFade,
    syncScrollFade,
    syncScrollFadeAfterWheel,
    dragScrollProps: {
      onClickCapture: handleClickCapture,
      onPointerCancel: finishPointerDrag,
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: finishPointerDrag,
    },
  };
}
