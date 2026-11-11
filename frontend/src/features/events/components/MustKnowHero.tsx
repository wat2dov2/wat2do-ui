"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Pause, Play } from "lucide-react";
import { EventCardImage, FEATURE_POSTER_SHAPE_CLASS } from "@/features/events/components/EventCardImage";
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
 * moves when one replaces the other. The portrait poster sets the banner's
 * height: phones stack it above the copy, full width but never taller than half
 * the screen; wider screens set it beside the copy. The title always takes two
 * lines and each fact one, so every slide is the same height.
 */
const FRAME_CLASS = "overflow-hidden rounded-xl border border-border bg-surface";
const GRID_CLASS = "grid gap-4 p-3 md:grid-cols-[17rem_minmax(0,1fr)] md:gap-0 lg:grid-cols-[20rem_minmax(0,1fr)]";
const COPY_CLASS = "min-w-0 px-1 pb-1 md:p-6 lg:p-8";
/** Two lines tall whatever the title, with a short title sitting on the lower line, just above its facts. */
const TITLE_BOX_CLASS = "flex min-h-[2lh] items-end text-xl font-semibold leading-tight tracking-tight text-foreground sm:text-2xl lg:text-3xl";
const TITLE_CLASS = "line-clamp-2 text-balance";
const FACT_CLASS = "flex min-w-0 items-center gap-2 text-sm text-muted-foreground";
/** The row holds its height for a single event too, which has no controls. */
const TOP_ROW_CLASS = "h-8";
const SLIDE_MOTION_CLASS = "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500";

/** A div, not a p: its icon can be an avatar stack, which renders block elements. */
function HeroFact({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return <div className={FACT_CLASS}>{icon}<span className="truncate">{children}</span></div>;
}

function HeroEyebrow() {
  const { t } = useTranslation();
  return <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("events.highlights.mustKnow")}</p>;
}

/** Where the banner is among its events; the slide's own label says it to screen readers. */
function SlidePosition({ count, index }: { count: number; index: number }) {
  return (
    <Stack direction="horizontal" align="center" gap={1} aria-hidden="true" className="px-1">
      {Array.from({ length: count }, (_, dot) => (
        <span key={dot} className={cn("h-1.5 rounded-full transition-all duration-300", dot === index ? "w-4 bg-foreground" : "w-1.5 bg-muted-foreground/40")} />
      ))}
    </Stack>
  );
}

interface MustKnowHeroProps {
  events: Event[];
  onEventClick: (event: Event) => void;
}

/**
 * The events page's banner: one must-know event at a time, large, turning to
 * the next every few seconds like a slideshow. Its play/pause button stops it
 * for good; it also holds still while the reader points at it or works inside
 * it, and starts paused for a reader who asked for less motion. The arrows move
 * it by hand, and the dots beside them show where it is.
 */
export function MustKnowHero({ events, onEventClick }: MustKnowHeroProps) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const reducedMotion = usePrefersReducedMotion();
  const [position, setPosition] = useState(0);
  // Null until the reader presses play or pause; until then, motion preferences decide.
  const [chosenPlaying, setChosenPlaying] = useState<boolean | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const count = events.length;
  const index = position % count;
  const event = events[index];
  const playing = count > 1 && (chosenPlaying ?? !reducedMotion);
  const rotating = playing && !hovered && !focused;

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
  const togglePlaying = () => {
    setChosenPlaying(!playing);
    // Pressing play starts the banner at once, though the pointer and focus are on it.
    setHovered(false);
    setFocused(false);
  };
  const timezone = getSchoolTimezone(event.school);
  const language = i18n.language || "en-US";
  const clubs = event.club ? [
    { name: event.club, src: event.club_logo_url ?? "" },
    ...(event.cohosts ?? []).map(club => ({ name: club.club_name, src: club.logo_url ?? "" })),
  ] : [];

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
      <div className={GRID_CLASS}>
        <div key={`poster-${event.id}`} className={cn("cursor-pointer", SLIDE_MOTION_CLASS)} onClick={() => onEventClick(event)}>
          <EventCardImage event={event} variant="feature" priority={index === 0} />
        </div>
        <Stack gap={4} className={COPY_CLASS}>
          <Stack direction="horizontal" align="center" justify="between" gap={2} className={TOP_ROW_CLASS}>
            <HeroEyebrow />
            {count > 1 ? (
              <Stack direction="horizontal" align="center" gap={1}>
                <Button variant="ghost" size="icon-sm" aria-label={t(playing ? "events.highlights.pause" : "events.highlights.play")} onClick={togglePlaying}>
                  {playing ? <Pause /> : <Play />}
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={t("events.highlights.previous")} onClick={() => go(-1)}>
                  <ChevronLeft className="rtl:rotate-180" />
                </Button>
                <SlidePosition count={count} index={index} />
                <Button variant="ghost" size="icon-sm" aria-label={t("events.highlights.next")} onClick={() => go(1)}>
                  <ChevronRight className="rtl:rotate-180" />
                </Button>
              </Stack>
            ) : null}
          </Stack>
          {/* The copy sits in the middle of the space the poster leaves it. */}
          <Stack gap={6} justify="center" grow>
            {/* The slide stays one element, so screen readers hear each new event while the banner is still. */}
            <Stack
              role="group"
              aria-roledescription="slide"
              aria-label={t("events.highlights.slide", { current: index + 1, total: count })}
              aria-live={rotating ? "off" : "polite"}
            >
              <Stack key={`copy-${event.id}`} gap={4} className={SLIDE_MOTION_CLASS}>
                <div className={TITLE_BOX_CLASS}><h2 className={TITLE_CLASS}>{event.title}</h2></div>
                <Stack gap={2}>
                  <HeroFact icon={<CalendarDays aria-hidden="true" className="size-4 shrink-0" />}>
                    {`${formatCardDate(event, timezone, language)}, ${formatCardTime(event, timezone, language)}`}
                  </HeroFact>
                  {/* An event without a place or club keeps the line, so the banner keeps its height from event to event. */}
                  <HeroFact icon={<MapPin aria-hidden="true" className="size-4 shrink-0" />}>
                    {event.location?.trim() || " "}
                  </HeroFact>
                  <HeroFact icon={clubs.length > 0 ? <AvatarStack size="sm" decorative avatars={clubs} /> : undefined}>
                    {clubs.length > 0 ? clubs.map(club => club.name).join(", ") : " "}
                  </HeroFact>
                </Stack>
              </Stack>
            </Stack>
            <div>
              <Button size="lg" onClick={() => onEventClick(event)}>{t("events.highlights.openEvent")}</Button>
            </div>
          </Stack>
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
        <Skeleton data-skeleton-key="event-poster" className={FEATURE_POSTER_SHAPE_CLASS} />
        <Stack gap={4} className={COPY_CLASS}>
          <Stack direction="horizontal" align="center" className={TOP_ROW_CLASS}>
            <HeroEyebrow />
          </Stack>
          <Stack gap={6} justify="center" grow>
            <Stack gap={4}>
              <div className={TITLE_BOX_CLASS}><h2 className={cn(TITLE_CLASS, "w-full")}><SkeletonLine className="w-4/5" /><SkeletonLine className="w-1/2" /></h2></div>
              <Stack gap={2}>
                {["w-48", "w-40", "w-32"].map(width => (
                  <p key={width} className={FACT_CLASS}><SkeletonLine className={width} /></p>
                ))}
              </Stack>
            </Stack>
            <div>
              <Skeleton className="h-11 w-32 rounded-xl" />
            </div>
          </Stack>
        </Stack>
      </div>
    </section>
  );
}
