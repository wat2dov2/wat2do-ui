/**
 * Carousel state derived from a publish batch.
 *
 * The editor works in event ids: a slide is an event, its order is its position
 * in the carousel, and the cover is compiled from whatever events are currently
 * on it. These helpers are the one place that reads a batch's stored items.
 */

import type { ApiInstagramPublishBatchResponse } from "@/shared/generated";
import type { Event } from "@/shared/types";

type Batch = ApiInstagramPublishBatchResponse;

/** Carousel order, as Instagram will show it after the cover. */
export function carouselItems(batch: Batch): Batch["items"] {
  return [...batch.items].sort(
    (left, right) => Number(left.position) - Number(right.position),
  );
}

export function carouselEventIds(batch: Batch): number[] {
  return carouselItems(batch).map((item) => Number(item.event_id));
}

/** Slide events by event id, as the backend hydrated them onto the batch. */
export function carouselSlideEvents(batch: Batch): Record<number, Event> {
  return Object.fromEntries(
    carouselItems(batch).map((item) => [Number(item.event_id), item.event]),
  );
}

export function isBatchEditable(batch: Batch): boolean {
  return batch.status === "ready_for_review" || batch.status === "failed";
}

/**
 * The images a published run posted, indexed by slide: 0 is the cover, then the
 * event slides in carousel order.
 *
 * Empty until the run publishes, which is what makes the editor fall back to
 * rendering the templates from live event data.
 */
export function publishedCarouselAssets(batch: Batch): (string | null)[] {
  if (!batch.published_cover_url) return [];
  return [
    batch.published_cover_url,
    ...carouselItems(batch).map((item) => item.published_asset_url ?? null),
  ];
}
