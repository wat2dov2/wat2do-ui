import { getUserProfile, updateUserProfile } from "@/features/auth/api/auth.api";
import { getSchoolOrigin } from "@/shared/constants/schools";

/**
 * A club's panel is served only from its school's site: every school has its
 * own subdomain, and a club belongs to one school. Opening the panel from
 * another school's site moves there, and since each site keeps its own browser
 * storage, the address carries which club to open.
 */
export const CLUB_PANEL_CLUB_PARAM = "club";

export interface PanelClub {
  id: number;
  club_name: string;
  school?: string | null;
}

/** Makes `club` the one the club panel manages. */
export function makeActiveClub(club: PanelClub): void {
  const profile = getUserProfile();
  if (profile) updateUserProfile({ ...profile, clubId: club.id, clubName: club.club_name });
}

/**
 * Where the club panel page `path` for `club` lives when this page is on
 * another school's site, or null when it is already on the club's own (or the
 * club names no school).
 */
export function clubPanelUrlElsewhere(club: PanelClub, path: string): string | null {
  if (!club.school || typeof window === "undefined") return null;
  const origin = getSchoolOrigin(club.school);
  if (origin === window.location.origin) return null;
  const url = new URL(path, origin);
  url.searchParams.set(CLUB_PANEL_CLUB_PARAM, String(club.id));
  return url.toString();
}
