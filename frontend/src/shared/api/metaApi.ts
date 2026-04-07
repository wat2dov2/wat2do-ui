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

export interface AppConstants {
  event_categories: string[];
  interest_to_categories: Record<string, string[]>;
  submission_statuses: string[];
  report_statuses: string[];
}

// ---------------------------------------------------------------------------
// Static fallbacks — used only if the /meta/constants fetch fails.
// Keep these as a safety net; the backend is the source of truth.
// ---------------------------------------------------------------------------
const FALLBACK: AppConstants = {
  event_categories: [
    "Academics", "Studying", "Career", "Networking", "Games",
    "Partying", "Athletics", "Art", "Dance", "Culture",
    "Religion", "Advocacy", "Technology", "Design", "Entrepreneurship",
    "Health", "Wellness", "Mental Health", "Music", "Sports",
    "Food", "Volunteering",
  ],
  interest_to_categories: {
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
  },
  submission_statuses: ["pending", "approved", "rejected"],
  report_statuses: ["pending", "resolved", "dismissed"],
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
