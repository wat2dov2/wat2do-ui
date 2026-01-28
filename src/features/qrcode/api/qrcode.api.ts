/**
 * QR Code API
 * Public API for QR Code feature
 * 
 * This is the public API for the QR code feature.
 * It consolidates repository and service operations.
 */

import type { QRCode, QRCodeScan } from "@/shared/types";
import { mockQRCodes, mockQRScans } from "@/features/qrcode/data/qrCodes";
import { StorageService } from "@/shared/services/storageService";

/**
 * Track a QR code scan
 * Currently stores in localStorage for mock data purposes
 */
export function trackQRScan(qrCodeId: string, userId?: string): void {
  // Store scan in localStorage for tracking
  const scans = getQRScans();
  const newScan: QRCodeScan = {
    id: `scan-${Date.now()}-${Math.random()}`,
    qrCodeId,
    scannedAt: new Date().toISOString(),
    userId: userId || undefined,
    sessionId: userId || `session-${Date.now()}`,
    conversionActions: [],
  };
  scans.push(newScan);
  StorageService.setItem("qrCodeScans", JSON.stringify(scans));
}

/**
 * Get all QR code scans (mock data + localStorage)
 */
export function getQRScans(): QRCodeScan[] {
  const stored = StorageService.getItem<string | null>("qrCodeScans", null);
  const userScans: QRCodeScan[] = stored ? JSON.parse(stored) : [];
  return [...mockQRScans, ...userScans];
}

/**
 * Get scans for a specific QR code
 */
export function getScansForQRCode(qrCodeId: string): QRCodeScan[] {
  return getQRScans().filter((scan) => scan.qrCodeId === qrCodeId);
}

/**
 * Add conversion action to a scan
 */
export function addConversionAction(
  qrCodeId: string,
  action: string,
  sessionId?: string
): void {
  const scans = getQRScans();
  const scan = scans.find(
    (s) => s.qrCodeId === qrCodeId && (sessionId ? s.sessionId === sessionId : true)
  );
  if (scan) {
    scan.conversionActions.push(action);
    StorageService.setItem("qrCodeScans", JSON.stringify(scans));
  }
}

/**
 * Handle QR code redirect based on destination type
 * Tracks the scan and redirects to appropriate destination
 */
export function handleQRRedirect(qrCode: QRCode): void {
  // Track the scan
  const userEmail = StorageService.getItem<string | null>("userEmail", null);
  const userId = userEmail || undefined;
  trackQRScan(qrCode.id, userId);

  // Redirect based on destination type
  switch (qrCode.destinationType) {
    case "event":
      if (qrCode.destinationId) {
        window.location.href = `/?eventId=${qrCode.destinationId}`;
      }
      break;
    case "events-list":
      if (qrCode.filters) {
        const filtersParam = encodeURIComponent(JSON.stringify(qrCode.filters));
        window.location.href = `/?filters=${filtersParam}`;
      } else {
        window.location.href = `/`;
      }
      break;
    case "custom-url":
      if (qrCode.destinationId && typeof qrCode.destinationId === "string") {
        window.location.href = qrCode.destinationId;
      }
      break;
  }
}

/**
 * Get QR code by ID
 */
export function getQRCodeById(id: string): QRCode | null {
  const qrCodes = getQRCodes();
  return qrCodes.find((qr) => qr.id === id) || null;
}

/**
 * Get all QR codes (mock data only)
 */
export function getQRCodes(): QRCode[] {
  return mockQRCodes;
}

/**
 * Save QR code (no-op - QR codes are only from mock data)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function saveQRCode(_qrCode: QRCode): void {
  // No-op: We only use mock data, no real persistence
}

/**
 * Delete QR code (no-op - QR codes are only from mock data)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function deleteQRCode(_id: string): void {
  // No-op: We only use mock data, no real persistence
}
