/**
 * Search Feature - public re-exports actually consumed outside this feature.
 */

export { SearchBar } from "./components/SearchBar";
export { FilterDropdown } from "./components/FilterDropdown";
export { MoreFiltersButton } from "./components/MoreFiltersButton";
export { QuickFilterChip } from "./components/QuickFilterChip";
export { SortChip } from "./components/SortChip";

export { useSearch } from "./hooks/useSearch";
export { useFilterUrlActions } from "./hooks/useFilterState";
export {
  EMPTY_FILTER_STATE,
  parseFilterQueryString,
  writeFiltersToSearchParams,
} from "./api/filterService";
