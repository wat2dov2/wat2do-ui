export function generateQRCodeUrl(qrCodeId: string): string {
  const baseUrl = window.location.origin;
  return `${baseUrl}/qr/${qrCodeId}`;
}
