/**
 * Event-related types
 *
 * `Event` is the generated backend `ApiEventResponse` shape intersected with
 * a handful of optional view-only fields populated on the frontend (date,
 * time, dayOfWeek, eventDate, isLive, imageUrl, addedDate,
 * requiresRegistration). Do NOT hand-write new API fields here — add them to
 * the backend Pydantic model and regenerate via `npm run generate-types`.
 */

import type { ApiEventResponse } from "@/shared/generated";

/** View-only fields computed from the API payload on the frontend. */
interface EventViewOnlyFields {
  /** Human-readable date string (e.g. "Jan 5, 2025") derived from dtstart_utc. */
  date?: string;
  /** Human-readable time or range (e.g. "7 PM - 9 PM") derived from dtstart/end. */
  time?: string;
  /** Day-of-week string derived from dtstart_utc. */
  dayOfWeek?: string;
  /** Date object parsed from dtstart_utc for timeline/sort math. */
  eventDate?: Date;
  /** Date object parsed from added_at. */
  addedDate?: Date;
  /** Convenience alias for `source_image_url`. */
  imageUrl?: string;
  /** Live/upcoming/past flag derived elsewhere. */
  isLive?: boolean;
  /** Legacy alias for `registration`. */
  requiresRegistration?: boolean;
}

export type Event = ApiEventResponse & EventViewOnlyFields;

// Event creation/edit form data (matches EventFormData from SubmitEventModal)
export interface EventFormData {
  title: string;
  description: string;
  date: string;
  time: string;
  location: string;
  category: string;
  price: number;
  food: string[];
  requiresRegistration: boolean;
  organization: string;
}

// Form validation errors
export interface ValidationErrors {
  title?: string;
  organization?: string;
  date?: string;
  time?: string;
  location?: string;
}
