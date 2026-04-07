/**
 * QR Code Feature
 * Main export point for QR code feature
 * 
 * Architecture:
 * - components/ - Feature-specific UI components
 * - hooks/ - Feature-specific hooks
 * - api/ - Data layer (API calls, repositories)
 * - data/ - Feature-specific data
 */

// Components
export { QRCodeDetailsModal } from "./components/QRCodeDetailsModal";
export { CreateQRCodeModal } from "./components/CreateQRCodeModal";
export { QRScanMap } from "./components/QRScanMap";
export { QRCodeStatsDisplay } from "./components/QRCode/QRCodeStatsDisplay";
export { QRCodeScansChart } from "./components/QRCode/QRCodeScansChart";
export { GenerateQRAssetsWizard } from "./components/GenerateQRAssetsWizard";

// Hooks
export { useQRCodeScans } from "./hooks/useQRCodeScans";
export { useQRCodeStats } from "./hooks/useQRCodeStats";
export { useQRCodeImage } from "./hooks/useQRCodeImage";
export { useCreateQRCodeForm } from "./hooks/useCreateQRCodeForm";
export { useBackendScans } from "./hooks/useBackendScans";
export { useBackendPosters } from "./hooks/useBackendPosters";

// API (public interface)
export {
  fetchQrRedirectFromBackend,
  fetchQrRedirectWithLocation,
  redirectFromConfig,
  listPostersFromBackend,
  createPosterToBackend,
  updatePosterToBackend,
  deletePosterFromBackend,
  getScansFromBackend,
  normalizeBackendScan,
  normalizeBackendPoster,
} from "./api/qrcode.api";
export type {
  QrRedirectConfig,
  QrRedirectResult,
  QrCodeScanBackend,
  QrCodePosterBackend,
} from "./api/qrcode.api";

export {
  generateQRCodeUrl,
  downloadQRCodeAsPNG,
  downloadQRCodeAsSVG,
} from "@/shared/utils/qrGenerator";
