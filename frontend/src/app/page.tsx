import type { Metadata } from "next";
import { headers } from "next/headers";
import { EventRoutePage } from "@/app/event-route-page";
import imgContactHero from "@/assets/contact_hero.png";
import { getSchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";
import type { SchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";
import { getSchool } from "@/shared/api/schools.server";
import { getSchoolFromRequestHost } from "@/shared/constants/schools";
import {
  buildPublicPageMetadata,
  getSchoolCanonicalUrl,
  selectSeoImage,
} from "@/shared/lib/seo";

export const revalidate = 0;

async function loadInitialSnapshot(school: string): Promise<SchoolBrowseSnapshot | null> {
  try {
    return await getSchoolBrowseSnapshot(school);
  } catch (err) {
    console.error("Initial event feed fetch failed:", err);
    return null;
  }
}

/** Each school is served from its own subdomain, so the Host header scopes the feed. */
async function resolveRequestSchool(): Promise<string> {
  const requestHeaders = await headers();
  return getSchoolFromRequestHost(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const school = await resolveRequestSchool();
  const [schoolRecord, snapshot] = await Promise.all([
    getSchool(school),
    loadInitialSnapshot(school),
  ]);
  const schoolName = schoolRecord?.name ?? school;
  const title = `${schoolName} Events and Things to Do | Wat2Do`;
  const description = `Discover current events, activities, and things to do for students at ${schoolName}. Explore campus events by date, category, cost, and more.`;
  const featuredEvent = snapshot?.promotedEvents.find(
    (event) => event.source_image_url,
  ) ?? snapshot?.feed.items.find((event) => event.source_image_url);
  const image = selectSeoImage(
    featuredEvent?.source_image_url,
    featuredEvent ? `${featuredEvent.title} event poster` : "",
    {
      url: imgContactHero.src,
      alt: `Discover events and student life at ${schoolName} with Wat2Do`,
      width: imgContactHero.width,
      height: imgContactHero.height,
      type: "image/png",
    },
  );

  return buildPublicPageMetadata({
    title,
    description,
    canonicalUrl: getSchoolCanonicalUrl(school, "/"),
    image,
    index: Boolean(snapshot && snapshot.feed.items.length > 0),
  });
}

export default async function HomePage() {
  const school = await resolveRequestSchool();
  const [snapshot, schoolRecord] = await Promise.all([
    loadInitialSnapshot(school),
    getSchool(school),
  ]);

  return (
    <EventRoutePage
      initialSnapshot={snapshot}
      initialSchool={school}
      schoolName={schoolRecord?.name ?? school}
    />
  );
}
