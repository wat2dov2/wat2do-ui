"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getClubPositions } from "@/features/positions/api/positions.api";
import { PositionListSkeleton } from "@/features/positions/components/PositionList";
import { PositionsGrid } from "@/features/positions/components/PositionsGrid";
import { queryKeys } from "@/shared/lib/queryKeys";
import type { Position } from "@/shared/types";

interface ClubPositionsGridProps {
  clubId: number;
  school: string;
  /** Server-rendered positions; without them the grid fetches on mount. */
  initialPositions?: Position[];
}

/** Shown while the club's open positions stream in from the server. */
export function ClubPositionsGridSkeleton() {
  return <PositionListSkeleton />;
}

/** A club's open positions. */
export function ClubPositionsGrid({
  clubId,
  school,
  initialPositions,
}: ClubPositionsGridProps) {
  const { t } = useTranslation();
  const { data, isPending } = useQuery({
    queryKey: queryKeys.positions.byClub(clubId, school),
    queryFn: () => getClubPositions(clubId, school),
    enabled: clubId > 0 && Boolean(school),
    initialData: initialPositions,
  });
  return (
    <PositionsGrid
      positions={data ?? []}
      isPending={isPending}
      emptyTitle={t("positions.clubEmptyTitle")}
      emptyDescription={t("positions.clubEmptyDescription")}
    />
  );
}
