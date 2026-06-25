import { lazy, Suspense, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Heart, Sparkles, Tag, Utensils } from "@/shared/ui/doodle-icons";
import { EventList } from "../components/EventList";
import { EventCount } from "../components/EventCount";
import { EventsBackToTopButton } from "../components/EventsBackToTopButton";
import { Skeleton } from "@/shared/ui/skeleton";
import { LightRays } from "@/registry/magicui/light-rays";
import { SearchBar, QuickFilterChip, MoreFiltersButton } from "@/features/search";
import { useUIStore } from "@/shared/store/ui.store";
import { useProfileCompleted } from "@/features/auth";
import { useDarkMode } from "@/shared/hooks";
import { useEventsPageData } from "@/features/events/hooks/useEventsPageData";
import type { ViewMode, QuickFilterConfig } from "@/shared/types";

const FilterDropdown = lazy(() =>
  import("@/features/search").then((module) => ({
    default: module.FilterDropdown,
  })),
);

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
    fetchEvents,
    loadMoreEvents,
    totalEvents,
    hasMoreEvents,
    savedEventIds,
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

  const isNewlyAddedActive =
    filters.sortBy === "added_at" && filters.sortOrder === "desc";
  const handleNewlyAddedToggle = useCallback(() => {
    if (isNewlyAddedActive) {
      filters.setSort("date", "asc");
      return;
    }
    filters.setSort("added_at", "desc");
  }, [filters, isNewlyAddedActive]);

  // Build filter config array. `filters` is the aggregate returned by
  // useSearch; React Compiler infers it as a single dep rather than the
  // narrow property list, so depend on the whole object for consistency
  // with the compiler's preservation check.
  const filterConfigs: QuickFilterConfig[] = useMemo(
    () =>
      [
        {
          id: "saved",
          icon: <Heart className="size-3.5" fill={filters.savedFilter ? "currentColor" : "none"} />,
          labelKey: "filters.saved",
          active: filters.savedFilter,
          onMouseDown: () => filters.setSavedFilter(!filters.savedFilter),
          badge: savedEventIds.length > 0 ? savedEventIds.length : undefined,
          visible: profileCompleted,
        },
        {
          id: "newlyAdded",
          icon: <Sparkles className="size-3.5" />,
          labelKey: "events.newlyAdded",
          active: isNewlyAddedActive,
          onMouseDown: handleNewlyAddedToggle,
        },
        {
          id: "freeFood",
          icon: <Utensils className="size-3.5" />,
          labelKey: "common.freeFood",
          active: filters.freeFoodFilter,
          onMouseDown: () => filters.setFreeFoodFilter(!filters.freeFoodFilter),
          badge:
            filters.freeFoodEventsCount > 0
              ? filters.freeFoodEventsCount
              : undefined,
        },
      ].filter((config) => config.visible !== false),
    [filters, handleNewlyAddedToggle, isNewlyAddedActive, profileCompleted, savedEventIds.length]
  );

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
      <div className="-mx-2 space-y-2 sm:mx-0">
        <div className="space-y-3 pb-2">
          <SearchBar
            searchQuery={filters.searchQuery}
            onSearchChange={(query) => {
              filters.setSearchQuery(query);
            }}
            onSearchClear={() => filters.setSearchQuery("")}
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
          />

          {/* Filters - show even while loading but with skeletons inside */}
          <div className="flex items-center gap-2">
            <div className="no-visible-scrollbar flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto pb-1">
              {isPageLoading ? (
                <>
                  <Skeleton className="h-7 w-20 shrink-0 rounded-xl" />
                  <Skeleton className="h-7 w-24 shrink-0 rounded-xl" />
                  <Skeleton className="h-7 w-24 shrink-0 rounded-xl" />
                  <Skeleton className="h-7 w-28 shrink-0 rounded-xl" />
                </>
              ) : (
                <>
                  <div className="shrink-0">
                    <EventCount count={totalEvents} />
                  </div>
                  {filterConfigs.map((config) => (
                    <QuickFilterChip
                      key={config.id}
                      icon={config.icon}
                      label={t(config.labelKey)}
                      active={config.active}
                      onMouseDown={config.onMouseDown}
                      badge={config.badge}
                    />
                  ))}
                  {filters.categoryPieItems.map((category) => (
                    <QuickFilterChip
                      key={category.id}
                      icon={<Tag className="size-3.5" />}
                      label={category.label}
                      active={filters.selectedCategories.includes(category.id)}
                      onMouseDown={() => filters.toggleCategory(category.id)}
                    />
                  ))}
                </>
              )}
            </div>
            <div className="relative shrink-0 pb-1">
              <MoreFiltersButton
                open={showFilterDropdown}
                onOpenChange={setShowFilterDropdown}
                filterCount={filters.filterCount}
                onClearFilters={filters.handleClearAllFilters}
              >
                {showFilterDropdown ? (
                  <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
                    <FilterDropdown
                      filterViewMode={filterViewMode}
                      onFilterViewModeChange={setFilterViewMode}
                      filters={filters}
                      isDarkMode={isDarkMode}
                    />
                  </Suspense>
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
                onMouseDown={() => fetchEvents()}
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
