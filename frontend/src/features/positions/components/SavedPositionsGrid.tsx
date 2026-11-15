"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useRequestSchool } from "@/app/client-providers";
import { positionDirectoryQueryOptions } from "@/features/positions/api/positions.api";
import { PositionsGrid } from "@/features/positions/components/PositionsGrid";
import { useSavedPositionIds } from "@/features/positions/hooks/useSavedPositions";

/** The open positions at this school the visitor saved, latest save first. */
export function useSavedPositions() {
  const school = useRequestSchool();
  const saved = useSavedPositionIds();
  const directory = useQuery(positionDirectoryQueryOptions(school));
  const positions = useMemo(() => {
    const byId = new Map((directory.data?.items ?? []).map((position) => [position.id, position]));
    return (saved.data ?? []).flatMap((id) => byId.get(id) ?? []);
  }, [directory.data, saved.data]);
  return { positions, isPending: saved.isPending || directory.isPending };
}

/** The profile's saved positions, as cards that open in the position drawer. */
export function SavedPositionsGrid({ positions, isPending }: ReturnType<typeof useSavedPositions>) {
  const { t } = useTranslation();
  return (
    <PositionsGrid
      positions={positions}
      isPending={isPending}
      emptyTitle={t("positions.saved.emptyTitle")}
      emptyDescription={t("positions.saved.emptyDescription")}
    />
  );
}
