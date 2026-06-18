import { useEffect, useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale/zh-CN";
import { enUS } from "date-fns/locale/en-US";
import { Utensils, Heart } from "@/shared/ui/doodle-icons";
import { EventList } from "../components/EventList";
import { EventCount } from "../components/EventCount";
import { Skeleton } from "@/shared/ui/skeleton";
import { LightRays } from "@/registry/magicui/light-rays";
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
    isPromotedLoading,
    recsLoading,
    error,
    fetchEvents,
    savedEventIds,
    promotedEvents,
    latestAddedEvent,
    filters,
    orderedEvents,
    handleDeleteEvent,
  } = useEventsPageData({ profileCompleted });

  const isPageLoading = isLoading || isPromotedLoading || recsLoading;

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
          onMouseDown: () => filters.setFreeFoodFilter(!filters.freeFoodFilter),
          badge:
            filters.freeFoodEventsCount > 0
              ? filters.freeFoodEventsCount
              : undefined,
        },
        {
          id: "saved",
          icon: <Heart className="size-3.5" fill={filters.savedFilter ? "currentColor" : "none"} />,
          labelKey: "filters.saved",
          active: filters.savedFilter,
          onMouseDown: () => filters.setSavedFilter(!filters.savedFilter),
          badge: savedEventIds.length > 0 ? savedEventIds.length : undefined,
          visible: profileCompleted,
        },
      ].filter((config) => config.visible !== false),
    [filters, profileCompleted, savedEventIds.length]
  );

  return (
    <>
      <div
        className="pointer-events-none fixed left-0 right-2.5 top-0 z-[45] h-dvh overflow-hidden [mask-image:linear-gradient(to_bottom,black_0%,black_72%,transparent_100%)]"
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
      <div className="-mt-4 space-y-2">
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-3">
            {isPageLoading ? (
              <Skeleton className="h-6 w-20 rounded-lg" />
            ) : (
              <EventCount count={filters.filteredEvents.length} />
            )}
            {isPageLoading ? (
              <Skeleton className="h-4 w-48 rounded-lg self-center" />
            ) : latestAddedEvent ? (
              <LatestAddedButton
                title={latestAddedEvent.title}
                addedAt={latestAddedEvent.added_at}
                onMouseDown={() => filters.setSearchQuery(latestAddedEvent.title)}
              />
            ) : null}
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
                      onMouseDown={config.onMouseDown}
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
              filters.savedFilter
            }
            savedEventIds={savedEventIds}
            isLoading={isPageLoading}
          />
        )}
      </main>
    </div>
    </>
  );
}

interface LatestAddedButtonProps {
  title: string;
  addedAt: string;
  onMouseDown: () => void;
}

// `formatDistanceToNow` reads the current time. We compute it inline (pure
// render) and bump a `tick` counter once a minute so the relative-time label
// stays fresh without setState-in-effect.
function LatestAddedButton({ title, addedAt, onMouseDown }: LatestAddedButtonProps) {
  const { t, i18n } = useTranslation();
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((c) => c + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const locale = i18n.language.startsWith("zh") ? zhCN : enUS;
  const timeAgo = formatDistanceToNow(new Date(addedAt), { addSuffix: true, locale });
  const label = t("events.latestAdded", { title, timeAgo });
  return (
    <button
      type="button"
      onMouseDown={onMouseDown}
      className="relative -top-px text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
      aria-label={label}
    >
      {label}
    </button>
  );
}
