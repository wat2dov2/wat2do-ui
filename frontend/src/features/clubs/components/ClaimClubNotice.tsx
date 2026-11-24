import NextLink from "next/link";
import { BadgeCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { claimClubHref } from "@/features/clubs/lib/claimClub";
import { getCurrentSchool } from "@/shared/constants/schools";
import { Alert, AlertAction, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";

interface ClaimClubNoticeProps {
  club: { id: number; school: string; club_name: string };
}

/**
 * Tells someone who just sent an event that its club is not onboarded yet,
 * and links a member of it straight to the club's claim form.
 */
export function ClaimClubNotice({ club }: ClaimClubNoticeProps) {
  const { t } = useTranslation();
  return (
    <Alert>
      <BadgeCheck />
      <AlertDescription>
        <p>{t("clubs.claimNotice.description", { club: club.club_name })}</p>
      </AlertDescription>
      <AlertAction>
        <Button asChild variant="outline" size="sm">
          <NextLink href={claimClubHref(club, getCurrentSchool())}>
            {t("clubs.claimNotice.action")}
          </NextLink>
        </Button>
      </AlertAction>
    </Alert>
  );
}
