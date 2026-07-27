import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  getUserProfile,
  updateUserProfile,
} from "@/features/auth";
import { updatePromoterEnrollment } from "@/features/posters/api/posters.api";
import { queryKeys } from "@/shared/lib/queryKeys";

interface PromoterEnrollmentInput {
  payoutEmail: string;
  acceptTos: boolean;
}

export function usePromoterEnrollment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payoutEmail, acceptTos }: PromoterEnrollmentInput) =>
      updatePromoterEnrollment(payoutEmail, acceptTos),
    onSuccess: (user) => {
      const profile = getUserProfile();
      if (profile) {
        updateUserProfile({
          ...profile,
          payoutEmail: user.payout_email ?? null,
          promoterTosAcceptedAt: user.promoter_tos_accepted_at ?? null,
          promoterTosVersion: user.promoter_tos_version ?? null,
        });
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.posters.all });
    },
  });
}
