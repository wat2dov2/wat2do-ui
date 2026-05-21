import { useEffect, useMemo, useState, useCallback } from "react";
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
  const { checkSearchQuery } = useEasterEggs();

  const {
    isLoading,
    error,
    fetchEvents,
    savedEventIds,
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
    // Cancel the AppLayout scroll container's p-6 so the sticky toolbar can
    // sit flush against the scrollport edges. Re-add tighter padding on
    // the sticky inner content and <main> for a denser events surface.
    <div className="-m-6 isolate">
      {/* Sticky toolbar: search + filter row stay pinned as the user scrolls.
          -top-6 + top padding covers the scroll container's p-6 top padding so event
          cards scrolling up don't bleed through the gap between the fixed
          TopNav and the toolbar. */}
      <div className="sticky -top-6 z-20 bg-background px-6 py-4 space-y-3 after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-5 after:h-5 after:bg-linear-to-b after:from-black/[0.025] after:to-transparent">
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

      {/* Main Content */}
      <main className="w-full px-6 pt-3 pb-6" role="main" aria-label={t("search.ariaLabel")}>
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
      className="text-xs text-muted-foreground hover:text-foreground transition-colors text-left relative -top-px"
      aria-label={label}
    >
      {label}
    </button>
  );
}
