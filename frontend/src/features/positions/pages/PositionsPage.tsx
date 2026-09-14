"use client";

import { useTranslation } from "react-i18next";
import Link from "next/link";
import { ROUTES } from "@/shared/constants/routes";
import type { PaginatedPositionsResponse } from "@/features/positions/api/positions.api";
import { PositionList } from "@/features/positions/components/PositionList";
import { PositionDetailsDrawer } from "@/features/positions/components/PositionDetailsDrawer";
import { usePositionsPage } from "@/features/positions/hooks/usePositionsPage";
import { PageHeader, Stack } from "@/shared/layout";
import { FilterBar } from "@/shared/layout/filter-bar";
import { PageCountHeading } from "@/shared/ui/page-count-heading";
import { SubmittedSearchInput } from "@/shared/ui/submitted-search-input";
import { Button } from "@/shared/ui/button";
import { NewlyAddedFilterButton } from "@/shared/ui/newly-added-filter-button";
import { POSITION_TYPES } from "@/features/positions/api/positions.api";

interface PositionsPageProps {
  initialDirectory: PaginatedPositionsResponse | null;
  initialSchool: string;
}

export function PositionsPage({
  initialDirectory,
  initialSchool,
}: PositionsPageProps) {
  const { t } = useTranslation();
  const positionsPage = usePositionsPage({ initialDirectory, initialSchool });

  return (
    <Stack gap={2}>
      <PageHeader variant="listing">
        <PageCountHeading
          count={positionsPage.total}
          label={t("positions.position", { count: positionsPage.total })}
          latest={positionsPage.latestAddedPosition ? { item: positionsPage.latestAddedPosition, onSelect: positionsPage.searchLatest } : null}
        />
        <Stack direction="horizontal" gap={2} align="center">
          <SubmittedSearchInput
            size="lg"
            value={positionsPage.searchQuery}
            onChange={positionsPage.setSearchQuery}
            onSubmit={positionsPage.submitSearch}
            onClear={positionsPage.clearSearch}
            placeholder={t("positions.searchPlaceholder")}
            submitLabel={t("common.search")}
            clearLabel={t("positions.clearSearch")}
          />
          <Button asChild variant="outline" size="lg"><Link href={ROUTES.POSITION_SUBMIT}>{t("positions.addPosition")}</Link></Button>
        </Stack>
        <FilterBar data-testid="position-filter-scroll" aria-label={t("positions.filterByType")}>
          <NewlyAddedFilterButton
            value={positionsPage.addedSince}

            onValueChange={positionsPage.setAddedSince}
            onClear={positionsPage.clearNew}
          />
          <Button size="sm" variant={positionsPage.paidOnly ? "primary" : "outline"} aria-pressed={positionsPage.paidOnly} onClick={() => positionsPage.setPaidOnly(!positionsPage.paidOnly)}>{t("positions.paid")}</Button>
          {POSITION_TYPES.map((positionType) => (
            <Button
              key={positionType}
              size="sm"
              variant={positionsPage.positionType === positionType ? "primary" : "outline"}
              aria-pressed={positionsPage.positionType === positionType}
              onClick={() => positionsPage.setPositionType(positionsPage.positionType === positionType ? "all" : positionType)}
            >
              {t(`positions.types.${positionType}`)}
            </Button>
          ))}
        </FilterBar>
      </PageHeader>

      <PositionList
        positions={positionsPage.positions}
        isLoading={positionsPage.isLoading}
        isLoadingMore={positionsPage.isLoadingMore}
        hasMore={positionsPage.hasMore}
        onLoadMore={positionsPage.loadMore}
        onPositionClick={positionsPage.openPosition}
      />

      <PositionDetailsDrawer
        positions={positionsPage.positions}
        onSelect={positionsPage.openPosition}
        position={positionsPage.selectedPosition}
        onClose={positionsPage.closePosition}
      />
    </Stack>
  );
}
