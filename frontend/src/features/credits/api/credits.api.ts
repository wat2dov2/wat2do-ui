/**
 * Credits API
 * Public API for the credits feature — all operations hit the backend.
 */

import type { PromotedEvent } from "@/shared/types";
import {
  fetchBalance,
  addCreditsAPI,
  fetchPromotions,
  createPromotionAPI,
  fetchActivePromotedEventIds,
} from "@/features/credits/api/creditsRepository";

// ── Credits ─────────────────────────────────────────────────────────

export async function loadCredits(): Promise<number> {
  return fetchBalance();
}

export async function addCredits(amount: number): Promise<number> {
  return addCreditsAPI(amount);
}

// ── Promotions ──────────────────────────────────────────────────────

/** Map backend promotion rows to the frontend PromotedEvent shape. */
function toPromotedEvent(row: {
  event_id: number;
  package: string;
  start_date: string;
  end_date: string;
}): PromotedEvent {
  return {
    eventId: row.event_id,
    package: row.package as PromotedEvent["package"],
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

export async function loadPromotedEvents(): Promise<PromotedEvent[]> {
  const rows = await fetchPromotions();
  return rows.map(toPromotedEvent);
}

export async function promoteEventAPI(
  eventId: number,
  packageId: string,
): Promise<{ success: boolean; needsCredits?: boolean }> {
  try {
    await createPromotionAPI(eventId, packageId);
    return { success: true };
  } catch (err: unknown) {
    const detail = (err as { message?: string }).message ?? "";
    if (detail.includes("Insufficient credits")) {
      console.error("Promotion failed due to insufficient credits:", err);
      return { success: false, needsCredits: true };
    }
    console.error("Failed to create promotion:", err);
    throw err;
  }
}

export async function getActivePromotedEventIds(): Promise<number[]> {
  return fetchActivePromotedEventIds();
}

/** Client-side check — is an event currently promoted? */
export function isEventPromoted(
  eventId: number,
  promotions: PromotedEvent[],
): boolean {
  const now = new Date().toISOString();
  return promotions.some((p) => p.eventId === eventId && p.endDate > now);
}
