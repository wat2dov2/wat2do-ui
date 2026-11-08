"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { EventStats } from "@/features/events/api/events.api";
import { EventCard } from "@/features/events/components/EventCard";
import { EventCardSkeleton } from "@/features/events/components/EventCardSkeleton";
import { EventsBrowseViews } from "@/features/events/components/EventsBrowseViews";
import { EventViewSkeleton } from "@/features/events/components/EventViewSurface";
import { MustKnowHero, MustKnowHeroSkeleton } from "@/features/events/components/MustKnowHero";
import type { EventHighlights } from "@/features/events/lib/eventHighlights";
import { OpenPositionsCarousel, OpenPositionsCarouselSkeleton } from "@/features/positions/components/OpenPositionsCarousel";
import { useIntersectionObserver } from "@/shared/hooks/useIntersectionObserver";
import { Section, Stack } from "@/shared/layout";
import { CardCarousel } from "@/shared/layout/card-carousel";
import type { Event, Position } from "@/shared/types";

/** MapLibre and its tiles are heavy, so the map starts loading only as it nears the screen. */
const MAP_LOAD_MARGIN = "300px";
/** Placeholders while a row loads: more than any screen shows at once. */
const ROW_PLACEHOLDER_COUNT = 6;
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
  seeAll?: { onSelect: () => void };
}

/** A row of real event cards; a row with nothing in it is left out. */
function EventCarouselRow({ title, events, eventStats, onEventClick, seeAll }: EventCarouselRowProps) {
  if (events !== null && events.length === 0) return null;
  return (
    <CardCarousel title={title} seeAll={seeAll} busy={events === null}>
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
  /** The open positions row's positions; null or empty leaves the row out. */
  openPositions: Position[] | null;
  eventStats: Record<string, EventStats> | null;
  onEventClick: (event: Event) => void;
  /** See all featured events: the feed's Featured filter. */
  onSeeAllFeatured: () => void;
  /** Shown where the map waits once the complete feed has failed to load. */
  loadFailureNotice?: ReactNode;
}

/**
 * What the events page shows above its search and grid, top to bottom: the
 * must-know banner, the campus map, then rows of networking opportunities,
 * featured events and open positions.
 */
export function EventHighlightSections({
  school,
  highlights,
  mapEvents,
  openPositions,
  eventStats,
  onEventClick,
  onSeeAllFeatured,
  loadFailureNotice,
}: EventHighlightSectionsProps) {
  const { t } = useTranslation();
  return (
    <Stack gap={8} data-slot="event-highlights" className={SECTIONS_CLASS}>
      {highlights === null
        ? <MustKnowHeroSkeleton />
        : highlights.mustKnow.length > 0 ? <MustKnowHero events={highlights.mustKnow} onEventClick={onEventClick} /> : null}
      <EventMapSection school={school} events={mapEvents} onEventClick={onEventClick} loadFailureNotice={loadFailureNotice} />
      {highlights ? <>
        <EventCarouselRow
          title={t("events.highlights.networking")}
          events={highlights.networking}
          eventStats={eventStats}
          onEventClick={onEventClick}
        />
        <EventCarouselRow
          title={t("filters.featured")}
          events={highlights.featured}
          eventStats={eventStats}
          onEventClick={onEventClick}
          seeAll={{ onSelect: onSeeAllFeatured }}
        />
      </> : null}
      {openPositions && openPositions.length > 0 ? <OpenPositionsCarousel school={school} positions={openPositions} /> : null}
    </Stack>
  );
}

interface EventHighlightSectionsSkeletonProps {
  school: string;
  /** Highlights this visit already holds (a cached feed), or null when unknown. */
  highlights: EventHighlights | null;
  /** Whether the school has open positions, or null when unknown. */
  hasOpenPositions: boolean | null;
}

/**
 * The sections before the page's data arrives, box for box; nothing is fetched.
 * What this visit already knows decides which sections hold places; a section
 * that might turn out empty reserves nothing, as on the page itself.
 */
export function EventHighlightSectionsSkeleton({ school, highlights, hasOpenPositions }: EventHighlightSectionsSkeletonProps) {
  const { t } = useTranslation();
  return (
    <Stack gap={8} data-slot="event-highlights" className={SECTIONS_CLASS}>
      {highlights === null || highlights.mustKnow.length > 0 ? <MustKnowHeroSkeleton /> : null}
      <EventMapSection school={school} events={null} onEventClick={ignoreEvent} />
      {highlights && highlights.networking.length > 0 ? (
        <EventCarouselRow title={t("events.highlights.networking")} events={null} eventStats={null} onEventClick={ignoreEvent} />
      ) : null}
      {highlights && highlights.featured.length > 0 ? (
        <EventCarouselRow title={t("filters.featured")} events={null} eventStats={null} onEventClick={ignoreEvent} />
      ) : null}
      {hasOpenPositions ? <OpenPositionsCarouselSkeleton /> : null}
    </Stack>
  );
}
