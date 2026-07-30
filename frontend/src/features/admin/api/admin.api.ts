/**
 * Admin API
 * Handles all admin-related data operations via the backend.
 */

import type {
  EventFormData,
  EventSubmission,
  ReportedEvent,
  Organization,
  OrganizationStatus,
  SubmissionStatus,
} from "@/shared/types";
import type {
  ApiAdminPayoutDetail,
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
  createOrganizationAPI,
  updateOrganizationAPI,
  deleteOrganizationAPI,
} from "@/features/organizations";
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
    organization_id: eventData.organization_id ?? null,
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

function toEventSubmission(row: SubmissionResponse): EventSubmission {
  return {
    id: row.id,
    eventData: toEventFormData(row.event_data as ApiEventCreate),
    submittedBy: row.submitted_by_email || row.user_id,
    submittedAt: row.submitted_at,
    status: row.status as EventSubmission["status"],
    rejectionReason: row.rejection_reason ?? undefined,
  };
}

// ── Organization mutations ─────────────────────────────────────────

export async function adminCreateOrganization(club: Organization): Promise<Organization> {
  return createOrganizationAPI({
    organization_name: club.organization_name,
    categories: club.categories,
    organization_page: club.organization_page,
    ig: club.ig,
    discord: club.discord,
    organization_type: club.organization_type,
    logo_url: club.logo_url,
    school: club.school,
  });
}

export async function adminUpdateOrganization(club: Organization): Promise<Organization> {
  return updateOrganizationAPI(club, {
    organization_name: club.organization_name,
    categories: club.categories,
    organization_page: club.organization_page,
    ig: club.ig,
    discord: club.discord,
    organization_type: club.organization_type,
    logo_url: club.logo_url,
    school: club.school,
  });
}

export async function adminDeleteOrganization(organizationId: number): Promise<void> {
  await deleteOrganizationAPI(organizationId);
}

// ── Reported Events API ─────────────────────────────────────────────

export async function getReportedEvents(): Promise<ReportedEvent[]> {
  const rows = await getPaginatedItems<ReportResponse>("/reports/");
  return rows.map(toReportedEvent);
}

// ── Event Submissions API ───────────────────────────────────────────

export async function getEventSubmissions(school?: string): Promise<EventSubmission[]> {
  const params = new URLSearchParams();
  if (school) params.set("school", school);
  const qs = params.toString();
  const url = `/submissions/${qs ? `?${qs}` : ""}`;
  const rows = await getPaginatedItems<SubmissionResponse>(url);
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


// ── Admin Organizations API ─────────────────────────────────────────

export interface OrganizationClaim {
  id: string;
  organization_id: number;
  user_id: string;
  executive_role: string;
  proof_url: string | null;
  status: string;
  rejection_reason?: string | null;
  created_at: string;
  updated_at: string;
  organizations?: Organization;
  users?: {
    id: string;
    email: string;
    full_name: string | null;
    avatar_url: string | null;
  };
}

export async function getOrganizationClaims(status?: string, school?: string): Promise<OrganizationClaim[]> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (school) params.set("school", school);
  const qs = params.toString();
  const url = `/organizations/claims${qs ? `?${qs}` : ""}`;
  return api.get<OrganizationClaim[]>(url);
}

/** Organizations awaiting (or already through) admin review. */
export async function getOrganizationsForReview(
  status?: OrganizationStatus,
  school?: string
): Promise<Organization[]> {
  const params = new URLSearchParams();
  if (status) params.set("organization_status", status);
  if (school) params.set("school", school);
  const qs = params.toString();
  return getPaginatedItems<Organization>(`/organizations/review${qs ? `?${qs}` : ""}`);
}

export async function resolveOrganizationReview(
  organizationId: number,
  status: OrganizationStatus
): Promise<Organization> {
  return api.post<Organization>(
    `/organizations/${organizationId}/review?organization_status=${status}`,
    {}
  );
}

export async function resolveClaim(
  claimId: string,
  status: "approved" | "rejected",
  rejectionReason?: string
): Promise<OrganizationClaim> {
  return api.patch<OrganizationClaim>(`/organizations/claims/${claimId}`, {
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
export type AdminPosterPayoutPage = ApiPaginatedPosterPayoutResponse;
export type AdminPosterPayoutCsv = ApiPayoutCsvExportResponse;

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
): Promise<AdminPosterPayoutPage> {
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
  return api.get<AdminPosterPayoutPage>(`/payouts/admin?${params.toString()}`);
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
): Promise<AdminPosterPayoutCsv> {
  return api.post<AdminPosterPayoutCsv>("/payouts/admin/export", {
    payout_ids: payoutIds,
  });
}
