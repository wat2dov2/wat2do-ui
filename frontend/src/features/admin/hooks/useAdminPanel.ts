import { useQuery } from "@tanstack/react-query";
import { getPositionSubmissions, getAdminPosterPayouts } from "@/features/admin/api/admin.api";
import { useAdminPendingCounts } from "@/features/admin/hooks/useAdminList";
import { queryKeys } from "@/shared/lib/queryKeys";
import { SUBMISSION_PENDING } from "@/shared/constants/statuses";

const payoutFilters = { page: 1, pageSize: 1, payoutStatus: "pending" } as const;

export function useAdminPanel() {
  const moderation = useAdminPendingCounts(["submissions", "reports", "claims", "clubSubmissions"]);
  const positions = useQuery({ queryKey: queryKeys.positionSubmissions.list(1, SUBMISSION_PENDING), queryFn: () => getPositionSubmissions(1, SUBMISSION_PENDING) });
  const payouts = useQuery({ queryKey: queryKeys.posterPayouts.list(payoutFilters), queryFn: () => getAdminPosterPayouts(payoutFilters) });
  return {
    counts: {
      eventSubmissions: moderation.counts.submissions ?? null,
      eventReports: moderation.counts.reports ?? null,
      clubSubmissions: moderation.counts.clubSubmissions ?? null,
      claims: moderation.counts.claims ?? null,
      positionSubmissions: positions.data?.total ?? null,
      payouts: payouts.data?.total ?? null,
    },
    loadFailed: moderation.isError || positions.isError || payouts.isError,
    retry: () => { void moderation.refetch(); void positions.refetch(); void payouts.refetch(); },
  };
}
