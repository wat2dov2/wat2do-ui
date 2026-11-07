import { PageShellHeader } from "@/shared/layout/page-shell-header";
import { ClubPayoutsCard } from "@/features/club-panel/components/ClubPayoutsCard";
import { useActiveClub } from "@/features/clubs";
import { useClubPayouts } from "@/features/club-panel/hooks/useClubPayouts";
import { NoActiveClub } from "@/features/club-panel/pages/NoActiveClub";
import { ROUTES } from "@/shared/constants/routes";
import { Stack } from "@/shared/layout";
import { Skeleton } from "@/shared/ui/skeleton";

/** Where a club connects Stripe; Stripe sends members back here after onboarding. */
export function ClubPanelPayoutsPage() {
  const { clubId } = useActiveClub();
  const { data: payouts } = useClubPayouts(clubId);
  if (!clubId) return <NoActiveClub />;

  return (
    <Stack gap={6}>
      <PageShellHeader route={ROUTES.CLUB_PANEL_PAYOUTS} />
      {payouts ? (
        <ClubPayoutsCard clubId={clubId} status={payouts} />
      ) : (
        <Skeleton className="h-56 w-full rounded-xl" />
      )}
    </Stack>
  );
}
