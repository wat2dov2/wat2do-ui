export type EventDateFilter =
  | "any"
  | "today"
  | "tomorrow"
  | "thisWeek"
  | "thisWeekend"
  | "nextWeek"
  | "custom";

export interface FilterState {
  searchQuery: string;
  categories: string[];
  locations: string[];
  foods: string[];
  days: string[];
  minPrice: string;
  maxPrice: string;
  minGoing: number;
  registration: boolean;
  clubs: string[];
  hasFood: boolean;
  employersOnCampus: boolean;
  competitions: boolean;
  featured: boolean;
  sportsGame: boolean;
  recurring: boolean;
  campusSeasonIds: string[];
  going: boolean;
  sortBy: string;
  sortOrder: "asc" | "desc";
  addedSince: string;
  dateFilter: EventDateFilter;
  customDate: string;
  /**
   * The start date and time the list begins at: events still on at that moment
   * or later. `"now"` (the default) follows the clock, which is what keeps
   * ended events out; `""` sets no start, so past events are listed too; any
   * other value is a school-local `yyyy-MM-ddTHH:mm` the reader picked.
   */
  startFrom: string;
}
