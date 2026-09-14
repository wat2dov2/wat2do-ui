import { getAppConstantsSnapshot } from "@/shared/api/metaApi";

export function getDefaultEventCategory(): string {
  return getAppConstantsSnapshot().event_categories[0] ?? "";
}
