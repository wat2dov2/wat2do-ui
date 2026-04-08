/**
 * Credits Repository
 * Internal data layer for credits feature — backed by the API
 */

import { api } from "@/shared/services/apiClient";
import type { ApiCreditBalanceResponse, ApiPromotionResponse } from "@/shared/generated";

type CreditBalanceResponse = ApiCreditBalanceResponse;
type PromotionResponse = ApiPromotionResponse;

/**
 * Fetch user credit balance from the backend
 */
export async function fetchBalance(): Promise<number> {
  const res = await api.get<CreditBalanceResponse>("/credits/");
  return res.balance;
}

/**
 * Add credits via the backend
 */
export async function addCreditsAPI(amount: number): Promise<number> {
  const res = await api.post<CreditBalanceResponse>("/credits/add", { amount });
  return res.balance;
}

/**
 * Fetch user's promotions from the backend
 */
export async function fetchPromotions(): Promise<PromotionResponse[]> {
  return api.get<PromotionResponse[]>("/promotions/");
}

/**
 * Create a promotion via the backend.
 * Only sends event_id and package — the server determines cost and duration.
 */
export async function createPromotionAPI(
  eventId: number,
  packageId: string,
): Promise<PromotionResponse> {
  return api.post<PromotionResponse>("/promotions/", {
    event_id: eventId,
    package: packageId,
  });
}

/**
 * Fetch all currently active promoted event IDs (public endpoint)
 */
export async function fetchActivePromotedEventIds(): Promise<number[]> {
  return api.get<number[]>("/promotions/active-ids");
}
