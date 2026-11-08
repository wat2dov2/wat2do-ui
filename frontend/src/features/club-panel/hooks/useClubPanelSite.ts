import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuthState } from "@/features/auth";
import {
  CLUB_PANEL_CLUB_PARAM,
  clubPanelUrlElsewhere,
  makeActiveClub,
} from "@/features/clubs";

/**
 * Keeps the club panel on its club's school site. A club the address carries
 * from another school's site becomes the active club; an active club of
 * another school moves the panel to that school's site, same page.
 *
 * Returns false while either is under way, so the page waits in its loading
 * state instead of showing one club's panel on another school's site.
 */
export function useClubPanelSite(): boolean {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { clubs, clubId } = useAuthState();
  const carried = searchParams.get(CLUB_PANEL_CLUB_PARAM);
  const activeClub = clubs.find((club) => club.id === clubId) ?? clubs[0];
  const search = searchParams.toString();
  const elsewhere = carried === null && activeClub
    ? clubPanelUrlElsewhere(activeClub, search ? `${pathname}?${search}` : pathname)
    : null;

  useEffect(() => {
    if (carried === null) return;
    const club = clubs.find((item) => String(item.id) === carried);
    if (club) makeActiveClub(club);
    const rest = new URLSearchParams(search);
    rest.delete(CLUB_PANEL_CLUB_PARAM);
    router.replace(rest.size > 0 ? `${pathname}?${rest}` : pathname);
  }, [carried, clubs, pathname, router, search]);

  useEffect(() => {
    if (elsewhere) window.location.replace(elsewhere);
  }, [elsewhere]);

  return carried === null && elsewhere === null;
}
