import { useTranslation } from "react-i18next";
import { useSavedIds, useSavedIdToggle, type SavedKind } from "@/features/auth/hooks/useSavedIds";
import {
  fetchSavedEventIds,
  saveEvent,
  unsaveEvent,
} from "@/features/events/api/events.api";
import { controlBox } from "@/shared/config/controlBox";
import { queryKeys } from "@/shared/lib/queryKeys";

const SAVED_EVENTS: SavedKind = {
  keys: queryKeys.savedEvents,
  fetchIds: fetchSavedEventIds,
  save: saveEvent,
  unsave: unsaveEvent,
  staleTime: controlBox.clientCache.liveEventDataStaleMs,
};

/** The ids of the events the signed-in user saved, latest save first. */
export function useSavedEventIds() {
  return useSavedIds(SAVED_EVENTS);
}

/** Whether the user saved this event, and a toggle that shows the change at once. */
export function useSavedEventToggle(eventId: number) {
  const { t } = useTranslation();
  return useSavedIdToggle(SAVED_EVENTS, eventId, t("events.savedEvents.saveFailed"));
}
