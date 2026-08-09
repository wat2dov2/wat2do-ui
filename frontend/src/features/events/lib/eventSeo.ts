import { isVirtualLocation } from "@/features/events/lib/isVirtualLocation";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import { organizationPagePath } from "@/shared/constants/routes";
import { getSchoolCanonicalUrl } from "@/shared/lib/seo";
import type { Event } from "@/shared/types";

const RESTRICTED_ATTENDANCE_PATTERN =
  /\b(invitation only|invite only|members? only|private event|closed event)\b/i;
const PUBLIC_ATTENDANCE_PATTERN =
  /\b(open to (?:all|everyone|the public)|everyone (?:is )?welcome|all students (?:are )?welcome|public event)\b/i;
const STREET_ADDRESS_PATTERN = /^\d{1,6}\s+[A-Za-zÀ-ÖØ-öø-ÿ].+/;
const REGION_AND_POSTAL_CODE_PATTERN = /^([A-Za-z]{2,})(?:\s+(.+))?$/;

interface StructuredLocation {
  placeName: string;
  streetAddress: string;
  addressLocality: string;
  addressRegion: string;
  postalCode?: string;
  addressCountry?: string;
}

function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isEventIndexable(event: Event): boolean {
  const hasOccurrence = (event.occurrences ?? []).some((occurrence) =>
    Number.isFinite(new Date(occurrence.dtstart_utc).getTime()),
  );
  const hasUsefulContext = Boolean(
    event.location?.trim() ||
      event.organization?.trim() ||
      event.description?.trim(),
  );
  return Boolean(
    event.title.trim() && event.school?.trim() && hasOccurrence && hasUsefulContext,
  );
}

export function buildEventDescription(event: Event, schoolName: string): string {
  const description = event.description?.replace(/\s+/g, " ").trim();
  if (description) return description;

  const details = [event.location, event.organization]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return `${event.title} at ${schoolName}${details.length > 0 ? `. ${details.join(" - ")}.` : "."} View dates, times, location, cost, and attendance details on Wat2Do.`;
}

function parseStructuredLocation(location: string): StructuredLocation | null {
  const parts = location
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const streetIndex = parts.findIndex((part) => STREET_ADDRESS_PATTERN.test(part));
  if (streetIndex < 0 || parts.length < streetIndex + 3) return null;

  const regionMatch = REGION_AND_POSTAL_CODE_PATTERN.exec(parts[streetIndex + 2]);
  if (!regionMatch) return null;
  return {
    placeName: parts.slice(0, streetIndex).join(", ") || parts[streetIndex],
    streetAddress: parts[streetIndex],
    addressLocality: parts[streetIndex + 1],
    addressRegion: regionMatch[1],
    ...(regionMatch[2] ? { postalCode: regionMatch[2] } : {}),
    ...(parts[streetIndex + 3]
      ? { addressCountry: parts[streetIndex + 3] }
      : {}),
  };
}

export function isEventStructuredDataEligible(
  event: Event,
  nowMilliseconds = Date.now(),
): boolean {
  const [occurrence] = event.occurrences ?? [];
  const location = event.location?.trim() ?? "";
  const attendanceText = `${event.title} ${event.description ?? ""}`;
  const occurrenceEnd = occurrence?.dtend_utc ?? occurrence?.dtstart_utc;
  return Boolean(
    isEventIndexable(event) &&
      event.occurrences?.length === 1 &&
      occurrence &&
      Number.isFinite(new Date(occurrence.dtstart_utc).getTime()) &&
      occurrenceEnd &&
      new Date(occurrenceEnd).getTime() >= nowMilliseconds &&
      event.description?.trim() &&
      event.organization?.trim() &&
      event.organization_id &&
      isHttpUrl(event.source_url) &&
      isHttpUrl(event.source_image_url) &&
      location &&
      !isVirtualLocation(location) &&
      parseStructuredLocation(location) &&
      PUBLIC_ATTENDANCE_PATTERN.test(attendanceText) &&
      !RESTRICTED_ATTENDANCE_PATTERN.test(attendanceText)
  );
}

export function buildEventStructuredData(
  event: Event,
  schoolName: string,
): Record<string, unknown> | null {
  if (!isEventStructuredDataEligible(event)) return null;

  const [occurrence] = event.occurrences;
  const location = parseStructuredLocation(event.location ?? "");
  if (!location || !event.organization_id) return null;
  const school = event.school ?? "uwaterloo";
  const canonicalUrl = getSchoolCanonicalUrl(school, eventPagePath(event.id));

  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    description: buildEventDescription(event, schoolName),
    startDate: occurrence.dtstart_utc,
    ...(occurrence.dtend_utc ? { endDate: occurrence.dtend_utc } : {}),
    eventStatus: event.cancelled
      ? "https://schema.org/EventCancelled"
      : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: {
      "@type": "Place",
      name: location.placeName,
      address: {
        "@type": "PostalAddress",
        streetAddress: location.streetAddress,
        addressLocality: location.addressLocality,
        addressRegion: location.addressRegion,
        ...(location.postalCode ? { postalCode: location.postalCode } : {}),
        ...(location.addressCountry
          ? { addressCountry: location.addressCountry }
          : {}),
      },
    },
    image: [event.source_image_url],
    url: canonicalUrl,
    mainEntityOfPage: canonicalUrl,
    organizer: {
      "@type": "Organization",
      name: event.organization,
      url: getSchoolCanonicalUrl(
        school,
        organizationPagePath(event.organization_id),
      ),
    },
  };
}
