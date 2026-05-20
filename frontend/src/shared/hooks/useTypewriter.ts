import { useState, useEffect, useRef, useCallback } from "react";

const DEFAULT_CHAR_INTERVAL_MS = 30;
const RANDOMNESS_MS = 35;
const PUNCTUATION_PAUSE_MS = 500;
const PUNCTUATION = new Set([".", "!"]);

function jitter(baseMs: number): number {
  return baseMs + (Math.random() * 2 - 1) * RANDOMNESS_MS;
}

export function useTypewriter(text: string, intervalMs = DEFAULT_CHAR_INTERVAL_MS) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const indexRef = useRef(0);

  useEffect(() => {
    function tick() {
      indexRef.current += 1;
      if (indexRef.current >= text.length) {
        setDisplayed(text);
        setDone(true);
        return;
      }
      setDisplayed(text.slice(0, indexRef.current));
      const lastChar = text[indexRef.current - 1];
      const delay = PUNCTUATION.has(lastChar)
        ? PUNCTUATION_PAUSE_MS
        : jitter(intervalMs);
      timeoutRef.current = setTimeout(tick, delay);
    }

    const resetTimeout = setTimeout(() => {
      setDisplayed("");
      setDone(false);
      indexRef.current = 0;
      timeoutRef.current = setTimeout(tick, jitter(intervalMs));
    }, 0);

    return () => {
      if (resetTimeout) clearTimeout(resetTimeout);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [text, intervalMs]);

  const skip = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setDisplayed(text);
    setDone(true);
  }, [text]);

  return { displayed, done, skip };
}
