import { QueryClient } from "@tanstack/react-query";

import { controlBox } from "@/shared/config/controlBox";

function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        staleTime: controlBox.clientCache.defaultQueryStaleMs,
        gcTime: controlBox.clientCache.defaultQueryGarbageCollectionMs,
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
