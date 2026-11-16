import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useRequestSchool } from "@/app/client-providers";
import { useSavedIds, useSavedIdToggle, type SavedKind } from "@/features/auth/hooks/useSavedIds";
import {
  fetchSavedPositionIds,
  positionDirectoryQueryOptions,
  savePosition,
  unsavePosition,
} from "@/features/positions/api/positions.api";
import { controlBox } from "@/shared/config/controlBox";
import { queryKeys } from "@/shared/lib/queryKeys";

const SAVED_POSITIONS: SavedKind = {
  keys: queryKeys.savedPositions,
  fetchIds: fetchSavedPositionIds,
  save: savePosition,
  unsave: unsavePosition,
  staleTime: controlBox.clientCache.defaultQueryStaleMs,
};

/** The ids of the positions the signed-in user saved, latest save first. */
export function useSavedPositionIds() {
  return useSavedIds(SAVED_POSITIONS);
}

/** Whether the user saved this position, and a toggle that shows the change at once. */
export function useSavedPositionToggle(positionId: number) {
  const { t } = useTranslation();
  return useSavedIdToggle(SAVED_POSITIONS, positionId, t("positions.saved.saveFailed"));
}

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
