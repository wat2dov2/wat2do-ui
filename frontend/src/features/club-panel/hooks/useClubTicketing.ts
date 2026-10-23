import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "@/shared/hooks/use-toast";
import { queryKeys } from "@/shared/lib/queryKeys";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import {
  fetchClubPayoutStatus,
  fetchClubTicketSales,
  openPayoutDashboard,
  startPayoutOnboarding,
} from "@/features/club-panel/api/clubTicketing.api";

export function useClubPayouts(clubId: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.clubTicketing.payouts(clubId ?? 0),
    queryFn: () => fetchClubPayoutStatus(clubId as number),
    enabled: clubId != null,
  });
}

export function useClubTicketSales(clubId: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.clubTicketing.sales(clubId ?? 0),
    queryFn: () => fetchClubTicketSales(clubId as number),
    enabled: clubId != null,
  });
}

/** Leave for Stripe in this tab: Safari blocks a new tab opened after a request returns. */
export function usePayoutRedirects(clubId: number) {
  const { t } = useTranslation();
  const showError = (error: unknown) =>
    toast({
      description: getApiErrorMessage(error, t("tickets.errors.generic")),
      variant: "destructive",
    });
  const onboarding = useMutation({
    mutationFn: () => startPayoutOnboarding(clubId),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: showError,
  });
  const dashboard = useMutation({
    mutationFn: () => openPayoutDashboard(clubId),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: showError,
  });
  return { onboarding, dashboard };
}
