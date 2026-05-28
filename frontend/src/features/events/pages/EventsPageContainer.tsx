import { useEffect, useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { formatDistanceToNow } from "date-fns";
import { Utensils, Heart } from "lucide-react";
import { EventList, EventCount } from "@/features/events";
import { LoadingPage } from "@/shared/ui/loading-page";
import { LightRays } from "@/registry/magicui/light-rays";
import { DiaTextReveal } from "@/registry/magicui/dia-text-reveal";
import { SearchBar, QuickFilterChip, MoreFiltersButton, FilterDropdown } from "@/features/search";
import { useUIStore } from "@/shared/store/ui.store";
import { useProfileCompleted } from "@/features/auth";
import { useDarkMode } from "@/shared/hooks";
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
    error,
    fetchEvents,
    savedEventIds,
    activePromotedEventIds,
    latestAddedEvent,
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
          icon: <Utensils className="size-3.5" />,
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
          icon: <Heart className="size-3.5" />,
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
    <div className="-mt-6 space-y-3">
      <div
        className="pointer-events-none fixed left-0 right-2.5 top-0 z-[45] h-dvh overflow-hidden [mask-image:linear-gradient(to_bottom,black_0%,black_72%,transparent_100%)]"
        aria-hidden="true"
      >
        <LightRays
          data-page-light-rays
          length="110dvh"
          color={isDarkMode ? "rgba(255, 255, 255, 0.10)" : "rgba(30, 30, 30, 0.16)"}
          blendMode={isDarkMode ? "screen" : "multiply"}
        />
      </div>
      {/* Sticky toolbar hugs TopNav when scrolling (-top-6 cancels AppLayout top padding). */}
      <div className="sticky -top-6 z-20 bg-background space-y-3 pt-6 pb-3 backdrop-blur-sm">
        <SearchBar
          searchQuery={filters.searchQuery}
          onSearchChange={(query) => {
            filters.setSearchQuery(query);
          }}
          onSearchClear={() => filters.setSearchQuery("")}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
        />

        {/* Filters - only show once the event list is available */}
        {!isLoading && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-baseline gap-3">
              <EventCount count={filters.filteredEvents.length} />
              {latestAddedEvent && (
                <LatestAddedButton
                  title={latestAddedEvent.title}
                  addedAt={latestAddedEvent.added_at}
                  onClick={() => filters.setSearchQuery(latestAddedEvent.title)}
                />
              )}
            </div>
            <div className="relative flex flex-wrap items-center gap-2">
              {filterConfigs.flatMap((config) =>
                config.visible === false
                  ? []
                  : [
                      <QuickFilterChip
                        key={config.id}
                        icon={config.icon}
                        label={t(config.labelKey)}
                        active={config.active}
                        onClick={config.onClick}
                        badge={config.badge}
                      />,
                    ],
              )}
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

      <main className="relative z-10 w-full" role="main" aria-label={t("search.ariaLabel")}>
        {isLoading ? (
          <LoadingPage />
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <p className="text-destructive text-sm text-center max-w-md">{error}</p>
            <button
              type="button"
              onClick={() => fetchEvents()}
              className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {t("common.tryAgain")}
            </button>
          </div>
        ) : (
          <EventList
            events={orderedEvents}
            viewMode={viewMode}
            onDelete={handleDeleteEvent}
            onClearFilters={filters.handleClearAllFilters}
            savedEventIds={savedEventIds}
            activePromotedEventIds={activePromotedEventIds}
          />
        )}
      </main>
    </div>
  );
}

interface LatestAddedButtonProps {
  title: string;
  addedAt: string;
  onClick: () => void;
}

// `formatDistanceToNow` reads the current time. We compute it inline (pure
// render) and bump a `tick` counter once a minute so the relative-time label
// stays fresh without setState-in-effect.
function LatestAddedButton({ title, addedAt, onClick }: LatestAddedButtonProps) {
  const { t } = useTranslation();
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((c) => c + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const timeAgo = formatDistanceToNow(new Date(addedAt), { addSuffix: true });
  const label = t("events.latestAdded", { title, timeAgo });
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative -top-px text-left text-xs text-muted-foreground transition-colors [--latest-added-text-color:var(--muted-foreground)] hover:text-foreground hover:[--latest-added-text-color:var(--foreground)]"
      aria-label={label}
    >
      <DiaTextReveal
        key={label}
        className="text-xs"
        text={label}
        textColor="var(--latest-added-text-color)"
        colors={["#A97CF8", "#F38CB8", "#FDCC92"]}
      />
    </button>
  );
}
