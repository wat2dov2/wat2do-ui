"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Pause, Play } from "lucide-react";
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
 * where the square poster sets the banner's height. The controls row keeps its
 * height even for a single event, which has no controls.
 */
const FRAME_CLASS = "overflow-hidden rounded-xl border border-border bg-surface";
const GRID_CLASS = "grid gap-4 p-4 sm:p-6 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]";
const POSTER_CLASS = "mx-auto w-full max-w-[40svh] md:max-w-none";
const TITLE_CLASS = "line-clamp-2 min-h-[2lh] text-xl font-semibold leading-tight text-foreground sm:text-2xl";
const FACT_CLASS = "flex min-w-0 items-center gap-2 text-sm text-muted-foreground";
const CONTROLS_CLASS = "h-8";
const SLIDE_MOTION_CLASS = "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500";

function HeroFact({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return <p className={FACT_CLASS}>{icon}<span className="truncate">{children}</span></p>;
}

function HeroEyebrow() {
  const { t } = useTranslation();
  return <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("events.highlights.mustKnow")}</p>;
}

interface MustKnowHeroProps {
  events: Event[];
  onEventClick: (event: Event) => void;
}

/**
 * The events page's banner: one must-know event at a time, large, turning to
 * the next every few seconds like a slideshow. Its play/pause button stops it
 * for good; it also holds still while the reader points at it or works inside
 * it, and starts paused for a reader who asked for less motion. The arrows and
 * dots move it by hand.
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
        <div key={`poster-${event.id}`} className={cn(POSTER_CLASS, "cursor-pointer", SLIDE_MOTION_CLASS)} onClick={() => onEventClick(event)}>
          <EventCardImage event={event} variant="feature" priority={index === 0} />
        </div>
        <Stack gap={6} justify="between" className="min-w-0">
          {/* The slide stays one element, so screen readers hear each new event while the banner is still. */}
          <Stack
            role="group"
            aria-roledescription="slide"
            aria-label={t("events.highlights.slide", { current: index + 1, total: count })}
            aria-live={rotating ? "off" : "polite"}
            grow
          >
            <Stack key={`copy-${event.id}`} gap={4} justify="center" grow className={SLIDE_MOTION_CLASS}>
              <HeroEyebrow />
              <h2 className={TITLE_CLASS}>{event.title}</h2>
              <Stack gap={2}>
                <HeroFact icon={<CalendarDays aria-hidden="true" className="size-4 shrink-0" />}>
                  {`${formatCardDate(event, timezone, language)}, ${formatCardTime(event, timezone, language)}`}
                </HeroFact>
                {/* An event without a place or club keeps the line, so the banner keeps its height from event to event. */}
                <HeroFact icon={<MapPin aria-hidden="true" className="size-4 shrink-0" />}>
                  {event.location?.trim() || " "}
                </HeroFact>
                <HeroFact icon={clubs.length > 0 ? <AvatarStack size="sm" decorative avatars={clubs} /> : undefined}>
                  {clubs.length > 0 ? clubs.map(club => club.name).join(", ") : " "}
                </HeroFact>
              </Stack>
              <div>
                <Button size="lg" onClick={() => onEventClick(event)}>{t("events.highlights.openEvent")}</Button>
              </div>
            </Stack>
          </Stack>
          <Stack direction="horizontal" align="center" gap={1} className={CONTROLS_CLASS}>
            {count > 1 ? <>
              <Button variant="outline" size="icon-sm" aria-label={t(playing ? "events.highlights.pause" : "events.highlights.play")} onClick={togglePlaying}>
                {playing ? <Pause /> : <Play />}
              </Button>
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
            </> : null}
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
        <div className={POSTER_CLASS}>
          <Skeleton className="aspect-square w-full rounded-xl" />
        </div>
        <Stack gap={6} justify="between" className="min-w-0">
          <Stack gap={4} justify="center" grow>
            <HeroEyebrow />
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
          <Skeleton className={cn(CONTROLS_CLASS, "w-56 rounded-xl")} />
        </Stack>
      </div>
    </section>
  );
}
