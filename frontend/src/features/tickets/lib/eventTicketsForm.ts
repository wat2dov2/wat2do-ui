import { buildEventOccurrence } from "@/shared/api/eventPayload";
import { controlBox } from "@/shared/config/controlBox";
import type { ApiEventTicketingUpdate } from "@/shared/generated";
import type { Event, EventFormData } from "@/shared/types";

const { minimumPriceCents, maximumPriceCents, maximumCapacity } = controlBox.ticketing;

/** A typed price in cents: zero when empty (free), null outside the allowed range; "12,50" counts as 12.50. */
export function ticketPriceCents(price: string): number | null {
  if (!price.trim()) return 0;
  const cents = Math.round(Number(price.trim().replace(",", ".")) * 100);
  return cents >= minimumPriceCents && cents <= maximumPriceCents ? cents : null;
}

/** A typed limit per date: null for no limit, undefined when it is not one. */
export function ticketCapacity(capacity: string): number | null | undefined {
  if (!capacity.trim()) return null;
  const value = Number(capacity);
  return Number.isInteger(value) && value > 0 && value <= maximumCapacity ? value : undefined;
}

/** The form's dates that have tickets: every date the event will be saved with, ticked. */
function ticketedOccurrences(formData: EventFormData) {
  return formData.occurrences.filter((occurrence) => occurrence.dtstart_local && occurrence.tickets);
}

export interface EventTicketsErrors {
  price?: true;
  capacity?: true;
  dates?: true;
}

/** What stops the form's tickets from saving; nothing while tickets are off. */
export function eventTicketsErrors(formData: EventFormData): EventTicketsErrors {
  const { tickets } = formData;
  if (!tickets.enabled) return {};
  return {
    ...(ticketPriceCents(tickets.price) === null ? { price: true } : {}),
    ...(ticketCapacity(tickets.capacity) === undefined ? { capacity: true } : {}),
    ...(ticketedOccurrences(formData).length === 0 ? { dates: true } : {}),
  };
}

/**
 * The tickets to save for `event`, just saved from `formData`: its ticked
 * dates by id, a new date matched by when it starts.
 */
export function eventTicketingUpdate(event: Event, formData: EventFormData): ApiEventTicketingUpdate {
  const { tickets, timeZone } = formData;
  const savedIds = new Set((event.occurrences ?? []).map((occurrence) => occurrence.id));
  const eventDateIds = ticketedOccurrences(formData).flatMap((occurrence) => {
    if (occurrence.id && savedIds.has(occurrence.id)) return [occurrence.id];
    const startsMs = Date.parse(buildEventOccurrence(occurrence, timeZone).dtstart_utc);
    const saved = (event.occurrences ?? []).find(
      (candidate) => Date.parse(candidate.dtstart_utc) === startsMs,
    );
    return saved ? [saved.id] : [];
  });
  return {
    price_cents: ticketPriceCents(tickets.price) ?? 0,
    capacity: ticketCapacity(tickets.capacity) ?? null,
    paused: tickets.paused,
    event_date_ids: eventDateIds,
  };
}
