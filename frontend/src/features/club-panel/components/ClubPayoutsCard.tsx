import { useTranslation } from "react-i18next";
import { usePayoutRedirects } from "@/features/club-panel/hooks/useClubPayouts";
import type { ApiClubPayoutStatus } from "@/shared/generated";
import { Stack } from "@/shared/layout";
import { Badge } from "@/shared/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { LoadingButton } from "@/shared/ui/loading-button";
import { ExternalLink } from "lucide-react";

type PayoutState = "notConnected" | "inProgress" | "payoutsPaused" | "ready";

function payoutState(status: ApiClubPayoutStatus): PayoutState {
  if (!status.connected) return "notConnected";
  if (!status.charges_enabled) return "inProgress";
  if (!status.payouts_enabled || status.requirements_due.length > 0) return "payoutsPaused";
  return "ready";
}

const BADGE_VARIANT = {
  notConnected: "outline",
  inProgress: "warning",
  payoutsPaused: "warning",
  ready: "success",
} as const;

/** Where a club stands with Stripe, and the one next step to take. */
export function ClubPayoutsCard({ clubId, status }: { clubId: number; status: ApiClubPayoutStatus }) {
  const { t } = useTranslation();
  const { onboarding, dashboard } = usePayoutRedirects(clubId);
  const state = payoutState(status);
  // Both stay busy after success: the browser is already leaving for Stripe.
  const openingDashboard = dashboard.isPending || dashboard.isSuccess;

  return (
    <Card data-slot="club-payouts-card">
      <CardHeader>
        <CardTitle>{t("clubPanel.payouts.title")}</CardTitle>
        <CardDescription>{t(`clubPanel.payouts.states.${state}.description`)}</CardDescription>
        <CardAction>
          <Badge variant={BADGE_VARIANT[state]}>{t(`clubPanel.payouts.states.${state}.label`)}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Stack gap={2}>
          <CardDescription>{t("clubPanel.payouts.intro")}</CardDescription>
          <CardDescription>{t("clubPanel.payouts.fees")}</CardDescription>
          <CardDescription>{t("clubPanel.payouts.timing")}</CardDescription>
          <CardDescription>
            {t("clubPanel.payouts.currency", { currency: status.currency.toUpperCase() })}
          </CardDescription>
        </Stack>
      </CardContent>
      <CardFooter>
        <Stack direction="horizontal" gap={2} wrap>
          {state === "ready" ? null : (
            <LoadingButton
              type="button"
              isLoading={onboarding.isPending || onboarding.isSuccess}
              onClick={() => onboarding.mutate()}
            >
              {state === "notConnected"
                ? t("clubPanel.payouts.setUp")
                : t("clubPanel.payouts.continueSetup")}
            </LoadingButton>
          )}
          {status.details_submitted ? (
            <LoadingButton
              type="button"
              variant={state === "ready" ? "outline" : "ghost"}
              isLoading={openingDashboard}
              onClick={() => dashboard.mutate()}
            >
              <ExternalLink className="size-4" />
              {t("clubPanel.payouts.openDashboard")}
            </LoadingButton>
          ) : null}
        </Stack>
      </CardFooter>
    </Card>
  );
}
