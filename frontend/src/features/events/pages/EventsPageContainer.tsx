import { lazy, Suspense, useMemo, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { EventFormatFilterSelect } from "@/features/events/components/EventFormatFilterSelect";
import { IntegerFilter } from "@/shared/ui/integer-filter";
import { toast } from "@/shared/hooks/use-toast";
import { EventList } from "../components/EventList";
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
import { PageHeader, Stack } from "@/shared/layout";
import type { PaginatedEventsResponse } from "@/features/events/api/events.api";
import { LoadingPage } from "@/shared/ui/loading-page";

const EventDetailsModal = lazy(() =>
  import("@/features/events/components/EventDetailsModal").then((module) => ({
    default: module.EventDetailsModal,
  })),
);

interface QuickFilterButtonConfig {
  id: string;
  labelKey: string;
  active: boolean;
  onClick: () => void;
}

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

  const viewMode = useUIStore((s) => s.viewMode);
  const showFilterDropdown = useUIStore((s) => s.showFilterDropdown);
  const setShowFilterDropdown = useUIStore((s) => s.setShowFilterDropdown);
  const { profileCompleted } = useAuthState();
  const { t } = useTranslation();
  const router = useRouter();

  const {
    isLoading,
    error,
    refreshEvents,
    totalEvents,
    eventStats,
    latestAddedEvent,

    filters,
    orderedEvents,
    allEvents,
  } = useEventsPageData({
    initialSnapshot,
    initialSchool,
  });
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
          id: "hasFood",
          labelKey: "filters.food",
          active: filters.hasFoodFilter,
          onClick: () => filters.setHasFoodFilter(!filters.hasFoodFilter),
        },
      ].filter((config) => config.visible !== false),
    [filters, profileCompleted],
  );

  // Submitting an event requires an account, so gate before navigating.
  const handleSubmitEventClick = useCallback(() => {
    if (!profileCompleted) {
      toast({
        description: t("navigation.loginRequiredToSubmit"),
        action: {
          label: t("events.signIn"),
          onClick: () => router.push(ROUTES.LOGIN),
        },
      });
      return;
    }
    router.push(ROUTES.EVENT_SUBMIT);
  }, [profileCompleted, router, t]);

  return (
    <>
      <div className="space-y-2">
        <PageHeader variant="listing">
          <PageCountHeading
            count={totalEvents}
            label={t("events.upcomingEventCount", { count: totalEvents })}
            latest={latestAddedEvent ? { item: latestAddedEvent, onSelect: handleLatestAddedEventSearch } : null}
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

          <FilterBar refreshKey={`${filterConfigs.length + 4}:${filters.categoryOptions.length}`} data-testid="event-quick-filter-scroll" trailing={<>
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
                <NewlyAddedFilterButton
                  value={filters.addedSince || null}

                  onValueChange={filters.setAddedSince}
                  onClear={handleNewlyAddedFilterClear}
                />
                {filterConfigs.map((config) => (
                  <Button
                    key={config.id}
                    variant={config.active ? "primary" : "outline"}
                    size="sm"
                    onClick={config.onClick}
                    aria-pressed={config.active}
                  >
                    {t(config.labelKey)}
                  </Button>
                ))}
                <IntegerFilter
                  value={filters.priceFilterValue}
                  active={filters.priceFilterValue !== ""}
                  onChange={filters.setPriceFilter}
                  label={Number(filters.priceFilterValue) > 0 ? `> $${Number(filters.priceFilterValue)}` : t("common.free")}
                  inputLabel={t("filters.price")}
                />
                <DateFilterSelect
                  school={initialSchool}
                  value={filters.dateFilter}
                  customDate={filters.customDate}
                  onChange={filters.setDateFilter}
                />
                <IntegerFilter
                  value={filters.minGoing}
                  active={filters.minGoing > 0}
                  onChange={(value) => filters.setMinGoing(Number(value))}
                  label={`>${t("events.goingCount", { count: filters.minGoing })}`}
                  inputLabel={t("events.minimumGoing")}
                />
                <EventFormatFilterSelect
                  value={filters.eventFormat}
                  onChange={filters.setEventFormat}
                />
                {filters.categoryOptions.map((category) => (
                  <Button
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
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <p className="text-destructive text-sm text-center max-w-md">
                {error}
              </p>
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
              viewMode={viewMode}
              onEventClick={handleEventClick}
              onClearFilters={filters.clearAllFilters}
              hasActiveFilters={filters.filterCount > 0}
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
        <Suspense fallback={<LoadingPage />}>
          <EventDetailsModal
            eventId={selectedEventId}
            event={selectedEvent}
            onClose={handleCloseEventDetails}
            allEvents={orderedEvents}
          />
        </Suspense>
      ) : null}
    </>
  );
}
