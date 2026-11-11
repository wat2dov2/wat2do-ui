"use client";

import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { useSignedInAction } from "@/features/auth/hooks/useSignInGate";
import { useGoingEventSelection } from "@/features/events/hooks/useGoingEvents";
import { useTitleFont } from "@/features/events/hooks/useTitleFont";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Stack } from "@/shared/layout";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { Button } from "@/shared/ui/button";
import { LazyImage } from "@/shared/ui/lazy-image";
import { Skeleton } from "@/shared/ui/skeleton";
import type { Event } from "@/shared/types";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
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
 * the card, fading to dark at the bottom where its title, when and where, its
 * clubs and its two actions sit centred.
 */
export function FeaturedEventCard({ event, onEventClick, priority = false }: FeaturedEventCardProps) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const titleFont = useTitleFont(event.title_font);
  const timezone = getSchoolTimezone(event.school);
  const language = i18n.language || "en-US";
  const hosts = [
    { name: event.club ?? "", src: event.club_logo_url ?? "" },
    ...(event.cohosts ?? []).map(club => ({ name: club.club_name, src: club.logo_url ?? "" })),
  ].filter(host => host.name);
  const clubs = hosts.map(host => host.name).join(", ");
  const facts = [
    `${formatCardDate(event, timezone, language)}, ${formatCardTime(event, timezone, language)}`,
    event.location?.trim(),
  ].filter(Boolean);

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
            src={posterThumbnailUrl(event.source_image_url)}
            fallbackSrc={event.source_image_url}
            alt=""
            loading={priority ? "eager" : "lazy"}
            className="size-full"
          />
        ) : null}
      </button>
      {/* The poster fades to dark under the copy, so light text reads on any poster. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-media-scrim from-25% via-media-scrim/70 to-transparent" />
      <Stack gap={3} align="center" className="pointer-events-none absolute inset-x-0 bottom-0 px-5 pb-5 text-center text-on-media">
        <h3
          className="line-clamp-3 text-balance text-2xl font-bold leading-tight sm:text-3xl"
          style={titleFont ? { fontFamily: titleFont } : undefined}
        >
          {event.title}
        </h3>
        <Stack gap={1} align="center" className="w-full">
          <p className="line-clamp-1 text-sm font-medium">{facts.join(" · ")}</p>
          {clubs ? (
            <Stack direction="horizontal" gap={2} align="center" justify="center" className="max-w-full">
              <AvatarStack avatars={hosts} decorative loading={priority ? "eager" : "lazy"} />
              <p className="line-clamp-1 min-w-0 text-left text-sm text-on-media-muted">{clubs}</p>
            </Stack>
          ) : null}
        </Stack>
        <Stack direction="horizontal" gap={2} justify="center" className="pointer-events-auto pt-1">
          <FeaturedGoingButton event={event} onEventClick={onEventClick} />
          <Button variant="media" onClick={() => onEventClick(event)}>{t("events.highlights.openEvent")}</Button>
        </Stack>
      </Stack>
    </article>
  );
}

/**
 * Going in one tap for an event with one date to pick; an event with several
 * dates, or with registration or tickets, opens so the reader chooses there.
 * A signed-out reader is sent to log in instead, so it is never disabled for them.
 */
function FeaturedGoingButton({ event, onEventClick }: { event: Event; onEventClick: (event: Event) => void }) {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuthState();
  const signedInAction = useSignedInAction();
  const going = useGoingEventSelection(event, event.school);
  const [only] = going.selectableOccurrences;
  const oneTap = going.selectableOccurrences.length === 1 && !event.registration;

  const toggle = async () => {
    if (!oneTap || !only) {
      onEventClick(event);
      return;
    }
    await going.saveSelection(going.isActive ? [] : [only.id]).catch(() => undefined);
  };

  return (
    <Button
      variant="primary"
      aria-pressed={oneTap ? going.isActive : undefined}
      disabled={isAuthenticated && (going.isPending || going.isTimeUnavailable)}
      onClick={() => signedInAction(() => void toggle())}
    >
      {going.isActive ? <Check aria-hidden="true" /> : null}
      {t("events.going")}
    </Button>
  );
}

/** A featured card before its event arrives, the same size. */
export function FeaturedEventCardSkeleton() {
  return <Skeleton className="aspect-4/5 w-full rounded-2xl" />;
}
