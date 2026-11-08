"use client";

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
import type { Event } from "@/shared/types";

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
}

function EventMapSection({ school, events, onEventClick }: EventMapSectionProps) {
  const { t } = useTranslation();
  const { ref, hasIntersected } = useIntersectionObserver<HTMLDivElement>({ rootMargin: MAP_LOAD_MARGIN });
  return (
    <Section title={t("events.highlights.map")}>
      <div ref={ref} className={MAP_FRAME_CLASS}>
        {hasIntersected && events ? (
          <EventsBrowseViews view="map" school={school} events={events} eventStats={null} onEventClick={onEventClick} embedded />
        ) : <EventViewSkeleton variant="map" />}
      </div>
    </Section>
  );
}

interface EventCarouselRowProps {
  title: string;
  /** Null while the row's events load. */
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
  /** Null while the feed loads with no first screen. */
  highlights: EventHighlights | null;
  /** Every event still on; null until the complete feed arrives. */
  mapEvents: Event[] | null;
  eventStats: Record<string, EventStats> | null;
  onEventClick: (event: Event) => void;
  /** See all featured events: the feed's Featured filter. */
  onSeeAllFeatured: () => void;
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
  eventStats,
  onEventClick,
  onSeeAllFeatured,
}: EventHighlightSectionsProps) {
  const { t } = useTranslation();
  return (
    <Stack gap={8} data-slot="event-highlights" className={SECTIONS_CLASS}>
      {highlights === null
        ? <MustKnowHeroSkeleton />
        : highlights.mustKnow.length > 0 ? <MustKnowHero events={highlights.mustKnow} onEventClick={onEventClick} /> : null}
      <EventMapSection school={school} events={mapEvents} onEventClick={onEventClick} />
      <EventCarouselRow
        title={t("events.highlights.networking")}
        events={highlights?.networking ?? null}
        eventStats={eventStats}
        onEventClick={onEventClick}
      />
      <EventCarouselRow
        title={t("filters.featured")}
        events={highlights?.featured ?? null}
        eventStats={eventStats}
        onEventClick={onEventClick}
        seeAll={{ onSelect: onSeeAllFeatured }}
      />
      <OpenPositionsCarousel school={school} />
    </Stack>
  );
}

/** The sections before the page's data arrives, box for box; nothing is fetched. */
export function EventHighlightSectionsSkeleton({ school }: { school: string }) {
  const { t } = useTranslation();
  return (
    <Stack gap={8} data-slot="event-highlights" className={SECTIONS_CLASS}>
      <MustKnowHeroSkeleton />
      <EventMapSection school={school} events={null} onEventClick={ignoreEvent} />
      <EventCarouselRow title={t("events.highlights.networking")} events={null} eventStats={null} onEventClick={ignoreEvent} />
      <EventCarouselRow title={t("filters.featured")} events={null} eventStats={null} onEventClick={ignoreEvent} />
      <OpenPositionsCarouselSkeleton />
    </Stack>
  );
}
