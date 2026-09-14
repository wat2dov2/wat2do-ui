import type { Club } from "@/shared/types";

export function isClubIndexable(club: Club): boolean {
  return Boolean(
    club.status === "approved" &&
      club.club_name.trim() &&
      club.school.trim() &&
      (club.categories.length > 0 ||
        club.club_page.trim() ||
        club.ig ||
        club.discord ||
        (club.event_count ?? 0) > 0 ||
        (club.position_count ?? 0) > 0),
  );
}
