"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { EventStats } from "@/features/events/api/events.api";
import { EventCard } from "@/features/events/components/EventCard";
import { EventCardSkeleton } from "@/features/events/components/EventCardSkeleton";
import { EventsBrowseViews } from "@/features/events/components/EventsBrowseViews";
import { EventViewSkeleton } from "@/features/events/components/EventViewSurface";
import { FeaturedEventCard, FeaturedEventCardSkeleton } from "@/features/events/components/FeaturedEventCard";
import type { EventHighlights } from "@/features/events/lib/eventHighlights";
import { useIntersectionObserver } from "@/shared/hooks/useIntersectionObserver";
import { Section, Stack } from "@/shared/layout";
import { CardCarousel } from "@/shared/layout/card-carousel";
import type { Event } from "@/shared/types";

/** MapLibre and its tiles are heavy, so the map starts loading only as it nears the screen. */
const MAP_LOAD_MARGIN = "300px";
/** Placeholders while a row loads: more than any screen shows at once. */
const ROW_PLACEHOLDER_COUNT = 6;
const FEATURED_PLACEHOLDER_COUNT = 4;
/** The map fills its container, so the container has a height of its own. */
const MAP_FRAME_CLASS = "flex h-96 w-full flex-col sm:h-[32rem]";

const ignoreEvent = () => {};

interface EventMapSectionProps {
  school: string;
  /** Null until the complete feed arrives: the map shows every event still on. */
  events: Event[] | null;
  onEventClick: (event: Event) => void;
  /** Laid over the waiting map once the complete feed has failed to load. */
  loadFailureNotice?: ReactNode;
}

function EventMapSection({ school, events, onEventClick, loadFailureNotice }: EventMapSectionProps) {
  const { t } = useTranslation();
  const { ref, hasIntersected } = useIntersectionObserver<HTMLDivElement>({ rootMargin: MAP_LOAD_MARGIN });
  return (
    <Section title={t("events.highlights.map")}>
      <div ref={ref} className={MAP_FRAME_CLASS}>
        {hasIntersected && events ? (
          <EventsBrowseViews view="map" school={school} events={events} eventStats={null} onEventClick={onEventClick} embedded />
        ) : <EventViewSkeleton variant="map">{loadFailureNotice}</EventViewSkeleton>}
      </div>
    </Section>
  );
}

interface EventCarouselRowProps {
  title: string;
  /** Null for the row's placeholders, before the page's data arrives. */
  events: Event[] | null;
  eventStats: Record<string, EventStats> | null;
  onEventClick: (event: Event) => void;
}

/** A row of real event cards; a row with nothing in it is left out. */
function EventCarouselRow({ title, events, eventStats, onEventClick }: EventCarouselRowProps) {
  if (events !== null && events.length === 0) return null;
  return (
    <CardCarousel title={title} busy={events === null}>
      {events
        ? events.map(event => (
          <EventCard key={event.id} event={event} stats={eventStats?.[String(event.id)]} onEventClick={onEventClick} />
        ))
        : Array.from({ length: ROW_PLACEHOLDER_COUNT }, (_, index) => <EventCardSkeleton key={index} />)}
    </CardCarousel>
  );
}

/*
 * PageFrame drops its top padding for the events page's sticky listing header,
 * which brings its own; these sections sit above that header, so they take the
 * same top padding (`pt-5`) to clear the navigation.
 */
const SECTIONS_CLASS = "pt-5";

interface EventHighlightSectionsProps {
  school: string;
  /**
   * Null while the feed loads with no first screen. Until it arrives only the
   * banner and the map, which every feed with events has, hold their places;
   * the rows, which may turn out empty, reserve nothing.
   */
  highlights: EventHighlights | null;
  /** Every event still on; null until the complete feed arrives. */
  mapEvents: Event[] | null;
  eventStats: Record<string, EventStats> | null;
  onEventClick: (event: Event) => void;
  /** Shown where the map waits once the complete feed has failed to load. */
  loadFailureNotice?: ReactNode;
}

/** The featured row: tall poster cards, or their placeholders while the page's data loads. */
function FeaturedRow({ events, onEventClick }: { events: Event[] | null; onEventClick: (event: Event) => void }) {
  const { t } = useTranslation();
  if (events !== null && events.length === 0) return null;
  return (
    <CardCarousel title={t("filters.featured")} size="feature" busy={events === null}>
      {events
        ? events.map((event, index) => (
          <FeaturedEventCard key={event.id} event={event} onEventClick={onEventClick} priority={index === 0} />
        ))
        : Array.from({ length: FEATURED_PLACEHOLDER_COUNT }, (_, index) => <FeaturedEventCardSkeleton key={index} />)}
    </CardCarousel>
  );
}

/**
 * What the events page shows above its search and grid, top to bottom: the
 * featured row, rows of events new to Wat2Do and of networking
 * opportunities, then the campus map.
 */
export function EventHighlightSections({
  school,
  highlights,
  mapEvents,
  eventStats,
  onEventClick,
  loadFailureNotice,
}: EventHighlightSectionsProps) {
  const { t } = useTranslation();
  return (
    <Stack gap={8} data-slot="event-highlights" className={SECTIONS_CLASS}>
      <FeaturedRow events={highlights?.featured ?? null} onEventClick={onEventClick} />
      {highlights ? <>
        <EventCarouselRow
          title={t("events.highlights.fresh")}
          events={highlights.fresh}
          eventStats={eventStats}
          onEventClick={onEventClick}
        />
        <EventCarouselRow
          title={t("events.highlights.networking")}
          events={highlights.networking}
          eventStats={eventStats}
          onEventClick={onEventClick}
        />
      </> : null}
      <EventMapSection school={school} events={mapEvents} onEventClick={onEventClick} loadFailureNotice={loadFailureNotice} />
    </Stack>
  );
}

interface EventHighlightSectionsSkeletonProps {
  school: string;
  /** Highlights this visit already holds (a cached feed), or null when unknown. */
  highlights: EventHighlights | null;
}

/**
 * The sections before the page's data arrives, box for box; nothing is fetched.
 * What this visit already knows decides which sections hold places; a section
 * that might turn out empty reserves nothing, as on the page itself.
 */
export function EventHighlightSectionsSkeleton({ school, highlights }: EventHighlightSectionsSkeletonProps) {
  const { t } = useTranslation();
  return (
    <Stack gap={8} data-slot="event-highlights" className={SECTIONS_CLASS}>
      {highlights === null || highlights.featured.length > 0 ? <FeaturedRow events={null} onEventClick={ignoreEvent} /> : null}
      {highlights && highlights.fresh.length > 0 ? (
        <EventCarouselRow title={t("events.highlights.fresh")} events={null} eventStats={null} onEventClick={ignoreEvent} />
      ) : null}
      {highlights && highlights.networking.length > 0 ? (
        <EventCarouselRow title={t("events.highlights.networking")} events={null} eventStats={null} onEventClick={ignoreEvent} />
      ) : null}
      <EventMapSection school={school} events={null} onEventClick={ignoreEvent} />
    </Stack>
  );
}
