import { useMemo, useCallback, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { EventList } from "../components/EventList";
import { EventCount } from "../components/EventCount";
import { EventsBackToTopButton } from "../components/EventsBackToTopButton";
import { SearchBar, QuickFilterChip, MoreFiltersButton, FilterDropdown } from "@/features/search";
import { useUIStore } from "@/shared/store/ui.store";
import { useProfileCompleted } from "@/features/auth";
import { useDarkMode, useHorizontalScrollFade } from "@/shared/hooks";
import { HorizontalScrollFadeEdge } from "@/shared/ui/horizontal-scroll-fade-edge";
import { useEventsPageData } from "@/features/events/hooks/useEventsPageData";
import { EventDetailsModal } from "@/features/events/components/EventDetailsModal";
import { QP } from "@/shared/constants/queryParams";
import { useMutableSearchParams } from "@/shared/hooks/useMutableSearchParams";
import type { ViewMode, QuickFilterConfig, Event } from "@/shared/types";
import { LightRays } from "@/registry/magicui/light-rays";

export function EventsPageContainer() {
  const viewMode = useUIStore((s) => s.viewMode);
  const setViewMode = useUIStore((s) => s.setViewMode);
  const filterViewMode = useUIStore((s) => s.filterViewMode);
  const setFilterViewMode = useUIStore((s) => s.setFilterViewMode);
  const showFilterDropdown = useUIStore((s) => s.showFilterDropdown);
  const setShowFilterDropdown = useUIStore((s) => s.setShowFilterDropdown);
  const { isDarkMode } = useDarkMode();
  const profileCompleted = useProfileCompleted();
  const { t } = useTranslation();
  const [searchParams] = useMutableSearchParams();

  const {
    isLoading,
    error,
    refreshEvents,
    totalEvents,
    goingCounts,
    latestAddedEvent,
    promotedEvents,
    filters,
    orderedEvents,
    allEvents,
    handleDeleteEvent,
  } = useEventsPageData({ profileCompleted, viewMode });

  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const urlEventId = useMemo(() => {
    const eventIdParam = searchParams.get(QP.EVENT_ID);
    if (!eventIdParam) return null;
    const parsed = parseInt(eventIdParam, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }, [searchParams]);

  useEffect(() => {
    setSelectedEventId(urlEventId);
  }, [urlEventId]);

  const selectedEvent = useMemo(() => {
    if (selectedEventId == null) return null;
    return allEvents.find((e) => e.id === selectedEventId) ?? null;
  }, [selectedEventId, allEvents]);

  const handleEventClick = useCallback((event: Event) => {
    setSelectedEventId(event.id);
  }, []);

  const handleCloseEventDetails = useCallback(() => {
    setSelectedEventId(null);
  }, []);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
  }, [setViewMode]);

  const isNewlyAddedActive = filters.addedWithin24h;
  const handleNewlyAddedToggle = useCallback(() => {
    filters.toggleAddedWithin24h();
  }, [filters]);

  const handleLatestAddedEventSearch = useCallback(() => {
    if (!latestAddedEvent) {
      return;
    }

    filters.setSearchQuery(latestAddedEvent.title);
  }, [filters, latestAddedEvent]);

  const filterConfigs: QuickFilterConfig[] = useMemo(
    () =>
      [
        {
          id: "going",
          icon: null,
          labelKey: "filters.going",
          active: filters.goingFilter,
          onClick: () => filters.setGoingFilter(!filters.goingFilter),
          visible: profileCompleted,
        },
        {
          id: "newlyAdded",
          icon: null,
          labelKey: "events.newlyAdded",
          active: isNewlyAddedActive,
          onClick: handleNewlyAddedToggle,
        },
        {
          id: "freeFood",
          icon: null,
          labelKey: "common.freeFood",
          active: filters.freeFoodFilter,
          onClick: () => filters.setFreeFoodFilter(!filters.freeFoodFilter),
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
    refreshKey: `${filterConfigs.length}:${filters.categoryOptions.length}`,
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
          <EventCount
            count={totalEvents}
            latestAddedEvent={latestAddedEvent}
            onLatestAddedEventSearch={handleLatestAddedEventSearch}
          />
          <SearchBar
            searchQuery={filters.searchQuery}
            onSearchChange={(query) => {
              filters.setSearchQuery(query);
            }}
            onSearchClear={() => filters.setSearchQuery("")}
          />

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
                    onClick={config.onClick}
                  />
                ))}
                {filters.categoryOptions.map((category) => (
                  <QuickFilterChip
                    key={category.id}
                    icon={null}
                    label={category.label}
                    active={filters.selectedCategories.includes(category.id)}
                    onClick={() => filters.toggleCategory(category.id)}
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
              onEventClick={handleEventClick}
              onDelete={handleDeleteEvent}
              onClearFilters={filters.handleClearAllFilters}
              hasActiveFilters={filters.filterCount > 0}
              goingCounts={goingCounts}
              isLoading={isLoading}
              groupByDateSections={filters.sortBy === "date" && filters.sortOrder === "asc"}
            />
          )}
        </main>
      </div>
      <EventsBackToTopButton />
      <EventDetailsModal
        eventId={selectedEventId}
        event={selectedEvent}
        onClose={handleCloseEventDetails}
        allEvents={orderedEvents}
      />
    </>
  );
}
