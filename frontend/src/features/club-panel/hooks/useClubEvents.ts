import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { clubEventsQueryOptions, orderClubEvents } from "@/features/events";
import { useCurrentTime } from "@/features/events/hooks/useGoingEvents";
import { useClubTicketSales } from "@/features/club-panel/hooks/useClubTicketing";
import { controlBox } from "@/shared/config/controlBox";
import { hasActiveEventOccurrence } from "@/shared/utils/date";

/** A club's events split into upcoming and past, with each one's ticket sales. */
export function useClubEvents(clubId: number | null | undefined, school: string | null | undefined) {
  const events = useQuery(clubEventsQueryOptions(clubId ?? 0, school ?? ""));
  const sales = useClubTicketSales(controlBox.ticketing.enabled ? clubId : null);
  const now = useCurrentTime();
  return useMemo(() => {
    const ordered = now === null ? events.data ?? [] : orderClubEvents(events.data ?? [], now);
    const isUpcoming = (event: (typeof ordered)[number]) =>
      now === null || hasActiveEventOccurrence(event, now);
    return {
      upcoming: ordered.filter(isUpcoming),
      past: ordered.filter((event) => !isUpcoming(event)),
      sales: new Map((sales.data ?? []).map((summary) => [summary.event_id, summary])),
      isLoading: events.isPending,
    };
  }, [events.data, events.isPending, now, sales.data]);
}
