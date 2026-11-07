import { useTranslation } from "react-i18next";
import { POSITION_TYPES } from "@/features/positions/api/positions.api";
import type { usePositionsPage } from "@/features/positions/hooks/usePositionsPage";
import { PageHeader } from "@/shared/layout";
import { FilterBar } from "@/shared/layout/filter-bar";
import { Button } from "@/shared/ui/button";
import { NewlyAddedFilterButton } from "@/shared/ui/newly-added-filter-button";
import { PageCountHeading } from "@/shared/ui/page-count-heading";
import { SubmittedSearchInput } from "@/shared/ui/submitted-search-input";
import type { ApiLatestAddedItem } from "@/shared/generated";

/** The directory controls the header shows; the route's loading state passes their initial values. */
export type PositionsHeaderState = Pick<
  ReturnType<typeof usePositionsPage>,
  | "appliedQueryKey" | "searchQuery" | "setSearchQuery" | "submitSearch" | "clearSearch"
  | "positionType" | "setPositionType" | "addedSince" | "setAddedSince" | "clearNew"
>;

interface PositionsPageHeaderProps {
  state: PositionsHeaderState;
  /** Null while the directory loads. */
  count: number | null;
  latest: { item: ApiLatestAddedItem; onSelect: () => void } | null;
  disabled: boolean;
}

/**
 * The positions page's heading, search and filter row. The route's loading
 * state renders this same header, so nothing above the list moves when it arrives.
 */
export function PositionsPageHeader({ state, count, latest, disabled }: PositionsPageHeaderProps) {
  const { t } = useTranslation();
  return (
    <PageHeader variant="listing">
      <PageCountHeading
        count={count}
        label={t("positions.position", { count: count ?? 2 })}
        latest={latest}
      />
      <SubmittedSearchInput
        size="lg"
        value={state.searchQuery}
        onChange={state.setSearchQuery}
        onSubmit={state.submitSearch}
        onClear={state.clearSearch}
        placeholder={t("positions.searchPlaceholder")}
        submitLabel={t("common.search")}
        clearLabel={t("positions.clearSearch")}
      />
      <FilterBar appliedQueryKey={state.appliedQueryKey} disabled={disabled} data-testid="position-filter-scroll" aria-label={t("positions.filterByType")}>
        <NewlyAddedFilterButton
          value={state.addedSince}
          onValueChange={state.setAddedSince}
          onClear={state.clearNew}
        />
        {POSITION_TYPES.map((positionType) => (
          <Button
            activation="click"
            key={positionType}
            size="sm"
            variant={state.positionType === positionType ? "primary" : "outline"}
            aria-pressed={state.positionType === positionType}
            onClick={() => state.setPositionType(state.positionType === positionType ? "all" : positionType)}
          >
            {t(`positions.types.${positionType}`)}
          </Button>
        ))}
      </FilterBar>
    </PageHeader>
  );
}
