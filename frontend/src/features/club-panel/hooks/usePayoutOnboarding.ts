import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { startPayoutOnboarding } from "@/features/club-panel/api/payouts.api";
import { toast } from "@/shared/hooks/use-toast";
import { getApiErrorMessage } from "@/shared/services/apiClient";

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
