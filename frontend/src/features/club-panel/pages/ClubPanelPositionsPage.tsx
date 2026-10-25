import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { Briefcase, Plus } from "lucide-react";
import { ClubPositionsGrid } from "@/features/positions/components/ClubPositionsGrid";
import { useActiveClub } from "@/features/club-panel/hooks/useActiveClub";
import { NoActiveClub } from "@/features/club-panel/pages/NoActiveClub";
import { ROUTES } from "@/shared/constants/routes";
import { PageHeader, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";

/** The active club's open positions, with a shortcut to post another. */
export function ClubPanelPositionsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { clubId, club } = useActiveClub();
  if (!clubId) return <NoActiveClub />;

  return (
    <Stack gap={5}>
      <PageHeader
        back={{ label: t("clubPanel.backToPanel"), onClick: () => router.push(ROUTES.CLUB_PANEL) }}
        icon={Briefcase}
        title={t("navigation.positions")}
        description={t("clubPanel.positionsDesc")}
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
