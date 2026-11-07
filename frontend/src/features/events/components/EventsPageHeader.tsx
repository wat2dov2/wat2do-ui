import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { PriceFilter, type useSearch } from "@/features/search";
import type { CampusSeasonFilterOption } from "@/features/search/api/filterService";
import { SearchBar } from "@/features/search/components/SearchBar";
import { MoreFiltersButton } from "@/features/search/components/MoreFiltersButton";
import { FilterDropdown } from "@/features/search/components/FilterDropdown";
import { DateFilterSelect } from "@/features/events/components/DateFilterSelect";
import { EventViewSelect, type EventBrowseView } from "@/features/events/components/EventViewSelect";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { getEventQuickFilters } from "@/shared/constants/eventFilters";
import { PageHeader } from "@/shared/layout";
import { FilterBar } from "@/shared/layout/filter-bar";
import { useUIStore } from "@/shared/store/ui.store";
import { Button } from "@/shared/ui/button";
import { IntegerFilter } from "@/shared/ui/integer-filter";
import { NewlyAddedFilterButton } from "@/shared/ui/newly-added-filter-button";
import { PageCountHeading } from "@/shared/ui/page-count-heading";
import type { ApiLatestAddedItem } from "@/shared/generated";

// Exam de-stress leaves the season group to sit beside the date filter, where students look during exams.
const EXAM_DESTRESS_SEASON = "exam_destress";

interface EventsPageHeaderProps {
  filters: ReturnType<typeof useSearch>;
  school: string;
  view: EventBrowseView;
  onViewChange: (view: EventBrowseView) => void;
  /** Null while the feed loads. */
  count: number | null;
  latest: { item: ApiLatestAddedItem; onSelect: () => void } | null;
  currentTimeMs?: number | null;
  disabled: boolean;
  /** Going counts have loaded, so the minimum-going filter can apply. */
  eventStatsReady: boolean;
  goingEventsReady: boolean;
  appliedQueryKey?: string;
}

/**
 * The events page's heading, search and filter row. The route's loading state
 * renders this same header, so nothing above the feed moves when it arrives.
 */
export function EventsPageHeader({
  filters,
  school,
  view,
  onViewChange,
  count,
  latest,
  currentTimeMs,
  disabled,
  eventStatsReady,
  goingEventsReady,
  appliedQueryKey,
}: EventsPageHeaderProps) {
  const { t } = useTranslation();
  const { profileCompleted } = useAuthState();
  const showFilterDropdown = useUIStore((s) => s.showFilterDropdown);
  const setShowFilterDropdown = useUIStore((s) => s.setShowFilterDropdown);
  const quickFilters = getEventQuickFilters({ profileCompleted, sportsGameAvailable: filters.sportsGameAvailable });
  const renderSeasonChip = (season: CampusSeasonFilterOption) => (
    <Button activation="click" key={season.id} variant={filters.campusSeasonIds.includes(season.id) ? "primary" : "outline"} size="sm" onClick={() => filters.toggleCampusSeason(season.id)} aria-pressed={filters.campusSeasonIds.includes(season.id)}>
      {season.label}
    </Button>
  );

  return (
    <PageHeader variant="listing">
      <PageCountHeading
        count={count}
        label={t("events.upcomingEventCount", { count: count ?? 2 })}
        latest={latest}
        currentTimeMs={currentTimeMs}
      />
      <SearchBar
        searchQuery={filters.searchQuery}
        onSearchChange={filters.setSearchQuery}
        onSearchClear={() => filters.setSearchQuery("")}
      />
      <FilterBar appliedQueryKey={`${view}:${appliedQueryKey}`} disabled={disabled} refreshKey={`${view}:${quickFilters.length}:${filters.categoryOptions.length}:${filters.campusSeasonOptions.map(season => season.id).join(",")}`} data-testid="event-quick-filter-scroll">
        <EventViewSelect value={view} onChange={onViewChange} />
        {quickFilters.map(config => {
          switch (config.id) {
            case "new":
              return <NewlyAddedFilterButton key={config.id} value={filters.addedSince || null} onValueChange={filters.setAddedSince} onClear={() => filters.setAddedSince("")} />;
            case "price":
              return <PriceFilter key={config.id} minPrice={filters.minPrice} maxPrice={filters.maxPrice} setMinPrice={filters.setMinPrice} setMaxPrice={filters.setMaxPrice} />;
            case "campusSeasons":
              return <Fragment key={config.id}>{filters.campusSeasonOptions.filter(season => season.classificationId !== EXAM_DESTRESS_SEASON).map(renderSeasonChip)}</Fragment>;
            case "examDestress":
              return <Fragment key={config.id}>{filters.campusSeasonOptions.filter(season => season.classificationId === EXAM_DESTRESS_SEASON).map(renderSeasonChip)}</Fragment>;
            case "date":
              return <DateFilterSelect key={config.id} school={school} value={filters.dateFilter} customDate={filters.customDate} onChange={filters.setDateFilter} />;
            case "minGoing":
              return <IntegerFilter key={config.id} disabled={!eventStatsReady} value={filters.minGoing} active={filters.minGoing > 0} onChange={value => filters.setMinGoing(Number(value))} label={`>${t("events.goingCount", { count: filters.minGoing })}`} inputLabel={t("events.minimumGoing")} />;
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
            variant={filters.selectedCategories.includes(category.id) ? "primary" : "outline"}
            size="sm"
            onClick={() => filters.toggleCategory(category.id)}
            aria-pressed={filters.selectedCategories.includes(category.id)}
          >
            {category.label}
          </Button>
        ))}
        {/* Last in the row, so it scrolls with the filters instead of staying pinned. */}
        <MoreFiltersButton
          open={showFilterDropdown}
          onOpenChange={setShowFilterDropdown}
          filterCount={filters.filterCount}
          onClearFilters={filters.clearAllFilters}
        >
          {showFilterDropdown ? <FilterDropdown school={school} filters={filters} /> : null}
        </MoreFiltersButton>
      </FilterBar>
    </PageHeader>
  );
}
