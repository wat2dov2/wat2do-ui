import type { PromotedEvent } from "@/shared/types";

/**
 * Promotion Service
 * Handles event promotion and credits management
 */

export interface PromotionResult {
  success: boolean;
  reason?: string;
}

/**
 * Check if user has enough credits for promotion
 */
export function hasEnoughCredits(
  userCredits: number,
  requiredCredits: number
): boolean {
  return userCredits >= requiredCredits;
}

/**
 * Create a promotion for an event
 */
export function createPromotion(
  eventId: number,
  packageId: string,
  duration: number
): PromotedEvent {
  const startDate = new Date().toISOString();
  const endDate = new Date(
    Date.now() + duration * 24 * 60 * 60 * 1000
  ).toISOString();

  return {
    eventId,
    package: packageId as PromotedEvent["package"],
    startDate,
    endDate,
  };
}

/**
 * Promote an event (deduct credits and create promotion)
 */
export function promoteEvent(
  eventId: number,
  packageId: string,
  credits: number,
  duration: number,
  currentCredits: number,
  currentPromotions: PromotedEvent[]
): {
  success: boolean;
  newCredits: number;
  newPromotions: PromotedEvent[];
  reason?: string;
} {
  // Check if user has enough credits
  if (!hasEnoughCredits(currentCredits, credits)) {
    return {
      success: false,
      newCredits: currentCredits,
      newPromotions: currentPromotions,
      reason: "Insufficient credits",
    };
  }

  // Deduct credits
  const newCredits = currentCredits - credits;

  // Create promotion and remove existing promotion for this event
  const promotion = createPromotion(eventId, packageId, duration);
  const newPromotions = [
    ...currentPromotions.filter((p) => p.eventId !== eventId),
    promotion,
  ];

  return {
    success: true,
    newCredits,
    newPromotions,
  };
}

/**
 * Check if an event is currently promoted
 */
export function isEventPromoted(
  eventId: number,
  promotions: PromotedEvent[]
): boolean {
  const now = new Date().toISOString();
  return promotions.some(
    (p) => p.eventId === eventId && p.endDate > now
  );
}

/**
 * Get active promoted event IDs
 */
export function getActivePromotedEventIds(
  promotions: PromotedEvent[]
): number[] {
  const now = new Date().toISOString();
  return promotions
    .filter((p) => p.endDate > now)
    .map((p) => p.eventId);
}

/**
 * Get expired promotions
 */
export function getExpiredPromotions(
  promotions: PromotedEvent[]
): PromotedEvent[] {
  const now = new Date().toISOString();
  return promotions.filter((p) => p.endDate <= now);
}

/**
 * Clean up expired promotions
 */
export function cleanupExpiredPromotions(
  promotions: PromotedEvent[]
): PromotedEvent[] {
  return promotions.filter((p) => {
    const now = new Date().toISOString();
    return p.endDate > now;
  });
}
