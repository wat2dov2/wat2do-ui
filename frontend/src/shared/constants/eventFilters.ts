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
const eventQuickFilters = [
  { id: "going", labelKey: "filters.going", value: "goingFilter", action: "setGoingFilter", requiresProfile: true },
  { id: "new", labelKey: "common.newlyAddedFilter.last24Hours" },
  { id: "featured", labelKey: "filters.featured", value: "featured", action: "setFeatured" },
  { id: "employersOnCampus", labelKey: "filters.employersOnCampus", value: "employersOnCampus", action: "setEmployersOnCampus" },
  { id: "freeFoodOnCampus", labelKey: "filters.freeFoodOnCampus", value: "freeFoodOnCampus", action: "setFreeFoodOnCampus" },
  { id: "price", labelKey: "filters.anyPrice" },
  { id: "campusSeasons" },
  { id: "sportsGame", labelKey: "filters.sportsGame", value: "sportsGame", action: "setSportsGame" },
  { id: "competitions", labelKey: "filters.competitions", value: "competitions", action: "setCompetitions" },
  { id: "date", labelKey: "events.dateFilter.any" },
  { id: "minGoing", labelKey: "events.goingCount" },
  { id: "hasFood", labelKey: "filters.food", value: "hasFoodFilter", action: "setHasFoodFilter" },
] as const;

/** Loading shells only show controls whose availability is already established. */
export function getEventQuickFilters({
  profileCompleted = false,
  sportsGameAvailable = false,
}: { profileCompleted?: boolean; sportsGameAvailable?: boolean } = {}) {
  return eventQuickFilters.filter(config =>
    (!("requiresProfile" in config) || profileCompleted) &&
    (config.id !== "sportsGame" || sportsGameAvailable),
  );
}
