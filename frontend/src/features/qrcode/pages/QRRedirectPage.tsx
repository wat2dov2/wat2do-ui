/**
 * Full-page view for /qr/:qrCodeId. Shows loading UI immediately and handles
 * backend resolve (200 -> redirect, 202 -> get location and retry, 404 -> home).
 * No app chrome so the scan experience is minimal.
 */

import { useQRRedirect } from "@/features/qrcode/hooks/useQRRedirect";
import { LoadingPage } from "@/shared/ui/loading-page";
import { Container, PageFrame, PageHeader } from "@/shared/layout";

export function QRRedirectPage() {
  const { message } = useQRRedirect();

  return (
    <PageFrame>
      <Container size="sm">
        <PageHeader title={message} />
        <LoadingPage label={message} />
      </Container>
    </PageFrame>
  );
}
