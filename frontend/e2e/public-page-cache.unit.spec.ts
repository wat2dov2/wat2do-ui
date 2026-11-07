import { expect, test } from "@playwright/test";
import { unstable_getResponseFromNextConfig } from "next/experimental/testing/server.js";
import nextConfig from "../next.config";
import discoveryCache from "../../backend/controlbox/discovery_cache.json" with { type: "json" };

async function cdnCacheControl(path: string) {
  const response = await unstable_getResponseFromNextConfig({
    url: `https://uwaterloo.wat2do.io${path}`,
    nextConfig,
  });
  return response.headers.get("vercel-cdn-cache-control");
}

for (const path of ["/events", "/events/42", "/clubs", "/clubs/7", "/positions", "/about", "/support-local"]) {
  test(`Vercel's CDN keeps ${path} and answers with it while a fresh copy renders`, async () => {
    expect(await cdnCacheControl(path)).toBe(
      `max-age=${discoveryCache.cdn_ttl_seconds}, stale-while-revalidate=${discoveryCache.public_page_stale_while_revalidate_seconds}`,
    );
  });
}

for (const path of ["/events/submit", "/clubs/new", "/login", "/settings", "/admin", "/tickets", "/api/events/stats"]) {
  test(`${path} is never kept at the edge for every visitor`, async () => {
    expect(await cdnCacheControl(path)).toBeNull();
  });
}
