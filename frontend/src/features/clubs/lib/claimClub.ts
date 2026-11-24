import { QP } from "@/shared/constants/queryParams";
import { clubPagePath } from "@/shared/constants/routes";
import { schoolPageHref } from "@/shared/constants/schools";

/**
 * Where someone who runs `club` claims it from `currentSchool`'s site: the
 * club's page, on its own school's site, with the claim form already open.
 */
export function claimClubHref(club: { id: number; school: string }, currentSchool: string): string {
  return schoolPageHref(club.school, `${clubPagePath(club.id)}?${QP.CLAIM_CLUB}=1`, currentSchool);
}

/** Whether a club page's address asks for its claim form to open (a link from `claimClubHref`). */
export function isClaimRequested(searchParams: Pick<URLSearchParams, "get">): boolean {
  return searchParams.get(QP.CLAIM_CLUB) === "1";
}
