import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { AppPage } from "@/app/app-page";
import imgContactHero from "@/assets/contact_hero.png";
import { getEventDetailSnapshot } from "@/features/events/api/eventFeed.server";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import { EventDetailsPageContainer } from "@/features/events/pages/EventDetailsPageContainer";
import { getSchool } from "@/shared/api/schools.server";
import {
  buildNoIndexPageMetadata,
  buildPublicPageMetadata,
  getSchoolCanonicalUrl,
  isCanonicalProductionHost,
  selectSeoImage,
} from "@/shared/lib/seo";
import type { Event } from "@/shared/types";

interface EventDetailsPageProps {
  params: Promise<{
    id: string;
  }>;
}

function parseEventId(value: string): number | null {
  const eventId = Number(value);
  return Number.isInteger(eventId) && eventId > 0 ? eventId : null;
}

function isEventIndexable(event: Event): boolean {
  const hasOccurrence = (event.occurrences ?? []).some((occurrence) =>
    Number.isFinite(new Date(occurrence.dtstart_utc).getTime()),
  );
  const hasUsefulContext = Boolean(
    event.location?.trim() ||
      event.organization?.trim() ||
      event.description?.trim(),
  );
  return Boolean(event.title.trim() && event.school?.trim() && hasOccurrence && hasUsefulContext);
}

function buildEventDescription(event: Event, schoolName: string): string {
  const description = event.description?.replace(/\s+/g, " ").trim();
  if (description) return description;

  const details = [event.location, event.organization]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return `${event.title} at ${schoolName}${details.length > 0 ? `. ${details.join(" - ")}.` : "."} View dates, times, location, cost, and attendance details on Wat2Do.`;
}

async function loadEvent(eventId: number): Promise<Event | null> {
  try {
    return await getEventDetailSnapshot(eventId);
  } catch (error) {
    console.error("Event SEO detail fetch failed:", error);
    return null;
  }
}

export async function generateMetadata({
  params,
}: EventDetailsPageProps): Promise<Metadata> {
  const { id } = await params;
  const eventId = parseEventId(id);
  const event = eventId ? await loadEvent(eventId) : null;
  const fallbackImage = {
    url: imgContactHero.src,
    alt: "Discover campus events with Wat2Do",
    width: imgContactHero.width,
    height: imgContactHero.height,
    type: "image/png",
  };

  if (!event) {
    return buildNoIndexPageMetadata({
      title: "Event Not Found | Wat2Do",
      description: "This Wat2Do event could not be found.",
      image: fallbackImage,
    });
  }

  const school = event.school ?? "uwaterloo";
  const schoolRecord = await getSchool(school);
  const schoolName = schoolRecord?.name ?? school;
  const title = `${event.title} at ${schoolName} | Wat2Do`;
  const description = buildEventDescription(event, schoolName);

  return buildPublicPageMetadata({
    title,
    description,
    canonicalUrl: getSchoolCanonicalUrl(school, eventPagePath(event.id)),
    image: selectSeoImage(
      event.source_image_url,
      `${event.title} event poster`,
      fallbackImage,
    ),
    index: isEventIndexable(event),
  });
}

export default async function EventDetailsPage({ params }: EventDetailsPageProps) {
  const { id } = await params;
  const eventId = parseEventId(id);
  if (!eventId) notFound();

  const event = await getEventDetailSnapshot(eventId);
  if (!event) notFound();

  const canonicalUrl = getSchoolCanonicalUrl(
    event.school ?? "uwaterloo",
    eventPagePath(event.id),
  );
  const requestHeaders = await headers();
  const requestHost =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!isCanonicalProductionHost(requestHost, canonicalUrl)) {
    permanentRedirect(canonicalUrl);
  }

  return (
    <AppPage renderBeforeReady>
      <EventDetailsPageContainer eventId={event.id} initialEvent={event} />
    </AppPage>
  );
}
