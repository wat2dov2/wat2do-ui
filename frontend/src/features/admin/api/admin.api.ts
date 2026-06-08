/**
 * Admin API
 * Handles all admin-related data operations via the backend.
 */

import type {
  EventFormData,
  EventSubmission,
  ReportedEvent,
  Club,
  SubmissionStatus,
} from "@/shared/types";
import { DEFAULT_EVENT_CATEGORY } from "@/shared/constants/eventCategories";
import {
  getAllClubs as getAllClubsData,
  getClubTypes as getClubTypesData,
  createClubAPI,
  updateClubAPI,
  deleteClubAPI,
} from "@/features/clubs";
import { api, getPaginatedItems } from "@/shared/services/apiClient";

// Re-export types for convenience
export type { ReportedEvent };

// ── Backend response shapes (derived from OpenAPI spec) ─────────────
import type { ApiEventCreate, ApiReportResponse, ApiSubmissionResponse } from "@/shared/generated";

type SubmissionResponse = ApiSubmissionResponse;
type ReportResponse = ApiReportResponse;

// ── Mappers ─────────────────────────────────────────────────────────

function toReportedEvent(row: ReportResponse): ReportedEvent {
  return {
    id: row.id,
    eventId: row.event_id,
    reportedBy: row.user_id,
    reportedAt: row.reported_at,
    reason: row.reason,
    status: row.status as ReportedEvent["status"],
  };
}

function toEventFormData(eventData: ApiEventCreate): EventFormData {
  return {
    club_id: eventData.club_id ?? null,
    title: eventData.title || "",
    description: eventData.description ?? "",
    occurrences: (eventData.occurrences || []).map((occurrence) => {
      const startsAt = occurrence.dtstart_utc ? new Date(occurrence.dtstart_utc) : null;
      const endsAt = occurrence.dtend_utc ? new Date(occurrence.dtend_utc) : null;
      return {
        dtstart_local: startsAt ? startsAt.toLocaleString("sv-SE").replace(" ", "T").slice(0, 16) : "",
        dtend_local: endsAt
          ? endsAt.toLocaleString("sv-SE").replace(" ", "T").slice(0, 16)
          : "",
      };
    }),
    location: eventData.location || "",
    category: eventData.category ?? DEFAULT_EVENT_CATEGORY,
    price: eventData.price ?? 0,
    food: eventData.food ?? [],
    registration: eventData.registration ?? false,
  };
}

function toEventSubmission(row: SubmissionResponse): EventSubmission {
  return {
    id: row.id,
    eventData: toEventFormData(row.event_data as ApiEventCreate),
    submittedBy: row.user_id,
    submittedAt: row.submitted_at,
    status: row.status as EventSubmission["status"],
    rejectionReason: row.rejection_reason ?? undefined,
  };
}

// ── Club mutations ─────────────────────────────────────────────────

export async function adminCreateClub(club: Club): Promise<Club> {
  return createClubAPI({
    club_name: club.club_name,
    categories: club.categories,
    club_page: club.club_page,
    ig: club.ig,
    discord: club.discord,
    club_type: club.club_type,
    logo_url: club.logo_url,
    created_by: club.created_by,
    school: club.school,
  });
}

export async function adminUpdateClub(club: Club): Promise<Club> {
  return updateClubAPI(club, {
    club_name: club.club_name,
    categories: club.categories,
    club_page: club.club_page,
    ig: club.ig,
    discord: club.discord,
    club_type: club.club_type,
    logo_url: club.logo_url,
    school: club.school,
  });
}

export async function adminDeleteClub(clubId: number): Promise<void> {
  await deleteClubAPI(clubId);
}

// ── Reported Events API ─────────────────────────────────────────────

export async function getReportedEvents(): Promise<ReportedEvent[]> {
  const rows = await getPaginatedItems<ReportResponse>("/reports/");
  return rows.map(toReportedEvent);
}

// ── Event Submissions API ───────────────────────────────────────────

export async function getEventSubmissions(): Promise<EventSubmission[]> {
  const rows = await getPaginatedItems<SubmissionResponse>("/submissions/");
  return rows.map(toEventSubmission);
}

export async function getSubmissionsByStatus(
  status: SubmissionStatus,
): Promise<EventSubmission[]> {
  const rows = await getPaginatedItems<SubmissionResponse>(
    `/submissions/?submission_status=${status}`,
  );
  return rows.map(toEventSubmission);
}

export async function updateEventSubmission(
  id: string,
  status: SubmissionStatus,
  rejectionReason?: string,
): Promise<void> {
  await api.patch(`/submissions/${id}`, {
    status,
    rejection_reason: rejectionReason ?? null,
  });
}


// ── Admin Clubs API ─────────────────────────────────────────────────

export interface ClubClaim {
  id: string;
  club_id: number;
  user_id: string;
  executive_role: string;
  proof_url: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  clubs?: Club;
  users?: {
    id: string;
    email: string;
    full_name: string | null;
    avatar_url: string | null;
  };
}

export async function loadAdminClubsData(): Promise<{
  clubs: Club[];
  clubTypes: string[];
}> {
  const [clubs, clubTypes] = await Promise.all([
    getAllClubsData(),
    getClubTypesData(),
  ]);
  return { clubs, clubTypes };
}

export async function getPendingClaims(): Promise<ClubClaim[]> {
  return api.get<ClubClaim[]>("/clubs/claims/pending");
}

export async function resolveClaim(
  claimId: string,
  status: "approved" | "rejected",
  rejectionReason?: string
): Promise<ClubClaim> {
  return api.patch<ClubClaim>(`/clubs/claims/${claimId}`, {
    status,
    rejection_reason: rejectionReason || null,
  });
}
