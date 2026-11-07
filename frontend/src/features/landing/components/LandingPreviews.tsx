"use client";

/**
 * The landing page's feature previews: the app's own components with this
 * school's real data, shown as they render in the app but inert, so nothing
 * in them navigates or changes anyone's filters, saves or follows.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Calendar } from "lucide-react";
import { ClubCard } from "@/features/clubs/components/ClubCard";
import { ClubCardSkeleton } from "@/features/clubs/components/ClubCardSkeleton";
import { EventCard, EventCardSkeleton } from "@/features/events";
import { SearchBar } from "@/features/search/components/SearchBar";
import { Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import type { Club, Event } from "@/shared/types";

/** The quick filters the free food preview shows, in the events page's order, Free food on. */
const PREVIEW_QUICK_FILTERS = [
  { labelKey: "filters.employersOnCampus", active: false },
  { labelKey: "filters.freeFoodOnCampus", active: true },
  { labelKey: "filters.competitions", active: false },
] as const;

/** Takes a live component out of the interaction and accessibility trees; it is a picture of the app. */
function Inert({ children }: { children: ReactNode }) {
  return (
    // React 18 has no `inert` prop, so the attribute is set on the element directly.
    <div ref={(node) => node?.setAttribute("inert", "")} aria-hidden="true" className="w-full select-none">
      {children}
    </div>
  );
}

/** The feed's search bar and quick filters with Free food on, above a real event that has free food. */
export function FreeFoodPreview({ events, isLoading }: { events: readonly Event[]; isLoading: boolean }) {
  const { t } = useTranslation();
  const freeFood = events.find((event) => event.food.length > 0 && !event.price && event.source_image_url);

  return (
    <Inert>
      <Stack gap={3}>
        <SearchBar searchQuery="" onSearchChange={() => {}} onSearchClear={() => {}} />
        {/* The events page's quick filter chips, as it renders them. */}
        <Stack direction="horizontal" gap={2} wrap>
          {PREVIEW_QUICK_FILTERS.map(({ labelKey, active }) => (
            <Button key={labelKey} variant={active ? "primary" : "outline"} size="sm" aria-pressed={active}>
              {t(labelKey)}
            </Button>
          ))}
        </Stack>
        {/* An event card's natural width in the feed grid. */}
        <div className="mx-auto w-60">
          {freeFood ? <EventCard event={freeFood} interactive={false} /> : isLoading ? <EventCardSkeleton /> : null}
        </div>
      </Stack>
    </Inert>
  );
}

/** A real upcoming event's card with the Add to calendar control its page shows once you are going. */
export function RemindersPreview({ events, isLoading }: { events: readonly Event[]; isLoading: boolean }) {
  const { t } = useTranslation();
  const event = events.find((candidate) => candidate.source_image_url);

  return (
    <Inert>
      <Stack gap={3} align="center">
        <div className="w-60">{event ? <EventCard event={event} interactive={false} /> : isLoading ? <EventCardSkeleton /> : null}</div>
        {/* The event page's calendar control (EventActions), as it renders. */}
        <Button type="button" variant="outline" size="sm">
          <Calendar className="size-4" />
          {t("common.addToCalendar")}
        </Button>
      </Stack>
    </Inert>
  );
}

/** Real club cards from this school's directory, with the follow control the clubs page shows. */
export function ClubsPreview({ clubs, isLoading }: { clubs: readonly Club[]; isLoading: boolean }) {
  return (
    <Inert>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {isLoading
          ? [0, 1].map((index) => <ClubCardSkeleton key={index} />)
          : clubs.map((club) => <ClubCard key={club.id} club={club} />)}
      </div>
    </Inert>
  );
}
