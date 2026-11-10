import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useClubPayouts } from "@/features/club-panel/hooks/useClubPayouts";
import { cachedEvent, fetchEventById } from "@/features/events/api/events.api";
import { useEventTicketing, useTicketDesk } from "@/features/tickets";
import { queryKeys } from "@/shared/lib/queryKeys";

/** The event id in a club panel event page's path, or 0 when it isn't one. */
export function useEventIdParam(): number {
  const params = useParams<{ eventId?: string | string[] }>();
  const raw = Array.isArray(params.eventId) ? params.eventId[0] : params.eventId;
  return Number(raw) || 0;
}

/**
 * Everything a club's ticket pages for one event read: the event, its
 * tickets, their desk once there are tickets, and the club's payouts.
 */
export function useClubPanelEvent(eventId: number) {
  const event = useQuery({
    queryKey: queryKeys.events.detail(eventId),
    queryFn: () => fetchEventById(eventId),
    enabled: eventId > 0,
    // Opened from the club's events, the event is already known.
    placeholderData: () => cachedEvent(eventId),
  });
  const ticketing = useEventTicketing(eventId);
  const desk = useTicketDesk(eventId, Boolean(ticketing.data));
  const payouts = useClubPayouts(event.data?.club_id);
  // Payouts load once the event names its club; until then paid tickets can't be offered.
  const ticketsLoading =
    ticketing.isPending ||
    (event.data?.club_id != null && payouts.isPending) ||
    (ticketing.data != null && desk.isPending);
  const deskData = desk.data;
  return {
    event,
    ticketing: ticketing.data ?? null,
    desk: deskData,
    ticketsLoading,
    /** Tickets ever given out or sold. */
    issuedEver: (deskData?.issued ?? 0) + (deskData?.refunded ?? 0),
    payouts: {
      available: Boolean(payouts.data?.paid_tickets_enabled),
      ready: Boolean(payouts.data?.charges_enabled),
      currency: payouts.data?.currency ?? "cad",
    },
  };
}
