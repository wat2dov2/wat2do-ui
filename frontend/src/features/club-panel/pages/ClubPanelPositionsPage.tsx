import { useTranslation } from "react-i18next";
import { PageShellHeader } from "@/shared/layout/page-shell-header";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { ClubPositionsGrid } from "@/features/positions/components/ClubPositionsGrid";
import { useActiveClub } from "@/features/clubs";
import { NoActiveClub } from "@/features/club-panel/pages/NoActiveClub";
import { ROUTES } from "@/shared/constants/routes";
import { Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";

/** The active club's open positions, with a shortcut to post another. */
export function ClubPanelPositionsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { clubId, club } = useActiveClub();
  if (!clubId) return <NoActiveClub />;

  return (
    <Stack gap={5}>
      <PageShellHeader
        route={ROUTES.CLUB_PANEL_POSITIONS}
        actions={
          <Button onClick={() => router.push(ROUTES.POSITION_SUBMIT)}>
            <Plus />
            {t("positions.addPosition")}
          </Button>
        }
      />
      {club ? <ClubPositionsGrid clubId={clubId} school={club.school} /> : null}
    </Stack>
  );
}
