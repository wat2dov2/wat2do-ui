import admin from "../../../../backend/controlbox/admin.json";
import clientCache from "../../../../backend/controlbox/client_cache.json";
import eventDiscovery from "../../../../backend/controlbox/event_discovery.json";
import interactionTracking from "../../../../backend/controlbox/interaction_tracking.json";

const secondsToMilliseconds = (seconds: number): number => seconds * 1000;

export const controlBox = {
  eventDiscovery: {
    feedRevalidateSeconds: eventDiscovery.feed_revalidate_seconds,
    serverFeedPageSize: eventDiscovery.server_feed_page_size,
  },
  clientCache: {
    defaultQueryStaleMs: secondsToMilliseconds(
      clientCache.default_query_stale_seconds,
    ),
    defaultQueryGarbageCollectionMs: secondsToMilliseconds(
      clientCache.default_query_garbage_collection_seconds,
    ),
    liveEventDataStaleMs: secondsToMilliseconds(
      clientCache.live_event_data_stale_seconds,
    ),
    profileStaleMs: secondsToMilliseconds(
      clientCache.profile_stale_seconds,
    ),
    adminStaleMs: secondsToMilliseconds(
      clientCache.admin_stale_seconds,
    ),
  },
  interactionTracking: {
    flushDebounceMs: interactionTracking.flush_debounce_milliseconds,
  },
  admin: {
    itemsPerPage: admin.items_per_page,
  },
} as const;
