"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useRequestSchool } from "@/app/client-providers";
import { eventFeedQueryOptions } from "@/features/events/api/events.api";
import { EventHighlightSectionsSkeleton } from "@/features/events/components/EventHighlightSections";
import { EVENT_MAP_VIEW_CLASS, EventsBrowseViews } from "@/features/events/components/EventsBrowseViews";
import { DEFAULT_EVENT_VIEW } from "@/features/events/components/EventViewSelect";
import { EventsPageHeader } from "@/features/events/components/EventsPageHeader";
import { buildEventHighlights } from "@/features/events/lib/eventHighlights";
import { useCurrentTime } from "@/features/events/hooks/useGoingEvents";
import { ClubList } from "@/features/clubs/components/ClubList";
import { ClubsPageHeader, type ClubsHeaderState } from "@/features/clubs/components/ClubsPageHeader";
import { PositionListSkeleton } from "@/features/positions/components/PositionList";
import { PositionsPageHeader, type PositionsHeaderState } from "@/features/positions/components/PositionsPageHeader";
import { useSearch } from "@/features/search";
import { feedFilterAvailability, resolveCampusSeasonFilters } from "@/features/search/api/filterService";
import { Stack } from "@/shared/layout";
import { cn } from "@/shared/lib/utils";
import { useAppConstants } from "@/shared/hooks/useAppConstants";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import type { Event } from "@/shared/types";

const ignore = () => {};
const NO_EVENTS: Event[] = [];
const NO_IDS: number[] = [];

/*
 * Route fallbacks render each list page's own header and its own loading grid,
 * so the page that replaces them keeps every box in place. Controls start at
 * the values the page itself starts with, and no feed request is made here.
 */

function EventsLoading() {
  const { t, i18n } = useTranslation();
  const school = useRequestSchool();
  const { schoolBySlug } = useSchoolDirectory();
  // Season chips are decided by the day, so the server's clock gives the same row the browser's will.
  const [renderedAtMs] = useState(() => Date.now());
  const currentTimeMs = useCurrentTime() ?? renderedAtMs;
  // A feed this visit already holds decides the same chips the page will show; nothing is fetched here.
  const { data: feed } = useQuery({ ...eventFeedQueryOptions(school), enabled: false });
  const availability = useMemo(() => feed ? feedFilterAvailability(feed.items, school) : null, [feed, school]);
  const search = useSearch({
    events: feed?.items ?? NO_EVENTS,
    availability,
    goingEventIds: NO_IDS,
    goingCounts: null,
    school,
    currentTimeMs,
  });
  // Without a feed, the calendar still decides most season chips; chips that need the feed's events
  // (varsity games, exam de-stress) can only follow it.
  const campusSeasonOptions = feed ? search.campusSeasonOptions : resolveCampusSeasonFilters(
    schoolBySlug.get(school), currentTimeMs, i18n.resolvedLanguage ?? i18n.language, [], feedFilterAvailability(NO_EVENTS, school),
  ).options;
  // A feed and directory this visit already holds decide which highlights hold places.
  const highlights = useMemo(() => feed ? buildEventHighlights(feed.items, currentTimeMs) : null, [feed, currentTimeMs]);
  return (
    <>
      <EventHighlightSectionsSkeleton school={school} highlights={highlights} withMap={DEFAULT_EVENT_VIEW !== "map"} />
      <EventsPageHeader
        filters={{ ...search, campusSeasonOptions }}
        school={school}
        view={DEFAULT_EVENT_VIEW}
        onViewChange={ignore}
        count={null}
        latest={null}
        disabled
        eventStatsReady={false}
        goingEventsReady={false}
      />
      <Stack
        as="main"
        className={cn("relative z-10 w-full", DEFAULT_EVENT_VIEW === "map" && EVENT_MAP_VIEW_CLASS)}
        role="main"
        aria-label={t("search.ariaLabel")}
      >
        <EventsBrowseViews view={DEFAULT_EVENT_VIEW} school={school} events={NO_EVENTS} eventStats={null} isLoading onEventClick={ignore} />
      </Stack>
    </>
  );
}

function ClubsLoading() {
  const { club_categories: allCategories } = useAppConstants();
  const state: ClubsHeaderState = {
    appliedQueryKey: "", addedSince: null, setAddedSince: ignore, clearNew: ignore,
    searchQuery: "", setSearchQuery: ignore, submitSearchQuery: ignore, clearSearchQuery: ignore,
    minEvents: 0, setMinEvents: ignore, selectedCategories: [], toggleCategory: ignore,
    allCategories, activeTab: "all", setActiveTab: ignore,
  };
  return (
    <>
      <ClubsPageHeader state={state} count={null} disabled />
      <ClubList clubs={[]} savedClubIds={NO_IDS} isLoading />
    </>
  );
}

const POSITIONS_STATE: PositionsHeaderState = {
  appliedQueryKey: "", searchQuery: "", setSearchQuery: ignore, submitSearch: ignore, clearSearch: ignore,
  positionType: "all", setPositionType: ignore, addedSince: null, setAddedSince: ignore, clearNew: ignore,
};

function PositionsLoading() {
  return (
    <>
      <PositionsPageHeader state={POSITIONS_STATE} count={null} latest={null} disabled />
      <PositionListSkeleton />
    </>
  );
}

/** The events, clubs or positions page before its data arrives. */
export function DiscoveryLoading({ resource }: { resource: "events" | "clubs" | "positions" }) {
  return (
    <Stack gap={2} data-slot="discovery-loading" aria-busy="true">
      {resource === "events" ? <EventsLoading /> : resource === "clubs" ? <ClubsLoading /> : <PositionsLoading />}
    </Stack>
  );
}
