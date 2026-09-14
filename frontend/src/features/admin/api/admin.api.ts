/**
 * Admin API
 * Handles all admin-related data operations via the backend.
 */

import type {
  EventFormData,
  EventSubmission,
  ReportedEvent,
  Club,
  ClubStatus,
  SubmissionStatus,
} from "@/shared/types";
import type {
  ApiAdminPayoutDetail,
  ApiEventCreate,
  ApiReportResponse,
  ApiSubmissionResponse,
  ApiPositionSubmissionResponse,
  ApiPositionSubmissionPage,
  ApiInstagramPublishBatchPublish,
  ApiInstagramPublishBatchResponse,
  ApiInstagramPublishBatchUpdate,
  ApiPaginatedInstagramPublishBatchSummaryResponse,
  ApiPaginatedPosterPayoutResponse,
  ApiPayoutCsvExportResponse,
  ApiPayoutStatusUpdate,
  ApiPosterPayoutResponse,
} from "@/shared/generated";
import { getDefaultEventCategory } from "@/shared/data/eventCategories";
import {
  createClubAPI,
  updateClubAPI,
  deleteClubAPI,
} from "@/features/clubs";
import { api, getPaginatedItems } from "@/shared/services/apiClient";
import type { components } from "@/shared/generated/api-types";
import { ADMIN_ITEMS_PER_PAGE } from "@/features/admin/constants";

export async function getPositionSubmissions(page = 1, status?: string, school?: string, search?: string) {
  const params = new URLSearchParams({ page: String(page), page_size: String(ADMIN_ITEMS_PER_PAGE) });
  if (status) params.set("submission_status", status);
  if (school) params.set("school", school);
  if (search) params.set("search", search);
  return api.get<ApiPositionSubmissionPage>("/position-submissions/?" + params.toString());
}

export function reviewPositionSubmission(id: string, status: "approved" | "rejected") {
  return api.patch<ApiPositionSubmissionResponse>("/position-submissions/" + id, { status });
}

// Re-export types for convenience
export type { ReportedEvent };

// ── Mappers ─────────────────────────────────────────────────────────

function toReportedEvent(row: ApiReportResponse): ReportedEvent {
  return {
    school: row.school,
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
    category: eventData.category ?? getDefaultEventCategory(),
    price: eventData.price ?? 0,
    food: eventData.food ?? [],
    registration: eventData.registration ?? false,
  };
}

function toEventSubmission(row: ApiSubmissionResponse): EventSubmission {
  return {
    school: row.school,
    id: row.id,
    eventData: toEventFormData(row.event_data as ApiEventCreate),
    submittedBy: row.submitted_by_email || row.user_id,
    submittedAt: row.submitted_at,
    status: row.status as EventSubmission["status"],
    rejectionReason: row.rejection_reason ?? undefined,
  };
}

// ── Club mutations ─────────────────────────────────────────

export async function adminCreateClub(club: Club): Promise<Club> {
  return createClubAPI({
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
  const rows = await getPaginatedItems<ApiReportResponse>("/reports/");
  return rows.map(toReportedEvent);
}

// ── Event Submissions API ───────────────────────────────────────────

export async function getEventSubmissions(school?: string): Promise<EventSubmission[]> {
  const params = new URLSearchParams();
  if (school) params.set("school", school);
  const qs = params.toString();
  const url = `/submissions/${qs ? `?${qs}` : ""}`;
  const rows = await getPaginatedItems<ApiSubmissionResponse>(url);
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

// ── Instagram Publishing API ───────────────────────────────────────

export async function getInstagramPublishBatches(
  page: number,
  pageSize: number,
): Promise<ApiPaginatedInstagramPublishBatchSummaryResponse> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  return api.get<ApiPaginatedInstagramPublishBatchSummaryResponse>(
    `/instagram-publishing/batches/?${params.toString()}`,
  );
}

export async function getInstagramPublishBatch(
  id: string,
): Promise<ApiInstagramPublishBatchResponse> {
  return api.get<ApiInstagramPublishBatchResponse>(
    `/instagram-publishing/batches/${id}`,
  );
}

export async function updateInstagramPublishBatch(
  id: string,
  data: ApiInstagramPublishBatchUpdate,
): Promise<ApiInstagramPublishBatchResponse> {
  return api.patch<ApiInstagramPublishBatchResponse>(
    `/instagram-publishing/batches/${id}`,
    data,
  );
}

export async function publishInstagramBatch(
  id: string,
  data: ApiInstagramPublishBatchPublish,
): Promise<ApiInstagramPublishBatchResponse> {
  return api.post<ApiInstagramPublishBatchResponse>(
    `/instagram-publishing/batches/${id}/publish`,
    data,
  );
}


// ── Admin Clubs API ─────────────────────────────────────────

export type ClubClaim = components["schemas"]["ClubClaimResponse"];

export async function getClubClaims(status?: string, school?: string): Promise<ClubClaim[]> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (school) params.set("school", school);
  const qs = params.toString();
  const url = `/clubs/claims${qs ? `?${qs}` : ""}`;
  return api.get<ClubClaim[]>(url);
}

/** Clubs awaiting (or already through) admin review. */
export async function getClubSubmissions(
  status?: ClubStatus,
  school?: string
): Promise<Club[]> {
  const params = new URLSearchParams();
  if (status) params.set("club_status", status);
  if (school) params.set("school", school);
  const qs = params.toString();
  return getPaginatedItems<Club>(`/clubs/review${qs ? `?${qs}` : ""}`);
}

export async function resolveClubReview(
  clubId: number,
  status: ClubStatus
): Promise<Club> {
  return api.post<Club>(
    `/clubs/${clubId}/review?club_status=${status}`,
    {}
  );
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

// ── Poster Payouts API ─────────────────────────────────────────────

export type PosterPayoutStatus = ApiPayoutStatusUpdate["status"];
export type PosterPayoutFraudStatus =
  ApiPosterPayoutResponse["fraud_status"];
export type AdminPosterPayout = ApiPosterPayoutResponse;

export interface AdminPosterPayoutFilters {
  userId?: string;
  payoutStatus?: PosterPayoutStatus;
  payoutEmail?: string;
  periodFrom?: string;
  periodTo?: string;
  minAmountCents?: number;
  maxAmountCents?: number;
  fraudStatus?: PosterPayoutFraudStatus;
  page: number;
  pageSize: number;
}

export type AdminPosterPayoutDetail = ApiAdminPayoutDetail;

function addOptionalParam(
  params: URLSearchParams,
  name: string,
  value: string | number | undefined,
): void {
  if (value !== undefined && value !== "") {
    params.set(name, String(value));
  }
}

export async function getAdminPosterPayouts(
  filters: AdminPosterPayoutFilters,
): Promise<ApiPaginatedPosterPayoutResponse> {
  const params = new URLSearchParams({
    page: String(filters.page),
    page_size: String(filters.pageSize),
  });
  addOptionalParam(params, "user_id", filters.userId);
  addOptionalParam(params, "payout_status", filters.payoutStatus);
  addOptionalParam(params, "payout_email", filters.payoutEmail);
  addOptionalParam(params, "period_from", filters.periodFrom);
  addOptionalParam(params, "period_to", filters.periodTo);
  addOptionalParam(params, "min_amount_cents", filters.minAmountCents);
  addOptionalParam(params, "max_amount_cents", filters.maxAmountCents);
  addOptionalParam(params, "fraud_status", filters.fraudStatus);
  return api.get<ApiPaginatedPosterPayoutResponse>(`/payouts/admin?${params.toString()}`);
}

export async function getAdminPosterPayoutDetail(
  payoutId: string,
): Promise<AdminPosterPayoutDetail> {
  return api.get<AdminPosterPayoutDetail>(`/payouts/admin/${payoutId}`);
}

export async function transitionAdminPosterPayout(
  payoutId: string,
  status: PosterPayoutStatus,
  notes?: string,
): Promise<AdminPosterPayout> {
  return api.patch<AdminPosterPayout>(`/payouts/admin/${payoutId}/status`, {
    status,
    notes: notes?.trim() || null,
  });
}

export async function markAdminPosterPayoutsPaid(
  payoutIds: string[],
): Promise<AdminPosterPayout[]> {
  return api.post<AdminPosterPayout[]>("/payouts/admin/mark-paid", {
    payout_ids: payoutIds,
  });
}

export async function exportAdminPosterPayouts(
  payoutIds: string[],
): Promise<ApiPayoutCsvExportResponse> {
  return api.post<ApiPayoutCsvExportResponse>("/payouts/admin/export", {
    payout_ids: payoutIds,
  });
}
