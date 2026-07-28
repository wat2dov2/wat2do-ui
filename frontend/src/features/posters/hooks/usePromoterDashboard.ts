import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createPromoterPosters,
  getCampusCoverage,
  getPromoterEarnings,
  listPromoterPayouts,
} from "@/features/posters/api/posters.api";
import { queryKeys } from "@/shared/lib/queryKeys";

export function useCampusCoverage(school: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.posters.coverage(school),
    queryFn: () => getCampusCoverage(school!),
    enabled: Boolean(school),
  });
}

export function usePromoterDashboard(userId: string | null | undefined) {
  const earnings = useQuery({
    queryKey: queryKeys.posters.earnings(userId),
    queryFn: getPromoterEarnings,
    enabled: Boolean(userId),
  });
  const payouts = useQuery({
    queryKey: queryKeys.posters.payouts(userId),
    queryFn: listPromoterPayouts,
    enabled: Boolean(userId),
  });
  return { earnings, payouts };
}

export function useCreatePromoterPosters() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createPromoterPosters,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.posters.all }),
  });
}
