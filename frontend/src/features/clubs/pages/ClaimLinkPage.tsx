import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { BadgeCheck, ShieldAlert } from "lucide-react";
import { fetchProfileAPI } from "@/features/auth/api/auth.api";
import { useRequireSignIn } from "@/features/auth/hooks/useSignInGate";
import { acceptClaimLink, claimLinkQueryOptions } from "@/features/clubs/api/clubs.api";
import { useOpenClubPanel } from "@/features/clubs/hooks/useOpenClubPanel";
import { ROUTES } from "@/shared/constants/routes";
import { EmptyState } from "@/shared/feedback";
import { useConfetti } from "@/shared/hooks/useConfetti";
import { Container, PageFrame } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { LoadingButton } from "@/shared/ui/loading-button";

/**
 * Where an outreach email's claim link lands: it names the club, and claiming
 * (signed in, or after signing in) makes the visitor its owner and opens its panel.
 */
export function ClaimLinkPage() {
  const { t } = useTranslation();
  const params = useParams<{ token: string }>();
  const token = params.token;
  const link = useQuery(claimLinkQueryOptions(token));
  const requireSignIn = useRequireSignIn();
  const openClubPanel = useOpenClubPanel();
  const { trigger: celebrate } = useConfetti();
  const claim = useMutation({
    mutationFn: () => acceptClaimLink(token),
    onSuccess: async (club) => {
      celebrate();
      // The new club joins the account's clubs before its panel opens.
      await fetchProfileAPI();
      openClubPanel({ id: club.club_id, club_name: club.club_name, school: club.school });
    },
  });
  const failed = link.isError || claim.isError;

  return (
    <PageFrame>
      <Container size="sm">
        {failed ? (
          <EmptyState
            icon={<ShieldAlert />}
            title={t("clubs.claimLink.invalidTitle")}
            description={t("clubs.claimLink.invalidDescription")}
            action={
              <Button asChild>
                <Link href={ROUTES.EVENTS}>{t("clubs.claimLink.browseEvents")}</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<BadgeCheck />}
            title={link.data ? t("clubs.claimLink.title", { club: link.data.club_name }) : t("clubs.claimLink.checking")}
            description={t("clubs.claimLink.description")}
            action={
              <LoadingButton
                size="lg"
                disabled={!link.data}
                isLoading={claim.isPending || claim.isSuccess}
                loadingText={t("clubs.claimLink.claiming")}
                onClick={async () => {
                  if (await requireSignIn()) claim.mutate();
                }}
              >
                <BadgeCheck />
                {t("clubs.claimLink.claim")}
              </LoadingButton>
            }
          />
        )}
      </Container>
    </PageFrame>
  );
}
