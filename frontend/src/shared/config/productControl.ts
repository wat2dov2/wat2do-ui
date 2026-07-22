import control from "../../../../product-control.json";

const secondsToMilliseconds = (seconds: number): number => seconds * 1000;

export const productControl = {
  eventDiscovery: {
    feedRevalidateSeconds: control.event_discovery.feed_revalidate_seconds,
    serverFeedPageSize: control.event_discovery.server_feed_page_size,
  },
  clientCache: {
    defaultQueryStaleMs: secondsToMilliseconds(
      control.client_cache.default_query_stale_seconds,
    ),
    defaultQueryGarbageCollectionMs: secondsToMilliseconds(
      control.client_cache.default_query_garbage_collection_seconds,
    ),
    liveEventDataStaleMs: secondsToMilliseconds(
      control.client_cache.live_event_data_stale_seconds,
    ),
    profileStaleMs: secondsToMilliseconds(
      control.client_cache.profile_stale_seconds,
    ),
    adminStaleMs: secondsToMilliseconds(
      control.client_cache.admin_stale_seconds,
    ),
  },
  interactionTracking: {
    flushDebounceMs: control.interaction_tracking.flush_debounce_milliseconds,
  },
  admin: {
    itemsPerPage: control.admin.items_per_page,
  },
} as const;
