"use client";

import { useEffect, useRef, useState } from "react";

const COUNT_MS = 900;

/**
 * A number that counts up from zero the first time its element scrolls into
 * view. Server HTML and reduced motion show the final number; so does an
 * element already on screen when the page hydrates, so nothing visibly resets.
 */
export function useCountUp<T extends HTMLElement>(target: number) {
  const ref = useRef<T>(null);
  const [value, setValue] = useState(target);

  useEffect(() => {
    const element = ref.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = element.getBoundingClientRect();
    if (box.top < window.innerHeight && box.bottom > 0) return;

    let frame = 0;
    // Off screen and unseen, so dropping to zero now is never visible.
    frame = requestAnimationFrame(() => setValue(0));
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      const start = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - start) / COUNT_MS);
        // Ease out, so the count settles onto its number rather than stopping dead.
        setValue(Math.round(target * (1 - (1 - progress) ** 3)));
        if (progress < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }, { threshold: 0.4 });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [target]);

  return { ref, value };
}
