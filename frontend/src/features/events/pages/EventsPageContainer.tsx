import { useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { EventList } from "../components/EventList";
import { EventCount } from "../components/EventCount";
import { EventsBackToTopButton } from "../components/EventsBackToTopButton";
import { LightRays } from "@/registry/magicui/light-rays";
import { SearchBar, QuickFilterChip, MoreFiltersButton, FilterDropdown } from "@/features/search";
import { useUIStore } from "@/shared/store/ui.store";
import { useProfileCompleted } from "@/features/auth";
import { useDarkMode, useHorizontalScrollFade } from "@/shared/hooks";
import { HorizontalScrollFadeEdge } from "@/shared/ui/horizontal-scroll-fade-edge";
import { useEventsPageData } from "@/features/events/hooks/useEventsPageData";
import type { ViewMode, QuickFilterConfig } from "@/shared/types";

export function EventsPageContainer() {
  const viewMode = useUIStore((s) => s.viewMode);
  const setViewMode = useUIStore((s) => s.setViewMode);
  const filterViewMode = useUIStore((s) => s.filterViewMode);
  const setFilterViewMode = useUIStore((s) => s.setFilterViewMode);
  // Filter dropdown open/close lives in the UI store (shared with the
  // command palette) rather than the search filter-value store.
  const showFilterDropdown = useUIStore((s) => s.showFilterDropdown);
  const setShowFilterDropdown = useUIStore((s) => s.setShowFilterDropdown);
  const { isDarkMode } = useDarkMode();
  const profileCompleted = useProfileCompleted();
  const { t } = useTranslation();

  const {
    isLoading,
    isLoadingMore,
    error,
    refreshEvents,
    loadMoreEvents,
    totalEvents,
    hasMoreEvents,
    savedEventIds,
    latestAddedEvent,
    promotedEvents,
    filters,
    orderedEvents,
    handleDeleteEvent,
  } = useEventsPageData({ profileCompleted });

  const isPageLoading = isLoading;

  // Memoize view mode change handler to ensure stable reference
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
  }, [setViewMode]);

  const isNewlyAddedActive = filters.addedWithin24h;
  const handleNewlyAddedToggle = useCallback(() => {
    filters.toggleAddedWithin24h();
  }, [filters]);

  // Build filter config array. `filters` is the aggregate returned by
  // useSearch; React Compiler infers it as a single dep rather than the
  // narrow property list, so depend on the whole object for consistency
  // with the compiler's preservation check.
  const filterConfigs: QuickFilterConfig[] = useMemo(
    () =>
      [
        {
          id: "saved",
          icon: null,
          labelKey: "filters.saved",
          active: filters.savedFilter,
          onMouseDown: () => filters.setSavedFilter(!filters.savedFilter),
          visible: profileCompleted,
        },
        {
          id: "newlyAdded",
          icon: null,
          labelKey: "events.newlyAdded",
          active: isNewlyAddedActive,
          onMouseDown: handleNewlyAddedToggle,
        },
        {
          id: "freeFood",
          icon: null,
          labelKey: "common.freeFood",
          active: filters.freeFoodFilter,
          onMouseDown: () => filters.setFreeFoodFilter(!filters.freeFoodFilter),
        },
      ].filter((config) => config.visible !== false),
    [filters, handleNewlyAddedToggle, isNewlyAddedActive, profileCompleted]
  );

  const {
    scrollRef: filterScrollRef,
    scrollEndRef: filterScrollEndRef,
    showScrollFade: showFilterScrollFade,
    syncScrollFade: syncFilterScrollFade,
    syncScrollFadeAfterWheel: syncFilterScrollFadeAfterWheel,
  } = useHorizontalScrollFade<HTMLDivElement>({
    refreshKey: `${filterConfigs.length}:${filters.categoryPieItems.length}`,
  });

  return (
    <>
      <div
        className="pointer-events-none fixed left-0 right-2.5 top-0 z-[45] hidden h-dvh overflow-hidden [mask-image:linear-gradient(to_bottom,black_0%,black_72%,transparent_100%)] sm:block"
        aria-hidden="true"
      >
        {isDarkMode && (
          <LightRays
            data-page-light-rays
            length="110dvh"
            color="rgba(255, 255, 255, 0.06)"
            blendMode="screen"
          />
        )}
      </div>
      <div className="space-y-2">
        <div className="space-y-3 pb-2">
          <EventCount count={totalEvents} latestAddedEvent={latestAddedEvent} />
          <SearchBar
            searchQuery={filters.searchQuery}
            onSearchChange={(query) => {
              filters.setSearchQuery(query);
            }}
            onSearchClear={() => filters.setSearchQuery("")}
          />

          {/* Filters stay visible while event cards load. */}
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <div
                ref={filterScrollRef}
                onScroll={syncFilterScrollFade}
                onWheel={syncFilterScrollFadeAfterWheel}
                onTouchEnd={syncFilterScrollFade}
                className="no-visible-scrollbar flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto pb-1"
              >
                {filterConfigs.map((config) => (
                  <QuickFilterChip
                    key={config.id}
                    icon={config.icon}
                    label={t(config.labelKey)}
                    active={config.active}
                    onMouseDown={config.onMouseDown}
                  />
                ))}
                {filters.categoryPieItems.map((category) => (
                  <QuickFilterChip
                    key={category.id}
                    icon={null}
                    label={category.label}
                    active={filters.selectedCategories.includes(category.id)}
                    onMouseDown={() => filters.toggleCategory(category.id)}
                  />
                ))}
                <span
                  ref={filterScrollEndRef}
                  aria-hidden="true"
                  className="h-px w-px shrink-0"
                />
              </div>
              <HorizontalScrollFadeEdge visible={showFilterScrollFade} />
            </div>
            <div className="relative shrink-0 pb-1">
              <MoreFiltersButton
                open={showFilterDropdown}
                onOpenChange={setShowFilterDropdown}
                filterCount={filters.filterCount}
                onClearFilters={filters.handleClearAllFilters}
              >
                {showFilterDropdown ? (
                  <FilterDropdown
                    filterViewMode={filterViewMode}
                    onFilterViewModeChange={setFilterViewMode}
                    viewMode={viewMode}
                    onViewModeChange={handleViewModeChange}
                    filters={filters}
                    isDarkMode={isDarkMode}
                  />
                ) : null}
              </MoreFiltersButton>
            </div>
          </div>
        </div>

        <main className="relative z-10 w-full" role="main" aria-label={t("search.ariaLabel")}>
          {error ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <p className="text-destructive text-sm text-center max-w-md">{error}</p>
              <button
                type="button"
                onMouseDown={() => refreshEvents()}
                className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                {t("common.tryAgain")}
              </button>
            </div>
          ) : (
            <EventList
              events={orderedEvents}
              promotedEvents={promotedEvents}
              viewMode={viewMode}
              onDelete={handleDeleteEvent}
              onClearFilters={filters.handleClearAllFilters}
              hasActiveFilters={
                filters.filterCount > 0 ||
                filters.searchQuery !== "" ||
                filters.freeFoodFilter ||
                filters.savedFilter ||
                filters.addedWithin24h ||
                filters.sortBy !== "date" ||
                filters.sortOrder !== "asc"
              }
              savedEventIds={savedEventIds}
              isLoading={isPageLoading}
              isLoadingMore={isLoadingMore}
              hasMoreEvents={hasMoreEvents}
              onLoadMore={loadMoreEvents}
              groupByDateSections={filters.sortBy === "date" && filters.sortOrder === "asc"}
            />
          )}
        </main>
      </div>
      <EventsBackToTopButton />
    </>
  );
}
