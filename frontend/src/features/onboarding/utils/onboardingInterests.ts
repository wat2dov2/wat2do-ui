import type { Event } from "@/shared/types";
import { getEventCategory } from "@/shared/utils/event";

/**
 * The interests onboarding saves: the topics the reader picked, then the
 * categories of the events they tapped, each once.
 */
export function onboardingInterests(
  topics: readonly string[],
  pickedEvents: readonly Pick<Event, "category">[],
): string[] {
  return [...new Set([...topics, ...pickedEvents.map(getEventCategory)])];
}
