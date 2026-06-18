/**
 * Event category helpers backed by /meta/constants.
 *
 * Uses fallback constants immediately, then backend-hydrated constants once
 * loadAppConstants() completes.
 */

import { getAppConstants } from "@/shared/api/metaApi";


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
