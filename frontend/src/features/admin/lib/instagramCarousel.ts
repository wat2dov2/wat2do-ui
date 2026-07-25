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
type BatchItem = Batch["items"][number];

export function includedSlides(batch: Batch): BatchItem[] {
  return batch.items
    .filter((item) => item.included)
    .sort((left, right) => Number(left.position ?? 0) - Number(right.position ?? 0));
}

/** Cover first, then each event slide, as Instagram will show them. */
export function slideThumbnails(batch: Batch): string[] {
  const slides = includedSlides(batch).map((item) => item.asset_url);
  return batch.cover_image_url ? [batch.cover_image_url, ...slides] : slides;
}

/** The stored snapshot is opaque jsonb; the slide only reads known fields. */
export function slideEvent(item: BatchItem): SlideEvent {
  return {
    ...(item.event_snapshot as Partial<SlideEvent>),
    id: Number(item.event_id),
  };
}

export function carouselEventIds(batch: Batch): number[] {
  return includedSlides(batch).map((item) => Number(item.event_id));
}

export function isBatchEditable(batch: Batch): boolean {
  return batch.status === "ready_for_review" || batch.status === "failed";
}
