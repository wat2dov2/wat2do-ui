/**
 * Fetches shared domain constants from the backend (/meta/constants).
 *
 * Called during app init (main.tsx) so categories, interest mappings,
 * and status enums hydrate from one backend source of truth before render.
 */

import { api } from "@/shared/services/apiClient";

interface AppConstants {
  event_categories: string[];
  interests: string[];
  interest_to_categories: Record<string, string[]>;
  report_statuses: string[];
}

// ---------------------------------------------------------------------------
// Module-level cache — written once by loadAppConstants(), read many times.
// ---------------------------------------------------------------------------
let cached: AppConstants = {
  event_categories: [],
  interests: [],
  interest_to_categories: {},
  report_statuses: [],
};

/**
 * Fetch constants from the backend. Call once during app init.
 */
export async function loadAppConstants(): Promise<void> {
  cached = await api.get<AppConstants>("/meta/constants");
}

/**
 * Synchronous access to the fetched constants.
 * Safe to call anywhere after app init.
 */
export function getAppConstants(): AppConstants {
  return cached;
}
