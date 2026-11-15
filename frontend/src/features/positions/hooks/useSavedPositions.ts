import { useTranslation } from "react-i18next";
import { useSavedIds, useSavedIdToggle, type SavedKind } from "@/features/auth/hooks/useSavedIds";
import { fetchSavedPositionIds, savePosition, unsavePosition } from "@/features/positions/api/positions.api";
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
