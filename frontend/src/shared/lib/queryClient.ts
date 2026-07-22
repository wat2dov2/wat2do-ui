import { QueryClient } from "@tanstack/react-query";

import { productControl } from "@/shared/config/productControl";

function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        staleTime: productControl.clientCache.defaultQueryStaleMs,
        gcTime: productControl.clientCache.defaultQueryGarbageCollectionMs,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (!browserQueryClient) {
    browserQueryClient = createAppQueryClient();
  }
  return browserQueryClient;
}
