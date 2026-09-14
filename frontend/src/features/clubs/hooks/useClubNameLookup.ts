import { useCallback, useMemo } from "react";
import type { Club } from "@/shared/types";
import { getAllClubs } from "@/features/clubs/api/clubs.api";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/shared/lib/queryKeys";

const NO_CLUBS: Club[] = [];

/**
 * Resolve a club id to its display name. Loads the full club list once and
 * exposes a stable lookup - the single source of truth for showing the club
 * name of an event/submission that only carries a club_id.
 */
export function useClubNameLookup() {
  const { data: clubs = NO_CLUBS } = useQuery({
    queryKey: queryKeys.clubs.allForSchool(null),
    queryFn: () => getAllClubs(),
    placeholderData: NO_CLUBS,
  });

  const namesById = useMemo(() => {
    const map = new Map<number, string>();
    clubs.forEach((org) => map.set(org.id, org.club_name));
    return map;
  }, [clubs]);

  const getClubName = useCallback(
    (clubId: number | null | undefined): string =>
      clubId != null ? namesById.get(clubId) ?? "" : "",
    [namesById],
  );

  return { getClubName: getClubName };
}
