import { QP } from "@/shared/constants/queryParams";

/** Path of the dedicated event page. */
export function eventPagePath(eventId: number): string {
  return `/events/${eventId}`;
}

/** Absolute shareable URL that opens the event drawer on the feed. */
export function buildEventShareUrl(eventId: number): string {
  const eventPath = `/?${QP.EVENT_ID}=${eventId}`;
  if (typeof window === "undefined") return eventPath;
  return `${window.location.origin}${eventPath}`;
}
