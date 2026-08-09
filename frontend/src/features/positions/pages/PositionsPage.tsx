"use client";

import { useTranslation } from "react-i18next";
import type { PaginatedPositionsResponse } from "@/features/positions/api/positions.api";
import { PositionList } from "@/features/positions/components/PositionList";
import { PositionDetailsDrawer } from "@/features/positions/components/PositionDetailsDrawer";
import { usePositionsPage } from "@/features/positions/hooks/usePositionsPage";
import { Stack } from "@/shared/layout";
import { PageCountHeading } from "@/shared/ui/page-count-heading";
import { SubmittedSearchInput } from "@/shared/ui/submitted-search-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import type { PositionType } from "@/shared/types";

const POSITION_TYPES: PositionType[] = [
  "executive",
  "committee",
  "volunteer",
  "staff",
  "internship",
  "general",
];

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
      <Stack gap={3} className="pb-2">
        <PageCountHeading
          count={positionsPage.total}
          label={t("positions.position", { count: positionsPage.total })}
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
          <Select
            value={positionsPage.positionType}
            onValueChange={(value) =>
              positionsPage.setPositionType(value as PositionType | "all")
            }
          >
            <SelectTrigger size="lg" aria-label={t("positions.filterByType")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="all">{t("positions.allTypes")}</SelectItem>
              {POSITION_TYPES.map((positionType) => (
                <SelectItem key={positionType} value={positionType}>
                  {t(`positions.types.${positionType}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Stack>
      </Stack>

      <PositionList
        positions={positionsPage.positions}
        isLoading={positionsPage.isLoading}
        isLoadingMore={positionsPage.isLoadingMore}
        hasMore={positionsPage.hasMore}
        onLoadMore={positionsPage.loadMore}
        onPositionClick={positionsPage.openPosition}
      />

      <PositionDetailsDrawer
        position={positionsPage.selectedPosition}
        onClose={positionsPage.closePosition}
      />
    </Stack>
  );
}
