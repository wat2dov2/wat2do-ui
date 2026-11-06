import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchClubPayouts, startPayoutOnboarding } from "@/features/club-panel/api/payouts.api";
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

/** Leave for Stripe's onboarding, which creates the club's account on first use. */
export function usePayoutOnboarding(clubId: number) {
  const { t } = useTranslation();
  return useMutation({
    mutationFn: () => startPayoutOnboarding(clubId),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error) =>
      toast({
        description: getApiErrorMessage(error, t("clubPanel.payouts.failed")),
        variant: "destructive",
      }),
  });
}
