import {
  useMemo,
  useCallback,
  useState,
  useEffect,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { toast } from "@/shared/hooks/use-toast";
import { EventList } from "../components/EventList";
import { EventCount } from "../components/EventCount";
import { SearchBar, MoreFiltersButton, FilterDropdown } from "@/features/search";
import { useUIStore } from "@/shared/store/ui.store";
import { useAuthState } from "@/features/auth";
import { useHorizontalScrollFade } from "@/shared/hooks";
import { HorizontalScrollFade } from "@/shared/ui/horizontal-scroll-fade";
import { Button } from "@/shared/ui/button";
import { useEventsPageData } from "@/features/events/hooks/useEventsPageData";
import { EventDetailsModal } from "@/features/events/components/EventDetailsModal";
import {
  NewlyAddedFilterSelect,
  type NewlyAddedFilterValue,
} from "@/features/events/components/NewlyAddedFilterSelect";
import { QP } from "@/shared/constants/queryParams";
import { ROUTES } from "@/shared/constants/routes";
import { useMutableSearchParams } from "@/shared/hooks/useMutableSearchParams";
import { controlBox } from "@/shared/config/controlBox";
import type { ViewMode, Event } from "@/shared/types";
import { usePosterLandingConfirmation } from "@/features/qrcode";
import { PromoterRecruitmentBanner } from "@/features/posters";
import { Plus } from "@/shared/ui/doodle-icons";

interface QuickFilterButtonConfig {
  id: string;
  labelKey: string;
  active: boolean;
  onClick: () => void;
}

export function EventsPageContainer() {
  usePosterLandingConfirmation();

  const viewMode = useUIStore((s) => s.viewMode);
  const setViewMode = useUIStore((s) => s.setViewMode);
  const showFilterDropdown = useUIStore((s) => s.showFilterDropdown);
  const setShowFilterDropdown = useUIStore((s) => s.setShowFilterDropdown);
  const { profileCompleted, userEmail } = useAuthState();
  const { t } = useTranslation();
  const router = useRouter();
  const [searchParams] = useMutableSearchParams();

  const {
    isLoading,
    error,
    refreshEvents,
    totalEvents,
    eventStats,
    schoolFilter,
    latestAddedEvent,
    promotedEvents,
    lastVisitAt,
    filters,
    orderedEvents,
    allEvents,
  } = useEventsPageData({
    profileCompleted,
    userEmail: profileCompleted ? userEmail : null,
  });
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

  const newlyAddedFilterValue: NewlyAddedFilterValue | null =
    filters.addedSince === ""
      ? null
      : filters.addedSince === lastVisitAt
        ? "sinceLastVisit"
        : "last24Hours";

  const handleNewlyAddedFilterChange = useCallback(
    (value: NewlyAddedFilterValue) => {
      const cutoff =
        value === "sinceLastVisit" && lastVisitAt
          ? lastVisitAt
          : new Date(
              Date.now() - controlBox.eventDiscovery.newEventWindowMs,
            ).toISOString();
      filters.setAddedSince(cutoff);
    },
    [filters, lastVisitAt],
  );

  const handleNewlyAddedFilterClear = useCallback(() => {
    filters.setAddedSince("");
  }, [filters]);

  const handleLatestAddedEventSearch = useCallback(() => {
    if (!latestAddedEvent) {
      return;
    }

    filters.setSearchQuery(latestAddedEvent.title);
  }, [filters, latestAddedEvent]);

  const filterConfigs: QuickFilterButtonConfig[] = useMemo(
    () =>
      [
        {
          id: "going",
          labelKey: "filters.going",
          active: filters.goingFilter,
          onClick: () => filters.setGoingFilter(!filters.goingFilter),
          visible: profileCompleted,
        },
        {
          id: "freeFood",
          labelKey: "common.freeFood",
          active: filters.freeFoodFilter,
          onClick: () => filters.setFreeFoodFilter(!filters.freeFoodFilter),
        },
      ].filter((config) => config.visible !== false),
    [filters, profileCompleted],
  );

  // Submitting an event requires an account, so gate before navigating.
  const handleSubmitEventClick = useCallback(() => {
    if (!profileCompleted) {
      toast({ description: t("navigation.loginRequiredToSubmit") });
      return;
    }
    router.push(ROUTES.EVENT_SUBMIT);
  }, [profileCompleted, router, t]);

  const {
    scrollRef: filterScrollRef,
    scrollEndRef: filterScrollEndRef,
    showScrollFade: showFilterScrollFade,
    syncScrollFade: syncFilterScrollFade,
    syncScrollFadeAfterWheel: syncFilterScrollFadeAfterWheel,
    dragScrollProps: filterDragScrollProps,
  } = useHorizontalScrollFade<HTMLDivElement>({
    refreshKey: `${filterConfigs.length + 1}:${filters.categoryOptions.length}`,
  });

  return (
    <>
      <div className="space-y-2">
        <PromoterRecruitmentBanner school={schoolFilter} />
        <div className="space-y-3 pb-2">
          <EventCount
            count={totalEvents}
            latestAddedEvent={latestAddedEvent}
            onLatestAddedEventSearch={handleLatestAddedEventSearch}
            action={
              <Button type="button" size="sm" onMouseDown={handleSubmitEventClick}>
                <Plus />
                {t("events.submitEvent")}
              </Button>
            }
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
              <HorizontalScrollFade
                ref={filterScrollRef}
                visible={showFilterScrollFade}
                {...filterDragScrollProps}
                data-testid="event-quick-filter-scroll"
                onScroll={syncFilterScrollFade}
                onWheel={syncFilterScrollFadeAfterWheel}
                onTouchEnd={syncFilterScrollFade}
                className="no-visible-scrollbar flex min-w-0 cursor-grab flex-nowrap items-center gap-2 overflow-x-auto pb-1 active:cursor-grabbing"
              >
                <NewlyAddedFilterSelect
                  value={newlyAddedFilterValue}
                  showSinceLastVisit={profileCompleted && lastVisitAt !== null}
                  lastVisitAt={lastVisitAt}
                  onValueChange={handleNewlyAddedFilterChange}
                  onClear={handleNewlyAddedFilterClear}
                />
                {filterConfigs.map((config) => (
                  <Button
                    key={config.id}
                    variant={config.active ? "primary" : "secondary"}
                    size="sm"
                    onClick={config.onClick}
                    aria-pressed={config.active}
                  >
                    {t(config.labelKey)}
                  </Button>
                ))}
                {filters.categoryOptions.map((category) => (
                  <Button
                    key={category.id}
                    variant={
                      filters.selectedCategories.includes(category.id)
                        ? "primary"
                        : "secondary"
                    }
                    size="sm"
                    onClick={() => filters.toggleCategory(category.id)}
                    aria-pressed={filters.selectedCategories.includes(category.id)}
                  >
                    {category.label}
                  </Button>
                ))}
                <span
                  ref={filterScrollEndRef}
                  aria-hidden="true"
                  className="h-px w-px shrink-0"
                />
              </HorizontalScrollFade>
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
                    viewMode={viewMode}
                    onViewModeChange={handleViewModeChange}
                    filters={filters}
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
                className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary-hover transition-colors"
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
              onClearFilters={filters.handleClearAllFilters}
              hasActiveFilters={filters.filterCount > 0}
              eventStats={eventStats}
              isLoading={isLoading}
              groupByDateSections={filters.sortBy === "date" && filters.sortOrder === "asc"}
            />
          )}
        </main>
      </div>
      <EventDetailsModal
        eventId={selectedEventId}
        event={selectedEvent}
        onClose={handleCloseEventDetails}
        allEvents={orderedEvents}
      />
    </>
  );
}
