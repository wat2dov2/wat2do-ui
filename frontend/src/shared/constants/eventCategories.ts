/**
 * Source of truth for event categories.
 * Matches the options in onboarding: "Everyone here is into something different. What kind of events are you into?"
 * Used app-wide: create event modal, filters, event cards, onboarding.
 * All events in the database should use one of these category values.
 */
export const EVENT_CATEGORIES = [
  "Academics",
  "Studying",
  "Career",
  "Networking",
  "Games",
  "Partying",
  "Athletics",
  "Art",
  "Dance",
  "Culture",
  "Religion",
  "Advocacy",
  "Technology",
  "Design",
  "Entrepreneurship",
  "Health",
  "Wellness",
  "Mental Health",
  "Music",
  "Sports",
  "Food",
  "Volunteering",
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];
