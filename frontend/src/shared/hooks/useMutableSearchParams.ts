"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setSearchParams = useCallback(
    (nextInit: SearchParamsInit, options: SetSearchParamsOptions = {}) => {
      const nextParams = toSearchParams(nextInit);
      const queryString = nextParams.toString();
      const href = queryString ? `${pathname}?${queryString}` : pathname;
      const navigate = options.replace ? router.replace : router.push;
      navigate(href, { scroll: false });
    },
    [pathname, router],
  );

  return [searchParams, setSearchParams] as const;
}
