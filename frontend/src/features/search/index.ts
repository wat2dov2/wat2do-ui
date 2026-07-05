/**
 * Search Feature - public re-exports actually consumed outside this feature.
 */

export { SearchBar } from "./components/SearchBar";
export { FilterDropdown } from "./components/FilterDropdown";
export { MoreFiltersButton } from "./components/MoreFiltersButton";
export { QuickFilterChip } from "./components/QuickFilterChip";
export { SortStatusLabel } from "./components/SortStatusLabel";

export { useSearch } from "./hooks/useSearch";
export { useFilterActions } from "./hooks/useFilterState";
export { EMPTY_FILTER_STATE } from "./api/filterService";
