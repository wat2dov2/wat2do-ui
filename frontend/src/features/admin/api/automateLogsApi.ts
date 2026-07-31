import { useQuery } from "@tanstack/react-query";
import { api } from "@/shared/services/apiClient";
import { queryKeys } from "@/shared/lib/queryKeys";

export interface AutomateLog {
  id: string;
  created_at: string;
  event: string;
  sender_id: string | null;
  school: string | null;
  ig_account: string | null;
  post_url: string | null;
  payload: Record<string, unknown> | null;
}

export async function fetchAutomateLogs(): Promise<AutomateLog[]> {
  return api.get<AutomateLog[]>("/webhooks/automate/logs");
}

export function useAutomateLogs() {
  return useQuery({
    queryKey: queryKeys.automateLogs.list(),
    queryFn: fetchAutomateLogs,
    refetchInterval: 3000,
  });
}
