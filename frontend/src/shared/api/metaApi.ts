/**
 * Fetches shared domain constants from the backend (/meta/constants).
 *
 * Called during app init (main.tsx) so categories, interest mappings,
 * and status enums hydrate from one backend source of truth before render.
 */

import { api } from "@/shared/services/apiClient";

interface AppConstants {
  event_categories: string[];
  organization_categories: string[];
  interests: string[];
  interest_to_categories: Record<string, string[]>;
  report_statuses: string[];
}

type AppConstantsPayload = Partial<Record<keyof AppConstants, unknown>>;

// ---------------------------------------------------------------------------
// Module-level cache — written once by loadAppConstants(), read many times.
// ---------------------------------------------------------------------------
let cached: AppConstants = {
  event_categories: [],
  organization_categories: [],
  interests: [],
  interest_to_categories: {},
  report_statuses: [],
};

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toStringArrayRecord(value: unknown): Record<string, string[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, rawValues]) => [key, toStringArray(rawValues)]),
  );
}

function normalizeAppConstants(payload: AppConstantsPayload): AppConstants {
  return {
    event_categories: toStringArray(payload.event_categories),
    organization_categories: toStringArray(payload.organization_categories),
    interests: toStringArray(payload.interests),
    interest_to_categories: toStringArrayRecord(payload.interest_to_categories),
    report_statuses: toStringArray(payload.report_statuses),
  };
}

/**
 * Fetch constants from the backend. Call once during app init.
 */
export async function loadAppConstants(): Promise<void> {
  cached = normalizeAppConstants(await api.get<AppConstantsPayload>("/meta/constants"));
}

/**
 * Synchronous access to the fetched constants.
 * Safe to call anywhere after app init.
 */
export function getAppConstants(): AppConstants {
  return cached;
}
