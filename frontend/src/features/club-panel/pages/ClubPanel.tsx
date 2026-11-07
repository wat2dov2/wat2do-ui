import { useTranslation } from "react-i18next";
import { PageShellHeader } from "@/shared/layout/page-shell-header";
import { ROUTES } from "@/shared/constants/routes";
import { Briefcase, Calendar, Coins, Users } from "lucide-react";
import { useActiveClub } from "@/features/club-panel/hooks/useActiveClub";
import { useClubPayouts } from "@/features/club-panel/hooks/useClubPayouts";
import { FormGrid, Stack } from "@/shared/layout";
import { AdminCard } from "@/shared/ui/AdminCard";
import type { ClubPanelRouteKey } from "@/shared/constants/routes";

interface ClubPanelProps {
  onNavigate: (page: ClubPanelRouteKey) => void;
}

export function ClubPanel({ onNavigate }: ClubPanelProps) {
  const { t } = useTranslation();
  const { clubId, club } = useActiveClub();
  // Payouts matter only once wat2do sells paid tickets; free tickets need none.
  const { data: payouts } = useClubPayouts(clubId);

  return (
    <Stack gap={5}>
      <PageShellHeader route={ROUTES.CLUB_PANEL} title={club?.club_name} />
      <FormGrid columns={3}>
        <AdminCard
          icon={Calendar}
          title={t("navigation.events")}
          description={t("clubPanel.eventsDesc")}
          onClick={() => onNavigate("club-panel-events")}
        />
        <AdminCard
          icon={Briefcase}
          title={t("navigation.positions")}
          description={t("clubPanel.positionsDesc")}
          onClick={() => onNavigate("club-panel-positions")}
        />
        <AdminCard
          icon={Users}
          title={t("clubPanel.members")}
          description={t("clubPanel.membersDesc")}
          onClick={() => onNavigate("club-panel-members")}
        />
        {payouts?.paid_tickets_enabled ? (
          <AdminCard
            icon={Coins}
            title={t("clubPanel.payouts.title")}
            description={t("clubPanel.payoutsDesc")}
            onClick={() => onNavigate("club-panel-payouts")}
          />
        ) : null}
      </FormGrid>
    </Stack>
  );
}
