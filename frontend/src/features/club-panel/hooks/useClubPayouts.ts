import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  fetchClubPayouts,
  openPayoutDashboard,
  startPayoutOnboarding,
} from "@/features/club-panel/api/payouts.api";
import { toast } from "@/shared/hooks/use-toast";
import { queryKeys } from "@/shared/lib/queryKeys";
import { getApiErrorMessage } from "@/shared/services/apiClient";

export function useClubPayouts(clubId: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.clubTicketing.payouts(clubId ?? 0),
    queryFn: () => fetchClubPayouts(clubId as number),
    enabled: clubId != null && clubId > 0,
  });
}

/** Leave for Stripe: its onboarding, or the club's Express dashboard. */
export function usePayoutRedirects(clubId: number) {
  const { t } = useTranslation();
  const leave = ({ url }: { url: string }) => window.location.assign(url);
  const showError = (error: unknown) =>
    toast({
      description: getApiErrorMessage(error, t("clubPanel.payouts.failed")),
      variant: "destructive",
    });
  const onboarding = useMutation({
    mutationFn: () => startPayoutOnboarding(clubId),
    onSuccess: leave,
    onError: showError,
  });
  const dashboard = useMutation({
    mutationFn: () => openPayoutDashboard(clubId),
    onSuccess: leave,
    onError: showError,
  });
  return { onboarding, dashboard };
}
