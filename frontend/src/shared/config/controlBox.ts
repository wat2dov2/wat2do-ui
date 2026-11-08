import admin from "../../../../backend/controlbox/admin.json" with { type: "json" };
import clientCache from "../../../../backend/controlbox/client_cache.json" with { type: "json" };
import contact from "../../../../backend/controlbox/contact.json" with { type: "json" };
import type eventDiscoveryControl from "../../../../backend/controlbox/event_discovery.json";
import interactionTracking from "../../../../backend/controlbox/interaction_tracking.json" with { type: "json" };
import clubManagement from "../../../../backend/controlbox/club_management.json" with { type: "json" };
import socialPreviews from "../../../../backend/controlbox/social_previews.json" with { type: "json" };
import ticketing from "../../../../backend/controlbox/ticketing.json" with { type: "json" };
import uploads from "../../../../backend/controlbox/uploads.json" with { type: "json" };

const serializedEventDiscovery = process.env.NEXT_PUBLIC_EVENT_DISCOVERY;
if (!serializedEventDiscovery) {
  throw new Error("NEXT_PUBLIC_EVENT_DISCOVERY is required");
}
const eventDiscovery = JSON.parse(serializedEventDiscovery) as Omit<
  typeof eventDiscoveryControl,
  "campus_seasons"
>;

const secondsToMilliseconds = (seconds: number): number => seconds * 1000;
const minutesToMilliseconds = (minutes: number): number => minutes * 60 * 1000;
const hoursToMilliseconds = (hours: number): number => hours * 60 * 60 * 1000;

export const controlBox = {
  contact: {
    maximumMessageLength: contact.maximum_message_length,
  },
  eventDiscovery: {
    newEventWindowHours: eventDiscovery.new_event_window_hours,
    newEventWindowMs: hoursToMilliseconds(
      eventDiscovery.new_event_window_hours,
    ),
    eventWithoutEndVisibilityMs: minutesToMilliseconds(
      eventDiscovery.event_without_end_visibility_minutes,
    ),
    initialRenderCount: eventDiscovery.initial_render_count,
    previewEventCount: eventDiscovery.preview_event_count,
    serverFeedPageSize: eventDiscovery.server_feed_page_size,
    views: eventDiscovery.views,
  },
  clubManagement: {
    initialRenderCount: clubManagement.initial_render_count,
    directoryPageSize: clubManagement.directory_page_size,
  },
  clientCache: {
    discoveryPrefetchIdleTimeoutMs: clientCache.discovery_prefetch_idle_timeout_ms,
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
    eventFeedRetries: clientCache.event_feed_retries,
  },
  interactionTracking: {
    flushDebounceMs: interactionTracking.flush_debounce_milliseconds,
  },
  admin: {
    itemsPerPage: admin.items_per_page,
  },
  uploads: {
    eventImageAllowedMimeTypes: uploads.event_image_allowed_mime_types,
    eventImageMaxSizeBytes: uploads.event_image_max_size_bytes,
  },
  socialPreviews: {
    width: socialPreviews.width,
    height: socialPreviews.height,
    cacheMaxAgeSeconds: socialPreviews.cache_max_age_seconds,
  },
  ticketing: {
    minimumPriceCents: ticketing.minimum_price_cents,
    maximumPriceCents: ticketing.maximum_price_cents,
    maximumCapacity: ticketing.maximum_capacity,
    maximumTiers: ticketing.maximum_tiers,
  },
} as const;
