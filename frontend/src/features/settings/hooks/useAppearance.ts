/**
 * useAppearance Hook
 * Manages appearance preferences (view mode, filter view mode)
 * 
 * Note: viewMode and filterViewMode are also managed globally in UIContext
 * This hook provides local state management for the settings page
 */

import type { ViewMode, FilterViewMode } from "@/shared/types";

export interface UseAppearanceProps {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  filterViewMode: FilterViewMode;
  setFilterViewMode: (mode: FilterViewMode) => void;
}

export function useAppearance({
  viewMode,
  setViewMode,
  filterViewMode,
  setFilterViewMode,
}: UseAppearanceProps) {
  return {
    viewMode,
    setViewMode,
    filterViewMode,
    setFilterViewMode,
  };
}
