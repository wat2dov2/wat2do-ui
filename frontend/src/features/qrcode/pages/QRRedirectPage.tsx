/**
 * Full-page view for /qr/:qrCodeId. Shows loading UI immediately and handles
 * backend resolve (200 -> redirect, 202 -> get location and retry, 404 -> home).
 * No app chrome so the scan experience is minimal.
 */

import { useQRRedirect } from "@/features/qrcode/hooks/useQRRedirect";
import { LoadingPage } from "@/shared/ui/loading-page";

export function QRRedirectPage() {
  const { message } = useQRRedirect();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <LoadingPage label={message} spinnerClassName="size-8" className="py-24" />
    </div>
  );
}
