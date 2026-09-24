export type EventDateFilter =
  | "any"
  | "today"
  | "tomorrow"
  | "thisWeek"
  | "thisWeekend"
  | "nextWeek"
  | "custom";

export type EventFormatFilter = "any" | "inPerson" | "online";

export interface FilterState {
  searchQuery: string;
  categories: string[];
  locations: string[];
  foods: string[];
  days: string[];
  minPrice: string;
  maxPrice: string;
  minGoing: number;
  eventFormat: EventFormatFilter;
  registration: boolean;
  clubs: string[];
  hasFood: boolean;
  going: boolean;
  sortBy: string;
  sortOrder: "asc" | "desc";
  addedSince: string;
  dateFilter: EventDateFilter;
  customDate: string;
}
