"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/shared/lib/utils";

/** How long each phrase stays before the next rolls in. */
const PHRASE_MS = 3000;

const useSafeLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface LandingRotatingWordProps {
  phrases: readonly string[];
  /** Runs as each phrase starts rolling in, with its index. */
  onChange?: (index: number) => void;
  /** Extra classes for each phrase, such as the hero's poster-filled letters. */
  phraseClassName?: string;
}

/**
 * A headline line of its own that cycles through phrases: each rolls up and
 * out as the next rolls in, centred, one at a time. The line is one line tall
 * and clips only vertically; a phrase wider than the line is scaled down to
 * fit rather than cut. Assistive tech skips it (the heading carries one stable
 * sentence), and under reduced motion it shows the first phrase only.
 */
export function LandingRotatingWord({ phrases, onChange, phraseClassName }: LandingRotatingWordProps) {
  const unique = [...new Set(phrases)];
  const count = unique.length;
  const [turn, setTurn] = useState<{ index: number; previous: number | null }>({ index: 0, previous: null });
  const [rotating, setRotating] = useState(false);
  const [fits, setFits] = useState<number[]>([]);
  const line = useRef<HTMLSpanElement>(null);
  const items = useRef<(HTMLSpanElement | null)[]>([]);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setRotating(count > 1 && !motion.matches);
    update();
    motion.addEventListener("change", update);
    return () => motion.removeEventListener("change", update);
  }, [count]);

  useEffect(() => {
    if (!rotating) return;
    const timer = window.setInterval(() => {
      setTurn((current) => ({ index: (current.index + 1) % count, previous: current.index }));
    }, PHRASE_MS);
    return () => window.clearInterval(timer);
  }, [rotating, count]);

  useEffect(() => {
    if (rotating) onChangeRef.current?.(turn.index);
  }, [rotating, turn.index]);

  // How far each phrase must shrink to fit the line, remeasured as fonts load or the width changes.
  useSafeLayoutEffect(() => {
    const measure = () => {
      const available = line.current?.getBoundingClientRect().width ?? 0;
      setFits(items.current.map((item) => (item && available ? Math.min(1, available / item.scrollWidth) : 1)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (line.current) observer.observe(line.current);
    return () => observer.disconnect();
  }, [count]);

  // Stopped (reduced motion, one phrase), the line shows the first phrase whatever turn it had reached.
  const { index, previous } = rotating ? turn : { index: 0, previous: null };

  return (
    <span
      ref={line}
      aria-hidden="true"
      // One line tall (with room for descenders), clipped vertically only, so nothing is cut at the sides.
      className="relative block h-[1.2em] [overflow-x:visible] [overflow-y:clip]"
    >
      {unique.map((phrase, phraseIndex) => (
        <span
          key={phrase}
          ref={(node) => { items.current[phraseIndex] = node; }}
          className={cn(
            "absolute top-[0.1em] left-1/2 whitespace-nowrap transition-[translate,opacity] duration-500 ease-out",
            phraseIndex === index ? "translate-y-0 opacity-100" : phraseIndex === previous ? "-translate-y-full opacity-0" : "translate-y-full opacity-0",
            !rotating && phraseIndex !== 0 && "hidden",
            phraseClassName,
          )}
          // Centred on the line, and shrunk only when the phrase is wider than it.
          style={{ transform: `translateX(-50%) scale(${fits[phraseIndex] ?? 1})` }}
        >
          {phrase}
        </span>
      ))}
    </span>
  );
}
