/** Path of the dedicated event page. */
export function eventPagePath(eventId: number): string {
  return `/events/${eventId}`;
}

/** Absolute shareable URL for the dedicated event page. */
export function buildEventShareUrl(eventId: number): string {
  const eventPath = eventPagePath(eventId);
  if (typeof window === "undefined") return eventPath;
  return `${window.location.origin}${eventPath}`;
}
