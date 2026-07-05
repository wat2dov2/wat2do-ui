import { useCallback, useMemo } from "react";
import { QP } from "@/shared/constants/queryParams";
import { useMutableSearchParams } from "@/shared/hooks/useMutableSearchParams";
import type { Event } from "@/shared/types";

export function useEventIdUrlActions() {
  const [searchParams, setSearchParams] = useMutableSearchParams();

  const eventIdParam = searchParams.get(QP.EVENT_ID);
  const eventId = useMemo(() => {
    if (!eventIdParam) return null;
    const parsed = parseInt(eventIdParam, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }, [eventIdParam]);

  const openEventId = useCallback(
    (id: number) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set(QP.EVENT_ID, id.toString());
      setSearchParams(nextParams);
    },
    [searchParams, setSearchParams],
  );

  const closeEventId = useCallback(() => {
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
