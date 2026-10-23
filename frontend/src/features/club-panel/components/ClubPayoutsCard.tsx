import { useTranslation } from "react-i18next";
import { usePayoutRedirects } from "@/features/club-panel/hooks/useClubTicketing";
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
import { ExternalLink } from "lucide-react";
import { LoadingButton } from "@/shared/ui/loading-button";

type PayoutState = "unavailable" | "notConnected" | "inProgress" | "payoutsPaused" | "ready";

function payoutState(status: ApiClubPayoutStatus): PayoutState {
  if (!status.ticketing_enabled) return "unavailable";
  if (!status.connected) return "notConnected";
  if (!status.charges_enabled) return "inProgress";
  if (!status.payouts_enabled || status.requirements_due.length > 0) return "payoutsPaused";
  return "ready";
}

const BADGE_VARIANT = {
  unavailable: "muted",
  notConnected: "outline",
  inProgress: "warning",
  payoutsPaused: "warning",
  ready: "success",
} as const;

interface ClubPayoutsCardProps {
  clubId: number;
  status: ApiClubPayoutStatus;
  /** The payouts page also explains fees and currency; the dashboard keeps it short. */
  detailed?: boolean;
}

/** Where a club stands with Stripe, and the one next step to take. */
export function ClubPayoutsCard({ clubId, status, detailed = false }: ClubPayoutsCardProps) {
  const { t } = useTranslation();
  const { onboarding, dashboard } = usePayoutRedirects(clubId);
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
      {detailed ? (
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
      ) : null}
      {state === "unavailable" ? null : (
        <CardFooter>
          {state === "ready" ? (
            <LoadingButton
              type="button"
              variant="outline"
              // Stays busy after success: the browser is already leaving for Stripe.
              isLoading={dashboard.isPending || dashboard.isSuccess}
              onClick={() => dashboard.mutate()}
            >
              <ExternalLink className="size-4" />
              {t("clubPanel.payouts.openDashboard")}
            </LoadingButton>
          ) : (
            <Stack direction="horizontal" gap={2} wrap>
              <LoadingButton
                type="button"
                isLoading={onboarding.isPending || onboarding.isSuccess}
                onClick={() => onboarding.mutate()}
              >
                {state === "notConnected"
                  ? t("clubPanel.payouts.setUp")
                  : t("clubPanel.payouts.continueSetup")}
              </LoadingButton>
              {status.details_submitted ? (
                <LoadingButton
                  type="button"
                  variant="ghost"
                  isLoading={dashboard.isPending || dashboard.isSuccess}
                  onClick={() => dashboard.mutate()}
                >
                  {t("clubPanel.payouts.openDashboard")}
                </LoadingButton>
              ) : null}
            </Stack>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
