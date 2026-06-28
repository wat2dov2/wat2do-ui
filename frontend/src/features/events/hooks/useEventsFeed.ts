import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  type EventListQuery,
  type PaginatedEventsResponse,
  fetchEventsPage,
  fetchPromotedEvents,
} from "@/features/events/api/events.api";
import { EVENTS_PAGE_SIZE } from "@/features/events/constants";
import { getSchoolFetchKey, normalizeEventQuery } from "@/features/events/lib/eventsQuery";
import { queryKeys } from "@/shared/lib/queryKeys";

function buildRequestQuery(
  school: string | null,
  query: EventListQuery,
  page: number,
  pageSize: number,
): EventListQuery {
  return {
    ...query,
    school: school ?? undefined,
    page,
    pageSize,
  };
}

function hasMore(response: PaginatedEventsResponse): boolean {
  return response.items.length > 0 && response.page < response.total_pages;
}

function isFeedQueryEnabled(query: EventListQuery): boolean {
  return !(query.ids && query.ids.length === 0);
}

export function useEventsFeed(school: string | null, query: EventListQuery) {
  const eventQuery = normalizeEventQuery(query);
  const schoolKey = getSchoolFetchKey(school);

  return useInfiniteQuery({
    queryKey: queryKeys.events.feed(schoolKey, eventQuery),
    queryFn: ({ pageParam }) =>
      fetchEventsPage(buildRequestQuery(school, eventQuery, pageParam, EVENTS_PAGE_SIZE)),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.total_pages ? lastPage.page + 1 : undefined,
    enabled: isFeedQueryEnabled(eventQuery),
  });
}

export function usePromotedEvents(school: string | null) {
  const schoolKey = getSchoolFetchKey(school);

  return useQuery({
    queryKey: queryKeys.events.promoted(schoolKey),
    queryFn: () => fetchPromotedEvents(school ?? undefined),
  });
}

export function flattenEventsFeedPages(
  pages: PaginatedEventsResponse[] | undefined,
): PaginatedEventsResponse | null {
  if (!pages || pages.length === 0) return null;

  const lastPage = pages[pages.length - 1];
  return {
    items: pages.flatMap((page) => page.items),
    total: lastPage.total,
    page: lastPage.page,
    page_size: lastPage.page_size,
    total_pages: lastPage.total_pages,
    latest_added_event: lastPage.latest_added_event ?? null,
  };
}

export function eventsFeedHasMore(pages: PaginatedEventsResponse[] | undefined): boolean {
  const lastPage = pages?.[pages.length - 1];
  return lastPage ? hasMore(lastPage) : false;
}
