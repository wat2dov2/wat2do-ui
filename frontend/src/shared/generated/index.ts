/**
 * Convenience re-exports from the auto-generated OpenAPI types.
 *
 * Regenerate with:  npm run generate-types
 *
 * Import these instead of hand-writing backend response shapes.
 */

import type { components } from "./api-types";

// ── Auth ────────────────────────────────────────────────────────────
// export type ApiSignupRequest = components["schemas"]["SignupRequest"];
// export type ApiLoginRequest = components["schemas"]["LoginRequest"];
export type ApiTokenResponse = components["schemas"]["TokenResponse"];
// export type ApiForgotPasswordRequest = components["schemas"]["ForgotPasswordRequest"];
// export type ApiResetPasswordRequest = components["schemas"]["ResetPasswordRequest"];
// export type ApiMessageResponse = components["schemas"]["MessageResponse"];

// ── Users ───────────────────────────────────────────────────────────
export type ApiUserResponse = components["schemas"]["UserResponse"];

// ── Events ──────────────────────────────────────────────────────────
export type ApiEventCreate = components["schemas"]["EventCreate"];
// export type ApiEventUpdate = components["schemas"]["EventUpdate"];
export type ApiEventResponse = components["schemas"]["EventResponse"];
export type ApiEventPublicResponse = components["schemas"]["EventPublicResponse"];
export type ApiEventSummaryResponse = components["schemas"]["EventSummaryResponse"];
export type ApiEventFeedResponse = components["schemas"]["EventFeedResponse"];
export type ApiEventStatsResponse = components["schemas"]["EventStatsResponse"];
export type ApiEventAttendeesResponse = components["schemas"]["EventAttendeesResponse"];
export type ApiLatestEventResponse = components["schemas"]["LatestEventResponse"];
export type ApiGoingEventSelection = components["schemas"]["GoingEventSelection"];
export type ApiGoingEventSelectionUpdate =
  components["schemas"]["GoingEventSelectionUpdate"];
export type ApiGoingEventStatusResponse =
  components["schemas"]["GoingEventStatusResponse"];

// ── Instagram Publishing ───────────────────────────────────────────
export type ApiInstagramPublishBatchResponse =
  components["schemas"]["InstagramPublishBatchResponse"];
export type ApiInstagramPublishBatchUpdate =
  components["schemas"]["InstagramPublishBatchUpdate"];
export type ApiInstagramPublishBatchPublish =
  components["schemas"]["InstagramPublishBatchPublish"];

// ── Event Submissions ───────────────────────────────────────────────
// export type ApiSubmissionCreate = components["schemas"]["SubmissionCreate"];
// export type ApiSubmissionUpdate = components["schemas"]["SubmissionUpdate"];
export type ApiSubmissionResponse = components["schemas"]["SubmissionResponse"];
// export type ApiPaginatedSubmissionResponse = components["schemas"]["PaginatedResponse_SubmissionResponse_"];

// ── Organizations ───────────────────────────────────────────────────
// export type ApiOrganizationCreate = components["schemas"]["OrganizationCreate"];
// export type ApiOrganizationUpdate = components["schemas"]["OrganizationUpdate"];
export type ApiOrganizationResponse = components["schemas"]["OrganizationResponse"];
export type ApiOrganizationIntegrationResponse = components["schemas"]["OrganizationIntegrationResponse"];
// export type ApiOrganizationIntegrationUpdate = components["schemas"]["OrganizationIntegrationUpdate"];

// ── Club Integrations (Discord) ─────────────────────────────────────
export type ApiDiscordChannelOption = components["schemas"]["DiscordChannelOption"];
export type ApiDiscordServerOption = components["schemas"]["DiscordServerOption"];
// export type ApiDiscordIntegrationOptionsResponse = components["schemas"]["DiscordIntegrationOptionsResponse"];

// ── Credits & Promotions ────────────────────────────────────────────
export type ApiCreditBalanceResponse = components["schemas"]["CreditBalanceResponse"];
// export type ApiAddCreditsRequest = components["schemas"]["AddCreditsRequest"];
// export type ApiPromotionCreate = components["schemas"]["PromotionCreate"];
export type ApiPromotionResponse = components["schemas"]["PromotionResponse"];

// ── Reports ─────────────────────────────────────────────────────────
// export type ApiReportCreate = components["schemas"]["ReportCreate"];
// export type ApiReportUpdate = components["schemas"]["ReportUpdate"];
export type ApiReportResponse = components["schemas"]["ReportResponse"];
// export type ApiPaginatedReportResponse = components["schemas"]["PaginatedResponse_ReportResponse_"];

// ── QR Codes ────────────────────────────────────────────────────────
export type ApiQrCodeCreate = components["schemas"]["QrCodeCreate"];
export type ApiQrCodeResponse = components["schemas"]["QrCodeResponse"];
export type ApiQrCodeRedirect = components["schemas"]["QrCodeRedirect"];
export type ApiQrCodeScanResponse = components["schemas"]["QrCodeScanResponse"];
export type ApiPromoterPosterBatchCreate =
  components["schemas"]["PromoterPosterBatchCreate"];
export type ApiPromoterPosterBatchResponse =
  components["schemas"]["PromoterPosterBatchResponse"];
export type ApiPromoterEarningsResponse =
  components["schemas"]["PromoterEarningsResponse"];
export type ApiCampusCoverageResponse =
  components["schemas"]["CampusCoverageResponse"];
// export type ApiPaginatedQrCodeResponse = components["schemas"]["PaginatedResponse_QrCodeResponse_"];
// export type ApiPaginatedQrCodeScanResponse = components["schemas"]["PaginatedResponse_QrCodeScanResponse_"];

// ── Poster Payouts ──────────────────────────────────────────────────
export type ApiUserPosterPayoutResponse =
  components["schemas"]["UserPosterPayoutResponse"];
export type ApiPosterPayoutResponse =
  components["schemas"]["PosterPayoutResponse"];
export type ApiAdminPayoutDetail =
  components["schemas"]["AdminPayoutDetail"];
export type ApiPayoutCsvExportResponse =
  components["schemas"]["PayoutCsvExportResponse"];
export type ApiPayoutStatusUpdate =
  components["schemas"]["PayoutStatusUpdate"];
export type ApiPaginatedPosterPayoutResponse =
  components["schemas"]["PaginatedResponse_PosterPayoutResponse_"];

// ── AI ──────────────────────────────────────────────────────────────
export type ApiFilterStateResponse = components["schemas"]["FilterStateResponse"];
export type ApiEventFormDataResponse = components["schemas"]["EventFormDataResponse"];
// export type ApiAIPromptRequest = components["schemas"]["AIPromptRequest"];
