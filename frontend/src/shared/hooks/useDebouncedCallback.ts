import { useEffect, useMemo, useRef } from "react";

/**
 * Returns a stable debounced wrapper around `callback`.
 * The latest callback is always invoked after `waitMs` of quiet time.
 */
export function useDebouncedCallback<T extends (...args: never[]) => void>(
  callback: T,
  waitMs: number,
): T {
  const callbackRef = useRef(callback);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const debounced = useMemo(() => {
    const wrapped = (...args: Parameters<T>) => {
      if (timeoutRef.current !== undefined) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, waitMs);
    };

    return wrapped as T;
  }, [waitMs]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== undefined) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [debounced]);

  return debounced;
}
