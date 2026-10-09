import { useQuery } from "@tanstack/react-query";
import { api } from "@/shared/services/apiClient";
import { queryKeys } from "@/shared/lib/queryKeys";

interface AutomateLog {
  id: string;
  created_at: string;
  event: string;
  sender_id: string | null;
  school: string | null;
  ig_account: string | null;
  post_url: string | null;
  payload: Record<string, unknown> | null;
}

async function fetchAutomateLogs(senderId?: string): Promise<AutomateLog[]> {
  return api.get<AutomateLog[]>(`/webhooks/automate/logs${senderId ? `?sender_id=${encodeURIComponent(senderId)}` : ""}`);
}

export function useAutomateLogs(senderId?: string) {
  return useQuery({
    queryKey: queryKeys.automateLogs.list(senderId),
    queryFn: () => fetchAutomateLogs(senderId),
    refetchInterval: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retryOnMount: false,
  });
}
