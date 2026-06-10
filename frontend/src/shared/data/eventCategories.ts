/**
 * Event category helpers backed by /meta/constants.
 *
 * Call after app init (main.tsx awaits loadAppConstants).
 */

import { getAppConstants } from "@/shared/api/metaApi";

export type EventCategory = string;

export function getEventCategories(): string[] {
  return getAppConstants().event_categories;
}

export function getDefaultEventCategory(): string {
  const categories = getEventCategories();
  return categories[0] ?? "";
}

export function isEventCategory(value: string): boolean {
  return getEventCategories().includes(value);
}
