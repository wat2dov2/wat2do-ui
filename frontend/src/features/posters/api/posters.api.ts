/**
 * Poster API - data-fetching functions for QR code posters.
 */

import type {
  CampusCoverage,
  CreatePromoterPostersPayload,
  CreatedPromoterPosterBatch,
  PromoterEarnings,
  PromoterPayout,
  QRCode,
} from "@/features/posters/types";
import type {
  ApiCampusCoverageResponse,
  ApiFilterStateResponse,
  ApiPromoterEarningsResponse,
  ApiPromoterPosterBatchCreate,
  ApiPromoterPosterBatchResponse,
  ApiQrCodeCreate,
  ApiQrCodeResponse,
  ApiUserResponse,
  ApiUserPosterPayoutResponse,
} from "@/shared/generated";
import { api, getPaginatedItems } from "@/shared/services/apiClient";
import { API_BASE_URL } from "@/shared/config/api";
import { stripTrailingSlash } from "@/shared/utils/string";
import { generatedFilterStateToFilterState } from "@/features/search/api/filterService";

/** Poster row from GET /qr/ or POST /qr/. */
type QrCodePosterBackend = ApiQrCodeResponse;

export type CreatePosterPayload = Omit<
  ApiQrCodeCreate,
  "latitude" | "longitude" | "program"
> &
  Partial<Pick<ApiQrCodeCreate, "latitude" | "longitude" | "program">>;

function normalizePosterFilters(
  destinationType: QRCode["destinationType"],
  filters: QrCodePosterBackend["filters"],
): QRCode["filters"] {
  if (destinationType !== "events-list" || !filters || Array.isArray(filters)) {
    return undefined;
  }
  return generatedFilterStateToFilterState(
    filters as Partial<ApiFilterStateResponse>,
  );
}

/** Map backend poster to frontend QRCode. */
function normalizeBackendPoster(b: QrCodePosterBackend): QRCode {
  const destinationType = b.destination_type;
  return {
    id: b.id,
    name: b.name,
    description: b.description ?? undefined,
    destinationType,
    destinationId:
      b.destination_id != null
        ? Number.isNaN(Number(b.destination_id))
          ? b.destination_id
          : Number(b.destination_id)
        : undefined,
    filters: normalizePosterFilters(destinationType, b.filters),
    createdAt: b.created_at,
    createdBy: b.created_by,
    isActive: b.is_active,
    program: b.program,
    latestScan: b.latest_scan ?? undefined,
    posterTemplateId: b.poster_template_id ?? undefined,
    imageUrl: b.image_url ?? undefined,
    latitude: b.latitude,
    longitude: b.longitude,
  };
}

/** List all posters (auth). */
export async function listPostersFromBackend(
  school?: string,
): Promise<QRCode[]> {
  const url = school
    ? `/qr/?${new URLSearchParams({ school }).toString()}`
    : "/qr/";
  const list = await getPaginatedItems<QrCodePosterBackend>(url);
  return (list ?? []).map(normalizeBackendPoster);
}

export async function createPromoterPosters(
  payload: CreatePromoterPostersPayload,
): Promise<CreatedPromoterPosterBatch> {
  const body = {
    program: "promoter",
    poster_template_id: payload.posterTemplateId,
    name: payload.name.trim(),
    copies: payload.copies,
  } satisfies ApiPromoterPosterBatchCreate;
  const response = await api.post<ApiPromoterPosterBatchResponse>("/qr/", body);

  return {
    posters: response.posters.map(normalizeBackendPoster),
  };
}

export async function getPromoterEarnings(): Promise<PromoterEarnings> {
  const response = await api.get<ApiPromoterEarningsResponse>("/qr/earnings");
  return {
    period: response.period,
    posters: response.posters.map((poster) => ({
      id: poster.qr_code_id,
      name: poster.name,
      latestScan: poster.latest_scan,
      latitude: poster.latitude,
      longitude: poster.longitude,
      posterTemplateId: poster.poster_template_id,
      templatePreviewUrl: poster.template_preview_url,
      lifetimeUniqueVisitors: poster.lifetime_unique_scans,
      periodUniqueVisitors: poster.period_unique_scans,
      periodCreditableVisitors: poster.period_creditable_scans,
      pendingCents: poster.pending_cents,
    })),
    periodCreditableVisitors: response.period_creditable_scans,
    periodUnqualifiedScans: response.period_unqualified_scans,
    pendingCents: response.pending_cents,
    lifetimePaidCents: response.lifetime_paid_cents,
    activeSlotsUsed: response.active_slots_used,
    activeSlotsLimit: response.active_slots_limit,
    programEnabled: response.program_enabled,
  };
}

export async function getCampusCoverage(
  school: string,
): Promise<CampusCoverage> {
  const params = new URLSearchParams({ school });
  const response = await api.get<ApiCampusCoverageResponse>(
    `/qr/map?${params}`,
  );
  return {
    school: response.school,
    quietAfterDays: response.quiet_after_days,
    cells: response.cells.map((cell) => ({
      latitude: cell.latitude,
      longitude: cell.longitude,
      posterCount: cell.poster_count,
      recentPosterCount: cell.recent_poster_count,
      quietPosterCount: cell.quiet_poster_count,
      confirmedVisitorBucket: cell.confirmed_visitor_bucket,
    })),
  };
}

export async function listPromoterPayouts(): Promise<PromoterPayout[]> {
  const payouts =
    await getPaginatedItems<ApiUserPosterPayoutResponse>("/payouts/");
  return payouts.map((payout) => ({
    id: payout.id,
    period: payout.period,
    payoutEmail: payout.payout_email,
    rateCents: payout.rate_cents,
    amountCents: payout.amount_cents,
    visitorCount: payout.scan_count,
    status: payout.status,
    paidAt: payout.paid_at,
    createdAt: payout.created_at,
  }));
}

export async function updatePromoterEnrollment(
  payoutEmail: string,
  acceptTos: boolean,
): Promise<ApiUserResponse> {
  return api.put<ApiUserResponse>("/users/me/promoter-enrollment", {
    payout_email: payoutEmail.trim(),
    accept_tos: acceptTos,
  });
}

/** Create a standard poster. Promoter batches use createPromoterPosters. */
export async function createPosterToBackend(
  payload: CreatePosterPayload,
): Promise<QRCode> {
  const body = {
    ...payload,
    description: payload.description ?? null,
    destination_id: payload.destination_id ?? null,
    filters: payload.filters ?? null,
    image_url: payload.image_url ?? null,
    latitude: payload.latitude ?? 0,
    longitude: payload.longitude ?? 0,
  };
  const poster = await api.post<QrCodePosterBackend>("/qr/", body);
  return normalizeBackendPoster(poster);
}

/**
 * Resolve a poster image URL to an absolute URL.
 * If the imageUrl is already absolute (http/https) or a data URI, returns it as-is.
 * Otherwise, prepends API_BASE_URL, normalizing slashes.
 */
export function getQRImageUrl(imageUrl: string): string {
  if (imageUrl.startsWith("http") || imageUrl.startsWith("data:")) {
    return imageUrl;
  }
  const base = stripTrailingSlash(API_BASE_URL);
  const path = imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`;
  return `${base}${path}`;
}
