import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Utensils, Sparkles, Heart } from "lucide-react";
import { EventList } from "@/components/EventList";
import { SearchBar } from "@/components/SearchBar";
import { EventCount } from "@/components/EventCount";
import { QuickFilterChip } from "@/components/QuickFilterChip";
import { MoreFiltersButton } from "@/components/MoreFiltersButton";
import { FilterDropdown } from "@/components/FilterDropdown";
import { useAppEvents } from "@/hooks/useAppEvents";
import { useAppFilters } from "@/hooks/useAppFilters";
import { useAppPromotions } from "@/hooks/useAppPromotions";
import { useSavedEvents } from "@/hooks/useSavedEvents";
import { useEasterEggs } from "@/hooks/useEasterEggs";
import type { ViewMode, FilterViewMode, QuickFilterConfig } from "@/types";

interface EventsPageContainerProps {
  profileCompleted: boolean;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  filterViewMode: FilterViewMode;
  setFilterViewMode: (mode: FilterViewMode) => void;
  isDarkMode: boolean;
  isAdmin: boolean;
}

export function EventsPageContainer({
  profileCompleted,
  viewMode,
  setViewMode,
  filterViewMode,
  setFilterViewMode,
  isDarkMode,
  isAdmin,
}: EventsPageContainerProps) {
  const { t } = useTranslation();
  const { activeEasterEgg, clearEasterEgg, checkSearchQuery } = useEasterEggs();
  
  // Use hooks for business logic
  const appEvents = useAppEvents();
  const { savedEventIds, toggleSaveEvent } = useSavedEvents();
  const promotions = useAppPromotions();
  
  const filters = useAppFilters({
    events: appEvents.events,
    profileCompleted,
    savedEventIds,
  });

  const handleEditEvent = (event: any) => {
    appEvents.handleEditEvent(event);
  };

  const handleDeleteEvent = (eventId: number) => {
    appEvents.deleteEvent(eventId);
  };

  // Build filter config array
  const filterConfigs: QuickFilterConfig[] = useMemo(
    () =>
      [
        {
          id: "today",
          icon: <Clock className="w-3.5 h-3.5" />,
          labelKey: "filters.today",
          active: filters.todayFilter,
          onClick: () => {
            filters.setTodayFilter(!filters.todayFilter);
            if (!filters.todayFilter) filters.setThisWeekFilter(false);
          },
          badge:
            filters.todayEventsCount > 0
              ? filters.todayEventsCount
              : undefined,
        },
        {
          id: "freeFood",
          icon: <Utensils className="w-3.5 h-3.5" />,
          labelKey: "filters.freeFood",
          active: filters.freeFoodFilter,
          onClick: () => {
            filters.setFreeFoodFilter(!filters.freeFoodFilter);
            if (!filters.freeFoodFilter) filters.setFreeFilter(false);
          },
          badge:
            filters.freeFoodEventsCount > 0
              ? filters.freeFoodEventsCount
              : undefined,
        },
        {
          id: "forYou",
          icon: <Sparkles className="w-3.5 h-3.5" />,
          labelKey: "filters.forYou",
          active: filters.forYouFilter,
          onClick: () => filters.setForYouFilter(!filters.forYouFilter),
          visible: profileCompleted,
        },
        {
          id: "saved",
          icon: <Heart className="w-3.5 h-3.5" />,
          labelKey: "filters.saved",
          active: filters.savedFilter,
          onClick: () => filters.setSavedFilter(!filters.savedFilter),
          badge: savedEventIds.length > 0 ? savedEventIds.length : undefined,
          visible: profileCompleted,
        },
      ].filter((config) => config.visible !== false),
    [
      filters.todayFilter,
      filters.todayEventsCount,
      filters.freeFoodFilter,
      filters.freeFoodEventsCount,
      filters.forYouFilter,
      filters.savedFilter,
      filters.setTodayFilter,
      filters.setThisWeekFilter,
      filters.setFreeFoodFilter,
      filters.setFreeFilter,
      filters.setForYouFilter,
      filters.setSavedFilter,
      profileCompleted,
      savedEventIds.length,
    ]
  );

  return (
    <div className="space-y-5">
      {/* Search and Quick Filters */}
      <div className="space-y-5">
        {/* Search Bar with View Mode Tabs */}
        <SearchBar
          searchQuery={filters.searchQuery}
          onSearchChange={(query) => {
            filters.setSearchQuery(query);
            checkSearchQuery(query);
          }}
          onSearchClear={() => filters.setSearchQuery("")}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />

        {/* Event Count and Quick Filter Chips */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <EventCount count={filters.filteredEvents.length} />
          <div className="relative flex flex-wrap items-center gap-2">
            {filterConfigs
              .filter((config) => config.visible !== false)
              .map((config) => (
                <QuickFilterChip
                  key={config.id}
                  icon={config.icon}
                  label={t(config.labelKey)}
                  active={config.active}
                  onClick={config.onClick}
                  badge={config.badge}
                />
              ))}
            <MoreFiltersButton
              isOpen={filters.showFilterDropdown}
              filterCount={filters.filterCount}
              onToggle={() =>
                filters.setShowFilterDropdown(!filters.showFilterDropdown)
              }
            />
            {/* Filter Dropdown */}
            {filters.showFilterDropdown && (
              <FilterDropdown
                filterViewMode={filterViewMode}
                onFilterViewModeChange={setFilterViewMode}
                filters={filters}
                isDarkMode={isDarkMode}
              />
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="w-full" role="main" aria-label={t("search.ariaLabel")}>
        <EventList
          events={filters.filteredEvents}
          savedEventIds={savedEventIds}
          activePromotedEventIds={promotions.activePromotedEventIds}
          onToggleSave={toggleSaveEvent}
          viewMode={viewMode}
          allEvents={appEvents.events}
          isAdmin={isAdmin}
          onEdit={handleEditEvent}
          onDelete={handleDeleteEvent}
          onClearFilters={filters.handleClearAllFilters}
        />
      </main>
    </div>
  );
}
