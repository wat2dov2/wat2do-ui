/**
 * Poster/QR code marketing types.
 */

import type { FilterState } from "@/shared/types/filter.types";
import type { ApprovedPosterTemplate } from "@/shared/config/promoterProgram";

export interface QRCode {
  id: string;
  name: string;
  description?: string;
  destinationType: "event" | "events-list" | "custom-url";
  destinationId?: number | string; // event ID or custom URL
  filters?: FilterState; // if events-list
  createdAt: string;
  createdBy: string;
  isActive: boolean;
  program: "standard" | "promoter";
  latestScan?: string;
  posterTemplateId?: string;
  imageUrl?: string; // Uploaded poster image URL
  latitude: number; // Poster location latitude
  longitude: number; // Poster location longitude
}

export interface QRCodeScan {
  id: string;
  qrCodeId: string;
  scannedAt: string;
  visitorReference: string;
  browserFamily?: string;
  osFamily?: string;
  asn?: number;
  country?: string;
  landingConfirmedAt?: string;
  riskScore: number;
  riskFlags: Array<Record<string, unknown>>;
}

export type PosterLifecycle =
  | "not-placed"
  | "recently-scanned"
  | "quiet"
  | "archived";

export interface PromoterPosterEarnings {
  id: string;
  name: string;
  isActive: boolean;
  latestScan: string | null;
  latitude: number;
  longitude: number;
  posterTemplateId: string | null;
  templatePreviewUrl: string | null;
  lifetimeUniqueVisitors: number;
  periodUniqueVisitors: number;
  periodCreditableVisitors: number;
  pendingCents: number;
}

export interface PromoterEarnings {
  period: string;
  posters: PromoterPosterEarnings[];
  periodCreditableVisitors: number;
  pendingCents: number;
  lifetimePaidCents: number;
  activeSlotsUsed: number;
  activeSlotsLimit: number;
  programEnabled: boolean;
}

export type ConfirmedVisitorBucket = "none" | "low" | "medium" | "high";

export interface CampusCoverageCell {
  latitude: number;
  longitude: number;
  posterCount: number;
  recentPosterCount: number;
  quietPosterCount: number;
  confirmedVisitorBucket: ConfirmedVisitorBucket;
}

export interface CampusCoverage {
  school: string;
  quietAfterDays: number;
  cells: CampusCoverageCell[];
}

export type PosterMapMarker =
  | {
      kind: "owned" | "managed";
      key: string;
      posterId: string;
      name: string;
      latitude: number;
      longitude: number;
      visitorCount: number;
    }
  | {
      kind: "coverage";
      key: string;
      latitude: number;
      longitude: number;
      posterCount: number;
      recentPosterCount: number;
      quietPosterCount: number;
      confirmedVisitorBucket: ConfirmedVisitorBucket;
    };

export interface PromoterPayout {
  id: string;
  period: string;
  payoutEmail: string;
  rateCents: number;
  amountCents: number;
  visitorCount: number;
  status: "pending" | "held" | "paid" | "voided";
  paidAt: string | null;
  createdAt: string;
}

export interface CreatePromoterPostersPayload {
  posterTemplateId: string;
  name: string;
  copies: number;
}

export interface CreatedPromoterPosterBatch {
  posters: QRCode[];
}

export type { ApprovedPosterTemplate };
