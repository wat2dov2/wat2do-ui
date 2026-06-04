import { useCallback, useMemo } from "react";
import type { Club } from "@/shared/types";
import { getAllClubs } from "@/features/clubs/api/clubs.api";
import { useBackendQuery } from "@/shared/hooks/useBackendQuery";

const NO_CLUBS: Club[] = [];

/**
 * Resolve a club id to its display name. Loads the full club list once and
 * exposes a stable lookup — the single source of truth for showing the club
 * name of an event/submission that only carries a club_id.
 */
export function useClubNameLookup() {
  const { data: clubs } = useBackendQuery(getAllClubs, NO_CLUBS);

  const namesById = useMemo(() => {
    const map = new Map<number, string>();
    clubs.forEach((club) => map.set(club.id, club.club_name));
    return map;
  }, [clubs]);

  const getClubName = useCallback(
    (clubId: number | null | undefined): string =>
      clubId != null ? namesById.get(clubId) ?? "" : "",
    [namesById],
  );

  return { getClubName };
}
