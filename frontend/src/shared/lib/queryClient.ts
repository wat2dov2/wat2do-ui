import { QueryClient } from "@tanstack/react-query";

const FIVE_MINUTES_MS = 1000 * 60 * 5;
const THIRTY_MINUTES_MS = 1000 * 60 * 30;

function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        staleTime: FIVE_MINUTES_MS,
        gcTime: THIRTY_MINUTES_MS,
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
