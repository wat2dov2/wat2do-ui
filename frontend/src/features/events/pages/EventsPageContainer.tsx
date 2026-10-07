import { useMemo, useCallback, useState, Fragment } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { PriceFilter } from "@/features/search";
import { IntegerFilter } from "@/shared/ui/integer-filter";
import { EventsBrowseViews } from "@/features/events/components/EventsBrowseViews";
import { EventViewSelect, type EventBrowseView } from "@/features/events/components/EventViewSelect";
import { PageCountHeading } from "@/shared/ui/page-count-heading";
import { SearchBar } from "@/features/search/components/SearchBar";
import { MoreFiltersButton } from "@/features/search/components/MoreFiltersButton";
import { FilterDropdown } from "@/features/search/components/FilterDropdown";
import { useUIStore } from "@/shared/store/ui.store";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { FilterBar } from "@/shared/layout/filter-bar";
import { Button } from "@/shared/ui/button";
import { useEventsPageData } from "@/features/events/hooks/useEventsPageData";
import {
  NewlyAddedFilterButton,
} from "@/shared/ui/newly-added-filter-button";
import { DateFilterSelect } from "@/features/events/components/DateFilterSelect";
import { ROUTES } from "@/shared/constants/routes";
import type { Event } from "@/shared/types";
import { usePosterLandingConfirmation } from "@/features/qrcode/hooks/usePosterLandingConfirmation";
import { EmptyState } from "@/shared/feedback";
import { PageHeader, Stack } from "@/shared/layout";
import type { PaginatedEventsResponse } from "@/features/events/api/events.api";
import { EventDetailsModal } from "@/features/events/components/EventDetailsModal";
import { getEventQuickFilters } from "@/shared/constants/eventFilters";

interface EventsPageContainerProps {
  /** The server's browse snapshot, or null when that fetch failed. */
  initialSnapshot: PaginatedEventsResponse | null;
  initialSchool: string;
}

export function EventsPageContainer({
  initialSnapshot,
  initialSchool,
}: EventsPageContainerProps) {
  usePosterLandingConfirmation();

  const showFilterDropdown = useUIStore((s) => s.showFilterDropdown);
  const setShowFilterDropdown = useUIStore((s) => s.setShowFilterDropdown);
  const { profileCompleted } = useAuthState();
  const { t } = useTranslation();
  const router = useRouter();

  const {
    appliedQueryKey,
    isLoading,
    error,
    refreshEvents,
    totalEvents,
    eventStats,
    goingEventsReady,
    latestAddedEvent,
    currentTimeMs,

    filters,
    orderedEvents,
    allEvents,
  } = useEventsPageData({
    initialSnapshot,
    initialSchool,
  });
  const [view, setView] = useState<EventBrowseView>("grid");
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [hasOpenedDetails, setHasOpenedDetails] = useState(false);

  const selectedEvent = useMemo(() => {
    if (selectedEventId == null) return null;
    return allEvents.find((e) => e.id === selectedEventId) ?? null;
  }, [selectedEventId, allEvents]);

  const handleEventClick = useCallback((event: Event) => {
    setHasOpenedDetails(true);
    setSelectedEventId(event.id);
  }, []);

  const handleCloseEventDetails = useCallback(() => {
    setSelectedEventId(null);
  }, []);

  const handleNewlyAddedFilterClear = useCallback(() => {
    filters.setAddedSince("");
  }, [filters]);

  const handleLatestAddedEventSearch = useCallback(() => {
    if (!latestAddedEvent) {
      return;
    }

    filters.setSearchQuery(latestAddedEvent.title);
  }, [filters, latestAddedEvent]);

  const quickFilters = getEventQuickFilters({ profileCompleted, sportsGameAvailable: filters.sportsGameAvailable });

  const handleSubmitEventClick = useCallback(() => {
    router.push(ROUTES.EVENT_SUBMIT);
  }, [router]);

  return (
    <>
      <div className="space-y-2">
        <PageHeader variant="listing">
          <PageCountHeading
            count={isLoading ? null : totalEvents}
            label={t("events.upcomingEventCount", { count: totalEvents })}
            latest={latestAddedEvent ? { item: latestAddedEvent, onSelect: handleLatestAddedEventSearch } : null}
            currentTimeMs={currentTimeMs}
          />
          <Stack direction="horizontal" align="center" gap={2}>
            <div className="min-w-0 flex-1">
              <SearchBar
                searchQuery={filters.searchQuery}
                onSearchChange={(query) => {
                  filters.setSearchQuery(query);
                }}
                onSearchClear={() => filters.setSearchQuery("")}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="shrink-0"
              onMouseDown={handleSubmitEventClick}
            >
              {t("events.submitEvent")}
            </Button>
          </Stack>

          <FilterBar appliedQueryKey={`${view}:${appliedQueryKey}`} disabled={isLoading || Boolean(error)} refreshKey={`${view}:${quickFilters.length}:${filters.categoryOptions.length}:${filters.campusSeasonOptions.map(season => season.id).join(",")}`} data-testid="event-quick-filter-scroll" trailing={<>
              <MoreFiltersButton
                open={showFilterDropdown}
                onOpenChange={setShowFilterDropdown}
                filterCount={filters.filterCount}
                onClearFilters={filters.clearAllFilters}
              >
                {showFilterDropdown ? (
                  <FilterDropdown
                    school={initialSchool}
                    filters={filters}
                  />
                ) : null}
              </MoreFiltersButton>
            </>}>
                <EventViewSelect value={view} onChange={setView} />
                {quickFilters.map(config => {
                  switch (config.id) {
                    case "new":
                      return <NewlyAddedFilterButton key={config.id} value={filters.addedSince || null} onValueChange={filters.setAddedSince} onClear={handleNewlyAddedFilterClear} />;
                    case "price":
                      return <PriceFilter key={config.id} minPrice={filters.minPrice} maxPrice={filters.maxPrice} setMinPrice={filters.setMinPrice} setMaxPrice={filters.setMaxPrice} />;
                    case "campusSeasons":
                      return <Fragment key={config.id}>{filters.campusSeasonOptions.map(season => (
                        <Button activation="click" key={season.id} variant={filters.campusSeasonIds.includes(season.id) ? "primary" : "outline"} size="sm" onClick={() => filters.toggleCampusSeason(season.id)} aria-pressed={filters.campusSeasonIds.includes(season.id)}>
                          {season.label}
                        </Button>
                      ))}</Fragment>;
                    case "date":
                      return <DateFilterSelect key={config.id} school={initialSchool} value={filters.dateFilter} customDate={filters.customDate} onChange={filters.setDateFilter} />;
                    case "minGoing":
                      return <IntegerFilter key={config.id} disabled={eventStats === null} value={filters.minGoing} active={filters.minGoing > 0} onChange={value => filters.setMinGoing(Number(value))} label={`>${t("events.goingCount", { count: filters.minGoing })}`} inputLabel={t("events.minimumGoing")} />;
                    default:
                      return <Button activation="click" key={config.id} disabled={config.id === "going" && !goingEventsReady} variant={filters[config.value] ? "primary" : "outline"} size="sm" onClick={() => filters[config.action](!filters[config.value])} aria-pressed={filters[config.value]}>
                        {t(config.labelKey)}
                      </Button>;
                  }
                })}
                {filters.categoryOptions.map((category) => (
                  <Button
                    activation="click"
                    key={category.id}
                    variant={
                      filters.selectedCategories.includes(category.id)
                        ? "primary"
                        : "outline"
                    }
                    size="sm"
                    onClick={() => filters.toggleCategory(category.id)}
                    aria-pressed={filters.selectedCategories.includes(
                      category.id,
                    )}
                  >
                    {category.label}
                  </Button>
                ))}
                </FilterBar>
        </PageHeader>

        <main
          className="relative z-10 w-full"
          role="main"
          aria-label={t("search.ariaLabel")}
        >
          {error ? (
            <EmptyState title={error} action={
              <Button variant="primary" onClick={refreshEvents}>{t("common.tryAgain")}</Button>
            } />
          ) : (
            <EventsBrowseViews
              view={view}
              school={initialSchool}
              events={orderedEvents}
              onEventClick={handleEventClick}
              onClearFilters={filters.clearAllFilters}
              hasActiveFilters={filters.filterCount > 0 || filters.searchQuery.trim().length > 0}
              showDateWheel
              eventStats={eventStats}
              isLoading={isLoading}
              groupByDateSections={
                filters.sortBy === "date" && filters.sortOrder === "asc"
              }
            />
          )}
        </main>
      </div>
      {hasOpenedDetails ? (
        <EventDetailsModal
          eventId={selectedEventId}
          event={selectedEvent}
          onClose={handleCloseEventDetails}
          allEvents={orderedEvents}
          />
      ) : null}
    </>
  );
}
