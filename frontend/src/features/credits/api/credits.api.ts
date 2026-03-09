/**
 * Credits API
 * Handles all credits and promotions-related data operations
 * 
 * This is the public API for the credits feature.
 * It consolidates repository and service operations.
 */

import type { PromotedEvent } from "@/shared/types";
import {
  loadUserCredits,
  saveUserCredits,
  loadPromotedEvents,
  savePromotedEvents,
} from "@/features/credits/api/creditsRepository";
import {
  promoteEvent as promoteEventService,
  getActivePromotedEventIds,
  isEventPromoted as isEventPromotedService,
} from "@/shared/services/promotionService";

/**
 * Credits API
 */

/**
 * Load user credits
 */
export function loadCredits(): number {
  return loadUserCredits();
}

/**
 * Save user credits
 */
export function saveCredits(credits: number): void {
  saveUserCredits(credits);
}

/**
 * Add credits to user account
 */
export function addCredits(currentCredits: number, amount: number): number {
  const newCredits = currentCredits + amount;
  saveCredits(newCredits);
  return newCredits;
}

/**
 * Promotions API
 */

/**
 * Load promoted events
 */
export function loadPromotedEventsAPI(): PromotedEvent[] {
  return loadPromotedEvents();
}

/**
 * Save promoted events
 */
export function savePromotedEventsAPI(events: PromotedEvent[]): void {
  savePromotedEvents(events);
}

/**
 * Promote an event
 * Returns the result with updated credits and promotions
 */
export function promoteEventAPI(
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
  needsCredits?: boolean;
} {
  const result = promoteEventService(
    eventId,
    packageId,
    credits,
    duration,
    currentCredits,
    currentPromotions
  );

  if (result.success) {
    // Persist the changes
    saveCredits(result.newCredits);
    savePromotedEventsAPI(result.newPromotions);
    return { success: true, newCredits: result.newCredits, newPromotions: result.newPromotions };
  } else {
    return { success: false, newCredits: currentCredits, newPromotions: currentPromotions, needsCredits: true };
  }
}

/**
 * Get active promoted event IDs
 */
export function getActivePromotedEventIdsAPI(
  promotions: PromotedEvent[]
): number[] {
  return getActivePromotedEventIds(promotions);
}

/**
 * Check if an event is currently promoted
 */
export function isEventPromotedAPI(
  eventId: number,
  promotions: PromotedEvent[]
): boolean {
  return isEventPromotedService(eventId, promotions);
}
