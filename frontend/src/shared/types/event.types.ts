/**
 * Event-related types
 *
 * `Event` is the generated backend `ApiEventResponse` shape intersected with
 * a handful of optional view-only fields populated on the frontend (isLive,
 * addedDate). Do NOT hand-write new API fields here — add them to
 * the backend Pydantic model and regenerate via `npm run generate-types`.
 */

import type { ApiEventResponse } from "@/shared/generated";

/** View-only fields computed from the API payload on the frontend. */
interface EventViewOnlyFields {
  /** Date object parsed from added_at. */
  addedDate?: Date;
  /** Live/upcoming/past flag derived elsewhere. */
  isLive?: boolean;
}

export type Event = ApiEventResponse & EventViewOnlyFields;

export interface EventFormOccurrence {
  dtstart_local: string;
  dtend_local: string;
}

// Event creation/edit form data (matches EventFormData from SubmitEventModal)
export interface EventFormData {
  club_id?: number | null;
  title: string;
  description: string;
  occurrences: EventFormOccurrence[];
  location: string;
  category: string;
  price: number;
  food: string[];
  registration: boolean;
  organization: string;
  school?: string;
}

// Form validation errors
export interface ValidationErrors {
  title?: string;
  organization?: string;
  occurrences?: string;
  location?: string;
}
