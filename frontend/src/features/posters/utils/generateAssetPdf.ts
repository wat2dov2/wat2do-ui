/**
 * Generate one PDF per asset: one page per QR code, with asset image as background
 * and QR code drawn at the chosen placement (0-1 relative to image).
 */

import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { generateQRCodeUrl } from "@/shared/utils/qrGenerator";
import { stripTrailingSlash } from "@/shared/utils/string";

interface AssetPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AssetForPdf {
  imagePreview: string;
  name: string;
  quantity: number;
  placement: AssetPlacement;
}

interface AssetOutputOptions {
  printSize?: "a4" | "us-letter";
  orientation?: "portrait";
  pageLabels?: string[];
}

/**
 * Load an image once for both PDF and PNG compositing.
 */
function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = source;
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

/**
 * Generate a QR code as PNG data URL for the given poster URL.
 */
async function qrDataUrl(url: string, sizePx: number = 256): Promise<string> {
  return QRCode.toDataURL(url, {
    width: sizePx,
    margin: 4,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

function resolvePosterUrl(posterId: string, baseUrl?: string): string {
  return baseUrl
    ? `${stripTrailingSlash(baseUrl)}/qr/${posterId}`
    : generateQRCodeUrl(posterId);
}

function imageToPngDataUrl(image: HTMLImageElement): string {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is unavailable");
  }
  context.drawImage(image, 0, 0);
  return canvas.toDataURL("image/png");
}

function validatePosterCount(asset: AssetForPdf, posterIds: string[]): void {
  if (posterIds.length !== asset.quantity) {
    throw new Error(
      `Poster count (${posterIds.length}) must match asset quantity (${asset.quantity})`,
    );
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Failed to create poster image"));
      }
    }, "image/png");
  });
}

function fitFooterLabel(
  label: string,
  maxWidth: number,
  measureWidth: (value: string) => number,
): string {
  if (measureWidth(label) <= maxWidth) {
    return label;
  }

  const copySuffix = label.match(/(\s+-\s+\d+\s+of\s+\d+)$/)?.[1] ?? "";
  const base = copySuffix ? label.slice(0, -copySuffix.length) : label;
  const ellipsis = "…";
  let lower = 0;
  let upper = base.length;

  while (lower < upper) {
    const midpoint = Math.ceil((lower + upper) / 2);
    const candidate = `${base.slice(0, midpoint).trimEnd()}${ellipsis}${copySuffix}`;
    if (measureWidth(candidate) <= maxWidth) {
      lower = midpoint;
    } else {
      upper = midpoint - 1;
    }
  }

  return `${base.slice(0, lower).trimEnd()}${ellipsis}${copySuffix}`;
}

/**
 * Generate a single PDF for one asset: one page per poster ID, each page
 * shows the asset image (fit to page) with the QR code at the placement.
 */
export async function generateAssetPdf(
  asset: AssetForPdf,
  posterIds: string[],
  baseUrl?: string,
  options: AssetOutputOptions = {},
): Promise<Blob> {
  validatePosterCount(asset, posterIds);

  const image = await loadImage(asset.imagePreview);
  const imageDataUrl = imageToPngDataUrl(image);

  const doc = new jsPDF({
    orientation: options.orientation ?? "portrait",
    unit: "mm",
    format: options.printSize === "us-letter" ? "letter" : "a4",
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const imageRect = getImageRectOnPage(
    image.naturalWidth,
    image.naturalHeight,
    pageWidth,
    pageHeight,
  );

  const p = asset.placement;

  const qrDataUrls = await Promise.all(
    posterIds.map((posterId) => qrDataUrl(resolvePosterUrl(posterId, baseUrl), 1024)),
  );

  const qrW = p.width * imageRect.width;
  const qrH = p.height * imageRect.height;
  const qrSize = Math.min(qrW, qrH);
  const qrX = imageRect.x + p.x * imageRect.width + (qrW - qrSize) / 2;
  const qrY = imageRect.y + p.y * imageRect.height + (qrH - qrSize) / 2;

  for (let i = 0; i < qrDataUrls.length; i++) {
    if (i > 0) doc.addPage();
    doc.addImage(
      imageDataUrl,
      "PNG",
      imageRect.x,
      imageRect.y,
      imageRect.width,
      imageRect.height
    );
    doc.addImage(qrDataUrls[i], "PNG", qrX, qrY, qrSize, qrSize);
    const label = options.pageLabels?.[i];
    if (label) {
      doc.setFillColor(255, 255, 255);
      doc.rect(0, pageHeight - 6, pageWidth, 6, "F");
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(7);
      doc.text(
        fitFooterLabel(label, pageWidth - 8, (value) =>
          doc.getTextWidth(value),
        ),
        pageWidth / 2,
        pageHeight - 2.2,
        { align: "center" },
      );
    }
  }

  return doc.output("blob");
}

export async function generateAssetPngs(
  asset: AssetForPdf,
  posterIds: string[],
  baseUrl: string | undefined,
  options: AssetOutputOptions,
  onGenerated: (blob: Blob, index: number) => void | Promise<void>,
): Promise<void> {
  validatePosterCount(asset, posterIds);
  const image = await loadImage(asset.imagePreview);

  for (let index = 0; index < posterIds.length; index += 1) {
    const qrImage = await loadImage(
      await qrDataUrl(resolvePosterUrl(posterIds[index], baseUrl), 1024),
    );
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas is unavailable");
    }

    try {
      context.drawImage(image, 0, 0);
      const p = asset.placement;
      const qrWidth = p.width * canvas.width;
      const qrHeight = p.height * canvas.height;
      const qrSize = Math.min(qrWidth, qrHeight);
      const qrX = p.x * canvas.width + (qrWidth - qrSize) / 2;
      const qrY = p.y * canvas.height + (qrHeight - qrSize) / 2;
      context.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

      const label = options.pageLabels?.[index];
      if (label) {
        const footerHeight = Math.max(28, canvas.height * 0.018);
        context.fillStyle = "#ffffff";
        context.fillRect(0, canvas.height - footerHeight, canvas.width, footerHeight);
        context.fillStyle = "#000000";
        context.font = `${Math.max(16, canvas.width * 0.01)}px sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(
          fitFooterLabel(
            label,
            canvas.width - Math.max(32, canvas.width * 0.025),
            (value) => context.measureText(value).width,
          ),
          canvas.width / 2,
          canvas.height - footerHeight / 2,
        );
      }

      const blob = await canvasToBlob(canvas);
      await onGenerated(blob, index);
    } finally {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
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
