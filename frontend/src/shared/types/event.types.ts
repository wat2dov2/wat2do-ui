/**
 * Event-related types
 *
 * `Event` is the generated backend event shape intersected with a handful of
 * optional view-only fields populated on the frontend (isLive, addedDate). The
 * public list returns `ApiEventSummaryResponse`; detail/edit flows return
 * `ApiEventPublicResponse`/`ApiEventResponse`. Do NOT hand-write new API fields
 * here - add them to the backend Pydantic model and regenerate via
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
  description?: ApiEventResponse["description"];
  source_url?: ApiEventResponse["source_url"];
  club_logo_url?: ApiEventResponse["club_logo_url"];
  club_type?: ApiEventResponse["club_type"];
  ig_handle?: ApiEventResponse["ig_handle"];
  created_by?: ApiEventResponse["created_by"];
  /** Org link/social fields are embedded only on the list summary shape. */
  club_page?: ApiEventSummaryResponse["club_page"];
  club_ig?: ApiEventSummaryResponse["club_ig"];
  club_discord?: ApiEventSummaryResponse["club_discord"];
}

export type Event = EventApiShape & EventViewOnlyFields;

export interface EventFormOccurrence {
  id?: string;
  original?: { dtstart_utc: string; dtend_utc?: string | null };
  dtstart_local: string;
  dtend_local: string;
  /** This date has tickets, while the event's tickets are on. */
  tickets: boolean;
}

/** An event's tickets as its club sets them in the event's form. */
export interface EventFormTickets {
  enabled: boolean;
  /** The price as typed; empty is free. */
  price: string;
  /** Tickets per date as typed; empty is no limit. */
  capacity: string;
  /** Nobody new gets a ticket while paused. */
  paused: boolean;
}

// Event creation/edit form data (matches EventFormData from SubmitEventModal).
// The owning club (club_id) is the single source of truth for the event's
// club/school - those are derived server-side, never entered.
export interface EventFormData {
  /** School clock used to interpret the form's wall-clock inputs. */
  timeZone: string;
  club_id: number | null;
  title: string;
  description: string;
  occurrences: EventFormOccurrence[];
  location: string;
  /**
   * Where the map places the event, never typed: it follows `location`, and
   * is empty for an online event or a venue still to be announced.
   */
  map_location: string;
  category: string;
  price: number;
  food: string[];
  registration: boolean;
  /** Optional link to where the event was announced. */
  source_url?: string | null;
  source_image_url?: string | null;
  /** Only the club's own team sets these; the form saves them after the event. */
  tickets: EventFormTickets;
}

// Form validation errors
export interface ValidationErrors {
  title?: string;
  club_id?: string;
  occurrences?: string;
  location?: string;
}
