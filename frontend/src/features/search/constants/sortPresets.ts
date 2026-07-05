export interface SortPreset {
  id: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
  labelKey: string;
}

export const SORT_PRESETS: SortPreset[] = [
  {
    id: "date-asc",
    sortBy: "date",
    sortOrder: "asc",
    labelKey: "filters.sortHappeningSoon",
  },
  {
    id: "date-desc",
    sortBy: "date",
    sortOrder: "desc",
    labelKey: "filters.sortLaterDates",
  },
  {
    id: "added_at-desc",
    sortBy: "added_at",
    sortOrder: "desc",
    labelKey: "filters.sortRecentlyAdded",
  },
  {
    id: "title-asc",
    sortBy: "title",
    sortOrder: "asc",
    labelKey: "filters.sortTitleAZ",
  },
  {
    id: "price-asc",
    sortBy: "price",
    sortOrder: "asc",
    labelKey: "filters.sortLowestPrice",
  },
  {
    id: "location-asc",
    sortBy: "location",
    sortOrder: "asc",
    labelKey: "filters.sortLocationAZ",
  },
];

export function findSortPreset(
  sortBy: string,
  sortOrder: "asc" | "desc",
): SortPreset | undefined {
  return SORT_PRESETS.find(
    (preset) => preset.sortBy === sortBy && preset.sortOrder === sortOrder,
  );
}
