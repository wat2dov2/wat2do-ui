import { useQuery } from "@tanstack/react-query";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { getMyClubs } from "@/features/clubs";
import { queryKeys } from "@/shared/lib/queryKeys";

/** The clubs whose team the visitor is on, at every school, by name. */
export function useMemberClubs() {
  const { userId } = useAuthState();
  const query = useQuery({
    queryKey: queryKeys.clubs.mine(userId ?? ""),
    queryFn: async () => (await getMyClubs()).sort((left, right) => left.club_name.localeCompare(right.club_name)),
    enabled: Boolean(userId),
  });
  return { clubs: query.data ?? [], isPending: query.isPending };
}
