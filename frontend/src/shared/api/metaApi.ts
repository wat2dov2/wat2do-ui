/**
 * Fetches shared domain constants from the backend (/meta/constants).
 *
 * Called once during app init (main.tsx) so that categories, interest
 * mappings, and status enums always come from one source of truth.
 *
 * Consumers use the synchronous `getAppConstants()` getter — by the
 * time React renders, the constants are already loaded.
 */

import { api } from "@/shared/services/apiClient";
import { SUBMISSION_STATUSES, REPORT_STATUSES } from "@/shared/constants/statuses";

export interface AppConstants {
  event_categories: string[];
  interests: string[];
  interest_to_categories: Record<string, string[]>;
  submission_statuses: string[];
  report_statuses: string[];
}

// ---------------------------------------------------------------------------
// Static fallbacks — the single frontend copy of backend constants.
// Keep these as a safety net; the backend is the source of truth.
//
// Other modules (eventCategories.ts, interestCategoryMap.ts, interests.ts)
// derive their static values from these — do NOT duplicate elsewhere.
// ---------------------------------------------------------------------------

/** Fallback event categories — exported so eventCategories.ts can derive its union type. */
export const FALLBACK_EVENT_CATEGORIES = [
  "Academics", "Studying", "Career", "Networking", "Games",
  "Partying", "Athletics", "Art", "Dance", "Culture",
  "Religion", "Advocacy", "Technology", "Design", "Entrepreneurship",
  "Health", "Wellness", "Mental Health", "Music", "Sports",
  "Food", "Volunteering",
] as const;

/** Fallback interest list — exported so interests.ts can derive its static list. */
export const FALLBACK_INTERESTS = [
  "Academic", "Social", "Career", "Sports", "Music", "Art",
  "Technology", "Gaming", "Food", "Networking", "Health", "Cultural",
] as const;

/** Fallback interest-to-category mapping — exported so interestCategoryMap.ts can re-export. */
export const FALLBACK_INTEREST_TO_CATEGORIES: Record<string, string[]> = {
  Academic: ["Academics", "Studying"],
  Social: ["Partying", "Games", "Dance"],
  Career: ["Career", "Networking", "Entrepreneurship"],
  Sports: ["Athletics", "Sports"],
  Music: ["Music"],
  Art: ["Art", "Design"],
  Technology: ["Technology"],
  Gaming: ["Games"],
  Food: ["Food"],
  Networking: ["Networking", "Career"],
  Health: ["Health", "Wellness", "Mental Health"],
  Cultural: ["Culture", "Religion", "Advocacy"],
};

const FALLBACK: AppConstants = {
  event_categories: [...FALLBACK_EVENT_CATEGORIES],
  interests: [...FALLBACK_INTERESTS],
  interest_to_categories: FALLBACK_INTEREST_TO_CATEGORIES,
  submission_statuses: [...SUBMISSION_STATUSES],
  report_statuses: [...REPORT_STATUSES],
};

// ---------------------------------------------------------------------------
// Module-level cache — written once by loadAppConstants(), read many times.
// ---------------------------------------------------------------------------
let cached: AppConstants = FALLBACK;
let loaded = false;

/**
 * Fetch constants from the backend. Call once during app init.
 * On failure, falls back silently to compiled defaults and logs.
 */
export async function loadAppConstants(): Promise<void> {
  try {
    cached = await api.get<AppConstants>("/meta/constants");
    loaded = true;
  } catch (err) {
    console.error("Failed to load app constants from backend, using fallback:", err);
    // cached already holds FALLBACK — app keeps working.
  }
}

/**
 * Synchronous access to the fetched (or fallback) constants.
 * Safe to call anywhere after app init.
 */
export function getAppConstants(): AppConstants {
  return cached;
}

/** Whether the constants were successfully fetched from the backend. */
export function appConstantsLoaded(): boolean {
  return loaded;
}
