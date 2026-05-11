import React, { useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { formatDistanceToNow } from "date-fns";
import { Utensils, Heart } from "lucide-react";
import { EventList, EventCount } from "@/features/events";
import { LoadingPage } from "@/shared/ui/loading-page";
import { SearchBar, QuickFilterChip, MoreFiltersButton, FilterDropdown } from "@/features/search";
import { useEasterEggs } from "@/shared/components/useEasterEggs";
import { useAppPrefsStore } from "@/shared/store/appPrefs.store";
import { useModalStore } from "@/shared/store/modal.store";
import { useProfileCompleted } from "@/features/auth/hooks/useAuthState";
import { useDarkMode } from "@/shared/hooks";
import { useEventsPageData } from "@/features/events/hooks/useEventsPageData";
import type { ViewMode, QuickFilterConfig } from "@/shared/types";

export function EventsPageContainer() {
  const viewMode = useAppPrefsStore((s) => s.viewMode);
  const setViewMode = useAppPrefsStore((s) => s.setViewMode);
  const filterViewMode = useAppPrefsStore((s) => s.filterViewMode);
  const setFilterViewMode = useAppPrefsStore((s) => s.setFilterViewMode);
  // Filter dropdown open/close lives in the modal store (shared with the
  // command palette) rather than the search filter-value store.
  const showFilterDropdown = useModalStore((s) => s.showFilterDropdown);
  const setShowFilterDropdown = useModalStore((s) => s.setShowFilterDropdown);
  const { isDarkMode } = useDarkMode();
  const profileCompleted = useProfileCompleted();
  const { t } = useTranslation();
  const { activeEasterEgg, clearEasterEgg, checkSearchQuery } = useEasterEggs();

  const {
    isLoading,
    error,
    fetchEvents,
    savedEventIds,
    latestAddedEvent,
    recsLoading,
    filters,
    orderedEvents,
    handleDeleteEvent,
  } = useEventsPageData({ profileCompleted });

  // Memoize view mode change handler to ensure stable reference
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
  }, [setViewMode]);

  // Build filter config array. `filters` is the aggregate returned by
  // useSearch; React Compiler infers it as a single dep rather than the
  // narrow property list, so depend on the whole object for consistency
  // with the compiler's preservation check.
  const filterConfigs: QuickFilterConfig[] = useMemo(
    () =>
      [
        {
          id: "freeFood",
          icon: <Utensils className="w-3.5 h-3.5" />,
          labelKey: "common.freeFood",
          active: filters.freeFoodFilter,
          onClick: () => filters.setFreeFoodFilter(!filters.freeFoodFilter),
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
    [filters, profileCompleted, savedEventIds.length]
  );

  return (
    // Cancel the AppLayout scroll container's p-6 so the sticky toolbar can
    // sit flush against the scrollport edges. Re-add equivalent padding on
    // the sticky inner content and <main> so the visible layout is unchanged.
    <div className="-m-6 isolate">
      {/* Sticky toolbar: search + filter row stay pinned as the user scrolls.
          -top-6 + pt-10 covers the scroll container's p-6 top padding so event
          cards scrolling up don't bleed through the gap between the fixed
          TopNav and the toolbar. */}
      <div className="sticky -top-6 z-20 bg-background px-6 pt-7 pb-3 space-y-5">
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

        {/* Filters - only show when events and recommendations are loaded */}
        {!isLoading && !recsLoading && (
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
                open={showFilterDropdown}
                onOpenChange={setShowFilterDropdown}
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
        )}
      </div>

      {/* Main Content */}
      <main className="w-full px-6 pt-5 pb-6" role="main" aria-label={t("search.ariaLabel")}>
        {isLoading || recsLoading ? (
          <LoadingPage />
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <p className="text-destructive text-sm text-center max-w-md">{error}</p>
            <button
              type="button"
              onClick={() => fetchEvents()}
              className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Try again
            </button>
          </div>
        ) : (
          <EventList
            events={orderedEvents}
            viewMode={viewMode}
            onDelete={handleDeleteEvent}
            onClearFilters={filters.handleClearAllFilters}
          />
        )}
      </main>
    </div>
  );
}
