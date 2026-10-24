/**
 * Convenience re-exports from the auto-generated OpenAPI types.
 *
 * Regenerate with:  npm run generate-types
 *
 * Import these instead of hand-writing backend response shapes.
 */

import type { components } from "./api-types";

// ── Auth ────────────────────────────────────────────────────────────
export type ApiTokenResponse = components["schemas"]["TokenResponse"];

// ── Users ───────────────────────────────────────────────────────────
export type ApiUserResponse = components["schemas"]["UserResponse"];

// ── Events ──────────────────────────────────────────────────────────
export type ApiEventCreate = components["schemas"]["EventCreate"];
export type ApiEventResponse = components["schemas"]["EventResponse"];
export type ApiEventPublicResponse = components["schemas"]["EventPublicResponse"];
export type ApiEventSummaryResponse = components["schemas"]["EventSummaryResponse"];
export type ApiEventFeedResponse = components["schemas"]["EventFeedResponse"];
export type ApiEventStatsResponse = components["schemas"]["EventStatsResponse"];
export type ApiEventAttendeesResponse = components["schemas"]["EventAttendeesResponse"];
export type ApiLatestAddedItem = components["schemas"]["LatestAddedItem"];
export type ApiGoingEventSelection = components["schemas"]["GoingEventSelection"];
export type ApiGoingEventSelectionUpdate =
  components["schemas"]["GoingEventSelectionUpdate"];
export type ApiGoingEventStatusResponse =
  components["schemas"]["GoingEventStatusResponse"];

// ── Positions ───────────────────────────────────────────────────────
export type ApiPositionStatsResponse = components["schemas"]["PositionStatsResponse"];
export type ApiPositionResponse = components["schemas"]["PositionResponse"];
export type ApiPaginatedPositionResponse =
  components["schemas"]["PositionDirectoryResponse"];
export type ApiPositionCreate = components["schemas"]["PositionCreate"];
export type ApiPositionSubmissionResponse = components["schemas"]["PositionSubmissionResponse"];
export type ApiPositionSubmissionPage = components["schemas"]["PaginatedResponse_PositionSubmissionResponse_"];
export type ApiPositionImageResponse = components["schemas"]["PositionImageResponse"];

// ── Instagram Publishing ───────────────────────────────────────────
export type ApiInstagramPublishBatchResponse =
  components["schemas"]["InstagramPublishBatchResponse"];
export type ApiInstagramPublishBatchSummaryResponse =
  components["schemas"]["InstagramPublishBatchSummaryResponse"];
export type ApiPaginatedInstagramPublishBatchSummaryResponse =
  components["schemas"]["PaginatedResponse_InstagramPublishBatchSummaryResponse_"];
export type ApiInstagramPublishBatchUpdate =
  components["schemas"]["InstagramPublishBatchUpdate"];
export type ApiInstagramPublishBatchPublish =
  components["schemas"]["InstagramPublishBatchPublish"];
export type ApiInstagramSongCreate =
  components["schemas"]["InstagramSongCreate"];
export type ApiInstagramSongResponse =
  components["schemas"]["InstagramSongResponse"];

// ── Event Submissions ───────────────────────────────────────────────
export type ApiSubmissionResponse = components["schemas"]["SubmissionResponse"];

// ── Clubs ───────────────────────────────────────────────────
export type ApiClubResponse = components["schemas"]["ClubResponse"];
export type ApiPaginatedClubsResponse = components["schemas"]["PaginatedResponse_ClubResponse_"];
export type ApiClubIntegrationResponse = components["schemas"]["ClubIntegrationResponse"];

// ── Club Integrations (Discord) ─────────────────────────────────────
export type ApiDiscordChannelOption = components["schemas"]["DiscordChannelOption"];
export type ApiDiscordServerOption = components["schemas"]["DiscordServerOption"];

// ── Reports ─────────────────────────────────────────────────────────
export type ApiReportResponse = components["schemas"]["ReportResponse"];

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

// ── Club payouts and ticketing ──────────────────────────────────────
export type ApiClubPayoutStatus = components["schemas"]["ClubPayoutStatus"];
export type ApiStripeRedirectResponse = components["schemas"]["StripeRedirectResponse"];
export type ApiEventTicketingResponse = components["schemas"]["EventTicketingResponse"];
export type ApiEventTicketingUpdate = components["schemas"]["EventTicketingUpdate"];
export type ApiTicketDateAvailability = components["schemas"]["TicketDateAvailability"];
export type ApiTicketCheckoutCreate = components["schemas"]["TicketCheckoutCreate"];
export type ApiTicketCheckoutResponse = components["schemas"]["TicketCheckoutResponse"];
export type ApiTicketResponse = components["schemas"]["TicketResponse"];
export type ApiTicketOrderResponse = components["schemas"]["TicketOrderResponse"];
export type ApiTicketAttendee = components["schemas"]["TicketAttendee"];
export type ApiEventTicketSalesResponse = components["schemas"]["EventTicketSalesResponse"];
export type ApiTicketCheckInResponse = components["schemas"]["TicketCheckInResponse"];
export type ApiTicketRefundsResponse = components["schemas"]["TicketRefundsResponse"];
export type ApiTicketRefundRequestCreate = components["schemas"]["TicketRefundRequestCreate"];
export type ApiClubEventTicketSummary = components["schemas"]["ClubEventTicketSummary"];
