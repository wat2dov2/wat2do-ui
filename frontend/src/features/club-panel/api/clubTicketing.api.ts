import type {
  ApiClubEventTicketSummary,
  ApiClubPayoutStatus,
  ApiStripeRedirectResponse,
} from "@/shared/generated";
import { api } from "@/shared/services/apiClient";

export function fetchClubPayoutStatus(clubId: number): Promise<ApiClubPayoutStatus> {
  return api.get<ApiClubPayoutStatus>(`/clubs/${clubId}/payouts`);
}

/** Stripe's hosted onboarding for the club; the browser leaves Wat2Do to finish it. */
export function startPayoutOnboarding(clubId: number): Promise<ApiStripeRedirectResponse> {
  return api.post<ApiStripeRedirectResponse>(`/clubs/${clubId}/payouts/onboarding`);
}

export function openPayoutDashboard(clubId: number): Promise<ApiStripeRedirectResponse> {
  return api.post<ApiStripeRedirectResponse>(`/clubs/${clubId}/payouts/dashboard`);
}

export function fetchClubTicketSales(clubId: number): Promise<ApiClubEventTicketSummary[]> {
  return api.get<ApiClubEventTicketSummary[]>(`/clubs/${clubId}/ticket-sales`);
}
