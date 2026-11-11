"use client";

import { useTranslation } from "react-i18next";
import { PosterTitleArt } from "@/features/events/components/PosterTitleArt";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Stack } from "@/shared/layout";
import { cn } from "@/shared/lib/utils";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { LazyImage } from "@/shared/ui/lazy-image";
import { Skeleton } from "@/shared/ui/skeleton";
import type { Event } from "@/shared/types";
import { formatCardDate } from "@/shared/utils/date";
import { posterThumbnailUrl } from "@/shared/utils/media";

/** Portrait like most club posters, so the poster fills the card. */
const CARD_CLASS = "relative aspect-4/5 w-full overflow-hidden rounded-2xl bg-media-scrim";

interface FeaturedEventCardProps {
  event: Event;
  onEventClick: (event: Event) => void;
  /** The first card loads its poster at once; the rest as they near the screen. */
  priority?: boolean;
}

/**
 * One featured event the way a streaming app shows a title: its poster fills
 * the card and fades to dark at the bottom, where its title, the clubs it is
 * by, and its day and place sit centred. Tapping the card opens the event. The title is drawn the way its poster sets it, from the SVG
 * ingestion made of it; without one it is set as text sized to its length.
 */
export function FeaturedEventCard({ event, onEventClick, priority = false }: FeaturedEventCardProps) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const posterSrc = event.source_image_url ? posterThumbnailUrl(event.source_image_url) : null;
  const timezone = getSchoolTimezone(event.school);
  const language = i18n.language || "en-US";
  const hosts = [
    { name: event.club ?? "", src: event.club_logo_url ?? "" },
    ...(event.cohosts ?? []).map(club => ({ name: club.club_name, src: club.logo_url ?? "" })),
  ].filter(host => host.name);
  const clubs = hosts.map(host => host.name).join(", ");
  // The day and the place; the time waits on the event itself.
  const facts = [formatCardDate(event, timezone, language), event.location?.trim()].filter(Boolean);

  return (
    <article data-slot="featured-event-card" className={CARD_CLASS}>
      <button
        type="button"
        className="absolute inset-0 cursor-pointer focus-visible:outline-none"
        aria-label={event.title}
        onClick={() => onEventClick(event)}
      >
        {event.source_image_url ? (
          <LazyImage
            src={posterSrc}
            fallbackSrc={event.source_image_url}
            alt=""
            loading={priority ? "eager" : "lazy"}
            className="size-full"
          />
        ) : null}
      </button>
      {/* The poster fades to dark under the copy, from well above it, so the copy always sits on a calm, dark base. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-media-scrim from-40% via-media-scrim/75 via-65% to-transparent" />
      <Stack gap={3} align="center" className="pointer-events-none absolute inset-x-0 bottom-0 px-5 pb-6 text-center text-on-media">
        {event.title_svg ? <PosterTitle title={event.title} svg={event.title_svg} /> : <TextTitle title={event.title} />}
        <Stack gap={2} align="center" className="w-full">
          {clubs ? (
            <Stack direction="horizontal" gap={2} align="center" justify="center" className="max-w-full">
              <span className="shrink-0 text-xs text-on-media-muted">{t("events.highlights.by")}</span>
              <AvatarStack avatars={hosts} decorative loading={priority ? "eager" : "lazy"} />
              <p className="line-clamp-1 min-w-0 text-left text-xs text-on-media-muted">{clubs}</p>
            </Stack>
          ) : null}
          <p className="line-clamp-1 text-xs font-medium">{facts.join(" · ")}</p>
        </Stack>
      </Stack>
    </article>
  );
}

/** The title as its poster sets it, with the title as text for screen readers. */
function PosterTitle({ title, svg }: { title: string; svg: string }) {
  return <>
    <h3 className="sr-only">{title}</h3>
    <PosterTitleArt svg={svg} variant="card" />
  </>;
}

/** A title set as text, smaller the longer it is, and never more than three lines. */
function TextTitle({ title }: { title: string }) {
  const size = title.length <= 18 ? "text-3xl sm:text-4xl" : title.length <= 36 ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl";
  return <h3 className={cn("line-clamp-3 text-balance font-bold leading-tight", size)}>{title}</h3>;
}

/** A featured card before its event arrives, the same size. */
export function FeaturedEventCardSkeleton() {
  return <Skeleton className="aspect-4/5 w-full rounded-2xl" />;
}
