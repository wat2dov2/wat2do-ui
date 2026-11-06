import type { ApiClubPayoutStatus, ApiStripeRedirectResponse } from "@/shared/generated";
import { api } from "@/shared/services/apiClient";

/** Whether the club can sell tickets, and what Stripe still needs from it. */
export function fetchClubPayouts(clubId: number): Promise<ApiClubPayoutStatus> {
  return api.get<ApiClubPayoutStatus>(`/clubs/${clubId}/payouts`);
}

/** A one-time link to Stripe's onboarding, creating the club's account on first use. */
export function startPayoutOnboarding(clubId: number): Promise<ApiStripeRedirectResponse> {
  return api.post<ApiStripeRedirectResponse>(`/clubs/${clubId}/payouts/onboarding`);
}

/** A one-time login to the club's Stripe Express dashboard. */
export function openPayoutDashboard(clubId: number): Promise<ApiStripeRedirectResponse> {
  return api.post<ApiStripeRedirectResponse>(`/clubs/${clubId}/payouts/dashboard`);
}
