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

// Hooks
export { useQRCodeScans } from "./hooks/useQRCodeScans";
export { useQRCodeStats } from "./hooks/useQRCodeStats";
export { useQRCodeImage } from "./hooks/useQRCodeImage";
export { useCreateQRCodeForm } from "./hooks/useCreateQRCodeForm";

// API (public interface)
export {
  trackQRScan,
  getQRScans,
  getScansForQRCode,
  addConversionAction,
  handleQRRedirect,
  getQRCodeById,
  getQRCodes,
  saveQRCode,
  deleteQRCode,
} from "./api/qrcode.api";

export {
  generateQRCodeUrl,
  downloadQRCodeAsPNG,
  downloadQRCodeAsSVG,
} from "./api/qrcodeGenerator";
