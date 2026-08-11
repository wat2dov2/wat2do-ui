import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import imgContactHero from "@/assets/contact_hero.png";
import { getEventDetailSnapshot } from "@/features/events/api/eventFeed.server";
import {
  buildEventDescription,
  buildEventStructuredData,
  isEventIndexable,
} from "@/features/events/lib/eventSeo";
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
import { StructuredData } from "@/shared/ui/structured-data";

interface EventDetailsPageProps {
  params: Promise<{
    id: string;
  }>;
}

function parseEventId(value: string): number | null {
  const eventId = Number(value);
  return Number.isInteger(eventId) && eventId > 0 ? eventId : null;
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

  const schoolRecord = await getSchool(event.school ?? "uwaterloo");
  const structuredData = buildEventStructuredData(
    event,
    schoolRecord?.name ?? event.school ?? "Wat2Do",
  );

  return (
    <>
      {structuredData ? <StructuredData data={structuredData} /> : null}
      <EventDetailsPageContainer eventId={event.id} initialEvent={event} />
    </>
  );
}
