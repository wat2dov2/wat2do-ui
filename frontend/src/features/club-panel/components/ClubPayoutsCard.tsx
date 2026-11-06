import { useTranslation } from "react-i18next";
import { usePayoutOnboarding } from "@/features/club-panel/hooks/useClubPayouts";
import type { ApiClubPayoutStatus } from "@/shared/generated";
import { Stack } from "@/shared/layout";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
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

// The club's own Stripe account: its team signs in there with their own login.
const STRIPE_DASHBOARD_URL = "https://dashboard.stripe.com/";

/** Where a club stands with Stripe, and the one next step to take. */
export function ClubPayoutsCard({ clubId, status }: { clubId: number; status: ApiClubPayoutStatus }) {
  const { t } = useTranslation();
  const onboarding = usePayoutOnboarding(clubId);
  const state = payoutState(status);

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
              // Busy after success too: the browser is already leaving for Stripe.
              isLoading={onboarding.isPending || onboarding.isSuccess}
              onClick={() => onboarding.mutate()}
            >
              {state === "notConnected"
                ? t("clubPanel.payouts.setUp")
                : t("clubPanel.payouts.continueSetup")}
            </LoadingButton>
          )}
          {status.details_submitted ? (
            <Button variant={state === "ready" ? "outline" : "ghost"} asChild>
              <a href={STRIPE_DASHBOARD_URL} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" />
                {t("clubPanel.payouts.openDashboard")}
              </a>
            </Button>
          ) : null}
        </Stack>
      </CardFooter>
    </Card>
  );
}
