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
 * Add credits via the backend.
 *
 * Backend contract (admin-only): POST /credits/add { user_id, amount }.
 * The frontend must send both fields — passing only `{ amount }` fails
 * Pydantic validation with a 422. Non-admin callers will receive a 403.
 */
export async function addCreditsRepo(
  userId: string,
  amount: number,
): Promise<number> {
  const res = await api.post<CreditBalanceResponse>("/credits/add", {
    user_id: userId,
    amount,
  });
  return res.balance;
}

/**
 * Create the single event promotion via the backend.
 * Only sends event_id — the server determines cost and duration.
 */
export async function createPromotionAPI(
  eventId: number,
): Promise<PromotionResponse> {
  return api.post<PromotionResponse>("/promotions/", {
    event_id: eventId,
  });
}

/**
 * Fetch all currently active promoted event IDs (public endpoint — no auth).
 */
export async function fetchActivePromotedEventIds(): Promise<number[]> {
  return api.get<number[]>("/promotions/active-ids");
}
