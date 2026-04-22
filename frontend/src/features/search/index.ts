/**
 * Search Feature - Public API
 *
 * This is the public interface for the search feature.
 * Other features should import from here, not from internal files.
 */

// API - Core search operations
export {
  filterEvents,
  sortEvents,
  getFilterCounts,
  type SearchFilters,
  type SortOptions,
} from "./api/search.api";

// API - Filter state management
export {
  serializeFiltersToJSON,
  parseFiltersFromJSON,
  parseFilterQueryString,
} from "./api/search.api";

// Components
export { SearchBar } from "./components/SearchBar";
export { VisualFilters } from "./components/VisualFilters";
export { FilterDropdown } from "./components/FilterDropdown";
export { FilterSection } from "./components/FilterSection";
export { AIGenerationInput } from "./components/AIGenerationInput";
export { JSONFilterEditor } from "./components/JSONFilterEditor";
export { MoreFiltersButton } from "./components/MoreFiltersButton";
export { QuickFilterChip } from "./components/QuickFilterChip";

// Hooks
export { useSearch } from "./hooks/useSearch";
export { useFilterState } from "./hooks/useFilterState";

// Store
export { useSearchStore } from "./store/search.store";
