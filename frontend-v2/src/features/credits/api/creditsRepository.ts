/**
 * Credits Repository
 * Internal data layer for credits feature
 * Handles credits and promotions data persistence
 */

import { StorageService } from "@/shared/services/storageService";
import type { PromotedEvent } from "@/shared/types";

const STORAGE_KEYS = {
  USER_CREDITS: "userCredits",
  PROMOTED_EVENTS: "promotedEvents",
} as const;

/**
 * Load user credits from localStorage
 */
export function loadUserCredits(): number {
  return StorageService.getItem<number>(STORAGE_KEYS.USER_CREDITS, 100); // Default 100 credits
}

/**
 * Save user credits to localStorage
 */
export function saveUserCredits(credits: number): void {
  StorageService.setItem(STORAGE_KEYS.USER_CREDITS, credits);
}

/**
 * Load promoted events from localStorage
 */
export function loadPromotedEvents(): PromotedEvent[] {
  return StorageService.getItem<PromotedEvent[]>(
    STORAGE_KEYS.PROMOTED_EVENTS,
    []
  );
}

/**
 * Save promoted events to localStorage
 */
export function savePromotedEvents(events: PromotedEvent[]): void {
  StorageService.setItem(STORAGE_KEYS.PROMOTED_EVENTS, events);
}
