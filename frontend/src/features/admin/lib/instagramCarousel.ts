/**
 * Carousel state derived from a publish batch.
 *
 * The editor works in event ids: a slide is an event, its order is its position
 * in the carousel, and the cover is compiled from whatever events are currently
 * on it. These helpers are the one place that reads a batch's stored items.
 */

import type { ApiInstagramPublishBatchResponse } from "@/shared/generated";
import type { SlideEvent } from "@/features/admin/lib/instagramSlides";

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

/** Slide data by event id: live event data the backend joined onto the batch. */
export function carouselSlideEvents(batch: Batch): Record<number, SlideEvent> {
  return Object.fromEntries(
    carouselItems(batch).map((item) => [Number(item.event_id), item.event]),
  );
}

export function isBatchEditable(batch: Batch): boolean {
  return batch.status === "ready_for_review" || batch.status === "failed";
}
