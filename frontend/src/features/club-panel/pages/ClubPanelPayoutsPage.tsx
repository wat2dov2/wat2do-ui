import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { ClubPayoutsCard } from "@/features/club-panel/components/ClubPayoutsCard";
import { useActiveClub } from "@/features/club-panel/hooks/useActiveClub";
import { useClubPayouts } from "@/features/club-panel/hooks/useClubPayouts";
import { NoActiveClub } from "@/features/club-panel/pages/NoActiveClub";
import { ROUTES } from "@/shared/constants/routes";
import { PageHeader, Stack } from "@/shared/layout";
import { Skeleton } from "@/shared/ui/skeleton";
import { Coins } from "lucide-react";

/** Where a club connects Stripe; Stripe sends members back here after onboarding. */
export function ClubPanelPayoutsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { clubId } = useActiveClub();
  const { data: payouts } = useClubPayouts(clubId);
  if (!clubId) return <NoActiveClub />;

  return (
    <Stack gap={6}>
      <PageHeader
        back={{ label: t("clubPanel.backToPanel"), onClick: () => router.push(ROUTES.CLUB_PANEL) }}
        icon={Coins}
        title={t("clubPanel.payouts.title")}
        description={t("clubPanel.payoutsDesc")}
      />
      {payouts ? (
        <ClubPayoutsCard clubId={clubId} status={payouts} />
      ) : (
        <Skeleton className="h-56 w-full rounded-xl" />
      )}
    </Stack>
  );
}
