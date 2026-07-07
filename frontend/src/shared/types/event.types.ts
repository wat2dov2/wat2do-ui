/**
 * Event-related types
 *
 * `Event` is the generated backend event shape intersected with a handful of
 * optional view-only fields populated on the frontend (isLive, addedDate). The
 * public list returns `ApiEventSummaryResponse`; detail/edit flows return
 * `ApiEventPublicResponse`/`ApiEventResponse`. Do NOT hand-write new API fields
 * here — add them to the backend Pydantic model and regenerate via
 * `npm run generate-types`.
 */

import type {
  ApiEventPublicResponse,
  ApiEventResponse,
  ApiEventSummaryResponse,
} from "@/shared/generated";

type EventApiShape = ApiEventResponse | ApiEventPublicResponse | ApiEventSummaryResponse;

/** View-only fields computed from the API payload on the frontend. */
interface EventViewOnlyFields {
  /** Date object parsed from added_at. */
  addedDate?: Date;
  /** Live/upcoming/past flag derived elsewhere. */
  isLive?: boolean;
  /** Full-detail/admin-only fields are absent from list summaries. */
  organization_id?: ApiEventResponse["organization_id"];
  description?: ApiEventResponse["description"];
  source_url?: ApiEventResponse["source_url"];
  organization_type?: ApiEventResponse["organization_type"];
  created_by?: ApiEventResponse["created_by"];
}

export type Event = EventApiShape & EventViewOnlyFields;

export interface EventFormOccurrence {
  dtstart_local: string;
  dtend_local: string;
}

// Event creation/edit form data (matches EventFormData from SubmitEventModal).
// The owning club (organization_id) is the single source of truth for the event's
// organization/organization_type/school — those are derived server-side, never entered.
export interface EventFormData {
  organization_id: number | null;
  title: string;
  description: string;
  occurrences: EventFormOccurrence[];
  location: string;
  category: string;
  price: number;
  food: string[];
  registration: boolean;
  source_image_url?: string | null;
}

// Form validation errors
export interface ValidationErrors {
  title?: string;
  organization_id?: string;
  occurrences?: string;
  location?: string;
}
