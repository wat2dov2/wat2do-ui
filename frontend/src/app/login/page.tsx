import type { Metadata } from "next";
import { headers } from "next/headers";
import imgAuthLogo from "@/assets/38e8096a28295e8dcc0e5020d0a5f3dd85d5f019.png";
import { AuthEntryPage } from "@/features/auth/pages/AuthEntryPage";
import { getSchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";
import { getSchoolFromRequestHost } from "@/shared/constants/schools";
import { QP } from "@/shared/constants/queryParams";
import {
  buildNoIndexPageMetadata,
  selectSeoImage,
} from "@/shared/lib/seo";
import type { Event } from "@/shared/types";

export const revalidate = 0;
const LOGIN_PREVIEW_EVENT_COUNT = 4;

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstSearchParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function loadPreviewEvents(school: string): Promise<Event[]> {
  try {
    const snapshot = await getSchoolBrowseSnapshot(school);
    const seenTitles = new Set<string>();
    const previewEvents: Event[] = [];
    for (const event of snapshot.feed.items) {
      if (seenTitles.has(event.title)) continue;
      seenTitles.add(event.title);
      previewEvents.push(event);
      if (previewEvents.length === LOGIN_PREVIEW_EVENT_COUNT) break;
    }
    return previewEvents;
  } catch (err) {
    console.error("Login preview feed fetch failed:", err);
    return [];
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const school = getSchoolFromRequestHost(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );
  const previewEvents = await loadPreviewEvents(school);
  const featuredEvent = previewEvents.find((event) => event.source_image_url);
  const title = "Sign In to Wat2Do";
  const description =
    "Sign in or create a Wat2Do account to save campus events, follow student clubs, and personalize your event feed.";

  return buildNoIndexPageMetadata({
    title,
    description,
    image: selectSeoImage(
      featuredEvent?.source_image_url,
      featuredEvent ? `${featuredEvent.title} event poster` : "",
      {
        url: imgAuthLogo.src,
        alt: "Wat2Do campus event discovery",
        width: imgAuthLogo.width,
        height: imgAuthLogo.height,
        type: "image/png",
      },
    ),
  });
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const requestHeaders = await headers();
  const school = getSchoolFromRequestHost(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );
  const [previewEvents, query] = await Promise.all([
    loadPreviewEvents(school),
    searchParams,
  ]);

  return (
    <AuthEntryPage
      previewEvents={previewEvents}
      initialEmail={firstSearchParam(query.email)}
      invitationToken={firstSearchParam(query.token)}
      initialReturnTo={firstSearchParam(query[QP.RETURN_TO])}
      initialOAuthError={firstSearchParam(query[QP.OAUTH_ERROR])}
    />
  );
}
