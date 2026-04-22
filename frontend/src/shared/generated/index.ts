/**
 * Convenience re-exports from the auto-generated OpenAPI types.
 *
 * Regenerate with:  npm run generate-types
 *
 * Import these instead of hand-writing backend response shapes.
 */

import type { components } from "./api-types";

// ── Auth ────────────────────────────────────────────────────────────
export type ApiSignupRequest = components["schemas"]["SignupRequest"];
export type ApiLoginRequest = components["schemas"]["LoginRequest"];
export type ApiTokenResponse = components["schemas"]["TokenResponse"];
export type ApiSignupResponse = components["schemas"]["SignupResponse"];
export type ApiForgotPasswordRequest = components["schemas"]["ForgotPasswordRequest"];
export type ApiResetPasswordRequest = components["schemas"]["ResetPasswordRequest"];
export type ApiMessageResponse = components["schemas"]["MessageResponse"];

// ── Users ───────────────────────────────────────────────────────────
export type ApiUserResponse = components["schemas"]["UserResponse"];

// ── Events ──────────────────────────────────────────────────────────
export type ApiEventCreate = components["schemas"]["EventCreate"];
export type ApiEventUpdate = components["schemas"]["EventUpdate"];
export type ApiEventResponse = components["schemas"]["EventResponse"];
export type ApiLatestEventResponse = components["schemas"]["LatestEventResponse"];

// ── Clubs ───────────────────────────────────────────────────────────
export type ApiClubCreate = components["schemas"]["ClubCreate"];
export type ApiClubUpdate = components["schemas"]["ClubUpdate"];
export type ApiClubResponse = components["schemas"]["ClubResponse"];
export type ApiClubIntegrationResponse = components["schemas"]["ClubIntegrationResponse"];
export type ApiClubIntegrationUpdate = components["schemas"]["ClubIntegrationUpdate"];

// ── Club Integrations (Discord) ─────────────────────────────────────
export type ApiDiscordChannelOption = components["schemas"]["DiscordChannelOption"];
export type ApiDiscordServerOption = components["schemas"]["DiscordServerOption"];
export type ApiDiscordIntegrationOptionsResponse = components["schemas"]["DiscordIntegrationOptionsResponse"];

// ── Credits & Promotions ────────────────────────────────────────────
export type ApiCreditBalanceResponse = components["schemas"]["CreditBalanceResponse"];
export type ApiAddCreditsRequest = components["schemas"]["AddCreditsRequest"];
export type ApiPromotionCreate = components["schemas"]["PromotionCreate"];
export type ApiPromotionResponse = components["schemas"]["PromotionResponse"];

// ── Submissions ─────────────────────────────────────────────────────
export type ApiSubmissionCreate = components["schemas"]["SubmissionCreate"];
export type ApiSubmissionUpdate = components["schemas"]["SubmissionUpdate"];
export type ApiSubmissionResponse = components["schemas"]["SubmissionResponse"];

// ── Reports ─────────────────────────────────────────────────────────
export type ApiReportCreate = components["schemas"]["ReportCreate"];
export type ApiReportUpdate = components["schemas"]["ReportUpdate"];
export type ApiReportResponse = components["schemas"]["ReportResponse"];

// ── Scraped Events ──────────────────────────────────────────────────
export type ApiScrapedEventCreate = components["schemas"]["ScrapedEventCreate"];
export type ApiScrapedEventResponse = components["schemas"]["ScrapedEventResponse"];

// ── QR Codes ────────────────────────────────────────────────────────
export type ApiQrCodeCreate = components["schemas"]["QrCodeCreate"];
export type ApiQrCodeResponse = components["schemas"]["QrCodeResponse"];
export type ApiQrCodeRedirect = components["schemas"]["QrCodeRedirect"];
export type ApiQrCodeScanResponse = components["schemas"]["QrCodeScanResponse"];

// ── Recommendations ─────────────────────────────────────────────────
export type ApiRecommendationItem = components["schemas"]["RecommendationItem"];

// ── AI ──────────────────────────────────────────────────────────────
export type ApiFilterStateResponse = components["schemas"]["FilterStateResponse"];
export type ApiEventFormDataResponse = components["schemas"]["EventFormDataResponse"];
export type ApiAIPromptRequest = components["schemas"]["AIPromptRequest"];
