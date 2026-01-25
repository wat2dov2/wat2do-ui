import type { PromotedEvent } from "@/types";
import { StorageService } from "@/services/storageService";

/**
 * User Repository
 * Handles user data persistence
 */

const STORAGE_KEYS = {
  USER_EMAIL: "userEmail",
  SAVED_EVENT_IDS: "savedEventIds",
  USER_CREDITS: "userCredits",
  PROMOTED_EVENTS: "promotedEvents",
  DARK_MODE: "darkMode",
} as const;

/**
 * Load user email from localStorage
 */
export function loadUserEmail(): string | null {
  const email = StorageService.getItem<string | null>(
    STORAGE_KEYS.USER_EMAIL,
    null
  );
  return email;
}

/**
 * Save user email to localStorage
 */
export function saveUserEmail(email: string | null): void {
  if (email) {
    StorageService.setItem(STORAGE_KEYS.USER_EMAIL, email);
  } else {
    StorageService.removeItem(STORAGE_KEYS.USER_EMAIL);
  }
}

/**
 * Load saved event IDs from localStorage
 */
export function loadSavedEventIds(): number[] {
  return StorageService.getItem<number[]>(STORAGE_KEYS.SAVED_EVENT_IDS, []);
}

/**
 * Save saved event IDs to localStorage
 */
export function saveSavedEventIds(ids: number[]): void {
  StorageService.setItem(STORAGE_KEYS.SAVED_EVENT_IDS, ids);
}

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

/**
 * Load dark mode preference from localStorage
 */
export function loadDarkMode(): boolean | null {
  const saved = StorageService.getItem<string | null>(
    STORAGE_KEYS.DARK_MODE,
    null
  );
  if (saved === null) return null;
  try {
    return JSON.parse(saved) as boolean;
  } catch {
    return null;
  }
}

/**
 * Save dark mode preference to localStorage
 */
export function saveDarkMode(isDark: boolean): void {
  StorageService.setItem(STORAGE_KEYS.DARK_MODE, JSON.stringify(isDark));
}
