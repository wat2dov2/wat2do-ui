"use client";

/**
 * The landing page's feature previews: the app's own components with this
 * school's real data. Event cards and the Free food filter work as they do in
 * the app; controls that would change someone's saves or follows are shown
 * inert, as a picture of the app.
 */

import { useCallback, type ReactNode } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ClubCard } from "@/features/clubs/components/ClubCard";
import { ClubCardSkeleton } from "@/features/clubs/components/ClubCardSkeleton";
import { EventCard, EventCardSkeleton } from "@/features/events";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import { FREE_FOOD_PREVIEW_COUNT } from "@/features/landing/lib/landingEvents";
import { EMPTY_FILTER_STATE, freeFoodFilterPatch } from "@/features/search/api/filterService";
import { SearchBar } from "@/features/search/components/SearchBar";
import { useSearchStore } from "@/features/search/store/search.store";
import { ROUTES } from "@/shared/constants/routes";
import { Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import type { Club, Event } from "@/shared/types";

/** Takes a live component out of the interaction and accessibility trees; it is a picture of the app. */
function Inert({ className = "w-full", children }: { className?: string; children: ReactNode }) {
  return (
    // React 18 has no `inert` prop, so the attribute is set on the element directly.
    <div ref={(node) => node?.setAttribute("inert", "")} aria-hidden="true" className={`${className} select-none`}>
      {children}
    </div>
  );
}

/**
 * The feed's search bar and its Free food filter, above a row of real
 * free-food events. The filter is the real one: a tap opens the feed with
 * Free food on (the feed keeps its filters in the search store, not the URL,
 * so the link sets them as it goes). Each card opens its event.
 */
export function FreeFoodPreview({ events, isLoading }: { events: readonly Event[]; isLoading: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const openEvent = useCallback((event: Event) => router.push(eventPagePath(event.id)), [router]);

  return (
    <Stack gap={4}>
      <Stack direction="horizontal" gap={2} wrap align="center">
        {/* The search bar keeps the width it has on the events page rather than stretching across the card. */}
        <Inert className="w-full max-w-sm">
          <SearchBar searchQuery="" onSearchChange={() => {}} onSearchClear={() => {}} />
        </Inert>
        {/* The events page's Free food chip, on, and live. */}
        <Button variant="primary" size="sm" asChild>
          <NextLink
            href={ROUTES.EVENTS}
            onClick={() => useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, ...freeFoodFilterPatch(true) })}
          >
            {t("filters.freeFoodOnCampus")}
          </NextLink>
        </Button>
      </Stack>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {isLoading
          ? Array.from({ length: FREE_FOOD_PREVIEW_COUNT }, (_, index) => <EventCardSkeleton key={index} />)
          : events.map((event) => <EventCard key={event.id} event={event} onEventClick={openEvent} />)}
      </div>
    </Stack>
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
