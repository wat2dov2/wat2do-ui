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

/** A drag past either end of the row gives this many pixels before the row starts to stretch. */
const STRETCH_SLACK_PX = 12;
/** However far it is pulled, the row stretches toward this many pixels and never reaches them. */
const STRETCH_LIMIT_PX = 64;
/** The pull beyond the slack that stretches the row halfway to its limit. */
const STRETCH_HALF_PULL_PX = 150;
/** Only the drag's last moments set the speed it lets go at; a pointer held still lets go at rest. */
const RELEASE_SPEED_WINDOW_MS = 100;
/**
 * The stretched row springs back critically damped (no bounce), settling in
 * about half a second when let go still.
 */
const SPRING_RATE_PER_SECOND = 18.5;
/** The spring counts as settled within this many pixels of rest. */
const SPRING_REST_PX = 0.5;
/** Its frames are worked out at the screen's usual rate. */
const SPRING_FRAME_SECONDS = 1 / 60;

/**
 * How far the row stretches when a drag pulls it `pull` pixels past its end:
 * more the further it is pulled, but less for each extra pixel, like a rubber band.
 */
function stretchFor(pull: number): number {
  const over = Math.max(0, pull - STRETCH_SLACK_PX);
  return STRETCH_LIMIT_PX * (over / (over + STRETCH_HALF_PULL_PX));
}

/**
 * Springs a stretched row back to rest from `stretch` pixels, starting at the
 * speed the drag let go at (pixels per second) rather than from still, so a
 * fling carries on before it turns back.
 */
function springBack(row: HTMLElement, stretch: number, velocity: number): Animation {
  const rate = SPRING_RATE_PER_SECOND;
  const frames: Keyframe[] = [];
  for (let time = 0; ; time += SPRING_FRAME_SECONDS) {
    // Critically damped: x(t) = (x0 + (v0 + rate * x0) * t) * e^(-rate * t).
    const decay = Math.exp(-rate * time);
    const settled = (Math.abs(stretch) + Math.abs(velocity + rate * stretch) * time) * decay < SPRING_REST_PX;
    const offset = settled ? 0 : (stretch + (velocity + rate * stretch) * time) * decay;
    frames.push({ translate: `${offset}px 0` });
    if (settled) break;
  }
  row.style.translate = "";
  return row.animate(frames, { duration: (frames.length - 1) * SPRING_FRAME_SECONDS * 1000 });
}

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
    /** Whether a pull past an end stretches the row: it can scroll, and motion is not reduced. */
    stretches: boolean;
    /** How far the stretch has shifted the row sideways now, in pixels. */
    stretch: number;
    /** Recent stretches with their times, for the speed the drag lets go at. */
    stretchSamples: { time: number; stretch: number }[];
  } | null>(null);
  const springRef = useRef<Animation | null>(null);
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

    // Catching the row mid-spring settles it, so the new drag starts from rest.
    springRef.current?.cancel();
    springRef.current = null;
    const row = event.currentTarget;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: row.scrollLeft,
      dragged: false,
      stretches:
        row.scrollWidth > row.clientWidth &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      stretch: 0,
      stretchSamples: [],
    };
  }, []);

  const handlePointerMove = useCallback(
    (event: PointerEvent<T>) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      const deltaX = event.clientX - dragState.startX;
      if (!dragState.dragged && Math.abs(deltaX) < DRAG_THRESHOLD_PX) return;

      const row = event.currentTarget;
      if (!dragState.dragged) {
        dragState.dragged = true;
        row.setPointerCapture(event.pointerId);
      }

      event.preventDefault();
      const wanted = dragState.startScrollLeft - deltaX;
      row.scrollLeft = wanted;
      if (dragState.stretches) {
        // The row stops at its ends; whatever the drag asks for past one stretches it
        // instead, toward the pointer, by less and less the further it pulls.
        const overshoot = wanted - row.scrollLeft;
        dragState.stretch = -Math.sign(overshoot) * stretchFor(Math.abs(overshoot));
        row.style.translate = dragState.stretch ? `${dragState.stretch}px 0` : "";
        dragState.stretchSamples = [
          ...dragState.stretchSamples.filter(
            (sample) => event.timeStamp - sample.time <= RELEASE_SPEED_WINDOW_MS,
          ),
          { time: event.timeStamp, stretch: dragState.stretch },
        ];
      }
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
    if (dragState.stretch) {
      // Let go stretched: it springs back, carrying on at the speed it was let go at.
      const recent = dragState.stretchSamples.filter(
        (sample) => event.timeStamp - sample.time <= RELEASE_SPEED_WINDOW_MS,
      );
      const first = recent[0];
      const last = recent[recent.length - 1];
      const velocity =
        first && last && last.time > first.time
          ? ((last.stretch - first.stretch) / (last.time - first.time)) * 1000
          : 0;
      springRef.current = springBack(event.currentTarget, dragState.stretch, velocity);
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
