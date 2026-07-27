import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  exportAdminPosterPayouts,
  getAdminPosterPayoutDetail,
  getAdminPosterPayouts,
  markAdminPosterPayoutsPaid,
  transitionAdminPosterPayout,
} from "@/features/admin/api/admin.api";
import type {
  AdminPosterPayoutFilters,
  PosterPayoutStatus,
} from "@/features/admin/api/admin.api";
import { queryKeys } from "@/shared/lib/queryKeys";

interface TransitionVariables {
  payoutId: string;
  status: PosterPayoutStatus;
  notes?: string;
}

async function refreshPayoutQueries(
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: queryKeys.posterPayouts.admin(),
  });
}

export function useAdminPosterPayouts(
  filters: AdminPosterPayoutFilters,
  selectedPayoutId: string | null,
) {
  const queryClient = useQueryClient();
  const queryFilters: Record<string, unknown> = { ...filters };
  const listQuery = useQuery({
    queryKey: queryKeys.posterPayouts.list(queryFilters),
    queryFn: () => getAdminPosterPayouts(filters),
    placeholderData: (previous) => previous,
  });
  const detailQuery = useQuery({
    queryKey: queryKeys.posterPayouts.detail(selectedPayoutId ?? ""),
    queryFn: () => getAdminPosterPayoutDetail(selectedPayoutId as string),
    enabled: selectedPayoutId !== null,
  });
  const transitionMutation = useMutation({
    mutationFn: ({ payoutId, status, notes }: TransitionVariables) =>
      transitionAdminPosterPayout(payoutId, status, notes),
    onSuccess: () => refreshPayoutQueries(queryClient),
  });
  const bulkPaidMutation = useMutation({
    mutationFn: markAdminPosterPayoutsPaid,
    onSuccess: () => refreshPayoutQueries(queryClient),
  });
  const exportMutation = useMutation({
    mutationFn: exportAdminPosterPayouts,
  });

  return {
    page: listQuery.data,
    isLoading: listQuery.isLoading,
    isFetching: listQuery.isFetching,
    error: listQuery.error,
    retry: listQuery.refetch,
    detail: detailQuery.data,
    isDetailLoading: detailQuery.isLoading,
    detailError: detailQuery.error,
    retryDetail: detailQuery.refetch,
    transitionPayout: transitionMutation.mutateAsync,
    bulkMarkPaid: bulkPaidMutation.mutateAsync,
    exportPayouts: exportMutation.mutateAsync,
    isTransitioning: transitionMutation.isPending,
    isBulkMarkingPaid: bulkPaidMutation.isPending,
    isExporting: exportMutation.isPending,
  };
}
