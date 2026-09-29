import { QueryClient } from "@tanstack/react-query";

import { controlBox } from "@/shared/config/controlBox";

function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        staleTime: controlBox.clientCache.defaultQueryStaleMs,
        // SSR clients belong to one request. Finite GC timers retain their query
        // graphs after rendering; Infinity disables timers so normal GC can collect them.
        gcTime: typeof window === "undefined"
          ? Infinity
          : controlBox.clientCache.defaultQueryGarbageCollectionMs,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") {
    return createAppQueryClient();
  }
  if (!browserQueryClient) {
    browserQueryClient = createAppQueryClient();
  }
  return browserQueryClient;
}
