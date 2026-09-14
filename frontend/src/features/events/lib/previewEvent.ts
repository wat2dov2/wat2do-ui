/**
 * The event a form is currently describing.
 *
 * Preview surfaces render the real event card, so they need an ``Event`` and
 * not a form. This is the one place that builds one from form state, which is
 * what lets a preview update on every keystroke while staying the same card
 * the feed shows.
 */

import type { Event, EventFormData } from "@/shared/types";

/** Stands in for the not-yet-saved event's id on the preview's occurrences. */
const PREVIEW_EVENT_ID = -1;

interface PreviewEventOptions {
  formData: EventFormData;
  /** Data URL or stored URL of the poster the form is showing. */
  imagePreview: string;
  /** Resolved name of the selected club, empty when none is selected. */
  clubName: string;
  /** Shown while the title field is empty, so the card never renders blank. */
  fallbackTitle: string;
  /**
   * The saved event being edited, when there is one. Fields the form does not
   * own - school, host name on a scraped event - carry over from it instead of
   * disappearing mid-edit.
   */
  base?: Event | null;
}

export function buildPreviewEvent({
  formData,
  imagePreview,
  clubName,
  fallbackTitle,
  base,
}: PreviewEventOptions): Event {
  const id = base?.id ?? PREVIEW_EVENT_ID;
  const now = new Date().toISOString();

  return {
    ...base,
    id,
    title: formData.title || fallbackTitle,
    location: formData.location,
    occurrences: formData.occurrences.map((occurrence, index) => ({
      id: occurrence.id ?? `preview-${index}`,
      event_id: id,
      dtstart_utc: occurrence.dtstart_local,
      dtend_utc: occurrence.dtend_local || undefined,
      created_at: now,
    })),
    price: formData.price,
    food: formData.food,
    registration: formData.registration,
    source_image_url: imagePreview || null,
    category: formData.category || null,
    club: clubName || base?.club || null,
    cancelled: base?.cancelled ?? false,
    added_at: base?.added_at ?? now,
  };
}
