/**
 * Poster/QR code marketing types.
 */

import type { FilterState } from "@/shared/types/filter.types";

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
