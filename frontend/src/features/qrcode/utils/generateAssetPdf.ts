/**
 * Generate one PDF per asset: one page per QR code, with asset image as background
 * and QR code drawn at the chosen placement (0-1 relative to image).
 */

import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { generateQRCodeUrl } from "@/shared/utils/qrGenerator";
import { stripTrailingSlash } from "@/shared/utils/string";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

export interface AssetPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AssetForPdf {
  imagePreview: string;
  name: string;
  quantity: number;
  placement: AssetPlacement;
}

/**
 * Load image and return its dimensions (in px). Rejects if load fails.
 */
function loadImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });
}

/**
 * Scale image to fit inside page while keeping aspect ratio.
 * Returns the rectangle (in mm) where the image will be drawn on the page.
 */
function getImageRectOnPage(
  imageWidth: number,
  imageHeight: number,
  pageWidth: number,
  pageHeight: number
): { x: number; y: number; width: number; height: number } {
  const pageRatio = pageWidth / pageHeight;
  const imgRatio = imageWidth / imageHeight;
  let drawWidth: number;
  let drawHeight: number;
  if (imgRatio > pageRatio) {
    drawWidth = pageWidth;
    drawHeight = pageWidth / imgRatio;
  } else {
    drawHeight = pageHeight;
    drawWidth = pageHeight * imgRatio;
  }
  const x = (pageWidth - drawWidth) / 2;
  const y = (pageHeight - drawHeight) / 2;
  return { x, y, width: drawWidth, height: drawHeight };
}

/** Image format for jsPDF from data URL. */
function getImageFormat(dataUrl: string): "PNG" | "JPEG" {
  return dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")
    ? "JPEG"
    : "PNG";
}

/**
 * Generate a QR code as PNG data URL for the given poster URL.
 */
async function qrDataUrl(url: string, sizePx: number = 256): Promise<string> {
  return QRCode.toDataURL(url, {
    width: sizePx,
    margin: 1,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

/**
 * Generate a single PDF for one asset: one page per poster ID, each page
 * shows the asset image (fit to page) with the QR code at the placement.
 */
export async function generateAssetPdf(
  asset: AssetForPdf,
  posterIds: string[],
  baseUrl?: string
): Promise<Blob> {
  if (posterIds.length !== asset.quantity) {
    throw new Error(
      `Poster count (${posterIds.length}) must match asset quantity (${asset.quantity})`
    );
  }

  const [imgWidth, imgHeight] = await loadImageDimensions(asset.imagePreview).then(
    (d) => [d.width, d.height] as [number, number]
  );

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = A4_WIDTH_MM;
  const pageHeight = A4_HEIGHT_MM;
  const imageRect = getImageRectOnPage(imgWidth, imgHeight, pageWidth, pageHeight);

  const p = asset.placement;
  const assetFormat = getImageFormat(asset.imagePreview);

  const qrDataUrls = await Promise.all(
    posterIds.map((posterId) => {
      const url = baseUrl
        ? `${stripTrailingSlash(baseUrl)}/qr/${posterId}`
        : generateQRCodeUrl(posterId);
      return qrDataUrl(url);
    })
  );

  const qrW = p.width * imageRect.width;
  const qrH = p.height * imageRect.height;
  const qrSize = Math.min(qrW, qrH);
  const qrX = imageRect.x + p.x * imageRect.width + (qrW - qrSize) / 2;
  const qrY = imageRect.y + p.y * imageRect.height + (qrH - qrSize) / 2;

  for (let i = 0; i < qrDataUrls.length; i++) {
    if (i > 0) doc.addPage();
    doc.addImage(
      asset.imagePreview,
      assetFormat,
      imageRect.x,
      imageRect.y,
      imageRect.width,
      imageRect.height
    );
    doc.addImage(qrDataUrls[i], "PNG", qrX, qrY, qrSize, qrSize);
  }

  return doc.output("blob");
}

/**
 * Sanitize a string for use in a filename (remove path chars, limit length).
 */
export function sanitizeFilename(name: string, maxLength: number = 40): string {
  const sanitized = name.replace(/[/\\?%*:|"<>]/g, "_").trim();
  if (sanitized.length <= maxLength) return sanitized;
  const ext = sanitized.includes(".") ? sanitized.slice(sanitized.lastIndexOf(".")) : "";
  const base = sanitized.slice(0, maxLength - ext.length);
  return base + ext;
}
