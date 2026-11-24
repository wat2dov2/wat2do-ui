/**
 * The event a form is currently describing.
 *
 * Preview surfaces render the real event card, so they need an ``Event`` and
 * not a form. This is the one place that builds one from form state, which is
 * what lets a preview update on every keystroke while staying the same card
 * the feed shows.
 */

import type { Club, Event, EventFormData } from "@/shared/types";
import { buildEventOccurrence } from "@/shared/api/eventPayload";

/** Stands in for the not-yet-saved event's id on the preview's occurrences. */
const PREVIEW_EVENT_ID = -1;

interface PreviewEventOptions {
  school: string;
  formData: EventFormData;
  /** Data URL or stored URL of the poster the form is showing. */
  imagePreview: string;
  /** The selected club, absent when none is selected. */
  club: Club | undefined;
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
  school,
  formData,
  imagePreview,
  club,
  fallbackTitle,
  base,
}: PreviewEventOptions): Event {
  const id = base?.id ?? PREVIEW_EVENT_ID;
  const now = new Date().toISOString();

  return {
    ...base,
    school,
    id,
    title: formData.title || fallbackTitle,
    location: formData.location,
    map_location: formData.map_location || null,
    occurrences: formData.occurrences.flatMap((occurrence, index) => {
      try {
        return [{
          ...buildEventOccurrence(occurrence, formData.timeZone),
          id: occurrence.id ?? `preview-${index}`,
          event_id: id,
          created_at: now,
        }];
      } catch {
        return [];
      }
    }),
    price: formData.price,
    food: formData.food,
    registration: formData.registration,
    source_image_url: imagePreview || null,
    category: formData.category || null,
    club: club?.club_name || base?.club || null,
    club_id: club?.id ?? base?.club_id ?? null,
    // The card shows the club's verified check as the feed will.
    verified: club?.verified ?? base?.verified ?? false,
    cancelled: base?.cancelled ?? false,
    added_at: base?.added_at ?? now,
  };
}
