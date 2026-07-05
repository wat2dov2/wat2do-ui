"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type SearchParamsInit = URLSearchParams | Record<string, string> | string;

interface SetSearchParamsOptions {
  replace?: boolean;
}

function toSearchParams(init: SearchParamsInit): URLSearchParams {
  if (init instanceof URLSearchParams) {
    return init;
  }

  return new URLSearchParams(init);
}

// Global listeners to notify all hook instances of search params updates
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

let globalSearchParams = typeof window !== "undefined"
  ? new URLSearchParams(window.location.search)
  : new URLSearchParams();

export function useMutableSearchParams() {
  const pathname = usePathname();
  const [, forceUpdate] = useState({});

  useEffect(() => {
    const handlePopState = () => {
      globalSearchParams = new URLSearchParams(window.location.search);
      notifyListeners();
    };

    const listener = () => forceUpdate({});
    window.addEventListener("popstate", handlePopState);
    listeners.add(listener);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      listeners.delete(listener);
    };
  }, []);

  const setSearchParams = useCallback(
    (nextInit: SearchParamsInit, options: SetSearchParamsOptions = {}) => {
      const nextParams = toSearchParams(nextInit);
      const queryString = nextParams.toString();
      const href = queryString ? `${pathname}?${queryString}` : pathname;

      if (typeof window !== "undefined") {
        const originalReplaceState = window.History.prototype.replaceState;
        const originalPushState = window.History.prototype.pushState;

        if (options.replace) {
          originalReplaceState.call(window.history, null, "", href);
        } else {
          originalPushState.call(window.history, null, "", href);
        }
      }

      globalSearchParams = nextParams;
      notifyListeners();
    },
    [pathname],
  );

  return [globalSearchParams, setSearchParams] as const;
}
