import type { ApiStripeRedirectResponse } from "@/shared/generated";
import { api } from "@/shared/services/apiClient";

/** A one-time link to Stripe's onboarding, creating the club's account on first use. */
export function startPayoutOnboarding(clubId: number): Promise<ApiStripeRedirectResponse> {
  return api.post<ApiStripeRedirectResponse>(`/clubs/${clubId}/payouts/onboarding`);
}
