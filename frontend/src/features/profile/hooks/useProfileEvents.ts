import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchEventsByIds,
  useCurrentTime,
  useGoingEvents,
  useSavedEventIds,
} from "@/features/events";
import { useMyTickets } from "@/features/tickets";
import { controlBox } from "@/shared/config/controlBox";
import { queryKeys } from "@/shared/lib/queryKeys";
import type { Event } from "@/shared/types";
import { getPrimaryOccurrence } from "@/shared/utils/date";

/** One line in a profile list: an event, on one of its dates. */
export interface ProfileEventRow {
  key: string;
  eventId: number;
  title: string;
  dtstartUtc: string;
  dtendUtc: string | null;
  location: string | null;
  school: string | null;
  /** The visitor's ticket for this date, when they hold one. */
  ticketCode: string | null;
}

function eventRow(event: Event, occurrence: NonNullable<Event["occurrences"]>[number], ticketCode: string | null): ProfileEventRow {
  return {
    key: `${event.id}:${occurrence.id}`,
    eventId: event.id,
    title: event.title,
    dtstartUtc: occurrence.dtstart_utc,
    dtendUtc: occurrence.dtend_utc ?? null,
    location: event.location ?? null,
    school: event.school ?? null,
    ticketCode,
  };
}

/** A date stays upcoming until it ends, while the event runs (as My tickets reads it). */
function endsAt(row: ProfileEventRow): number {
  return new Date(row.dtendUtc ?? row.dtstartUtc).getTime();
}

/**
 * The visitor's events for their profile: the ones they saved, and every date
 * they turned Notify me on for or held a ticket for, split into the ones still
 * to come (soonest first) and the past ones (latest first).
 */
export function useProfileEvents() {
  const going = useGoingEvents();
  const saved = useSavedEventIds();
  const tickets = useMyTickets();
  const now = useCurrentTime();

  const ids = useMemo(
    () =>
      [...new Set([...(saved.data ?? []), ...(going.data ?? []).map((selection) => selection.event_id)])].sort(
        (left, right) => left - right,
      ),
    [going.data, saved.data],
  );
  const events = useQuery({
    queryKey: queryKeys.events.byIds(ids),
    queryFn: () => fetchEventsByIds(ids),
    enabled: ids.length > 0,
    staleTime: controlBox.clientCache.liveEventDataStaleMs,
  });

  return useMemo(() => {
    const byId = new Map((events.data ?? []).map((event) => [event.id, event]));
    const validTickets = (tickets.data ?? []).filter((ticket) => ticket.status === "valid");
    const ticketFor = new Map(validTickets.map((ticket) => [ticket.event_date_id, ticket.code]));

    const savedRows = (saved.data ?? []).flatMap((eventId) => {
      const event = byId.get(eventId);
      const occurrence = event ? getPrimaryOccurrence(event) : null;
      return event && occurrence ? [{ ...eventRow(event, occurrence, null), key: `saved:${event.id}` }] : [];
    });

    const attending = new Map<string, ProfileEventRow>();
    for (const selection of going.data ?? []) {
      const event = byId.get(selection.event_id);
      for (const occurrence of event?.occurrences ?? []) {
        if (!event || !selection.occurrence_ids.includes(occurrence.id)) continue;
        attending.set(occurrence.id, eventRow(event, occurrence, ticketFor.get(occurrence.id) ?? null));
      }
    }
    // A ticket counts as an event of theirs, even without Notify me on.
    for (const ticket of validTickets) {
      if (attending.has(ticket.event_date_id)) continue;
      attending.set(ticket.event_date_id, {
        key: `${ticket.event_id}:${ticket.event_date_id}`,
        eventId: ticket.event_id,
        title: ticket.event_title,
        dtstartUtc: ticket.dtstart_utc,
        dtendUtc: ticket.dtend_utc ?? null,
        location: ticket.location ?? null,
        school: ticket.school ?? null,
        ticketCode: ticket.code,
      });
    }
    const rows = [...attending.values()];
    const isUpcoming = (row: ProfileEventRow) => now === null || endsAt(row) >= now;
    return {
      saved: savedRows,
      upcoming: rows.filter(isUpcoming).sort((left, right) => endsAt(left) - endsAt(right)),
      past: rows.filter((row) => !isUpcoming(row)).sort((left, right) => endsAt(right) - endsAt(left)),
      isPending: going.isPending || saved.isPending || tickets.isPending || (ids.length > 0 && events.isPending),
    };
  }, [events.data, events.isPending, going.data, going.isPending, ids.length, now, saved.data, saved.isPending, tickets.data, tickets.isPending]);
}
