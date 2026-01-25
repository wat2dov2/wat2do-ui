/**
 * QR Code Marketing types
 */

import type { FilterState } from "./filter.types";

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
  imageUrl?: string; // Image/poster image (stored as data URL)
  latitude: number; // Poster location latitude
  longitude: number; // Poster location longitude
}

export interface QRCodeScan {
  id: string;
  qrCodeId: string;
  scannedAt: string;
  userId?: string;
  sessionId: string;
  conversionActions: string[];
  userAgent?: string;
}
