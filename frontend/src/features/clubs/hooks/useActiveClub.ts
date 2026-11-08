import { useQuery } from "@tanstack/react-query";
import { useAuthState } from "@/features/auth";
import { getClubById } from "@/features/clubs/api/clubs.api";
import { useEventsStore } from "@/features/events/store/events.store";
import { getCurrentSchool, resolveSchool } from "@/shared/constants/schools";
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
 * The club someone adds events and positions for when they have exactly one at
 * the school they are submitting to, admins included: the forms fill it in and
 * keep it fixed. With none or several there is no club of their own, so the
 * forms offer the school's clubs to pick from.
 */
export function useOwnClub() {
  const { clubs } = useAuthState();
  const schoolFilter = useEventsStore((state) => state.schoolFilter);
  const school = resolveSchool(schoolFilter ?? getCurrentSchool());
  const inSchool = clubs.filter((club) => club.school != null && resolveSchool(club.school) === school);
  const only = inSchool.length === 1 ? inSchool[0] : null;
  const { data: club } = useQuery({
    queryKey: queryKeys.clubs.detail(only?.id ?? 0),
    queryFn: () => getClubById(only!.id),
    enabled: only != null,
  });
  return only ? { clubId: only.id, club } : null;
}
