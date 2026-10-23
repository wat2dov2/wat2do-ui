import { useTranslation } from "react-i18next";
import { useActiveClub } from "@/features/auth";
import { ClubPayoutsCard } from "@/features/club-panel/components/ClubPayoutsCard";
import { useClubPayouts } from "@/features/club-panel/hooks/useClubTicketing";
import { ROUTES } from "@/shared/constants/routes";
import { EmptyState } from "@/shared/feedback";
import { PageHeader, Stack } from "@/shared/layout";
import { Coins, ShieldAlert } from "lucide-react";
import { Skeleton } from "@/shared/ui/skeleton";

/** Where a club connects Stripe; Stripe sends members back here after onboarding. */
export function ClubPanelPayoutsPage() {
  const { t } = useTranslation();
  const activeClub = useActiveClub();
  const { data: payouts, isPending } = useClubPayouts(activeClub?.id);

  if (!activeClub) {
    return (
      <EmptyState
        icon={<ShieldAlert />}
        title={t("clubPanel.noActiveClubSelected")}
        description={t("clubPanel.noActiveClubSelectedDesc")}
      />
    );
  }

  return (
    <Stack gap={6}>
      <PageHeader
        back={{ href: ROUTES.CLUB_PANEL, label: t("clubPanel.backToPanel") }}
        icon={Coins}
        title={t("clubPanel.payouts.title")}
        description={t("clubPanel.payoutsDesc")}
      />
      {isPending || !payouts ? (
        <Skeleton className="h-56 w-full rounded-xl" />
      ) : (
        <ClubPayoutsCard clubId={activeClub.id} status={payouts} detailed />
      )}
    </Stack>
  );
}
