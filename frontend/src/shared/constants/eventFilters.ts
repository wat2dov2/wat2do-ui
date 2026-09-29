export const availableDays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** Event metadata may retain categories that are no longer offered as filters. */
export function getEventFilterCategories(categories: readonly string[]): string[] {
  return categories.filter(category => category !== "Media & Web");
}

/** Shared by the live filter controls and their initial loading shell. */
export const eventQuickFilters = [
  { id: "going", labelKey: "filters.going", value: "goingFilter", action: "setGoingFilter", requiresProfile: true },
  { id: "new", labelKey: "common.newlyAddedFilter.last24Hours" },
  { id: "employersOnCampus", labelKey: "filters.employersOnCampus", value: "employersOnCampus", action: "setEmployersOnCampus" },
  { id: "freeFoodOnCampus", labelKey: "filters.freeFoodOnCampus", value: "freeFoodOnCampus", action: "setFreeFoodOnCampus" },
  { id: "price", labelKey: "common.free" },
  { id: "campusSeasons" },
  { id: "sportsGame", labelKey: "filters.sportsGame", value: "sportsGame", action: "setSportsGame" },
  { id: "date", labelKey: "events.dateFilter.any" },
  { id: "minGoing", labelKey: "events.goingCount" },
  { id: "hasFood", labelKey: "filters.food", value: "hasFoodFilter", action: "setHasFoodFilter" },
] as const;
