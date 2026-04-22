/**
 * Credits API
 * Public API for the credits feature — all operations hit the backend.
 */

import {
  fetchBalance,
  addCreditsAPI as addCreditsAPIInternal,
  createPromotionAPI,
  fetchActivePromotedEventIds,
} from "@/features/credits/api/creditsRepository";

// ── Credits ─────────────────────────────────────────────────────────

export async function loadCredits(): Promise<number> {
  return fetchBalance();
}

/**
 * Grant credits to `userId`. Backend requires both user_id and amount and
 * is admin-only — non-admin callers will receive a 403.
 */
export async function addCreditsAPI(
  userId: string,
  amount: number,
): Promise<number> {
  return addCreditsAPIInternal(userId, amount);
}

// ── Promotions ──────────────────────────────────────────────────────

/**
 * Load currently-active promoted event IDs from the public endpoint.
 * Used by both authenticated and anonymous branches of the store so
 * promoted events still pin to the top of the grid for logged-out visitors.
 */
export async function loadActivePromotedEventIds(): Promise<number[]> {
  return fetchActivePromotedEventIds();
}

/** Stable machine-readable code emitted by the backend ValidationError handler
 * when a credit-spend is rejected because the user's balance is too low.
 * See backend/core/errors.py ``INSUFFICIENT_CREDITS_CODE``. */
const INSUFFICIENT_CREDITS_CODE = "insufficient_credits";

export async function promoteEventAPI(
  eventId: number,
  packageId: string,
): Promise<{ success: boolean; needsCredits?: boolean }> {
  try {
    await createPromotionAPI(eventId, packageId);
    return { success: true };
  } catch (err: unknown) {
    // Prefer the stable ``code`` attached to the error body over a
    // substring match on ``detail``.  Fall back to the old substring check
    // only if ``code`` is absent (handlers on old backend builds).
    const body = (err as { body?: { code?: string; detail?: string } }).body;
    const code = body?.code;
    const detail = body?.detail ?? (err as { message?: string }).message ?? "";
    if (code === INSUFFICIENT_CREDITS_CODE || detail.includes("Insufficient credits")) {
      // Insufficient credits is a routing hint (open BuyCreditsModal),
      // not an unexpected error — log at info so Sentry / console aren't
      // spammed with false-positive errors.
      console.info("Promotion blocked by insufficient credits; prompting purchase.");
      return { success: false, needsCredits: true };
    }
    console.error("Failed to create promotion:", err);
    throw err;
  }
}
