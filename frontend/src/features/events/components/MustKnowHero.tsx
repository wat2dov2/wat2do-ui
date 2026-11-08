"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { EventCardImage } from "@/features/events/components/EventCardImage";
import { controlBox } from "@/shared/config/controlBox";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Stack } from "@/shared/layout";
import { cn } from "@/shared/lib/utils";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { Button } from "@/shared/ui/button";
import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";
import type { Event } from "@/shared/types";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { posterThumbnailUrl } from "@/shared/utils/media";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** The banner never turns on its own for a reader who asked for less motion, nor on the server. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => true,
  );
}

/*
 * The banner's frame, shared by the banner and its skeleton so the page never
 * moves when one replaces the other. Phones stack the poster above the text and
 * cap the poster at 40% of the screen's height; wider screens set them side by side,
 * where the square poster sets the banner's height.
 */
const FRAME_CLASS = "relative isolate overflow-hidden rounded-xl border border-border bg-surface";
const GRID_CLASS = "grid gap-4 p-4 sm:p-6 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]";
const POSTER_CLASS = "mx-auto w-full max-w-[40svh] md:max-w-none";
const TITLE_CLASS = "line-clamp-2 min-h-[2lh] text-2xl font-bold leading-tight text-foreground sm:text-3xl";
const FACT_CLASS = "flex min-w-0 items-center gap-2 text-sm text-muted-foreground sm:text-base";
const SLIDE_MOTION_CLASS = "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500";

function HeroFact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <p className={FACT_CLASS}>{icon}<span className="truncate">{children}</span></p>;
}

interface MustKnowHeroProps {
  events: Event[];
  onEventClick: (event: Event) => void;
}

/**
 * The events page's banner: one must-know event at a time, large, turning to
 * the next every few seconds like a slideshow. It holds still while the reader
 * points at it or works inside it, and never turns for a reader who asked for
 * less motion; the arrows and dots move it by hand.
 */
export function MustKnowHero({ events, onEventClick }: MustKnowHeroProps) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const reducedMotion = usePrefersReducedMotion();
  const [position, setPosition] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const count = events.length;
  const index = position % count;
  const event = events[index];
  const rotating = count > 1 && !reducedMotion && !hovered && !focused;

  useEffect(() => {
    if (!rotating) return;
    const timer = window.setTimeout(() => setPosition(index + 1), controlBox.eventDiscovery.highlights.mustKnowSlideMs);
    return () => window.clearTimeout(timer);
  }, [index, rotating]);

  // The next poster loads while this one shows, so the banner never turns to an empty frame.
  const nextPoster = events[(index + 1) % count]?.source_image_url;
  useEffect(() => {
    if (!nextPoster || count < 2) return;
    const image = new window.Image();
    image.src = posterThumbnailUrl(nextPoster);
  }, [count, nextPoster]);

  const go = (offset: number) => setPosition((index + offset + count) % count);
  const timezone = getSchoolTimezone(event.school);
  const language = i18n.language || "en-US";

  return (
    <section
      aria-roledescription="carousel"
      aria-label={t("events.highlights.mustKnow")}
      data-slot="must-know-hero"
      className={FRAME_CLASS}
      onPointerEnter={pointer => { if (pointer.pointerType === "mouse") setHovered(true); }}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={focus => { if (!focus.currentTarget.contains(focus.relatedTarget)) setFocused(false); }}
    >
      {/* The poster, blurred, fills the banner behind it; the surface over it keeps the text readable. */}
      {event.source_image_url ? (
        <img key={`backdrop-${event.id}`} src={posterThumbnailUrl(event.source_image_url)} alt="" aria-hidden="true" className={cn("absolute inset-0 -z-20 size-full scale-110 object-cover opacity-50 blur-3xl", SLIDE_MOTION_CLASS)} />
      ) : null}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-surface/70" />
      <div className={GRID_CLASS}>
        <div key={`poster-${event.id}`} className={cn(POSTER_CLASS, "cursor-pointer", SLIDE_MOTION_CLASS)} onClick={() => onEventClick(event)}>
          <EventCardImage event={event} variant="feature" priority={index === 0} />
        </div>
        <Stack gap={6} justify="between" className="min-w-0">
          <Stack
            key={`copy-${event.id}`}
            gap={4}
            justify="center"
            grow
            aria-roledescription="slide"
            aria-label={t("events.highlights.slide", { current: index + 1, total: count })}
            aria-live={rotating ? "off" : "polite"}
            className={SLIDE_MOTION_CLASS}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("events.highlights.mustKnow")}</p>
            <h2 className={TITLE_CLASS}>{event.title}</h2>
            <Stack gap={2}>
              <HeroFact icon={<CalendarDays aria-hidden="true" className="size-4 shrink-0" />}>
                {`${formatCardDate(event, timezone, language)}, ${formatCardTime(event, timezone, language)}`}
              </HeroFact>
              {/* An event without a place keeps the line, so the banner keeps its height from event to event. */}
              <HeroFact icon={<MapPin aria-hidden="true" className="size-4 shrink-0" />}>
                {event.location?.trim() || " "}
              </HeroFact>
              <HeroFact icon={<AvatarStack size="sm" avatars={[
                { name: event.club ?? event.title, src: event.club_logo_url ?? "" },
                ...(event.cohosts ?? []).map(club => ({ name: club.club_name, src: club.logo_url ?? "" })),
              ]} />}>
                {event.club ?? " "}
              </HeroFact>
            </Stack>
            <div>
              <Button size="lg" onClick={() => onEventClick(event)}>{t("events.highlights.openEvent")}</Button>
            </div>
          </Stack>
          {count > 1 ? (
            <Stack direction="horizontal" align="center" gap={1}>
              <Button variant="outline" size="icon-sm" aria-label={t("events.highlights.previous")} onClick={() => go(-1)}>
                <ChevronLeft className="rtl:rotate-180" />
              </Button>
              {events.map((item, dot) => (
                <Button key={item.id} variant="ghost" size="icon-sm" aria-label={t("events.highlights.showSlide", { current: dot + 1, total: count })} aria-current={dot === index || undefined} onClick={() => setPosition(dot)}>
                  <span aria-hidden="true" className={cn("h-2 rounded-full transition-all", dot === index ? "w-5 bg-foreground" : "w-2 bg-muted-foreground/40")} />
                </Button>
              ))}
              <Button variant="outline" size="icon-sm" aria-label={t("events.highlights.next")} onClick={() => go(1)}>
                <ChevronRight className="rtl:rotate-180" />
              </Button>
            </Stack>
          ) : null}
        </Stack>
      </div>
    </section>
  );
}

/** The banner before its events arrive, box for box. */
export function MustKnowHeroSkeleton() {
  const { t } = useTranslation();
  return (
    <section aria-label={t("events.highlights.mustKnow")} aria-busy="true" data-slot="must-know-hero" className={FRAME_CLASS}>
      <div className={GRID_CLASS}>
        <div className={POSTER_CLASS}>
          <Skeleton className="aspect-square w-full rounded-xl" />
        </div>
        <Stack gap={6} justify="between" className="min-w-0">
          <Stack gap={4} justify="center" grow>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("events.highlights.mustKnow")}</p>
            <h2 className={TITLE_CLASS}><SkeletonLine className="w-4/5" /><SkeletonLine className="w-1/2" /></h2>
            <Stack gap={2}>
              {["w-48", "w-40", "w-32"].map(width => (
                <p key={width} className={FACT_CLASS}><SkeletonLine className={width} /></p>
              ))}
            </Stack>
            <div>
              <Skeleton className="h-11 w-32 rounded-xl" />
            </div>
          </Stack>
          {/* The arrows and dots, still: a banner of one event has none, but a feed rarely has one. */}
          <Skeleton className="h-8 w-48 rounded-xl" />
        </Stack>
      </div>
    </section>
  );
}
