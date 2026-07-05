import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { QP } from "@/shared/constants/queryParams";
import { useMutableSearchParams } from "@/shared/hooks/useMutableSearchParams";
import type { Event } from "@/shared/types";

let pendingEventId: number | null = null;
const pendingListeners = new Set<() => void>();

function emitPendingEventIdChange() {
  pendingListeners.forEach((listener) => listener());
}

function setPendingEventId(id: number | null) {
  if (pendingEventId === id) return;
  pendingEventId = id;
  emitPendingEventIdChange();
}

function subscribePendingEventId(listener: () => void) {
  pendingListeners.add(listener);
  return () => pendingListeners.delete(listener);
}

function getPendingEventIdSnapshot() {
  return pendingEventId;
}

function parseEventIdParam(eventIdParam: string | null) {
  if (!eventIdParam) return null;
  const parsed = parseInt(eventIdParam, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function useEventIdUrlActions() {
  const [searchParams, setSearchParams] = useMutableSearchParams();
  const optimisticEventId = useSyncExternalStore(
    subscribePendingEventId,
    getPendingEventIdSnapshot,
    () => null,
  );

  const eventIdParam = searchParams.get(QP.EVENT_ID);
  const urlEventId = useMemo(
    () => parseEventIdParam(eventIdParam),
    [eventIdParam],
  );
  const eventId = optimisticEventId ?? urlEventId;

  useEffect(() => {
    if (optimisticEventId !== null && urlEventId === optimisticEventId) {
      setPendingEventId(null);
    }
  }, [optimisticEventId, urlEventId]);

  const openEventId = useCallback(
    (id: number) => {
      setPendingEventId(id);
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set(QP.EVENT_ID, id.toString());
      setSearchParams(nextParams);
    },
    [searchParams, setSearchParams],
  );

  const closeEventId = useCallback(() => {
    setPendingEventId(null);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete(QP.EVENT_ID);
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  return {
    eventId,
    eventIdParam,
    openEventId,
    closeEventId,
  };
}

export function useEventDetailsFromUrl(events: Event[]) {
  const { eventId, closeEventId } = useEventIdUrlActions();

  const detailEvent = useMemo(() => {
    if (eventId == null) return null;
    return events.find((event) => event.id === eventId) ?? null;
  }, [eventId, events]);

  return {
    eventId,
    detailEvent,
    closeEventDetails: closeEventId,
  };
}
