"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PaginatedPositionsResponse } from "@/features/positions/api/positions.api";
import { PositionList } from "@/features/positions/components/PositionList";
import { usePositionsPage } from "@/features/positions/hooks/usePositionsPage";
import { PositionsPageHeader } from "@/features/positions/components/PositionsPageHeader";
import { Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/feedback/empty-state";
import { PositionDetailsDrawer } from "@/features/positions/components/PositionDetailsDrawer";

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
  const [hasOpenedDetails, setHasOpenedDetails] = useState(false);

  return (
    <Stack gap={2}>
      <PositionsPageHeader
        state={positionsPage}
        count={positionsPage.isLoading ? null : positionsPage.total}
        latest={positionsPage.latestAddedPosition ? { item: positionsPage.latestAddedPosition, onSelect: positionsPage.searchLatest } : null}
        disabled={positionsPage.isLoading || positionsPage.isError}
      />

      {positionsPage.isError ? (
        <EmptyState
          role="alert"
          title={t("errorBoundary.title")}
          action={
            <Button variant="outline" onClick={positionsPage.retry}>
              {t("common.tryAgain")}
            </Button>
          }
        />
      ) : (
        <PositionList
          positions={positionsPage.positions}
          isLoading={positionsPage.isLoading}
          onPositionClick={(position) => {
            setHasOpenedDetails(true);
            positionsPage.openPosition(position);
          }}
        />
      )}

      {hasOpenedDetails ? (
        <PositionDetailsDrawer
          positions={positionsPage.positions}
          onSelect={positionsPage.openPosition}
          position={positionsPage.selectedPosition}
          onClose={positionsPage.closePosition}
          />
      ) : null}
    </Stack>
  );
}
