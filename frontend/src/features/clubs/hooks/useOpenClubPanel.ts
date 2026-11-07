import { useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  clubPanelUrlElsewhere,
  makeActiveClub,
  type PanelClub,
} from "@/features/clubs/lib/clubPanelSite";
import { ROUTES } from "@/shared/constants/routes";

/**
 * Opens the club panel on one of the user's own clubs, on that club's school
 * site, making it the active club first.
 */
export function useOpenClubPanel() {
  const router = useRouter();
  return useCallback((club: PanelClub) => {
    const elsewhere = clubPanelUrlElsewhere(club, ROUTES.CLUB_PANEL);
    if (elsewhere) {
      // Another school's site is another origin, so this is a full navigation.
      window.location.assign(elsewhere);
      return;
    }
    makeActiveClub(club);
    router.push(ROUTES.CLUB_PANEL);
  }, [router]);
}
