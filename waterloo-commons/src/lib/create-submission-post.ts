import { normalisePost, type CommonsPost } from "@/lib/post";
import type { EventSubmissionFields } from "@/lib/submissions";

function captionLine(label: string, value: string) {
  return value ? `${label} ${value}` : "";
}

export function createSubmissionPost(event: EventSubmissionFields): CommonsPost {
  const schedule = [event.date, event.time].filter(Boolean).join(" @ ");
  const details = [
    captionLine("🗓️", schedule),
    captionLine("📍", event.location),
    event.description,
    event.registrationUrl ? `Register: ${event.registrationUrl}` : "",
  ].filter(Boolean);

  return normalisePost({
    title: event.title,
    hostOrg: event.hosts,
    badge: "EVENT",
    pills: event.registrationUrl ? ["REG. REQUIRED"] : [],
    venue: event.location,
    dateLine: event.date,
    timeLine: event.time,
    caption: [`${event.title.toUpperCase()} - hosted by ${event.hosts}`, ...details].join("\n\n"),
  });
}
