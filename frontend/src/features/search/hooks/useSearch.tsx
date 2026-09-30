import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFilterState } from "@/features/search/hooks/useFilterState";
import { filterEvents, sortEvents } from "@/features/search/api/searchService";
import { getFilterCounts } from "@/shared/utils/filter";
import { useAppConstants } from "@/shared/hooks/useAppConstants";
import { availableDays, getEventFilterCategories } from "@/shared/constants/eventFilters";
import { translateCategory } from "@/shared/utils/event";
import type { Event } from "@/shared/types";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { resolveCampusSeasonFilters, resolveVarsityGamesFilter } from "@/features/search/api/filterService";

/**
 * Search/filter orchestration: useFilterState for store state, searchService for logic.
 * UI expand/collapse state lives in components.
 */
interface UseSearchOptions {
  events: Event[];
  eventsReady: boolean;
  goingEventIds: number[];
  goingCounts: Readonly<Record<string, { going_count: number }>> | null;
  school: string;
  currentTimeMs: number | null;
}

export function useSearch({
  events,
  eventsReady,
  goingEventIds,
  goingCounts,
  school,
  currentTimeMs,
}: UseSearchOptions) {
  const { getSchoolTimezone, schoolBySlug } = useSchoolDirectory();
  const { t, i18n } = useTranslation();
  const { event_categories: eventCategories } = useAppConstants();

  const filterState = useFilterState();
  const varsityGames = useMemo(
    () => resolveVarsityGamesFilter(eventsReady ? events : null, school, currentTimeMs, filterState.sportsGame),
    [events, eventsReady, school, currentTimeMs, filterState.sportsGame],
  );
  const schoolRecord = schoolBySlug.get(school);
  const language = i18n.resolvedLanguage ?? i18n.language;
  const campusSeasons = useMemo(
    () => resolveCampusSeasonFilters(schoolRecord, currentTimeMs, language, filterState.campusSeasonIds, eventsReady ? events : null),
    [schoolRecord, currentTimeMs, language, filterState.campusSeasonIds, eventsReady, events],
  );
  const { setCampusSeasonIds, setSportsGame } = filterState;
  useEffect(() => {
    if (campusSeasons.ready && campusSeasons.selectedIds.length !== filterState.campusSeasonIds.length) {
      setCampusSeasonIds(campusSeasons.selectedIds, "normalization");
    }
  }, [campusSeasons, filterState.campusSeasonIds, setCampusSeasonIds]);
  useEffect(() => {
    if (varsityGames.ready && filterState.sportsGame && !varsityGames.available) {
      setSportsGame(false, "normalization");
    }
  }, [varsityGames, filterState.sportsGame, setSportsGame]);

  const filteredEvents = useMemo(() => {
    const filtered = filterEvents(events, {
      searchQuery: filterState.searchQuery,
      goingFilter: filterState.goingFilter,
      hasFoodFilter: filterState.hasFoodFilter,
      employersOnCampus: filterState.employersOnCampus,
      freeFoodOnCampus: filterState.freeFoodOnCampus,
      sportsGame: varsityGames.selected,
      campusSeasonIds: campusSeasons.selectedIds,
      campusSeasonOptions: campusSeasons.options,
      selectedDays: filterState.selectedDays,
      minPrice: filterState.minPrice,
      maxPrice: filterState.maxPrice,
      minGoing: filterState.minGoing,
      selectedLocations: filterState.selectedLocations,
      selectedFoods: filterState.selectedFoods,
      selectedCategories: filterState.selectedCategories,
      registration: filterState.registration,
      goingEventIds,
      selectedClubs: filterState.selectedClubs,
      addedSince: filterState.addedSince,
      dateFilter: filterState.dateFilter,
      customDate: filterState.customDate,
    }, getSchoolTimezone, goingCounts ?? {});
    return sortEvents(filtered, { sortBy: filterState.sortBy, sortOrder: filterState.sortOrder });
  }, [
    events,
    getSchoolTimezone,
    filterState.searchQuery,
    filterState.hasFoodFilter,
    filterState.employersOnCampus,
    filterState.freeFoodOnCampus,
    varsityGames.selected,
    campusSeasons.selectedIds,
    campusSeasons.options,
    filterState.selectedDays,
    filterState.minPrice,
    filterState.maxPrice,
    filterState.minGoing,
    goingCounts,
    filterState.selectedLocations,
    filterState.selectedFoods,
    filterState.selectedCategories,
    filterState.registration,
    filterState.goingFilter,
    goingEventIds,
    filterState.sortBy,
    filterState.sortOrder,
    filterState.selectedClubs,
    filterState.addedSince,
    filterState.dateFilter,
    filterState.customDate,
  ]);

  const filterCount = getFilterCounts({ ...filterState, sportsGame: varsityGames.selected, campusSeasonIds: campusSeasons.selectedIds });

  const categoryOptions = useMemo(
    () =>
      getEventFilterCategories(eventCategories).map((cat) => ({
        id: cat,
        label: translateCategory(cat, t),
      })),
    [eventCategories, t],
  );

  const dayOptions = useMemo(
    () =>
      availableDays.map((day) => {
        const key = `days.${day.toLowerCase()}`;
        const translated = t(key);
        return {
          id: day,
          label: translated !== key ? translated : day,
        };
      }),
    [t],
  );

  return {
    ...filterState,
    sportsGame: varsityGames.selected,
    sportsGameAvailable: varsityGames.available,
    campusSeasonIds: campusSeasons.selectedIds,
    campusSeasonOptions: campusSeasons.options,
    categoryOptions,
    dayOptions,
    filteredEvents,
    filterCount,
  };
}
