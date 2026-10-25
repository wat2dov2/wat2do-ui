import { useQuery } from "@tanstack/react-query";
import { useAuthState } from "@/features/auth";
import { getClubById } from "@/features/clubs";
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
