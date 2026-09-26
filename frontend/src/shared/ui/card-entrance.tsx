"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The entrance a card makes when it first appears in a grid.
 *
 * Cards rise and fade rather than snapping in, and a batch arriving together is
 * staggered so the grid fills in a sweep. Both values live here rather than at
 * each grid, so every card in the app arrives the same way.
 */
const ENTRANCE_DURATION_SECONDS = 0.5;
const STAGGER_STEP_SECONDS = 0.033;
const ENTRANCE_EASE = "cubic-bezier(0.18, 0.39, 0.14, 0.9)";

/**
 * How many cards a sweep runs across before starting over.
 *
 * The delay repeats on this cycle rather than growing with the index. A grid
 * scrolls further than it staggers: card two hundred does not want a six-second
 * delay, and giving every card past some ceiling the same delay would land a
 * whole screen at once. A cycle of roughly two rows keeps each batch arriving
 * as a sweep however far down the page the reader is.
 */
const STAGGER_CYCLE = 8;

interface CardEntranceProps {
  children: ReactNode;
  /** Position in the grid; only decides this card's share of the stagger. */
  index: number;
  className?: string;
  /** Carried by this element, so a grid needs no separate wrapper for it. */
  role?: string;
}

/**
 * Server-rendered cards are visible immediately, including without JavaScript.
 * Only cards below the first viewport animate as they scroll into view.
 * The browser owns this optional effect, so animation never delays first paint.
 */
export function CardEntrance({
  children,
  index,
  className,
  role,
}: CardEntranceProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const hasEntered = useRef(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || hasEntered.current) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const bounds = element.getBoundingClientRect();
    if (reducedMotion.matches || bounds.top < window.innerHeight) {
      hasEntered.current = true;
      return;
    }

    let animation: Animation | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      hasEntered.current = true;
      observer.disconnect();
      animation = element.animate(
        [{ opacity: 0, transform: "translateY(20px)" }, { opacity: 1, transform: "translateY(0)" }],
        {
          duration: ENTRANCE_DURATION_SECONDS * 1000,
          delay: (index % STAGGER_CYCLE) * STAGGER_STEP_SECONDS * 1000,
          easing: ENTRANCE_EASE,
          fill: "backwards",
        },
      );
    }, { threshold: 0.1 });
    const stop = () => {
      observer.disconnect();
      animation?.cancel();
    };
    const handleMotionChange = () => {
      if (reducedMotion.matches) {
        hasEntered.current = true;
        stop();
      }
    };
    observer.observe(element);
    reducedMotion.addEventListener("change", handleMotionChange);
    return () => {
      stop();
      reducedMotion.removeEventListener("change", handleMotionChange);
    };
  }, [index]);

  return (
    <div
      ref={elementRef}
      className={className}
      role={role}
    >
      {children}
    </div>
  );
}
