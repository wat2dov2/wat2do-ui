/**
 * Fetches shared domain constants from the backend (/meta/constants).
 *
 * TanStack Query owns the fetched values. The small fallback below keeps
 * first paint from waiting on that network request.
 */

import { queryOptions } from "@tanstack/react-query";
import { api } from "@/shared/services/apiClient";
import { getQueryClient } from "@/shared/lib/queryClient";
import { queryKeys } from "@/shared/lib/queryKeys";

interface AppConstants {
  event_categories: string[];
  club_categories: string[];
  interests: string[];
  interest_to_categories: Record<string, string[]>;
  report_statuses: string[];
}

type AppConstantsPayload = Partial<Record<keyof AppConstants, unknown>>;

const FALLBACK_CATEGORIES = [
  "Arts & Culture",
  "Academics & Science",
  "Business",
  "Community Service",
  "Environment",
  "Games & Recreation",
  "Health",
  "Media & Web",
  "Politics & Advocacy",
  "Religion & Spirituality",
];

const FALLBACK_INTEREST_TO_CATEGORIES = Object.fromEntries(
  FALLBACK_CATEGORIES.map((category) => [category, [category]]),
);

export const DEFAULT_APP_CONSTANTS: AppConstants = {
  event_categories: FALLBACK_CATEGORIES,
  club_categories: FALLBACK_CATEGORIES,
  interests: FALLBACK_CATEGORIES,
  interest_to_categories: FALLBACK_INTEREST_TO_CATEGORIES,
  report_statuses: ["pending", "resolved", "dismissed"],
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
    club_categories: toStringArray(payload.club_categories),
    interests: toStringArray(payload.interests),
    interest_to_categories: toStringArrayRecord(payload.interest_to_categories),
    report_statuses: toStringArray(payload.report_statuses),
  };
}

export function appConstantsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.meta.constants(),
    queryFn: async () => normalizeAppConstants(await api.get<AppConstantsPayload>("/meta/constants")),
    placeholderData: DEFAULT_APP_CONSTANTS,
  });
}

/**
 * Imperative snapshot for non-React event mappers.
 * Rendered options must subscribe through useAppConstants instead.
 */
export function getAppConstantsSnapshot(): AppConstants {
  return getQueryClient().getQueryData(queryKeys.meta.constants()) ?? DEFAULT_APP_CONSTANTS;
}
