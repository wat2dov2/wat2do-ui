import { useEffect, useState } from "react";

/**
 * Whether the browser has had an idle moment (or `timeoutMs` passed) since
 * `ready` became true, so work that can wait, such as a map's code and tiles
 * below the fold, never competes with what the page shows first. Browsers with
 * no idle callback wait for the page to finish loading instead.
 */
export function useWhenIdle(ready: boolean, timeoutMs: number): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!ready || idle) return;
    const done = () => setIdle(true);
    // Safari has no idle callback, whatever the DOM types say.
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(done, { timeout: timeoutMs });
      return () => window.cancelIdleCallback(handle);
    }
    if (document.readyState === "complete") {
      const timer = window.setTimeout(done, 0);
      return () => window.clearTimeout(timer);
    }
    window.addEventListener("load", done, { once: true });
    return () => window.removeEventListener("load", done);
  }, [ready, idle, timeoutMs]);
  return idle;
}
