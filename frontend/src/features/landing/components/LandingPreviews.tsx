"use client";

/**
 * The landing page's feature previews: the app's own components with this
 * school's real data, shown as they render in the app but inert, so nothing
 * in them navigates or changes anyone's filters, saves or follows.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
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

/** How many free-food events the preview shows: a row on desktop, two rows of two on phones. */
const FREE_FOOD_CARDS = 4;

/** The feed's search bar and quick filters with Free food on, above a row of real events that have free food. */
export function FreeFoodPreview({ events, isLoading }: { events: readonly Event[]; isLoading: boolean }) {
  const { t } = useTranslation();
  const freeFood = events.filter((event) => (event.food?.length ?? 0) > 0 && !event.price && event.source_image_url).slice(0, FREE_FOOD_CARDS);

  return (
    <Inert>
      <Stack gap={4}>
        {/* The search bar keeps the width it has on the events page rather than stretching across the card. */}
        <Stack direction="horizontal" gap={2} wrap align="center">
          <div className="w-full max-w-sm">
            <SearchBar searchQuery="" onSearchChange={() => {}} onSearchClear={() => {}} />
          </div>
          {/* The events page's quick filter chips, as it renders them. */}
          {PREVIEW_QUICK_FILTERS.map(({ labelKey, active }) => (
            <Button key={labelKey} variant={active ? "primary" : "outline"} size="sm" aria-pressed={active}>
              {t(labelKey)}
            </Button>
          ))}
        </Stack>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {isLoading
            ? Array.from({ length: FREE_FOOD_CARDS }, (_, index) => <EventCardSkeleton key={index} />)
            : freeFood.map((event) => <EventCard key={event.id} event={event} interactive={false} />)}
        </div>
      </Stack>
    </Inert>
  );
}

/** Real club cards from this school's directory, with the follow control the clubs page shows. */
export function ClubsPreview({ clubs, isLoading }: { clubs: readonly Club[]; isLoading: boolean }) {
  return (
    <Inert>
      <div className="grid gap-3 sm:grid-cols-2">
        {isLoading
          ? [0, 1].map((index) => <ClubCardSkeleton key={index} />)
          : clubs.map((club) => <ClubCard key={club.id} club={club} />)}
      </div>
    </Inert>
  );
}
