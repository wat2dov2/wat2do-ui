import { buildEventOccurrence } from "@/shared/api/eventPayload";
import { controlBox } from "@/shared/config/controlBox";
import type { ApiEventTicketingUpdate } from "@/shared/generated";
import type { Event, EventFormData, EventFormTicketRelease } from "@/shared/types";
import { localDateTimeToUtc, toLocalDateTimeInput } from "@/shared/utils/date";

const { minimumPriceCents, maximumPriceCents, maximumCapacity } = controlBox.ticketing;

/** A typed price in cents: zero when empty (free), null outside the allowed range; "12,50" counts as 12.50. */
export function ticketPriceCents(price: string): number | null {
  if (!price.trim()) return 0;
  const cents = Math.round(Number(price.trim().replace(",", ".")) * 100);
  return cents >= minimumPriceCents && cents <= maximumPriceCents ? cents : null;
}

/** A typed number of tickets per date: null for no limit, undefined when it is not one. */
export function ticketQuantity(quantity: string): number | null | undefined {
  if (!quantity.trim()) return null;
  const value = Number(quantity);
  return Number.isInteger(value) && value > 0 && value <= maximumCapacity ? value : undefined;
}

/** When a release goes on sale, in UTC, or null while it is not a time in the form's zone. */
function onSaleUtc(release: EventFormTicketRelease, timeZone: string): string | null {
  if (!release.on_sale_local) return null;
  try {
    return localDateTimeToUtc(release.on_sale_local, timeZone);
  } catch {
    return null;
  }
}

/** A new release, going on sale at `onSale` (now, for the first one). */
export function newTicketRelease(timeZone: string, onSale: Date | null): EventFormTicketRelease {
  return {
    on_sale_local: onSale ? toLocalDateTimeInput(onSale, timeZone) : "",
    quantity: "",
    price: "",
  };
}

/** The form's dates that have tickets: every date the event will be saved with, ticked. */
function ticketedOccurrences(formData: EventFormData) {
  return formData.occurrences.filter((occurrence) => occurrence.dtstart_local && occurrence.tickets);
}

/** What stops one release from saving. */
export interface TicketReleaseErrors {
  onSale?: "required" | "sameTime";
  quantity?: "range" | "unlimitedNotLast";
  price?: "range" | "mixed";
}

export interface EventTicketsErrors {
  releases?: TicketReleaseErrors[];
  dates?: true;
}

/**
 * What stops each release from saving, the rules the server applies too:
 * a time, a limit and price in range, one price kind for every release,
 * distinct times, and no limit only on the last release to go on sale.
 */
function releaseErrors(releases: EventFormTicketRelease[], timeZone: string): TicketReleaseErrors[] {
  const times = releases.map((release) => onSaleUtc(release, timeZone));
  const lastOnSale = Math.max(...times.map((time) => (time ? Date.parse(time) : -Infinity)));
  const paid = releases.some((release) => (ticketPriceCents(release.price) ?? 1) > 0);
  const free = releases.some((release) => ticketPriceCents(release.price) === 0);
  return releases.map((release, index) => {
    const errors: TicketReleaseErrors = {};
    const time = times[index];
    if (!time) errors.onSale = "required";
    else if (times.some((other, otherIndex) => otherIndex !== index && other === time)) errors.onSale = "sameTime";
    const quantity = ticketQuantity(release.quantity);
    if (quantity === undefined) errors.quantity = "range";
    else if (quantity === null && time && Date.parse(time) < lastOnSale) errors.quantity = "unlimitedNotLast";
    if (ticketPriceCents(release.price) === null) errors.price = "range";
    else if (paid && free) errors.price = "mixed";
    return errors;
  });
}

/** What stops the form's tickets from saving; nothing while tickets are off. */
export function eventTicketsErrors(formData: EventFormData): EventTicketsErrors {
  const { tickets, timeZone } = formData;
  if (!tickets.enabled) return {};
  const releases = releaseErrors(tickets.releases, timeZone);
  return {
    ...(releases.some((errors) => Object.keys(errors).length > 0) ? { releases } : {}),
    ...(ticketedOccurrences(formData).length === 0 ? { dates: true } : {}),
  };
}

/**
 * The tickets to save for `event`, just saved from `formData`: its releases,
 * and its ticked dates by id, a new date matched by when it starts.
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
    releases: tickets.releases.map((release) => ({
      id: release.id ?? null,
      on_sale_at: localDateTimeToUtc(release.on_sale_local, timeZone),
      quantity: ticketQuantity(release.quantity) ?? null,
      price_cents: ticketPriceCents(release.price) ?? 0,
    })),
    // Clubs no longer pause tickets, so saving always leaves them on sale.
    paused: false,
    event_date_ids: eventDateIds,
  };
}
