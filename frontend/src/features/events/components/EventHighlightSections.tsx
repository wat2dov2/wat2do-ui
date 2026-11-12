"use client";

import { useTranslation } from "react-i18next";
import type { EventStats } from "@/features/events/api/events.api";
import { EventCard } from "@/features/events/components/EventCard";
import { EventCardSkeleton } from "@/features/events/components/EventCardSkeleton";
import { FeaturedEventCard, FeaturedEventCardSkeleton } from "@/features/events/components/FeaturedEventCard";
import type { EventHighlights } from "@/features/events/lib/eventHighlights";
import { controlBox } from "@/shared/config/controlBox";
import { Stack } from "@/shared/layout";
import { CardCarousel } from "@/shared/layout/card-carousel";
import type { Event } from "@/shared/types";

/** Placeholders while a row loads: as many as the row holds, so the row is the same length loaded. */
const ROW_PLACEHOLDER_COUNT = controlBox.eventDiscovery.highlights.rowCardCount;
const FEATURED_PLACEHOLDER_COUNT = 4;

const ignoreEvent = () => {};

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
  /** Null while the feed loads with no first screen; the skeleton holds the rows' places until then. */
  highlights: EventHighlights | null;
  eventStats: Record<string, EventStats> | null;
  /** With `row`, the event was opened from that row (the featured cards), which the drawer then steps through. */
  onEventClick: (event: Event, row?: readonly Event[]) => void;
}

/** The featured row: tall poster cards, or their placeholders while the page's data loads. */
interface FeaturedRowProps {
  events: Event[] | null;
  onEventClick: (event: Event, row?: readonly Event[]) => void;
}

function FeaturedRow({ events, onEventClick }: FeaturedRowProps) {
  const { t } = useTranslation();
  if (events !== null && events.length === 0) return null;
  return (
    <CardCarousel title={t("filters.featured")} size="feature" busy={events === null}>
      {events
        ? events.map((event, index) => (
          <FeaturedEventCard key={event.id} event={event} onEventClick={(clicked) => onEventClick(clicked, events)} priority={index === 0} />
        ))
        : Array.from({ length: FEATURED_PLACEHOLDER_COUNT }, (_, index) => <FeaturedEventCardSkeleton key={index} />)}
    </CardCarousel>
  );
}

/**
 * What the events page shows above its search and grid, top to bottom: the
 * featured row, then rows of events new to Wat2Do and of networking
 * opportunities.
 */
export function EventHighlightSections({ highlights, eventStats, onEventClick }: EventHighlightSectionsProps) {
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
    </Stack>
  );
}

interface EventHighlightSectionsSkeletonProps {
  /** Highlights this visit already holds (a cached feed), or null when unknown. */
  highlights: EventHighlights | null;
}

/**
 * The sections before the page's data arrives, box for box; nothing is fetched.
 * What this visit already knows decides which sections hold places; a section
 * that might turn out empty reserves nothing, as on the page itself.
 */
export function EventHighlightSectionsSkeleton({ highlights }: EventHighlightSectionsSkeletonProps) {
  const { t } = useTranslation();
  return (
    <Stack gap={8} data-slot="event-highlights" className={SECTIONS_CLASS}>
      {highlights === null || highlights.featured.length > 0 ? <FeaturedRow events={null} onEventClick={ignoreEvent} /> : null}
      {/* Unknown highlights still hold the new row's place: any upcoming event beyond the featured ones fills it. */}
      {highlights === null || highlights.fresh.length > 0 ? (
        <EventCarouselRow title={t("events.highlights.fresh")} events={null} eventStats={null} onEventClick={ignoreEvent} />
      ) : null}
      {highlights && highlights.networking.length > 0 ? (
        <EventCarouselRow title={t("events.highlights.networking")} events={null} eventStats={null} onEventClick={ignoreEvent} />
      ) : null}
    </Stack>
  );
}
