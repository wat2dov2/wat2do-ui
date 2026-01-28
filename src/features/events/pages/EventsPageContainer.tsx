import React, { useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Utensils, Sparkles, Heart } from "lucide-react";
import { EventList, EventCount, useAppEvents, useSavedEvents } from "@/features/events";
import { EventsProvider } from "@/features/events/context/EventsContext";
import { SearchBar, QuickFilterChip, MoreFiltersButton, FilterDropdown, useSearch } from "@/features/search";
import { useAppPromotions } from "@/app/hooks/useAppPromotions";
import { useEasterEggs } from "@/shared/components/useEasterEggs";
import { useAppContext } from "@/contexts/AppContext";
import type { ViewMode, QuickFilterConfig } from "@/shared/types";

export function EventsPageContainer() {
  const {
    profileCompleted,
    viewMode,
    setViewMode,
    filterViewMode,
    setFilterViewMode,
    isDarkMode,
    isAdmin,
  } = useAppContext();
  const { t } = useTranslation();
  const { activeEasterEgg, clearEasterEgg, checkSearchQuery } = useEasterEggs();
  
  // Use hooks for business logic
  const appEvents = useAppEvents();
  const { savedEventIds, toggleSaveEvent } = useSavedEvents();
  const promotions = useAppPromotions();
  
  const filters = useSearch({
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

  // Memoize view mode change handler to ensure stable reference
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
  }, [setViewMode]);

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
          labelKey: "common.freeFood",
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
          onViewModeChange={handleViewModeChange}
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
        <EventsProvider
          savedEventIds={savedEventIds}
          toggleSaveEvent={toggleSaveEvent}
          activePromotedEventIds={promotions.activePromotedEventIds}
          isAdmin={isAdmin}
          onEdit={handleEditEvent}
          onDelete={handleDeleteEvent}
          allEvents={appEvents.events}
          onClearFilters={filters.handleClearAllFilters}
        >
          <EventList
            events={filters.filteredEvents}
            viewMode={viewMode}
          />
        </EventsProvider>
      </main>
    </div>
  );
}
