import imageDelivery from "../../../../backend/controlbox/image_delivery.json" with { type: "json" };
import uploads from "../../../../backend/controlbox/uploads.json" with { type: "json" };

const EVENT_IMAGES_PATH = "/event-images/";

/**
 * The small WebP the backend stores beside every poster when it is uploaded
 * (`<stem>.thumb.webp`, at most `event_image_thumbnail_width_pixels` wide).
 * Poster frames show it instead of the full image, so no image is resized when
 * a page is viewed. Anything that is not one of our posters is returned as is.
 */
export function posterThumbnailUrl(src: string): string {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return src;
  }
  if (url.origin !== imageDelivery.media_origin || !url.pathname.startsWith(EVENT_IMAGES_PATH)) return src;
  const name = url.pathname.slice(EVENT_IMAGES_PATH.length);
  if (name.includes("/") || name.endsWith(uploads.event_image_thumbnail_suffix)) return src;
  const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  return `${url.origin}${EVENT_IMAGES_PATH}${stem}${uploads.event_image_thumbnail_suffix}`;
}
