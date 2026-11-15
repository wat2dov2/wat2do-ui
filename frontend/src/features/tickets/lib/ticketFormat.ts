import type {
  ApiEventTicketingResponse,
  ApiTicketAttendee,
  ApiTicketResponse,
} from "@/shared/generated";
import type { Event } from "@/shared/types";
import { getCurrentSchool, getSchoolOrigin } from "@/shared/constants/schools";
import { ticketPath } from "@/shared/constants/routes";

/** The link a ticket's QR code holds: the holder's ticket, or check-in for the club's team. */
export function ticketUrl(ticket: Pick<ApiTicketResponse, "code" | "school">): string {
  return `${getSchoolOrigin(ticket.school ?? getCurrentSchool())}${ticketPath(ticket.code)}`;
}

/** "7KQ2 MZ4P ..." reads more easily at a door than one unbroken string. */
export function formatTicketCode(code: string): string {
  return code.match(/.{1,4}/g)?.join(" ") ?? code;
}

/** The code inside whatever the scanner read: a ticket link, or a code typed by hand. */
export function ticketCodeFrom(scanned: string): string {
  const lastSegment = scanned.trim().replace(/\/+$/, "").split("/").pop() ?? "";
  return lastSegment.split(/[?#]/)[0].replace(/[\s-]/g, "").toUpperCase();
}

/** "7:42 PM" in the reader's locale, for check-in times at the door. */
export function formatClock(iso: string | null | undefined, locale: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** "Oct 22" in the reader's locale, for when a refund was asked for or declined. */
export function formatDay(iso: string | null | undefined, locale: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(iso));
}

export type RefundRequestState = "none" | "waiting" | "declined";

/** Where a holder's refund request stands; a refunded ticket has none left to wait on. */
export function refundRequestState(
  ticket: Pick<ApiTicketAttendee, "status" | "refund_requested_at" | "refund_declined_at">,
): RefundRequestState {
  if (ticket.status !== "valid" || !ticket.refund_requested_at) return "none";
  return ticket.refund_declined_at ? "declined" : "waiting";
}

export type TicketDate = ApiEventTicketingResponse["dates"][number];
export type TicketUnavailable =
  | "cancelled"
  | "ownEvent"
  | "paused"
  | "onSale"
  | "soldOut"
  | "closed"
  | "notYet";

/**
 * Why nobody can get a ticket right now, or null when they can. The hosting
 * club's own team (`ownEvent`) never gets tickets to its event.
 */
export function ticketUnavailableReason(
  event: Pick<Event, "cancelled">,
  ticketing: ApiEventTicketingResponse,
  openDates: TicketDate[],
  ownEvent: boolean,
): TicketUnavailable | null {
  if (event.cancelled) return "cancelled";
  if (ownEvent) return "ownEvent";
  if (ticketing.paused) return "paused";
  if (!openDates.length) {
    if (ticketsOnSaleAt(ticketing)) return "onSale";
    return ticketing.dates.some((date) => date.remaining === 0) ? "soldOut" : "closed";
  }
  return ticketing.available ? null : "notYet";
}

/** When the next tickets go on sale, while no date has any on sale; null otherwise. */
export function ticketsOnSaleAt(ticketing: ApiEventTicketingResponse | null | undefined): string | null {
  if (!ticketing || ticketing.dates.some((date) => date.open)) return null;
  const times = ticketing.dates.flatMap((date) => (date.on_sale_at ? [date.on_sale_at] : []));
  return times.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
}

/** What a ticket costs now: the first open date's price, else the first date's. */
export function currentTicketPriceCents(ticketing: ApiEventTicketingResponse): number {
  const date = ticketing.dates.find((candidate) => candidate.open) ?? ticketing.dates[0];
  return date?.price_cents ?? ticketing.releases[0]?.price_cents ?? 0;
}

/** "Sat, Nov 15, 9:00 AM" on the event's campus clock, for when tickets go on sale. */
export function formatOnSale(iso: string, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}
