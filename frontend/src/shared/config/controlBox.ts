import admin from "../../../../backend/controlbox/admin.json";
import clientCache from "../../../../backend/controlbox/client_cache.json";
import contact from "../../../../backend/controlbox/contact.json";
import eventDiscovery from "../../../../backend/controlbox/event_discovery.json";
import interactionTracking from "../../../../backend/controlbox/interaction_tracking.json";
import organizationManagement from "../../../../backend/controlbox/organization_management.json";
import siteBanner from "../../../../backend/controlbox/site_banner.json";
import socialPreviews from "../../../../backend/controlbox/social_previews.json";
import uploads from "../../../../backend/controlbox/uploads.json";

const secondsToMilliseconds = (seconds: number): number => seconds * 1000;
const minutesToMilliseconds = (minutes: number): number => minutes * 60 * 1000;
const hoursToMilliseconds = (hours: number): number => hours * 60 * 60 * 1000;

export const controlBox = {
  contact: {
    maximumNameLength: contact.maximum_name_length,
    maximumMessageLength: contact.maximum_message_length,
  },
  eventDiscovery: {
    feedRevalidateSeconds: eventDiscovery.feed_revalidate_seconds,
    newEventWindowHours: eventDiscovery.new_event_window_hours,
    newEventWindowMs: hoursToMilliseconds(
      eventDiscovery.new_event_window_hours,
    ),
    eventWithoutEndVisibilityMs: minutesToMilliseconds(
      eventDiscovery.event_without_end_visibility_minutes,
    ),
    initialRenderCount: eventDiscovery.initial_render_count,
    serverFeedPageSize: eventDiscovery.server_feed_page_size,
  },
  organizationManagement: {
    directoryPageSize: organizationManagement.directory_page_size,
    directoryRevalidateSeconds:
      organizationManagement.directory_revalidate_seconds,
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
  siteBanner: {
    dismissalDays: siteBanner.dismissal_days,
  },
  admin: {
    itemsPerPage: admin.items_per_page,
  },
  uploads: {
    eventImageAllowedMimeTypes: uploads.event_image_allowed_mime_types,
    eventImageMaxSizeBytes: uploads.event_image_max_size_bytes,
  },
  socialPreviews: {
    outputWidth:
      socialPreviews.viewport_width * socialPreviews.device_scale_factor,
    outputHeight:
      socialPreviews.viewport_height * socialPreviews.device_scale_factor,
  },
} as const;
