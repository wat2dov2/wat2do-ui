"use client";

import { useCallback } from "react";
import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";

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

export function useMutableSearchParams() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const setSearchParams = useCallback(
    (nextInit: SearchParamsInit, options: SetSearchParamsOptions = {}) => {
      const nextParams = toSearchParams(nextInit);
      const queryString = nextParams.toString();
      const href = queryString ? `${pathname}?${queryString}` : pathname;

      if (options.replace) {
        router.replace(href, { scroll: false });
      } else {
        router.push(href, { scroll: false });
      }
    },
    [pathname, router],
  );

  return [searchParams, setSearchParams] as const;
}
