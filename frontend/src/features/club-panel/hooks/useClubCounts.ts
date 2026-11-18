import { useQuery } from "@tanstack/react-query";
import { fetchClubCounts } from "@/features/club-panel/api/counts.api";
import { queryKeys } from "@/shared/lib/queryKeys";

/**
 * The numbers on the club panel's cards. They are read again on every visit
 * to the panel, so a change made on one of its pages shows on return.
 */
export function useClubCounts(clubId: number | null) {
  return useQuery({
    queryKey: queryKeys.clubs.counts(clubId ?? 0),
    queryFn: () => fetchClubCounts(clubId as number),
    enabled: clubId != null && clubId > 0,
    staleTime: 0,
  });
}
