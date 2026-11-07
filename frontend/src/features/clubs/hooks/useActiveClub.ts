import { useQuery } from "@tanstack/react-query";
import { useAuthState } from "@/features/auth";
import { getClubById } from "@/features/clubs/api/clubs.api";
import { queryKeys } from "@/shared/lib/queryKeys";

/** The club the club panel is managing, picked from the menu's Club Panel dropdown. */
export function useActiveClub() {
  const { clubId } = useAuthState();
  const { data: club } = useQuery({
    queryKey: queryKeys.clubs.detail(clubId ?? 0),
    queryFn: () => getClubById(clubId!),
    enabled: clubId != null,
  });
  return { clubId, club };
}

/**
 * The club a club owner adds events and positions for: the one their club
 * panel manages, so their forms never ask which club. Admins add them for any
 * club and everyone else names one, so neither has a club of their own here.
 */
export function useOwnClub() {
  const { isAdmin } = useAuthState();
  const active = useActiveClub();
  return isAdmin || active.clubId == null ? null : { clubId: active.clubId, club: active.club };
}
