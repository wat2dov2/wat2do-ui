/**
 * QR Code Generation Utilities
 * Generates QR code data URLs and handles QR code creation
 */

export function generateQRCodeUrl(qrCodeId: string): string {
  const baseUrl = window.location.origin;
  return `${baseUrl}/qr/${qrCodeId}`;
}

export function downloadQRCodeAsPNG(dataUrl: string, filename: string): void {
  const link = document.createElement("a");
  link.download = `${filename}.png`;
  link.href = dataUrl;
  link.click();
}

export function downloadQRCodeAsSVG(svgString: string, filename: string): void {
  const blob = new Blob([svgString], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = `${filename}.svg`;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}
