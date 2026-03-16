import React, { useMemo, useCallback, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { formatDistanceToNow } from "date-fns";
import { Utensils, Heart } from "lucide-react";
import { EventList, EventCount, useAppEvents, useSavedEvents, useLatestAddedEvent } from "@/features/events";
import { LoadingPage } from "@/shared/ui/loading-page";
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
  const { isLoading } = appEvents;
  const { savedEventIds, toggleSaveEvent } = useSavedEvents();
  const promotions = useAppPromotions();
  const { latest: latestAddedEvent } = useLatestAddedEvent();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!latestAddedEvent) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [latestAddedEvent]);

  const filters = useSearch({
    events: appEvents.events,
    profileCompleted,
    savedEventIds,
  });

  const handleEditEvent = (event: any) => {
    appEvents.handleEditEvent(event);
  };

  const handleDeleteEvent = async (eventId: number) => {
    await appEvents.deleteEvent(eventId);
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
      filters.freeFoodFilter,
      filters.freeFoodEventsCount,
      filters.savedFilter,
      filters.setFreeFoodFilter,
      filters.setFreeFilter,
      filters.setSavedFilter,
      profileCompleted,
      savedEventIds.length,
    ]
  );

  return (
    <div className="space-y-5">
      {/* Search Bar - always visible */}
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

      {/* Filters - only show when events are loaded */}
      {!isLoading && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-baseline gap-3">
              <EventCount count={filters.filteredEvents.length} />
              {latestAddedEvent && (
                <button
                  type="button"
                  onClick={() => filters.setSearchQuery(latestAddedEvent.title)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors text-left relative -top-px"
                  aria-label={t("events.latestAdded", {
                    title: latestAddedEvent.title,
                    timeAgo: formatDistanceToNow(new Date(latestAddedEvent.added_at), { addSuffix: true }),
                  })}
                >
                  {t("events.latestAdded", {
                    title: latestAddedEvent.title,
                    timeAgo: formatDistanceToNow(new Date(latestAddedEvent.added_at), { addSuffix: true }),
                  })}
                </button>
              )}
            </div>
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
                open={filters.showFilterDropdown}
                onOpenChange={filters.setShowFilterDropdown}
                filterCount={filters.filterCount}
                onClearFilters={filters.handleClearAllFilters}
              >
                <FilterDropdown
                  filterViewMode={filterViewMode}
                  onFilterViewModeChange={setFilterViewMode}
                  filters={filters}
                  isDarkMode={isDarkMode}
                />
              </MoreFiltersButton>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="w-full" role="main" aria-label={t("search.ariaLabel")}>
        {isLoading ? (
          <LoadingPage />
        ) : (
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
        )}
      </main>
    </div>
  );
}
