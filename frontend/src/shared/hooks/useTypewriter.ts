import { useState, useEffect, useRef, useCallback } from "react";

const DEFAULT_CHAR_INTERVAL_MS = 25;

export function useTypewriter(text: string, intervalMs = DEFAULT_CHAR_INTERVAL_MS) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const indexRef = useRef(0);

  useEffect(() => {
    setDisplayed("");
    setDone(false);
    indexRef.current = 0;

    intervalRef.current = setInterval(() => {
      indexRef.current += 1;
      if (indexRef.current >= text.length) {
        setDisplayed(text);
        setDone(true);
        clearInterval(intervalRef.current);
      } else {
        setDisplayed(text.slice(0, indexRef.current));
      }
    }, intervalMs);

    return () => clearInterval(intervalRef.current);
  }, [text, intervalMs]);

  const skip = useCallback(() => {
    clearInterval(intervalRef.current);
    setDisplayed(text);
    setDone(true);
  }, [text]);

  return { displayed, done, skip };
}
