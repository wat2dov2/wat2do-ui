import type { components } from "@/shared/generated/api-types";
import { readDiscoverySnapshot } from "@/shared/services/discoveryCache.server";
import {
  fetchServerSnapshot,
  getServerApiBaseUrl,
} from "@/shared/services/serverApi";

export type SiteBanner = components["schemas"]["SiteBannerResponse"];

/** A disabled banner is publishable; upstream failures must keep the last good copy. */
export async function buildSiteBannerSnapshot(): Promise<SiteBanner | null> {
  const response = await fetchServerSnapshot(
    `${getServerApiBaseUrl()}/site-banner`,
    { cache: "no-store" },
  );
  if (response.status === 204) return null;
  if (!response.ok)
    throw new Error(`Site banner request failed with status ${response.status}`);
  return (await response.json()) as SiteBanner;
}

/** Public pages share the durable global banner generation across deployments. */
export async function getSiteBanner(): Promise<SiteBanner | null> {
  try {
    return await readDiscoverySnapshot(
      "_global",
      "site-banner",
      buildSiteBannerSnapshot,
    );
  } catch (error) {
    // A storage outage must not stop the page itself from rendering.
    console.error("Site banner snapshot unavailable:", error);
    return null;
  }
}
