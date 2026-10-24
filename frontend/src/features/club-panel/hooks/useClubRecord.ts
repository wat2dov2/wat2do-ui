import { useQuery } from "@tanstack/react-query";
import { getClubById } from "@/features/clubs";
import { queryKeys } from "@/shared/lib/queryKeys";

/** The club's full record, e.g. for its school and time zone. */
export function useClubRecord(clubId: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.clubs.detail(clubId ?? 0),
    queryFn: () => getClubById(clubId as number),
    enabled: clubId != null,
  });
}
