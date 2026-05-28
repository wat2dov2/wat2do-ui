/**
 * QR Code Feature — public redirect flow.
 */

export {
  fetchQrRedirectFromBackend,
  fetchQrRedirectWithLocation,
  redirectFromConfig,
  type QrRedirectConfig,
  type QrRedirectResult,
} from "./api/qrcode.api";
export { useQRRedirect } from "./hooks/useQRRedirect";
export { QRRedirectPage } from "./pages/QRRedirectPage";
