import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { getUserProfile, updateUserProfile } from "@/features/auth/api/auth.api";
import { ROUTES } from "@/shared/constants/routes";

interface PanelClub {
  id: number;
  club_name: string;
}

/** Opens the club panel on one of the user's own clubs, making it the active club first. */
export function useOpenClubPanel() {
  const router = useRouter();
  return useCallback((club: PanelClub) => {
    const profile = getUserProfile();
    if (profile) updateUserProfile({ ...profile, clubId: club.id, clubName: club.club_name });
    router.push(ROUTES.CLUB_PANEL);
  }, [router]);
}
