import { controlBox } from "@/shared/config/controlBox";
import type { components } from "@/shared/generated/api-types";
import { getServerApiBaseUrl } from "@/shared/services/serverApi";

const SITE_BANNER_TAG = "site-banner";

export type SiteBanner = components["schemas"]["SiteBannerResponse"];

/**
 * The one site-wide banner, or null when it is switched off.
 *
 * Fetched on the server so the banner is part of the first paint rather than
 * appearing a moment later, and tagged so turning it on or off can invalidate
 * the cache without waiting out the revalidation window.
 */
export async function getSiteBanner(): Promise<SiteBanner | null> {
  try {
    const response = await fetch(`${getServerApiBaseUrl()}/site-banner`, {
      next: {
        revalidate: controlBox.eventDiscovery.feedRevalidateSeconds,
        tags: [SITE_BANNER_TAG],
      },
    });
    if (response.status === 204 || !response.ok) return null;
    return (await response.json()) as SiteBanner;
  } catch {
    // A banner is an announcement, not the page. If it cannot be read the page
    // still renders without it.
    return null;
  }
}
