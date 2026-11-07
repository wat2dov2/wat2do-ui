import imageDelivery from "../../../../backend/controlbox/image_delivery.json" with { type: "json" };
import uploads from "../../../../backend/controlbox/uploads.json" with { type: "json" };

/**
 * The small WebP the backend stores beside an image in `folder` when it is
 * uploaded (`<stem>.thumb.webp`). SVGs have none, and anything that is not one
 * of our images in that folder is returned as is.
 */
function storedThumbnailUrl(src: string, folder: string): string {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return src;
  }
  if (url.origin !== imageDelivery.media_origin || !url.pathname.startsWith(folder)) return src;
  const name = url.pathname.slice(folder.length);
  if (name.includes("/") || name.endsWith(uploads.thumbnail_suffix) || name.toLowerCase().endsWith(".svg")) return src;
  const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  return `${url.origin}${folder}${stem}${uploads.thumbnail_suffix}`;
}

/**
 * A poster's thumbnail, at most `event_image_thumbnail_width_pixels` wide.
 * Poster frames show it instead of the full image, so no image is resized when
 * a page is viewed.
 */
export function posterThumbnailUrl(src: string): string {
  return storedThumbnailUrl(src, "/event-images/");
}

/**
 * A raster club logo's thumbnail, at most `club_logo_thumbnail_size_pixels` on
 * its longest side, for logos drawn at 64 CSS px or less. A logo stored before
 * thumbnails existed may not have one yet, so show the original if it fails.
 */
export function logoThumbnailUrl(src: string): string {
  return storedThumbnailUrl(src, "/organization-logos/");
}
