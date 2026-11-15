import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { useRequestSchool } from "@/app/client-providers";
import { clubDirectoryQueryOptions, useSavedClubsStore } from "@/features/clubs";

/** The clubs the visitor follows at this school, by name, and whether they are still loading. */
export function useFollowedClubs() {
  const school = useRequestSchool();
  const followedIds = useSavedClubsStore(useShallow((state) => state.savedClubIds));
  const followedLoaded = useSavedClubsStore((state) => state.hasLoaded);
  const directory = useQuery(clubDirectoryQueryOptions(school));
  const clubs = useMemo(() => {
    const followed = new Set(followedIds);
    return (directory.data?.items ?? [])
      .filter((club) => followed.has(club.id))
      .sort((left, right) => left.club_name.localeCompare(right.club_name));
  }, [directory.data, followedIds]);
  return { clubs, isPending: !followedLoaded || directory.isPending };
}
