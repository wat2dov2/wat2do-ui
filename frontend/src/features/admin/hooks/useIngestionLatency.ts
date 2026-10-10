import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/shared/lib/queryKeys";
import { controlBox } from "@/shared/config/controlBox";
import { getIngestionLatency } from "@/features/admin/api/admin.api";

export const INGESTION_LATENCY_WINDOWS = [1, 7, 30] as const;
export type IngestionLatencyWindow = (typeof INGESTION_LATENCY_WINDOWS)[number];

export function useIngestionLatency() {
  const [days, setDays] = useState<IngestionLatencyWindow>(7);
  const query = useQuery({
    queryKey: queryKeys.admin.ingestionLatency(days),
    queryFn: () => getIngestionLatency(days),
    staleTime: controlBox.clientCache.adminStaleMs,
  });
  return { ...query, days, setDays };
}
